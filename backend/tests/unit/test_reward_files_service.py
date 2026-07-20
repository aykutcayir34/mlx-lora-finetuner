"""Unit tests for app/services/reward_files_service.py.

Pure stdlib-ast service — no mlx anywhere. The delete conflict tests seed a
queued run row directly in SQLite (like the manager tests do) because the
service reads active runs from the DB, not from in-memory manager state.
"""

from __future__ import annotations

import aiosqlite
import pytest

from app.config import get_settings
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.db.database import init_db
from app.db.repositories import RunsRepo
from app.schemas.training import TrainingConfig
from app.services.reward_files_service import (
    MAX_REWARD_FILE_BYTES,
    RewardFilesService,
    resolve_reward_file_path,
)

VALID_SOURCE = b"""
from mlx_lm_lora.trainer import grpo_reward_functions
from mlx_lm_lora.trainer.grpo_reward_functions import register_reward_function


@register_reward_function()
def called_decorator_reward(prompts, completions, answers, types=None):
    return [1.0 for _ in completions]


@register_reward_function
def plain_decorator_reward(prompts, completions, answers, types=None):
    return [0.0 for _ in completions]


@grpo_reward_functions.register_reward_function(name="custom_named_reward")
def some_function_name(prompts, completions, answers, types=None):
    return [0.5 for _ in completions]


def not_a_reward_function():
    return None
"""


@pytest.fixture
def service(data_dir):
    return RewardFilesService()


@pytest.fixture
def settings(data_dir):
    return get_settings()


# ------------------------------------------------------------------- upload


def test_save_discovers_all_decorator_forms(service):
    info = service.save_reward_file("my_rewards.py", VALID_SOURCE)
    assert info.name == "my_rewards"
    assert info.functions == [
        "called_decorator_reward",
        "plain_decorator_reward",
        "custom_named_reward",
    ]
    assert info.uploaded_at.endswith("Z")


def test_save_writes_file_to_rewards_dir(service, settings):
    service.save_reward_file("my_rewards.py", VALID_SOURCE)
    path = settings.rewards_dir / "my_rewards.py"
    assert path.is_file()
    assert path.read_bytes() == VALID_SOURCE


def test_save_syntax_error_raises_422(service):
    with pytest.raises(ValidationAppError, match="not parseable Python") as exc_info:
        service.save_reward_file("broken.py", b"def broken(:\n    pass\n")
    assert exc_info.value.status_code == 422


def test_save_non_utf8_raises_422(service):
    with pytest.raises(ValidationAppError, match="not parseable Python"):
        service.save_reward_file("binary.py", b"\xff\xfe\x00garbage")


def test_save_without_decorated_function_raises_422(service):
    source = b"def plain(prompts, completions, answers, types=None):\n    return []\n"
    with pytest.raises(ValidationAppError, match="no @register_reward_function"):
        service.save_reward_file("plain.py", source)


@pytest.mark.parametrize(
    "filename",
    [
        "rewards.txt",  # not .py
        "rewards",  # no extension at all
        ".hidden.py",  # leading dot
        "-dash.py",  # leading dash
        "sub/dir.py",  # path separator
        "..%2F..%2Fetc.py",  # separator-ish charset violation
        ("x" * 129) + ".py",  # stem too long
    ],
)
def test_save_bad_name_raises_422(service, filename):
    with pytest.raises(ValidationAppError):
        service.save_reward_file(filename, VALID_SOURCE)


def test_save_oversize_raises_422(service):
    padding = b"# " + b"x" * MAX_REWARD_FILE_BYTES + b"\n"
    with pytest.raises(ValidationAppError, match="too large"):
        service.save_reward_file("big.py", VALID_SOURCE + padding)


def test_save_overwrites_existing_name(service):
    first = service.save_reward_file("my_rewards.py", VALID_SOURCE)
    assert len(first.functions) == 3

    replacement = (
        b"from mlx_lm_lora.trainer.grpo_reward_functions import register_reward_function\n"
        b"@register_reward_function()\n"
        b"def only_reward(prompts, completions, answers, types=None):\n"
        b"    return [1.0]\n"
    )
    second = service.save_reward_file("my_rewards.py", replacement)
    assert second.name == "my_rewards"
    assert second.functions == ["only_reward"]

    files = service.list_reward_files()
    assert [f.name for f in files] == ["my_rewards"]
    assert files[0].functions == ["only_reward"]


# --------------------------------------------------------------------- list


def test_list_empty_when_no_files(service):
    assert service.list_reward_files() == []


def test_list_sorted_by_name_and_skips_corrupted(service, settings):
    service.save_reward_file("zeta.py", VALID_SOURCE)
    service.save_reward_file("alpha.py", VALID_SOURCE)
    # Corrupted-on-disk file (never uploadable through the API): the listing
    # must skip it rather than 500.
    (settings.rewards_dir / "corrupted.py").write_bytes(b"\xff\xfe def broken(:")

    files = service.list_reward_files()
    assert [f.name for f in files] == ["alpha", "zeta"]


# ------------------------------------------------------------------- delete


def _grpo_config(**overrides) -> TrainingConfig:
    base = dict(
        name="grpo-run",
        model_id="mlx-community/Tiny-1",
        dataset_id="ds_1",
        train_mode="grpo",
        group_size=4,
    )
    base.update(overrides)
    return TrainingConfig(**base)


async def _seed_run(settings, config: TrainingConfig, status: str = "queued") -> None:
    await init_db(settings.db_path)
    async with aiosqlite.connect(settings.db_path) as conn:
        await RunsRepo(conn).insert(
            run_id="run_active",
            name=config.name,
            status=status,
            config_json=config.model_dump_json(),
            model_id=config.model_id,
            dataset_id=config.dataset_id,
            train_mode=config.train_mode.value,
            created_at="2026-07-20T00:00:00Z",
        )


@pytest.fixture
async def runs_repo(settings):
    await init_db(settings.db_path)
    async with aiosqlite.connect(settings.db_path) as conn:
        conn.row_factory = aiosqlite.Row
        yield RunsRepo(conn)


async def test_delete_missing_raises_404(service, runs_repo):
    with pytest.raises(NotFoundError):
        await service.delete_reward_file(runs_repo, "nope")


async def test_delete_removes_file(service, settings, runs_repo):
    service.save_reward_file("my_rewards.py", VALID_SOURCE)
    await service.delete_reward_file(runs_repo, "my_rewards")
    assert not (settings.rewards_dir / "my_rewards.py").exists()
    assert service.list_reward_files() == []


async def test_delete_accepts_optional_py_suffix(service, settings, runs_repo):
    service.save_reward_file("my_rewards.py", VALID_SOURCE)
    await service.delete_reward_file(runs_repo, "my_rewards.py")
    assert not (settings.rewards_dir / "my_rewards.py").exists()


async def test_delete_referenced_by_active_run_raises_409(service, settings):
    service.save_reward_file("my_rewards.py", VALID_SOURCE)
    await _seed_run(settings, _grpo_config(reward_functions_file="my_rewards"))

    async with aiosqlite.connect(settings.db_path) as conn:
        conn.row_factory = aiosqlite.Row
        with pytest.raises(ConflictError) as exc_info:
            await service.delete_reward_file(RunsRepo(conn), "my_rewards")
    assert exc_info.value.status_code == 409
    # The file survives a refused delete.
    assert (settings.rewards_dir / "my_rewards.py").is_file()


async def test_delete_unreferenced_file_succeeds_while_run_active(service, settings):
    service.save_reward_file("my_rewards.py", VALID_SOURCE)
    service.save_reward_file("other.py", VALID_SOURCE)
    await _seed_run(settings, _grpo_config(reward_functions_file="my_rewards"))

    async with aiosqlite.connect(settings.db_path) as conn:
        conn.row_factory = aiosqlite.Row
        await service.delete_reward_file(RunsRepo(conn), "other")
    assert not (settings.rewards_dir / "other.py").exists()


# ------------------------------------------------------------------ resolve


def test_resolve_reward_file_path(service, settings):
    assert resolve_reward_file_path("my_rewards", settings=settings) is None
    service.save_reward_file("my_rewards.py", VALID_SOURCE)
    path = resolve_reward_file_path("my_rewards", settings=settings)
    assert path == settings.rewards_dir / "my_rewards.py"
    assert path.is_absolute()
