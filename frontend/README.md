# mlx-lora-finetuner — frontend

React + TypeScript + Vite UI for the MLX LoRA fine-tuning studio. See the
[root README](../README.md) for the full project overview and quickstart.

## Development

```bash
npm install
npx vite            # dev server on :5173 (proxies /api to :8000)
npx vitest run      # tests
npx tsc --noEmit    # type check
```

The API contract lives in [`../docs/api.md`](../docs/api.md); TypeScript
mirrors of every schema are in `src/api/types.ts`.
