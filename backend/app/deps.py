from collections.abc import AsyncGenerator

import aiosqlite
from fastapi import Depends
from typing import Annotated

from app.config import Settings, get_settings as _get_settings


def get_settings() -> Settings:
    return _get_settings()


async def get_db(
    settings: Annotated[Settings, Depends(get_settings)],
) -> AsyncGenerator[aiosqlite.Connection, None]:
    db = await aiosqlite.connect(settings.db_path)
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()


def get_current_user() -> dict:
    return {"user": "local"}
