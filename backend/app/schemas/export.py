from typing import Annotated, Literal

from pydantic import BaseModel, Field

# Contract (docs/api.md): a plain file name under exports_dir — letters,
# digits, `.`, `_`, `-`; no path separators (`/`, `\`) or `..`; must not
# start with `.` or `-`. Anything else is a 422 validation_error.
ExportName = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")]


class FuseRequest(BaseModel):
    run_id: str | None = None
    model_id: str | None = None
    adapter_path: str | None = None
    de_quantize: bool = False
    output_name: ExportName


class GGUFRequest(BaseModel):
    model_path: str
    outtype: Literal["f16", "q8_0"]
    output_name: ExportName


class PreflightCheck(BaseModel):
    name: str
    ok: bool
    message: str


class PreflightReport(BaseModel):
    ok: bool
    checks: list[PreflightCheck]


class OllamaModelfileRequest(BaseModel):
    gguf_path: str
    model_family: Literal["qwen", "llama", "smollm", "mistral", "custom"]
    name: ExportName
    custom_template: str | None = None


class ExportJobInfo(BaseModel):
    export_id: str
    kind: Literal["fuse", "gguf"]
    status: Literal["running", "completed", "failed"]
    progress_log: list[str]
    output_path: str | None = None
    error: str | None = None


class ExportArtifact(BaseModel):
    id: str
    kind: Literal["fused", "gguf", "modelfile"]
    path: str
    size_bytes: int
    source_run_id: str | None = None
    created_at: str
