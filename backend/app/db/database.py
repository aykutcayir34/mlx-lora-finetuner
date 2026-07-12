"""SQLite database initialization and versioned migrations for the app.

No business logic here — just schema management via aiosqlite.
"""

from __future__ import annotations

from pathlib import Path

import aiosqlite

# Each migration is a (version, sql) pair where sql is either a single SQL
# string or a list of SQL statements to execute in order.
MIGRATIONS: list[tuple[int, str | list[str]]] = [
    (
        1,
        [
            """
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                config_json TEXT NOT NULL,
                model_id TEXT NOT NULL,
                dataset_id TEXT NOT NULL,
                train_mode TEXT NOT NULL,
                created_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                pid INTEGER,
                adapter_path TEXT,
                final_train_loss REAL,
                final_val_loss REAL,
                error TEXT
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS metrics (
                run_id TEXT NOT NULL,
                step INTEGER NOT NULL,
                kind TEXT NOT NULL,
                loss REAL,
                lr REAL,
                it_per_sec REAL,
                tokens_per_sec REAL,
                peak_mem REAL,
                ts TEXT NOT NULL,
                PRIMARY KEY (run_id, step, kind)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                path TEXT NOT NULL,
                size_bytes INTEGER,
                source_run_id TEXT,
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS datasets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                format TEXT NOT NULL,
                path TEXT NOT NULL,
                row_count INTEGER,
                splits_json TEXT,
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS downloads (
                download_id TEXT PRIMARY KEY,
                model_id TEXT NOT NULL,
                status TEXT NOT NULL,
                bytes_done INTEGER,
                bytes_total INTEGER,
                files_done INTEGER,
                files_total INTEGER,
                error TEXT,
                started_at TEXT NOT NULL,
                finished_at TEXT
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS exports (
                export_id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                output_path TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                finished_at TEXT
            )
            """,
        ],
    ),
    (
        2,
        [
            """
            CREATE TABLE IF NOT EXISTS recipe_jobs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                rows_emitted INTEGER,
                preview_json TEXT,
                dataset_id TEXT,
                error TEXT,
                created_at TEXT NOT NULL
            )
            """,
        ],
    ),
    (
        3,
        [
            """
            CREATE TABLE IF NOT EXISTS dataset_imports (
                id TEXT PRIMARY KEY,
                hf_dataset_id TEXT NOT NULL,
                config TEXT,
                split TEXT NOT NULL,
                name TEXT NOT NULL,
                max_rows INTEGER,
                status TEXT NOT NULL,
                rows_written INTEGER,
                dataset_id TEXT,
                error TEXT,
                started_at TEXT NOT NULL,
                finished_at TEXT
            )
            """,
        ],
    ),
]


async def init_db(db_path: str | Path) -> None:
    """Create/open the SQLite database and apply any pending migrations.

    Idempotent: safe to call multiple times. Already-applied migrations
    (tracked in schema_version) are skipped.
    """
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    async with aiosqlite.connect(db_path) as conn:
        await conn.execute("PRAGMA foreign_keys = ON")
        await conn.execute("PRAGMA journal_mode = WAL")

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
            """
        )
        await conn.commit()

        cursor = await conn.execute("SELECT MAX(version) FROM schema_version")
        row = await cursor.fetchone()
        current_version = row[0] if row and row[0] is not None else 0

        for version, sql in sorted(MIGRATIONS, key=lambda m: m[0]):
            if version <= current_version:
                continue
            statements = [sql] if isinstance(sql, str) else sql
            for statement in statements:
                await conn.execute(statement)
            await conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?, datetime('now'))",
                (version,),
            )
            await conn.commit()


def get_connection(db_path: str | Path) -> aiosqlite.Connection:
    """Return a new aiosqlite connection coroutine for the given db path.

    Usable as an async context manager: `async with get_connection(path) as conn:`.
    """
    return aiosqlite.connect(db_path)
