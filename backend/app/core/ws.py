"""WebSocket connection/broadcast yönetimi.

Basit, konu (topic) tabanlı pub/sub: birden çok WebSocket bir topic'e abone
olabilir; `broadcast` o topic'teki tüm bağlantılara JSON gönderir ve ölü
soketleri sessizce düşürür. `/ws/train/{run_id}` bu modülü kullanır; diğer
WS uç noktaları (indirmeler, chat) kendi yerel mekanizmalarını kullanabilir.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._topics: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, topic: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._topics[topic].add(websocket)

    async def unsubscribe(self, topic: str, websocket: WebSocket) -> None:
        async with self._lock:
            sockets = self._topics.get(topic)
            if sockets is None:
                return
            sockets.discard(websocket)
            if not sockets:
                self._topics.pop(topic, None)

    async def broadcast(self, topic: str, message: dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self._topics.get(topic, ()))

        dead: list[WebSocket] = []
        for websocket in sockets:
            try:
                await websocket.send_json(message)
            except Exception:  # noqa: BLE001 — any send failure means a dead socket
                dead.append(websocket)

        if dead:
            async with self._lock:
                remaining = self._topics.get(topic)
                if remaining is not None:
                    for websocket in dead:
                        remaining.discard(websocket)
                    if not remaining:
                        self._topics.pop(topic, None)


_connection_manager: ConnectionManager | None = None


def get_ws_manager() -> ConnectionManager:
    global _connection_manager
    if _connection_manager is None:
        _connection_manager = ConnectionManager()
    return _connection_manager
