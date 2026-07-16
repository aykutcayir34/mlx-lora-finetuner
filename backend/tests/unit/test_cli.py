from unittest.mock import patch

from app.cli import main


def _run(argv):
    with (
        patch("app.cli.uvicorn.run") as mock_run,
        patch("app.cli.webbrowser.open") as mock_open,
    ):
        main(argv)
    return mock_run, mock_open


def test_defaults_open_browser_and_forward_host_port(data_dir, capsys):
    mock_run, mock_open = _run([])
    mock_open.assert_called_once_with("http://127.0.0.1:8000")
    mock_run.assert_called_once_with("app.main:app", host="127.0.0.1", port=8000)
    # data_dir fixture points MLXLF_STATIC_DIR at a missing dir -> API-only hint.
    assert "serving API only" in capsys.readouterr().out


def test_no_browser_suppresses_open(data_dir):
    mock_run, mock_open = _run(["--no-browser"])
    mock_open.assert_not_called()
    mock_run.assert_called_once_with("app.main:app", host="127.0.0.1", port=8000)


def test_custom_host_and_port_forwarded(data_dir):
    mock_run, mock_open = _run(["--host", "0.0.0.0", "--port", "8123"])
    mock_open.assert_called_once_with("http://0.0.0.0:8123")
    mock_run.assert_called_once_with("app.main:app", host="0.0.0.0", port=8123)


def test_no_hint_when_static_dir_populated(data_dir, tmp_path, monkeypatch, capsys):
    static_dir = tmp_path / "dist"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<html></html>")
    monkeypatch.setenv("MLXLF_STATIC_DIR", str(static_dir))

    from app.config import get_settings

    get_settings.cache_clear()
    _run(["--no-browser"])
    assert "serving API only" not in capsys.readouterr().out
