"""Custom GRPO reward file management (docs/api.md: /train/reward-files).

Uploaded files live under `MLXLF_DATA_DIR/rewards/<name>.py` and are referenced
by name from `TrainingConfig.reward_functions_file`. Function discovery is
STATIC — a stdlib `ast` scan for `@register_reward_function`-decorated
functions; the API never executes the file. Only the training worker executes
it (via mlx-lm-lora's `load_reward_functions_from_file` at run start).

No mlx imports here — this module must stay importable on the mlx-less
Linux CI runner.
"""

from __future__ import annotations

import ast
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from app.config import Settings, get_settings
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.db.repositories import RunsRepo
from app.schemas.training import (
    REWARD_FILE_NAME_PATTERN,
    RewardFileInfo,
    TrainingConfig,
)

MAX_REWARD_FILE_BYTES = 256 * 1024

REWARD_DECORATOR_NAME = "register_reward_function"


def _mtime_iso(path: Path) -> str:
    """File mtime in the same UTC ISO-8601 shape the rest of the app emits."""
    dt = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _decorator_target_name(node: ast.expr) -> str | None:
    """Extract the trailing identifier a decorator expression refers to.

    Handles `@register_reward_function`, `@register_reward_function(...)`,
    and attribute forms like `@grpo_reward_functions.register_reward_function()`
    (any dotted prefix — only the final attribute matters).
    """
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _registered_name(decorator: ast.expr, func_name: str) -> str | None:
    """Return the registry name a decorator would register, or None if the
    decorator is not `register_reward_function` at all.

    Mirrors mlx-lm-lora's `register_reward_function(name=None)`: an explicit
    string `name=` keyword (or a single positional string literal) wins,
    otherwise the function's own name is used.
    """
    target = decorator.func if isinstance(decorator, ast.Call) else decorator
    if _decorator_target_name(target) != REWARD_DECORATOR_NAME:
        return None
    if isinstance(decorator, ast.Call):
        for kw in decorator.keywords:
            if kw.arg == "name" and isinstance(kw.value, ast.Constant) and isinstance(
                kw.value.value, str
            ):
                return kw.value.value
        if (
            decorator.args
            and isinstance(decorator.args[0], ast.Constant)
            and isinstance(decorator.args[0].value, str)
        ):
            return decorator.args[0].value
    return func_name


def discover_reward_functions(tree: ast.Module) -> list[str]:
    """Names of all `@register_reward_function`-decorated functions, in
    definition order. Walks the whole tree, so nested/class-level definitions
    count too — discovery is informational (listing), not an execution model.
    """
    names: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            registered = _registered_name(decorator, node.name)
            if registered is not None:
                names.append(registered)
                break
    return names


def resolve_reward_file_path(name: str, settings: Settings | None = None) -> Path | None:
    """Absolute path of an uploaded reward file, or None if it doesn't exist.

    `name` is the stored stem (TrainingConfig normalizes references to it).
    """
    settings = settings or get_settings()
    path = settings.rewards_dir / f"{name}.py"
    return path if path.is_file() else None


class RewardFilesService:
    """Upload / list / delete for custom GRPO reward files."""

    @property
    def _rewards_dir(self) -> Path:
        # Resolved per call (not cached) so tests that reset MLXLF_DATA_DIR
        # via `get_settings.cache_clear()` always see the fresh directory.
        return get_settings().rewards_dir

    def _parse(self, content: bytes, *, origin: str) -> ast.Module:
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValidationAppError(f"{origin} is not parseable Python: {exc}") from exc
        try:
            return ast.parse(text)
        except SyntaxError as exc:
            raise ValidationAppError(f"{origin} is not parseable Python: {exc}") from exc

    def save_reward_file(self, filename: str, content: bytes) -> RewardFileInfo:
        if not filename.endswith(".py"):
            raise ValidationAppError("reward file must have a .py extension")
        name = filename[: -len(".py")]
        if not REWARD_FILE_NAME_PATTERN.match(name):
            raise ValidationAppError(
                f"invalid reward file name '{filename}': the name before .py must use "
                "letters, digits, '.', '_' or '-' only and not start with '.' or '-'"
            )
        if len(content) > MAX_REWARD_FILE_BYTES:
            raise ValidationAppError(
                f"reward file is too large (max {MAX_REWARD_FILE_BYTES // 1024} KiB)"
            )

        tree = self._parse(content, origin="uploaded file")
        functions = discover_reward_functions(tree)
        if not functions:
            raise ValidationAppError(
                "no @register_reward_function-decorated function found in the uploaded file"
            )

        self._rewards_dir.mkdir(parents=True, exist_ok=True)
        path = self._rewards_dir / f"{name}.py"
        path.write_bytes(content)  # re-uploading the same name overwrites
        return RewardFileInfo(name=name, functions=functions, uploaded_at=_mtime_iso(path))

    def list_reward_files(self) -> list[RewardFileInfo]:
        rewards_dir = self._rewards_dir
        if not rewards_dir.is_dir():
            return []
        files: list[RewardFileInfo] = []
        for path in sorted(rewards_dir.glob("*.py")):
            if not REWARD_FILE_NAME_PATTERN.match(path.stem):
                continue  # stray file that could never have been uploaded
            # Tolerate unreadable/corrupted-on-disk files by skipping them —
            # one bad file must not 500 the whole listing.
            try:
                tree = ast.parse(path.read_bytes().decode("utf-8"))
            except (OSError, UnicodeDecodeError, SyntaxError):
                continue
            files.append(
                RewardFileInfo(
                    name=path.stem,
                    functions=discover_reward_functions(tree),
                    uploaded_at=_mtime_iso(path),
                )
            )
        return files

    async def delete_reward_file(self, runs_repo: RunsRepo, name: str) -> None:
        # Accept an optional trailing `.py` in the path segment, mirroring how
        # TrainingConfig normalizes references.
        if name.endswith(".py"):
            name = name[: -len(".py")]
        path = self._rewards_dir / f"{name}.py"
        if not REWARD_FILE_NAME_PATTERN.match(name) or not path.is_file():
            raise NotFoundError(f"reward file '{name}' not found")

        # Same guard shape as dataset deletion: the DB is the source of truth
        # for active (queued/running) runs, so the check also holds across
        # manager restarts.
        for row in await runs_repo.list_active():
            config = TrainingConfig.model_validate_json(row["config_json"])
            if config.reward_functions_file == name:
                raise ConflictError(
                    f"reward file '{name}' is referenced by the active training run "
                    f"'{row['run_id']}'"
                )

        path.unlink()


@lru_cache
def get_reward_files_service() -> RewardFilesService:
    return RewardFilesService()
