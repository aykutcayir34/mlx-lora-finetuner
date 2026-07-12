# mlx-lora-finetuner

A local web studio for LoRA fine-tuning of LLMs on Apple Silicon, built on top of
[mlx-lm-lora](https://github.com/Goekdeniz-Guelmez/mlx-lm-lora). FastAPI backend +
React/TypeScript/Vite frontend, similar in spirit to Unsloth Studio but running
entirely on-device via MLX.

> Project status: early scaffold (Wave 0). Business logic (training orchestration,
> dataset processing, export pipeline, chat inference) lands in later waves — see
> `docs/api.md` for the frozen API contract this app builds against.

## Quickstart

```bash
make install   # uv sync (backend) + npm install (frontend)
make dev       # backend on :8000, frontend on :5173
```

Run tests and lint:

```bash
make test      # pytest + vitest
make lint      # ruff check + tsc --noEmit
```

See `docs/api.md` for the API contract and `CLAUDE.md` for project conventions.
