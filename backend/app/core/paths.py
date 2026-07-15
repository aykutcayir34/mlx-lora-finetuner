"""Canonical mapping between HF model ids and on-disk directory names.

The model registry (`app/services/model_registry.py`) writes model
directories on download, so its historical mapping is the de-facto on-disk
format. Every component that resolves a `model_id` to a directory under
`MLXLF_DATA_DIR/models/` MUST use these helpers so ids keep resolving to
the directories that already exist on users' disks.

Semantics (do not change — existing data depends on it):
- `org/name`  -> `org__name` (only the FIRST slash is replaced; an id with
  more than one slash, e.g. `org/a/b`, maps to `org__a/b`).
- `name` (no slash) -> `_name` (leading underscore marks "no org").
- Inverse: `org__name` -> `org/name` (split on the FIRST `__`); a dirname
  without `__` is returned unchanged (so `_name` does not round-trip back
  to `name` — the registry has always behaved this way).
"""

from __future__ import annotations


def model_dirname(model_id: str) -> str:
    """Directory name under `models_dir` for a Hugging Face model id."""
    org, _, name = model_id.partition("/")
    if not name:
        # No "/" in model_id — fall back to using the whole string as the name.
        return f"_{org}"
    return f"{org}__{name}"


def model_id_from_dirname(dirname: str) -> str:
    """Reconstruct the model id from a directory name written by `model_dirname`."""
    org, sep, name = dirname.partition("__")
    if not sep:
        return dirname
    return f"{org}/{name}"
