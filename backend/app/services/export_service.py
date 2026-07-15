"""Export pipeline: fuse LoRA adapters, convert to GGUF, render Ollama Modelfiles.

No `mlx`/`mlx_lm` import happens in this process — every heavy operation
(`mlx_lm fuse`, `convert_hf_to_gguf.py`) is run as a subprocess so a crash or
memory spike in the conversion process never takes down the API server.
Subprocess creation goes through `self._run_subprocess`, injectable via the
constructor so tests can capture argv without ever spawning a real process.
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any, Protocol

import aiosqlite
from fastapi import BackgroundTasks, Depends
from jinja2 import Environment, FileSystemLoader

from app.config import Settings, get_settings
from app.core.errors import NotFoundError, TrainingActiveError, ValidationAppError
from app.core.paths import model_dirname
from app.db.repositories import ArtifactsRepo, ExportsRepo, RunsRepo
from app.schemas.export import (
    ExportArtifact,
    ExportJobInfo,
    FuseRequest,
    GGUFRequest,
    OllamaModelfileRequest,
    PreflightCheck,
    PreflightReport,
)

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "ollama"

# Curated set of architectures `convert_hf_to_gguf.py` is known to support.
# SmolLM checkpoints report model_type "llama" (they are llama-architecture),
# so no separate entry is needed for the "smollm" family.
CURATED_ARCHS = {"llama", "qwen2", "qwen3", "mistral", "gemma", "gemma2", "phi3"}

MODEL_FAMILIES = {"qwen", "llama", "smollm", "mistral", "custom"}


class RunSubprocess(Protocol):
    async def __call__(self, *args: str, **kwargs: Any) -> asyncio.subprocess.Process: ...


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _path_size_bytes(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    if path.is_dir():
        return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return 0


class ExportService:
    def __init__(
        self,
        settings: Settings,
        run_subprocess: RunSubprocess | None = None,
    ) -> None:
        self._settings = settings
        self._run_subprocess: RunSubprocess = run_subprocess or asyncio.create_subprocess_exec
        # export_id -> streamed stdout lines for jobs started by this process.
        self._progress_logs: dict[str, list[str]] = {}
        self._jinja_env = Environment(
            loader=FileSystemLoader(str(TEMPLATES_DIR)),
            autoescape=False,
            trim_blocks=True,
            lstrip_blocks=True,
            keep_trailing_newline=True,
        )

    # -- shared helpers -----------------------------------------------------

    async def _open_conn(self) -> aiosqlite.Connection:
        conn = await aiosqlite.connect(self._settings.db_path)
        conn.row_factory = aiosqlite.Row
        return conn

    def _model_path_for_id(self, model_id: str) -> Path:
        return self._settings.models_dir / model_dirname(model_id)

    async def _assert_training_inactive(self, conn: aiosqlite.Connection) -> None:
        active = await RunsRepo(conn).list_active()
        if active:
            raise TrainingActiveError(
                message="Eğitim işi çalışırken export yapılamaz (Metal bellek çakışması)"
            )

    def _export_output_path(self, file_name: str) -> Path:
        """Join `file_name` onto exports_dir, refusing anything that escapes it.

        Defense in depth: the schemas already reject path separators and `..`,
        but no caller of this service may write outside exports_dir even if
        that validation is bypassed.
        """
        candidate = self._settings.exports_dir / file_name
        base = self._settings.exports_dir.resolve()
        resolved = candidate.resolve()
        if resolved == base or not resolved.is_relative_to(base):
            raise ValidationAppError(
                message=f"geçersiz çıktı adı (exports dizini dışına çıkıyor): {file_name}"
            )
        return candidate

    def _llama_cpp_dir(self) -> Path | None:
        candidates = []
        if self._settings.llama_cpp_dir is not None:
            candidates.append(Path(self._settings.llama_cpp_dir))
        candidates.append(self._settings.cache_dir / "llama.cpp")
        for candidate in candidates:
            if (candidate / "convert_hf_to_gguf.py").is_file():
                return candidate
        return None

    # -- fuse -----------------------------------------------------------

    async def _resolve_fuse_source(
        self, conn: aiosqlite.Connection, body: FuseRequest
    ) -> tuple[Path, Path, str | None]:
        """Returns (model_path, adapter_path, source_run_id)."""
        if body.run_id:
            run = await RunsRepo(conn).get(body.run_id)
            if run is None or run["status"] != "completed" or not run["adapter_path"]:
                raise NotFoundError(message=f"run bulunamadı veya tamamlanmamış: {body.run_id}")
            return (
                self._model_path_for_id(run["model_id"]),
                Path(run["adapter_path"]),
                body.run_id,
            )
        if body.model_id and body.adapter_path:
            return self._model_path_for_id(body.model_id), Path(body.adapter_path), None
        raise ValidationAppError(message="run_id ya da (model_id, adapter_path) belirtilmeli")

    async def start_fuse(
        self,
        conn: aiosqlite.Connection,
        body: FuseRequest,
        background_tasks: BackgroundTasks,
    ) -> dict:
        await self._assert_training_inactive(conn)
        model_path, adapter_path, source_run_id = await self._resolve_fuse_source(conn, body)
        save_path = self._export_output_path(body.output_name)

        export_id = f"ex_{uuid.uuid4().hex[:12]}"
        created_at = _now()
        await ExportsRepo(conn).insert(export_id, "fuse", "running", created_at)
        self._progress_logs[export_id] = []

        argv = [
            sys.executable,
            "-m",
            "mlx_lm",
            "fuse",
            "--model",
            str(model_path),
            "--adapter-path",
            str(adapter_path),
            "--save-path",
            str(save_path),
        ]
        if body.de_quantize:
            argv.append("--dequantize")

        background_tasks.add_task(self._run_job, export_id, "fused", argv, save_path, source_run_id)
        return {"export_id": export_id, "kind": "fuse"}

    # -- gguf -----------------------------------------------------------

    async def preflight_gguf(self, model_path: str) -> PreflightReport:
        checks: list[PreflightCheck] = []

        llama_dir = self._llama_cpp_dir()
        if llama_dir is not None:
            checks.append(
                PreflightCheck(
                    name="llama_cpp_available", ok=True, message=f"llama.cpp bulundu: {llama_dir}"
                )
            )
        else:
            default_dir = self._settings.cache_dir / "llama.cpp"
            checks.append(
                PreflightCheck(
                    name="llama_cpp_available",
                    ok=False,
                    message=(
                        "llama.cpp bulunamadı. MLXLF_LLAMA_CPP_DIR ortam değişkenini "
                        f"convert_hf_to_gguf.py içeren bir dizine ayarlayın ya da llama.cpp "
                        f"deposunu {default_dir} içine klonlayın."
                    ),
                )
            )

        config_path = Path(model_path) / "config.json"
        config: dict[str, Any] | None = None
        if not config_path.is_file():
            message = f"config.json bulunamadı: {config_path}"
        else:
            try:
                parsed = json.loads(config_path.read_text())
            except (OSError, UnicodeDecodeError, ValueError) as exc:
                # ValueError covers json.JSONDecodeError.
                message = f"config.json is not valid JSON: {exc}"
            else:
                if isinstance(parsed, dict):
                    config = parsed
                else:
                    message = (
                        "config.json is not valid JSON: expected a JSON object, "
                        f"got {type(parsed).__name__}"
                    )

        if config is None:
            checks.append(PreflightCheck(name="arch_supported", ok=False, message=message))
            checks.append(PreflightCheck(name="weights_dequantized", ok=False, message=message))
        else:
            model_type = config.get("model_type")
            if model_type in CURATED_ARCHS:
                checks.append(
                    PreflightCheck(name="arch_supported", ok=True, message=str(model_type))
                )
            else:
                checks.append(
                    PreflightCheck(
                        name="arch_supported",
                        ok=False,
                        message=(
                            f"model_type '{model_type}' desteklenmiyor "
                            f"(desteklenenler: {sorted(CURATED_ARCHS)})"
                        ),
                    )
                )

            if "quantization" in config:
                checks.append(
                    PreflightCheck(
                        name="weights_dequantized",
                        ok=False,
                        message="weights are 4-bit quantized; re-fuse with de_quantize=true",
                    )
                )
            else:
                checks.append(
                    PreflightCheck(
                        name="weights_dequantized", ok=True, message="weights are not quantized"
                    )
                )

        return PreflightReport(ok=all(c.ok for c in checks), checks=checks)

    async def start_gguf(
        self,
        conn: aiosqlite.Connection,
        body: GGUFRequest,
        background_tasks: BackgroundTasks,
    ) -> dict:
        await self._assert_training_inactive(conn)
        report = await self.preflight_gguf(body.model_path)
        if not report.ok:
            failing = [c.model_dump() for c in report.checks if not c.ok]
            raise ValidationAppError(
                message="GGUF preflight kontrolü başarısız", detail={"checks": failing}
            )

        llama_dir = self._llama_cpp_dir()
        assert llama_dir is not None  # guaranteed by the passing preflight above
        output_path = self._export_output_path(f"{body.output_name}.gguf")

        export_id = f"ex_{uuid.uuid4().hex[:12]}"
        created_at = _now()
        await ExportsRepo(conn).insert(export_id, "gguf", "running", created_at)
        self._progress_logs[export_id] = []

        argv = [
            sys.executable,
            str(llama_dir / "convert_hf_to_gguf.py"),
            body.model_path,
            "--outfile",
            str(output_path),
            "--outtype",
            body.outtype,
        ]

        background_tasks.add_task(self._run_job, export_id, "gguf", argv, output_path, None)
        return {"export_id": export_id, "kind": "gguf"}

    # -- background job runner ------------------------------------------

    async def _run_job(
        self,
        export_id: str,
        artifact_kind: str,
        argv: list[str],
        output_path: Path,
        source_run_id: str | None,
    ) -> None:
        conn = await self._open_conn()
        try:
            exports_repo = ExportsRepo(conn)
            try:
                proc = await self._run_subprocess(
                    *argv,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
            except Exception as exc:  # subprocess spawn itself failed
                self._progress_logs.setdefault(export_id, []).append(str(exc))
                await exports_repo.finish(export_id, "failed", _now(), error=str(exc))
                return

            log = self._progress_logs.setdefault(export_id, [])
            if proc.stdout is not None:
                async for raw_line in proc.stdout:
                    line = raw_line.decode(errors="replace").rstrip("\n")
                    if line:
                        log.append(line)

            returncode = await proc.wait()

            if returncode == 0:
                artifact_id = f"art_{uuid.uuid4().hex[:12]}"
                await ArtifactsRepo(conn).insert(
                    artifact_id,
                    artifact_kind,
                    str(output_path),
                    _path_size_bytes(output_path),
                    source_run_id,
                    _now(),
                )
                await exports_repo.finish(
                    export_id, "completed", _now(), output_path=str(output_path)
                )
            else:
                error = f"process exited with code {returncode}"
                log.append(error)
                await exports_repo.finish(export_id, "failed", _now(), error=error)
        finally:
            await conn.close()

    # -- ollama modelfile -------------------------------------------------

    async def render_modelfile(
        self, conn: aiosqlite.Connection, body: OllamaModelfileRequest
    ) -> dict:
        if body.model_family == "custom" and not body.custom_template:
            raise ValidationAppError(
                message="model_family 'custom' için custom_template zorunludur"
            )

        template = self._jinja_env.get_template(f"{body.model_family}.j2")
        context: dict[str, Any] = {"gguf_path": body.gguf_path}
        if body.model_family == "custom":
            context["custom_template"] = body.custom_template
        rendered = template.render(**context)

        output_dir = self._export_output_path(body.name)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "Modelfile"
        output_path.write_text(rendered)

        artifact_id = f"art_{uuid.uuid4().hex[:12]}"
        await ArtifactsRepo(conn).insert(
            artifact_id,
            "modelfile",
            str(output_path),
            len(rendered.encode()),
            None,
            _now(),
        )

        return {"modelfile": rendered, "path": str(output_path)}

    # -- jobs / artifacts ---------------------------------------------------

    async def get_job(self, conn: aiosqlite.Connection, export_id: str) -> ExportJobInfo:
        row = await ExportsRepo(conn).get(export_id)
        if row is None:
            raise NotFoundError(message=f"export job bulunamadı: {export_id}")
        return ExportJobInfo(
            export_id=row["export_id"],
            kind=row["kind"],
            status=row["status"],
            progress_log=list(self._progress_logs.get(export_id, [])),
            output_path=row["output_path"],
            error=row["error"],
        )

    async def list_artifacts(self, conn: aiosqlite.Connection) -> list[ExportArtifact]:
        rows = await ArtifactsRepo(conn).list_()
        return [
            ExportArtifact(
                id=row["id"],
                kind=row["kind"],
                path=row["path"],
                size_bytes=row["size_bytes"] or 0,
                source_run_id=row["source_run_id"],
                created_at=row["created_at"],
            )
            for row in rows
        ]


# -- FastAPI dependency wiring --------------------------------------------

# Keyed by `id(settings)` so a fresh Settings object (e.g. after
# `get_settings.cache_clear()` between tests, or a real MLXLF_DATA_DIR
# change) transparently produces a fresh ExportService instead of reusing
# one bound to a stale data directory. Within a single process lifetime,
# `get_settings()` returns the same object, so this behaves as a singleton.
_service_cache: dict[int, ExportService] = {}


def get_export_service(
    settings: Annotated[Settings, Depends(get_settings)],
) -> ExportService:
    key = id(settings)
    if key not in _service_cache:
        _service_cache.clear()
        _service_cache[key] = ExportService(settings)
    return _service_cache[key]
