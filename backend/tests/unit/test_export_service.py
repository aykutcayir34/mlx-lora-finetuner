from __future__ import annotations

import json
import sys
from pathlib import Path

import aiosqlite
import pytest
from starlette.background import BackgroundTasks

from app.config import Settings
from app.core.errors import NotFoundError, TrainingActiveError, ValidationAppError
from app.db.database import init_db
from app.db.repositories import ArtifactsRepo, RunsRepo
from app.schemas.export import FuseRequest, GGUFRequest, OllamaModelfileRequest
from app.services.export_service import ExportService


class FakeProcess:
    def __init__(self, lines: list[bytes], returncode: int = 0) -> None:
        self._lines = list(lines)
        self.returncode = returncode
        self.stdout = self._iter_lines()

    async def _iter_lines(self):
        for line in self._lines:
            yield line

    async def wait(self) -> int:
        return self.returncode


class RecordingSubprocess:
    """Fake `run_subprocess` callable: records argv, never spawns a real process."""

    def __init__(
        self,
        lines: tuple[bytes, ...] = (b"log line 1\n",),
        returncode: int = 0,
        raise_error: Exception | None = None,
    ) -> None:
        self.calls: list[tuple] = []
        self._lines = lines
        self._returncode = returncode
        self._raise_error = raise_error

    async def __call__(self, *args, **kwargs):
        self.calls.append(args)
        if self._raise_error is not None:
            raise self._raise_error
        return FakeProcess(list(self._lines), self._returncode)


@pytest.fixture
async def settings(tmp_path) -> Settings:
    s = Settings(data_dir=tmp_path)
    for d in (s.data_dir, s.models_dir, s.datasets_dir, s.runs_dir, s.exports_dir, s.cache_dir):
        d.mkdir(parents=True, exist_ok=True)
    await init_db(s.db_path)
    return s


@pytest.fixture
async def conn(settings):
    async with aiosqlite.connect(settings.db_path) as c:
        c.row_factory = aiosqlite.Row
        yield c


def _make_model_dir(settings: Settings, model_id: str, config: dict) -> Path:
    org, _, name = model_id.partition("/")
    path = settings.models_dir / f"{org}__{name}"
    path.mkdir(parents=True, exist_ok=True)
    (path / "config.json").write_text(json.dumps(config))
    return path


async def _seed_run(
    conn: aiosqlite.Connection,
    run_id: str,
    status: str,
    model_id: str = "mlx-community/Foo-4bit",
    adapter_path: str | None = "/abs/adapters",
) -> None:
    repo = RunsRepo(conn)
    await repo.insert(
        run_id, "my-run", "queued", "{}", model_id, "ds_1", "sft", "2026-01-01T00:00:00Z"
    )
    if status == "completed":
        await repo.finish(run_id, "completed", "2026-01-01T01:00:00Z", adapter_path=adapter_path)
    elif status != "queued":
        await repo.update_status(run_id, status)


# ------------------------------- fuse ---------------------------------


@pytest.mark.asyncio
async def test_fuse_argv_direct_model_adapter(settings, conn):
    subprocess = RecordingSubprocess()
    service = ExportService(settings, run_subprocess=subprocess)
    body = FuseRequest(
        model_id="mlx-community/Foo-4bit", adapter_path="/abs/adapters", output_name="fused-out"
    )

    bg = BackgroundTasks()
    result = await service.start_fuse(conn, body, bg)
    assert result["kind"] == "fuse"
    export_id = result["export_id"]
    assert export_id.startswith("ex_")

    await bg()

    assert len(subprocess.calls) == 1
    argv = subprocess.calls[0]
    expected_model_path = settings.models_dir / "mlx-community__Foo-4bit"
    assert argv == (
        sys.executable,
        "-m",
        "mlx_lm",
        "fuse",
        "--model",
        str(expected_model_path),
        "--adapter-path",
        "/abs/adapters",
        "--save-path",
        str(settings.exports_dir / "fused-out"),
    )

    job = await service.get_job(conn, export_id)
    assert job.status == "completed"
    assert job.progress_log == ["log line 1"]
    assert job.output_path == str(settings.exports_dir / "fused-out")

    artifacts = await ArtifactsRepo(conn).list_()
    assert len(artifacts) == 1
    assert artifacts[0]["kind"] == "fused"
    assert artifacts[0]["source_run_id"] is None


@pytest.mark.asyncio
async def test_fuse_argv_includes_dequantize_flag_when_requested(settings, conn):
    subprocess = RecordingSubprocess()
    service = ExportService(settings, run_subprocess=subprocess)
    body = FuseRequest(
        model_id="mlx-community/Foo-4bit",
        adapter_path="/abs/adapters",
        output_name="fused-out",
        de_quantize=True,
    )

    bg = BackgroundTasks()
    await service.start_fuse(conn, body, bg)
    await bg()

    argv = subprocess.calls[0]
    assert argv[-1] == "--dequantize"


@pytest.mark.asyncio
async def test_fuse_argv_omits_dequantize_flag_by_default(settings, conn):
    subprocess = RecordingSubprocess()
    service = ExportService(settings, run_subprocess=subprocess)
    body = FuseRequest(
        model_id="mlx-community/Foo-4bit", adapter_path="/abs/adapters", output_name="fused-out"
    )

    bg = BackgroundTasks()
    await service.start_fuse(conn, body, bg)
    await bg()

    assert "--dequantize" not in subprocess.calls[0]


@pytest.mark.asyncio
async def test_fuse_resolves_run_id_to_model_and_adapter(settings, conn):
    await _seed_run(conn, "run_1", status="completed", adapter_path="/abs/adapters/run_1")
    subprocess = RecordingSubprocess()
    service = ExportService(settings, run_subprocess=subprocess)
    body = FuseRequest(run_id="run_1", output_name="fused-out")

    bg = BackgroundTasks()
    result = await service.start_fuse(conn, body, bg)
    await bg()

    argv = subprocess.calls[0]
    expected_model_path = settings.models_dir / "mlx-community__Foo-4bit"
    assert "--model" in argv
    assert argv[argv.index("--model") + 1] == str(expected_model_path)
    assert argv[argv.index("--adapter-path") + 1] == "/abs/adapters/run_1"

    artifacts = await ArtifactsRepo(conn).list_()
    assert artifacts[0]["source_run_id"] == "run_1"

    job = await service.get_job(conn, result["export_id"])
    assert job.status == "completed"


@pytest.mark.asyncio
async def test_fuse_run_id_missing_returns_404(settings, conn):
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    body = FuseRequest(run_id="does-not-exist", output_name="fused-out")

    with pytest.raises(NotFoundError):
        await service.start_fuse(conn, body, BackgroundTasks())


@pytest.mark.asyncio
async def test_fuse_run_id_not_completed_returns_404(settings, conn):
    await _seed_run(conn, "run_2", status="failed")
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    body = FuseRequest(run_id="run_2", output_name="fused-out")

    with pytest.raises(NotFoundError):
        await service.start_fuse(conn, body, BackgroundTasks())


@pytest.mark.asyncio
async def test_fuse_missing_source_raises_validation_error(settings, conn):
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    body = FuseRequest(output_name="fused-out")

    with pytest.raises(ValidationAppError):
        await service.start_fuse(conn, body, BackgroundTasks())


@pytest.mark.asyncio
async def test_fuse_training_active_raises_409(settings, conn):
    await _seed_run(conn, "run_running", status="running")
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    body = FuseRequest(
        model_id="mlx-community/Foo-4bit", adapter_path="/abs/adapters", output_name="fused-out"
    )

    with pytest.raises(TrainingActiveError):
        await service.start_fuse(conn, body, BackgroundTasks())


@pytest.mark.asyncio
async def test_fuse_failure_marks_job_failed_and_logs_error(settings, conn):
    subprocess = RecordingSubprocess(lines=(b"about to fail\n",), returncode=1)
    service = ExportService(settings, run_subprocess=subprocess)
    body = FuseRequest(
        model_id="mlx-community/Foo-4bit", adapter_path="/abs/adapters", output_name="fused-out"
    )

    bg = BackgroundTasks()
    result = await service.start_fuse(conn, body, bg)
    await bg()

    job = await service.get_job(conn, result["export_id"])
    assert job.status == "failed"
    assert job.error is not None
    assert "about to fail" in job.progress_log
    assert (await ArtifactsRepo(conn).list_()) == []


@pytest.mark.asyncio
async def test_fuse_subprocess_spawn_error_marks_job_failed(settings, conn):
    subprocess = RecordingSubprocess(raise_error=OSError("no such file"))
    service = ExportService(settings, run_subprocess=subprocess)
    body = FuseRequest(
        model_id="mlx-community/Foo-4bit", adapter_path="/abs/adapters", output_name="fused-out"
    )

    bg = BackgroundTasks()
    result = await service.start_fuse(conn, body, bg)
    await bg()

    job = await service.get_job(conn, result["export_id"])
    assert job.status == "failed"
    assert "no such file" in job.error


# ------------------------------ preflight -------------------------------


@pytest.mark.asyncio
async def test_preflight_all_green(settings):
    llama_dir = settings.cache_dir / "llama.cpp"
    llama_dir.mkdir(parents=True, exist_ok=True)
    (llama_dir / "convert_hf_to_gguf.py").write_text("# stub")
    model_path = _make_model_dir(settings, "mlx-community/Foo", {"model_type": "llama"})

    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    report = await service.preflight_gguf(str(model_path))

    assert report.ok is True
    by_name = {c.name: c for c in report.checks}
    assert by_name["llama_cpp_available"].ok is True
    assert by_name["arch_supported"].ok is True
    assert by_name["arch_supported"].message == "llama"
    assert by_name["weights_dequantized"].ok is True


@pytest.mark.asyncio
async def test_preflight_missing_llama_cpp_fails(settings):
    model_path = _make_model_dir(settings, "mlx-community/Foo", {"model_type": "llama"})
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    report = await service.preflight_gguf(str(model_path))

    assert report.ok is False
    by_name = {c.name: c for c in report.checks}
    assert by_name["llama_cpp_available"].ok is False
    assert "MLXLF_LLAMA_CPP_DIR" in by_name["llama_cpp_available"].message


@pytest.mark.asyncio
async def test_preflight_quantized_weights_fail(settings):
    llama_dir = settings.cache_dir / "llama.cpp"
    llama_dir.mkdir(parents=True, exist_ok=True)
    (llama_dir / "convert_hf_to_gguf.py").write_text("# stub")
    model_path = _make_model_dir(
        settings,
        "mlx-community/Foo-4bit",
        {"model_type": "llama", "quantization": {"bits": 4, "group_size": 64}},
    )

    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    report = await service.preflight_gguf(str(model_path))

    assert report.ok is False
    by_name = {c.name: c for c in report.checks}
    assert by_name["weights_dequantized"].ok is False
    assert "de_quantize=true" in by_name["weights_dequantized"].message


@pytest.mark.asyncio
async def test_preflight_unknown_arch_fails(settings):
    llama_dir = settings.cache_dir / "llama.cpp"
    llama_dir.mkdir(parents=True, exist_ok=True)
    (llama_dir / "convert_hf_to_gguf.py").write_text("# stub")
    model_path = _make_model_dir(settings, "mlx-community/Foo", {"model_type": "some-exotic-arch"})

    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    report = await service.preflight_gguf(str(model_path))

    assert report.ok is False
    by_name = {c.name: c for c in report.checks}
    assert by_name["arch_supported"].ok is False


@pytest.mark.asyncio
async def test_preflight_missing_config_fails_arch_and_weights(settings, tmp_path):
    llama_dir = settings.cache_dir / "llama.cpp"
    llama_dir.mkdir(parents=True, exist_ok=True)
    (llama_dir / "convert_hf_to_gguf.py").write_text("# stub")
    empty_model_dir = tmp_path / "no-config-model"
    empty_model_dir.mkdir()

    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    report = await service.preflight_gguf(str(empty_model_dir))

    assert report.ok is False
    by_name = {c.name: c for c in report.checks}
    assert by_name["arch_supported"].ok is False
    assert by_name["weights_dequantized"].ok is False


@pytest.mark.asyncio
async def test_preflight_respects_explicit_llama_cpp_dir_setting(settings, tmp_path):
    custom_dir = tmp_path / "custom-llama-cpp"
    custom_dir.mkdir()
    (custom_dir / "convert_hf_to_gguf.py").write_text("# stub")
    settings = settings.model_copy(update={"llama_cpp_dir": custom_dir})
    model_path = _make_model_dir(settings, "mlx-community/Foo", {"model_type": "llama"})

    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    report = await service.preflight_gguf(str(model_path))

    assert report.ok is True


# --------------------------------- gguf ----------------------------------


@pytest.mark.asyncio
async def test_gguf_argv_and_job_lifecycle(settings, conn):
    llama_dir = settings.cache_dir / "llama.cpp"
    llama_dir.mkdir(parents=True, exist_ok=True)
    (llama_dir / "convert_hf_to_gguf.py").write_text("# stub")
    model_path = _make_model_dir(settings, "mlx-community/Foo", {"model_type": "llama"})

    subprocess = RecordingSubprocess()
    service = ExportService(settings, run_subprocess=subprocess)
    body = GGUFRequest(model_path=str(model_path), outtype="q8_0", output_name="my-gguf")

    bg = BackgroundTasks()
    result = await service.start_gguf(conn, body, bg)
    assert result["kind"] == "gguf"
    await bg()

    argv = subprocess.calls[0]
    expected_outfile = settings.exports_dir / "my-gguf.gguf"
    assert argv == (
        sys.executable,
        str(llama_dir / "convert_hf_to_gguf.py"),
        str(model_path),
        "--outfile",
        str(expected_outfile),
        "--outtype",
        "q8_0",
    )

    job = await service.get_job(conn, result["export_id"])
    assert job.status == "completed"

    artifacts = await ArtifactsRepo(conn).list_()
    assert artifacts[0]["kind"] == "gguf"


@pytest.mark.asyncio
async def test_gguf_422_when_preflight_fails(settings, conn):
    # No llama.cpp present -> preflight fails.
    model_path = _make_model_dir(settings, "mlx-community/Foo", {"model_type": "llama"})
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    body = GGUFRequest(model_path=str(model_path), outtype="f16", output_name="my-gguf")

    with pytest.raises(ValidationAppError) as excinfo:
        await service.start_gguf(conn, body, BackgroundTasks())

    assert "checks" in excinfo.value.detail


@pytest.mark.asyncio
async def test_gguf_training_active_raises_409(settings, conn):
    await _seed_run(conn, "run_running", status="running")
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    body = GGUFRequest(model_path="/abs/whatever", outtype="f16", output_name="my-gguf")

    with pytest.raises(TrainingActiveError):
        await service.start_gguf(conn, body, BackgroundTasks())


@pytest.mark.asyncio
async def test_gguf_failure_marks_job_failed(settings, conn):
    llama_dir = settings.cache_dir / "llama.cpp"
    llama_dir.mkdir(parents=True, exist_ok=True)
    (llama_dir / "convert_hf_to_gguf.py").write_text("# stub")
    model_path = _make_model_dir(settings, "mlx-community/Foo", {"model_type": "llama"})

    subprocess = RecordingSubprocess(lines=(b"conversion error\n",), returncode=1)
    service = ExportService(settings, run_subprocess=subprocess)
    body = GGUFRequest(model_path=str(model_path), outtype="f16", output_name="my-gguf")

    bg = BackgroundTasks()
    result = await service.start_gguf(conn, body, bg)
    await bg()

    job = await service.get_job(conn, result["export_id"])
    assert job.status == "failed"
    assert "conversion error" in job.progress_log


# ----------------------------- ollama modelfile ---------------------------


@pytest.mark.asyncio
async def test_modelfile_qwen_golden(settings, conn):
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    body = OllamaModelfileRequest(gguf_path="/abs/model.gguf", model_family="qwen", name="my-model")

    result = await service.render_modelfile(conn, body)

    expected = (
        'FROM /abs/model.gguf\n\nTEMPLATE """{{ if .System }}<|im_start|>system\n'
        "{{ .System }}<|im_end|>\n{{ end }}<|im_start|>user\n{{ .Prompt }}<|im_end|>\n"
        '<|im_start|>assistant\n{{ .Response }}<|im_end|>\n"""\n'
        'PARAMETER stop "<|im_start|>"\nPARAMETER stop "<|im_end|>"\n'
    )
    assert result["modelfile"] == expected
    assert result["path"] == str(settings.exports_dir / "my-model" / "Modelfile")
    assert Path(result["path"]).read_text() == expected


@pytest.mark.asyncio
async def test_modelfile_llama_golden(settings, conn):
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    body = OllamaModelfileRequest(
        gguf_path="/abs/model.gguf", model_family="llama", name="my-model"
    )

    result = await service.render_modelfile(conn, body)

    expected = (
        'FROM /abs/model.gguf\n\nTEMPLATE """{{ if .System }}<|start_header_id|>system'
        "<|end_header_id|>\n\n{{ .System }}<|eot_id|>{{ end }}<|start_header_id|>user"
        "<|end_header_id|>\n\n{{ .Prompt }}<|eot_id|><|start_header_id|>assistant"
        '<|end_header_id|>\n\n{{ .Response }}<|eot_id|>"""\n'
        'PARAMETER stop "<|start_header_id|>"\nPARAMETER stop "<|end_header_id|>"\n'
        'PARAMETER stop "<|eot_id|>"\n'
    )
    assert result["modelfile"] == expected


@pytest.mark.asyncio
async def test_modelfile_smollm_golden(settings, conn):
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    body = OllamaModelfileRequest(
        gguf_path="/abs/model.gguf", model_family="smollm", name="my-model"
    )

    result = await service.render_modelfile(conn, body)

    expected = (
        'FROM /abs/model.gguf\n\nTEMPLATE """{{ if .System }}<|im_start|>system\n'
        "{{ .System }}<|im_end|>\n{{ end }}<|im_start|>user\n{{ .Prompt }}<|im_end|>\n"
        '<|im_start|>assistant\n{{ .Response }}<|im_end|>\n"""\n'
        'PARAMETER stop "<|im_start|>"\nPARAMETER stop "<|im_end|>"\n'
    )
    assert result["modelfile"] == expected


@pytest.mark.asyncio
async def test_modelfile_mistral_golden(settings, conn):
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    body = OllamaModelfileRequest(
        gguf_path="/abs/model.gguf", model_family="mistral", name="my-model"
    )

    result = await service.render_modelfile(conn, body)

    expected = (
        'FROM /abs/model.gguf\n\nTEMPLATE """{{ if .System }}{{ .System }}\n\n'
        '{{ end }}[INST] {{ .Prompt }} [/INST]{{ .Response }}"""\n'
        'PARAMETER stop "[INST]"\nPARAMETER stop "[/INST]"\n'
    )
    assert result["modelfile"] == expected


@pytest.mark.asyncio
async def test_modelfile_custom_uses_provided_template(settings, conn):
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    body = OllamaModelfileRequest(
        gguf_path="/abs/model.gguf",
        model_family="custom",
        name="my-model",
        custom_template="{{ .Prompt }}",
    )

    result = await service.render_modelfile(conn, body)

    expected = 'FROM /abs/model.gguf\n\nTEMPLATE """{{ .Prompt }}"""\n'
    assert result["modelfile"] == expected


@pytest.mark.asyncio
async def test_modelfile_custom_without_template_is_422(settings, conn):
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    body = OllamaModelfileRequest(
        gguf_path="/abs/model.gguf", model_family="custom", name="my-model"
    )

    with pytest.raises(ValidationAppError):
        await service.render_modelfile(conn, body)


@pytest.mark.asyncio
async def test_modelfile_registers_artifact(settings, conn):
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    body = OllamaModelfileRequest(gguf_path="/abs/model.gguf", model_family="qwen", name="my-model")

    await service.render_modelfile(conn, body)

    artifacts = await ArtifactsRepo(conn).list_()
    assert len(artifacts) == 1
    assert artifacts[0]["kind"] == "modelfile"
    assert artifacts[0]["path"] == str(settings.exports_dir / "my-model" / "Modelfile")


# --------------------------------- misc -----------------------------------


@pytest.mark.asyncio
async def test_get_job_missing_raises_404(settings, conn):
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    with pytest.raises(NotFoundError):
        await service.get_job(conn, "ex_missing")


@pytest.mark.asyncio
async def test_list_artifacts_empty(settings, conn):
    service = ExportService(settings, run_subprocess=RecordingSubprocess())
    assert await service.list_artifacts(conn) == []
