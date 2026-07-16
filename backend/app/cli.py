"""`mlxlf` — single-command production entry point.

Starts uvicorn serving `app.main:app` (API + the built frontend, see
`SPAStaticFiles` in `app.main`) and opens the browser. This module must stay
mlx-free at import time: it imports only stdlib + uvicorn, and `app.main` is
loaded lazily by uvicorn via its import string.
"""

from __future__ import annotations

import argparse
import webbrowser

import uvicorn


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="mlxlf",
        description="Run the mlx-lora-finetuner server (API + built frontend).",
    )
    parser.add_argument("--host", default="127.0.0.1", help="bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="bind port (default: 8000)")
    parser.add_argument(
        "--no-browser", action="store_true", help="do not open the app in the default browser"
    )
    args = parser.parse_args(argv)

    # Lazy import: keeps this module importable without the app's settings
    # machinery (and, transitively, without ever touching mlx).
    from app.config import get_settings

    static_dir = get_settings().static_dir
    if not (static_dir / "index.html").is_file():
        print(
            f"No built frontend found at {static_dir} — serving API only. "
            "Run `make build` first (or set MLXLF_STATIC_DIR) to serve the UI."
        )

    url = f"http://{args.host}:{args.port}"
    if not args.no_browser:
        # Opened just before uvicorn.run blocks; the browser takes longer to
        # start than the server does.
        webbrowser.open(url)
    uvicorn.run("app.main:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
