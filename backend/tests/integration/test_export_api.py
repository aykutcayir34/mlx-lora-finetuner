from __future__ import annotations

import json

import pytest
import pytest_asyncio

from app.config import get_settings
from app.db.repositories import RunsRepo
from app.services.export_service import ExportService, get_export_service


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
    def __init__(self, lines: tuple[bytes, ...] = (b"log line\n",), returncode: int = 0) -> None:
        self.calls: list[tuple] = []
        self._lines = lines
        self._returncode = returncode

    async def __call__(self, *args, **kwargs):
        self.calls.append(args)
        return FakeProcess(list(self._lines), self._returncode)


@pytest_asyncio.fixture
async def export_service(app, data_dir):
    subprocess = RecordingSubprocess()
    service = ExportService(get_settings(), run_subprocess=subprocess)
    app.dependency_overrides[get_export_service] = lambda: service
    yield service, subprocess
    app.dependency_overrides.pop(get_export_service, None)


def _make_model_dir(data_dir, model_id: str, config: dict):
    settings = get_settings()
    org, _, name = model_id.partition("/")
    path = settings.models_dir / f"{org}__{name}"
    path.mkdir(parents=True, exist_ok=True)
    (path / "config.json").write_text(json.dumps(config))
    return path


async def _seed_running_run(db_conn):
    repo = RunsRepo(db_conn)
    await repo.insert(
        "run_active",
        "active-run",
        "running",
        "{}",
        "mlx-community/Foo",
        "ds_1",
        "sft",
        "2026-01-01T00:00:00Z",
    )


# --------------------------------- fuse -----------------------------------


@pytest.mark.asyncio
async def test_fuse_end_to_end_via_api(client, export_service, data_dir):
    service, subprocess = export_service
    settings = get_settings()

    response = await client.post(
        "/api/v1/export/fuse",
        json={
            "model_id": "mlx-community/Foo-4bit",
            "adapter_path": "/abs/adapters",
            "output_name": "fused-out",
        },
    )
    assert response.status_code == 202
    body = response.json()
    assert body["kind"] == "fuse"
    export_id = body["export_id"]

    assert len(subprocess.calls) == 1
    assert "--dequantize" not in subprocess.calls[0]

    job_response = await client.get(f"/api/v1/export/jobs/{export_id}")
    assert job_response.status_code == 200
    job = job_response.json()
    assert job["status"] == "completed"
    assert job["progress_log"] == ["log line"]
    assert job["output_path"] == str(settings.exports_dir / "fused-out")

    artifacts_response = await client.get("/api/v1/export/artifacts")
    assert artifacts_response.status_code == 200
    artifacts = artifacts_response.json()["artifacts"]
    assert len(artifacts) == 1
    assert artifacts[0]["kind"] == "fused"


@pytest.mark.asyncio
async def test_fuse_missing_run_id_is_404(client, export_service):
    response = await client.post(
        "/api/v1/export/fuse", json={"run_id": "does-not-exist", "output_name": "out"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_fuse_training_active_is_409(client, export_service, db_conn):
    await _seed_running_run(db_conn)
    response = await client.post(
        "/api/v1/export/fuse",
        json={
            "model_id": "mlx-community/Foo",
            "adapter_path": "/abs/adapters",
            "output_name": "out",
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "training_active"


@pytest.mark.asyncio
async def test_fuse_validation_error_shape(client, export_service):
    response = await client.post("/api/v1/export/fuse", json={"output_name": "out"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


# --------------------- output_name / name validation ------------------------

BAD_EXPORT_NAMES = [
    "../../evil",  # traversal
    "..",  # bare traversal component
    "/abs/path",  # absolute path
    "a/b",  # path separator
    "a\\b",  # backslash
    ".hidden",  # leading dot
    "-dash",  # leading dash
    "",  # empty
    "a b",  # whitespace
]


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_name", BAD_EXPORT_NAMES)
async def test_fuse_rejects_unsafe_output_name(client, export_service, bad_name):
    service, subprocess = export_service
    response = await client.post(
        "/api/v1/export/fuse",
        json={
            "model_id": "mlx-community/Foo-4bit",
            "adapter_path": "/abs/adapters",
            "output_name": bad_name,
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert subprocess.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_name", BAD_EXPORT_NAMES)
async def test_gguf_rejects_unsafe_output_name(client, export_service, bad_name):
    service, subprocess = export_service
    response = await client.post(
        "/api/v1/export/gguf",
        json={"model_path": "/abs/fused", "outtype": "f16", "output_name": bad_name},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert subprocess.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_name", BAD_EXPORT_NAMES)
async def test_ollama_modelfile_rejects_unsafe_name(client, export_service, bad_name):
    response = await client.post(
        "/api/v1/export/ollama-modelfile",
        json={"gguf_path": "/abs/model.gguf", "model_family": "qwen", "name": bad_name},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


# ------------------------------- gguf --------------------------------------


@pytest.mark.asyncio
async def test_gguf_preflight_all_green_via_api(client, export_service, data_dir):
    settings = get_settings()
    llama_dir = settings.cache_dir / "llama.cpp"
    llama_dir.mkdir(parents=True, exist_ok=True)
    (llama_dir / "convert_hf_to_gguf.py").write_text("# stub")
    model_path = _make_model_dir(data_dir, "mlx-community/Foo", {"model_type": "llama"})

    response = await client.get(
        "/api/v1/export/gguf/preflight", params={"model_path": str(model_path)}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert {c["name"] for c in data["checks"]} == {
        "llama_cpp_available",
        "arch_supported",
        "weights_dequantized",
    }


@pytest.mark.asyncio
async def test_gguf_preflight_missing_llama_cpp_via_api(client, export_service, data_dir):
    model_path = _make_model_dir(data_dir, "mlx-community/Foo", {"model_type": "llama"})
    response = await client.get(
        "/api/v1/export/gguf/preflight", params={"model_path": str(model_path)}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is False


@pytest.mark.asyncio
async def test_gguf_start_422_on_failing_preflight(client, export_service, data_dir):
    model_path = _make_model_dir(data_dir, "mlx-community/Foo", {"model_type": "llama"})
    response = await client.post(
        "/api/v1/export/gguf",
        json={"model_path": str(model_path), "outtype": "f16", "output_name": "out"},
    )
    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "validation_error"
    assert "checks" in data["error"]["detail"]


@pytest.mark.asyncio
async def test_gguf_end_to_end_via_api(client, export_service, data_dir):
    service, subprocess = export_service
    settings = get_settings()
    llama_dir = settings.cache_dir / "llama.cpp"
    llama_dir.mkdir(parents=True, exist_ok=True)
    (llama_dir / "convert_hf_to_gguf.py").write_text("# stub")
    model_path = _make_model_dir(data_dir, "mlx-community/Foo", {"model_type": "llama"})

    response = await client.post(
        "/api/v1/export/gguf",
        json={"model_path": str(model_path), "outtype": "q8_0", "output_name": "my-gguf"},
    )
    assert response.status_code == 202
    export_id = response.json()["export_id"]

    argv = subprocess.calls[0]
    assert argv[-2:] == ("--outtype", "q8_0")
    assert str(settings.exports_dir / "my-gguf.gguf") in argv

    job_response = await client.get(f"/api/v1/export/jobs/{export_id}")
    assert job_response.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_gguf_training_active_is_409(client, export_service, db_conn):
    await _seed_running_run(db_conn)
    response = await client.post(
        "/api/v1/export/gguf",
        json={"model_path": "/abs/whatever", "outtype": "f16", "output_name": "out"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "training_active"


# --------------------------- ollama modelfile -------------------------------


@pytest.mark.asyncio
async def test_ollama_modelfile_via_api(client, export_service):
    settings = get_settings()
    response = await client.post(
        "/api/v1/export/ollama-modelfile",
        json={"gguf_path": "/abs/model.gguf", "model_family": "qwen", "name": "my-model"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["path"] == str(settings.exports_dir / "my-model" / "Modelfile")
    assert "FROM /abs/model.gguf" in data["modelfile"]
    assert "<|im_start|>" in data["modelfile"]

    artifacts_response = await client.get("/api/v1/export/artifacts")
    artifacts = artifacts_response.json()["artifacts"]
    assert any(a["kind"] == "modelfile" for a in artifacts)


@pytest.mark.asyncio
async def test_ollama_modelfile_custom_requires_template(client, export_service):
    response = await client.post(
        "/api/v1/export/ollama-modelfile",
        json={"gguf_path": "/abs/model.gguf", "model_family": "custom", "name": "my-model"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


# --------------------------------- jobs -------------------------------------


@pytest.mark.asyncio
async def test_get_export_job_not_found(client, export_service):
    response = await client.get("/api/v1/export/jobs/ex_missing")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_list_export_artifacts_empty(client, export_service):
    response = await client.get("/api/v1/export/artifacts")
    assert response.status_code == 200
    assert response.json() == {"artifacts": []}
