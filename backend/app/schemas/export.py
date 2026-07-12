from typing import Literal

from pydantic import BaseModel


class FuseRequest(BaseModel):
    run_id: str | None = None
    model_id: str | None = None
    adapter_path: str | None = None
    de_quantize: bool = False
    output_name: str


class GGUFRequest(BaseModel):
    model_path: str
    outtype: Literal["f16", "q8_0"]
    output_name: str


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
    name: str
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
