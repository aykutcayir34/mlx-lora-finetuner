"""Custom GRPO reward file endpoints (docs/api.md: /train/reward-files).

Thin HTTP layer over `app.services.reward_files_service` — upload with static
AST function discovery, listing, and deletion with an active-run 409 guard.
"""

from __future__ import annotations

import aiosqlite
from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel

from app.core.errors import ValidationAppError
from app.db.repositories import RunsRepo
from app.deps import get_current_user, get_db
from app.schemas.training import RewardFileInfo
from app.services.reward_files_service import (
    MAX_REWARD_FILE_BYTES,
    RewardFilesService,
    get_reward_files_service,
)

router = APIRouter(dependencies=[Depends(get_current_user)])


class RewardFilesListResponse(BaseModel):
    files: list[RewardFileInfo]


@router.post("/train/reward-files", response_model=RewardFileInfo, status_code=201)
async def upload_reward_file(
    file: UploadFile = File(...),
    service: RewardFilesService = Depends(get_reward_files_service),
) -> RewardFileInfo:
    # Read one byte past the cap so an oversize upload is detected without
    # buffering an arbitrarily large body (same as POST /train/configs/import).
    raw = await file.read(MAX_REWARD_FILE_BYTES + 1)
    if not file.filename:
        raise ValidationAppError("uploaded reward file has no filename")
    return service.save_reward_file(file.filename, raw)


@router.get("/train/reward-files", response_model=RewardFilesListResponse)
async def list_reward_files(
    service: RewardFilesService = Depends(get_reward_files_service),
) -> RewardFilesListResponse:
    return RewardFilesListResponse(files=service.list_reward_files())


@router.delete("/train/reward-files/{name}", status_code=204)
async def delete_reward_file(
    name: str,
    db: aiosqlite.Connection = Depends(get_db),
    service: RewardFilesService = Depends(get_reward_files_service),
) -> None:
    await service.delete_reward_file(RunsRepo(db), name)
