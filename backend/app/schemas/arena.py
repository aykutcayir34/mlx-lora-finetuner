# Faz-2 T17: Arena WS frame models (docs/api.md "Arena" section).

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.inference import ChatMessage, ChatUsage, GenerationParams

Side = Literal["a", "b"]


class ArenaSideSpec(BaseModel):
    model_id: str
    adapter_path: str | None = None


class ArenaGenerateFrame(BaseModel):
    type: Literal["generate"]
    side_a: ArenaSideSpec
    side_b: ArenaSideSpec
    messages: list[ChatMessage]
    params: GenerationParams = Field(default_factory=GenerationParams)


class ArenaCancelFrame(BaseModel):
    type: Literal["cancel"]


class ArenaSideStartFrame(BaseModel):
    type: Literal["side_start"]
    side: Side


class ArenaTokenFrame(BaseModel):
    type: Literal["token"]
    side: Side
    text: str


class ArenaSideDoneFrame(BaseModel):
    type: Literal["side_done"]
    side: Side
    usage: ChatUsage


class ArenaDoneFrame(BaseModel):
    type: Literal["done"]


class ArenaErrorFrame(BaseModel):
    type: Literal["error"]
    side: Side | None = None
    code: Literal["training_active", "model_not_found", "internal"]
    message: str
