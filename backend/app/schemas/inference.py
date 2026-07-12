from typing import Literal

from pydantic import BaseModel, Field


class AdapterInfo(BaseModel):
    adapter_path: str
    run_id: str | None = None
    name: str
    base_model_id: str
    created_at: str


class GenerationParams(BaseModel):
    max_tokens: int = 512
    temperature: float = 0.7
    top_p: float = 0.9
    repetition_penalty: float | None = None


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatGenerateFrame(BaseModel):
    type: Literal["generate"]
    model_id: str
    adapter_path: str | None = None
    messages: list[ChatMessage]
    params: GenerationParams = Field(default_factory=GenerationParams)


class ChatCancelFrame(BaseModel):
    type: Literal["cancel"]


class ChatTokenFrame(BaseModel):
    type: Literal["token"]
    text: str


class ChatUsage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    tokens_per_sec: float


class ChatDoneFrame(BaseModel):
    type: Literal["done"]
    usage: ChatUsage


class ChatErrorFrame(BaseModel):
    type: Literal["error"]
    code: Literal["training_active", "model_not_found", "internal"]
    message: str
