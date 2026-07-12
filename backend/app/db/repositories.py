"""Thin repository classes wrapping SQL access to the app's SQLite tables.

No business logic — each method maps directly to a SQL statement. Connections
are injected by the caller (see app/db/database.py for connection creation).
"""

from __future__ import annotations

import aiosqlite


class RunsRepo:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self._conn = conn

    async def insert(
        self,
        run_id: str,
        name: str,
        status: str,
        config_json: str,
        model_id: str,
        dataset_id: str,
        train_mode: str,
        created_at: str,
    ) -> None:
        await self._conn.execute(
            """
            INSERT INTO runs (
                run_id, name, status, config_json, model_id, dataset_id,
                train_mode, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (run_id, name, status, config_json, model_id, dataset_id, train_mode, created_at),
        )
        await self._conn.commit()

    async def update_status(self, run_id: str, status: str, error: str | None = None) -> None:
        await self._conn.execute(
            "UPDATE runs SET status = ?, error = ? WHERE run_id = ?",
            (status, error, run_id),
        )
        await self._conn.commit()

    async def set_pid(self, run_id: str, pid: int) -> None:
        await self._conn.execute(
            "UPDATE runs SET pid = ? WHERE run_id = ?",
            (pid, run_id),
        )
        await self._conn.commit()

    async def finish(
        self,
        run_id: str,
        status: str,
        finished_at: str,
        adapter_path: str | None = None,
        final_train_loss: float | None = None,
        final_val_loss: float | None = None,
        error: str | None = None,
    ) -> None:
        await self._conn.execute(
            """
            UPDATE runs
            SET status = ?, finished_at = ?, adapter_path = ?,
                final_train_loss = ?, final_val_loss = ?, error = ?
            WHERE run_id = ?
            """,
            (status, finished_at, adapter_path, final_train_loss, final_val_loss, error, run_id),
        )
        await self._conn.commit()

    async def get(self, run_id: str) -> dict | None:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,))
        row = await cursor.fetchone()
        return dict(row) if row is not None else None

    async def list_(
        self, status: str | None = None, limit: int = 50, offset: int = 0
    ) -> tuple[list[dict], int]:
        self._conn.row_factory = aiosqlite.Row
        if status is not None:
            cursor = await self._conn.execute(
                "SELECT * FROM runs WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (status, limit, offset),
            )
            rows = await cursor.fetchall()
            count_cursor = await self._conn.execute(
                "SELECT COUNT(*) FROM runs WHERE status = ?", (status,)
            )
        else:
            cursor = await self._conn.execute(
                "SELECT * FROM runs ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
            rows = await cursor.fetchall()
            count_cursor = await self._conn.execute("SELECT COUNT(*) FROM runs")

        count_row = await count_cursor.fetchone()
        total = count_row[0] if count_row is not None else 0
        return [dict(row) for row in rows], total

    async def list_active(self) -> list[dict]:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute(
            "SELECT * FROM runs WHERE status IN ('queued', 'running')"
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def list_history(
        self,
        model_id: str | None = None,
        train_mode: str | None = None,
        status: str | None = None,
        order_by: str = "created_at DESC",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Filtered/sorted run listing for GET /runs/history.

        `order_by` is a trusted SQL fragment (built from a whitelist by the
        caller, e.g. `app/api/history.py`), never raw user input.
        """
        self._conn.row_factory = aiosqlite.Row
        clauses: list[str] = []
        params: list[str] = []
        if model_id is not None:
            clauses.append("model_id = ?")
            params.append(model_id)
        if train_mode is not None:
            clauses.append("train_mode = ?")
            params.append(train_mode)
        if status is not None:
            clauses.append("status = ?")
            params.append(status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        cursor = await self._conn.execute(
            f"SELECT * FROM runs {where} ORDER BY {order_by} LIMIT ? OFFSET ?",
            (*params, limit, offset),
        )
        rows = await cursor.fetchall()

        count_cursor = await self._conn.execute(f"SELECT COUNT(*) FROM runs {where}", params)
        count_row = await count_cursor.fetchone()
        total = count_row[0] if count_row is not None else 0
        return [dict(row) for row in rows], total


class MetricsRepo:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self._conn = conn

    async def insert_many(self, rows: list[dict]) -> None:
        await self._conn.executemany(
            """
            INSERT OR REPLACE INTO metrics (
                run_id, step, kind, loss, lr, it_per_sec, tokens_per_sec, peak_mem, ts
            ) VALUES (:run_id, :step, :kind, :loss, :lr, :it_per_sec, :tokens_per_sec, :peak_mem, :ts)
            """,
            rows,
        )
        await self._conn.commit()

    async def list_after_step(
        self, run_id: str, after_step: int = 0, kind: str | None = None
    ) -> list[dict]:
        self._conn.row_factory = aiosqlite.Row
        if kind is not None:
            cursor = await self._conn.execute(
                """
                SELECT * FROM metrics
                WHERE run_id = ? AND step > ? AND kind = ?
                ORDER BY step ASC
                """,
                (run_id, after_step, kind),
            )
        else:
            cursor = await self._conn.execute(
                """
                SELECT * FROM metrics
                WHERE run_id = ? AND step > ?
                ORDER BY step ASC
                """,
                (run_id, after_step),
            )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


class DatasetsRepo:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self._conn = conn

    async def insert(
        self,
        id: str,
        name: str,
        format: str,
        path: str,
        row_count: int | None,
        splits_json: str | None,
        created_at: str,
    ) -> None:
        await self._conn.execute(
            """
            INSERT INTO datasets (id, name, format, path, row_count, splits_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (id, name, format, path, row_count, splits_json, created_at),
        )
        await self._conn.commit()

    async def get(self, id: str) -> dict | None:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute("SELECT * FROM datasets WHERE id = ?", (id,))
        row = await cursor.fetchone()
        return dict(row) if row is not None else None

    async def list_(self) -> list[dict]:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute("SELECT * FROM datasets ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def update_splits(self, id: str, row_count: int | None, splits_json: str | None) -> None:
        await self._conn.execute(
            "UPDATE datasets SET row_count = ?, splits_json = ? WHERE id = ?",
            (row_count, splits_json, id),
        )
        await self._conn.commit()

    async def delete(self, id: str) -> None:
        await self._conn.execute("DELETE FROM datasets WHERE id = ?", (id,))
        await self._conn.commit()


class ArtifactsRepo:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self._conn = conn

    async def insert(
        self,
        id: str,
        kind: str,
        path: str,
        size_bytes: int | None,
        source_run_id: str | None,
        created_at: str,
    ) -> None:
        await self._conn.execute(
            """
            INSERT INTO artifacts (id, kind, path, size_bytes, source_run_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (id, kind, path, size_bytes, source_run_id, created_at),
        )
        await self._conn.commit()

    async def list_(self) -> list[dict]:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute("SELECT * FROM artifacts ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get(self, id: str) -> dict | None:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute("SELECT * FROM artifacts WHERE id = ?", (id,))
        row = await cursor.fetchone()
        return dict(row) if row is not None else None


class DownloadsRepo:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self._conn = conn

    async def insert(
        self,
        download_id: str,
        model_id: str,
        status: str,
        bytes_done: int | None,
        bytes_total: int | None,
        files_done: int | None,
        files_total: int | None,
        started_at: str,
    ) -> None:
        await self._conn.execute(
            """
            INSERT INTO downloads (
                download_id, model_id, status, bytes_done, bytes_total,
                files_done, files_total, started_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (download_id, model_id, status, bytes_done, bytes_total, files_done, files_total, started_at),
        )
        await self._conn.commit()

    async def update_progress(
        self,
        download_id: str,
        bytes_done: int | None,
        bytes_total: int | None,
        files_done: int | None,
        files_total: int | None,
    ) -> None:
        await self._conn.execute(
            """
            UPDATE downloads
            SET bytes_done = ?, bytes_total = ?, files_done = ?, files_total = ?
            WHERE download_id = ?
            """,
            (bytes_done, bytes_total, files_done, files_total, download_id),
        )
        await self._conn.commit()

    async def finish(
        self, download_id: str, status: str, finished_at: str, error: str | None = None
    ) -> None:
        await self._conn.execute(
            "UPDATE downloads SET status = ?, finished_at = ?, error = ? WHERE download_id = ?",
            (status, finished_at, error, download_id),
        )
        await self._conn.commit()

    async def get(self, download_id: str) -> dict | None:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute(
            "SELECT * FROM downloads WHERE download_id = ?", (download_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row is not None else None

    async def list_(self) -> list[dict]:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute("SELECT * FROM downloads ORDER BY started_at DESC")
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_active_by_model(self, model_id: str) -> dict | None:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute(
            "SELECT * FROM downloads WHERE model_id = ? AND status = 'running'",
            (model_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row is not None else None


class ExportsRepo:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self._conn = conn

    async def insert(self, export_id: str, kind: str, status: str, created_at: str) -> None:
        await self._conn.execute(
            "INSERT INTO exports (export_id, kind, status, created_at) VALUES (?, ?, ?, ?)",
            (export_id, kind, status, created_at),
        )
        await self._conn.commit()

    async def update_status(
        self,
        export_id: str,
        status: str,
        output_path: str | None = None,
        error: str | None = None,
    ) -> None:
        await self._conn.execute(
            "UPDATE exports SET status = ?, output_path = ?, error = ? WHERE export_id = ?",
            (status, output_path, error, export_id),
        )
        await self._conn.commit()

    async def finish(
        self,
        export_id: str,
        status: str,
        finished_at: str,
        output_path: str | None = None,
        error: str | None = None,
    ) -> None:
        await self._conn.execute(
            """
            UPDATE exports
            SET status = ?, finished_at = ?, output_path = ?, error = ?
            WHERE export_id = ?
            """,
            (status, finished_at, output_path, error, export_id),
        )
        await self._conn.commit()

    async def get(self, export_id: str) -> dict | None:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute(
            "SELECT * FROM exports WHERE export_id = ?", (export_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row is not None else None

    async def list_(self) -> list[dict]:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute("SELECT * FROM exports ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


class RecipeJobsRepo:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self._conn = conn

    async def insert(self, id: str, name: str, status: str, created_at: str) -> None:
        await self._conn.execute(
            "INSERT INTO recipe_jobs (id, name, status, created_at) VALUES (?, ?, ?, ?)",
            (id, name, status, created_at),
        )
        await self._conn.commit()

    async def finish(
        self,
        id: str,
        status: str,
        rows_emitted: int | None,
        preview_json: str | None,
        dataset_id: str | None,
        error: str | None,
    ) -> None:
        await self._conn.execute(
            """
            UPDATE recipe_jobs
            SET status = ?, rows_emitted = ?, preview_json = ?, dataset_id = ?, error = ?
            WHERE id = ?
            """,
            (status, rows_emitted, preview_json, dataset_id, error, id),
        )
        await self._conn.commit()

    async def get(self, id: str) -> dict | None:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute("SELECT * FROM recipe_jobs WHERE id = ?", (id,))
        row = await cursor.fetchone()
        return dict(row) if row is not None else None


class DatasetImportsRepo:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self._conn = conn

    async def insert(
        self,
        id: str,
        hf_dataset_id: str,
        config: str | None,
        split: str,
        name: str,
        max_rows: int | None,
        status: str,
        started_at: str,
    ) -> None:
        await self._conn.execute(
            """
            INSERT INTO dataset_imports (
                id, hf_dataset_id, config, split, name, max_rows, status,
                rows_written, dataset_id, error, started_at, finished_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, NULL)
            """,
            (id, hf_dataset_id, config, split, name, max_rows, status, started_at),
        )
        await self._conn.commit()

    async def update_progress(self, id: str, rows_written: int) -> None:
        await self._conn.execute(
            "UPDATE dataset_imports SET rows_written = ? WHERE id = ?",
            (rows_written, id),
        )
        await self._conn.commit()

    async def finish(
        self,
        id: str,
        status: str,
        dataset_id: str | None,
        error: str | None,
        finished_at: str,
    ) -> None:
        await self._conn.execute(
            """
            UPDATE dataset_imports
            SET status = ?, dataset_id = ?, error = ?, finished_at = ?
            WHERE id = ?
            """,
            (status, dataset_id, error, finished_at, id),
        )
        await self._conn.commit()

    async def get(self, id: str) -> dict | None:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute("SELECT * FROM dataset_imports WHERE id = ?", (id,))
        row = await cursor.fetchone()
        return dict(row) if row is not None else None

    async def list_(self) -> list[dict]:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute(
            "SELECT * FROM dataset_imports ORDER BY started_at DESC"
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_active_by_hf_id(self, hf_dataset_id: str) -> dict | None:
        self._conn.row_factory = aiosqlite.Row
        cursor = await self._conn.execute(
            "SELECT * FROM dataset_imports WHERE hf_dataset_id = ? AND status = 'running'",
            (hf_dataset_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row is not None else None
