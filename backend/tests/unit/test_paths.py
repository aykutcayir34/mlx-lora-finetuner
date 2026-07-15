"""Unit tests for app.core.paths — the ONE canonical model-id <-> dirname mapping.

The semantics replicate what the model registry has always written to disk;
these tests pin them down so no component drifts back to its own variant.
"""

from app.core.paths import model_dirname, model_id_from_dirname


def test_org_name_maps_to_double_underscore():
    assert model_dirname("mlx-community/SmolLM-135M-Instruct-4bit") == (
        "mlx-community__SmolLM-135M-Instruct-4bit"
    )


def test_org_name_round_trips():
    model_id = "mlx-community/Qwen2.5-0.5B-Instruct-4bit"
    assert model_id_from_dirname(model_dirname(model_id)) == model_id


def test_name_without_org_gets_underscore_prefix():
    # Historical registry behavior: a slashless id is stored as "_<name>".
    assert model_dirname("gpt2") == "_gpt2"


def test_name_without_org_does_not_round_trip():
    # Also historical: "_gpt2" contains no "__", so the inverse returns it
    # unchanged instead of recovering "gpt2". Documented, not "fixed" —
    # existing directories on users' disks depend on this mapping.
    assert model_id_from_dirname(model_dirname("gpt2")) == "_gpt2"


def test_multiple_slashes_only_first_is_replaced():
    # Canonical behavior for exotic ids: only the FIRST slash becomes "__"
    # (this is what the registry, chat and arena already did; the training
    # manager used to replace every slash and has been aligned to this).
    assert model_dirname("org/sub/name") == "org__sub/name"
    assert model_id_from_dirname("org__sub/name") == "org/sub/name"


def test_dirname_without_separator_is_returned_unchanged():
    assert model_id_from_dirname("plain-dir") == "plain-dir"


def test_inverse_splits_on_first_double_underscore_only():
    assert model_id_from_dirname("org__name__variant") == "org/name__variant"
