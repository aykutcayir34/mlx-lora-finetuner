import { http, HttpResponse } from 'msw'

// Default happy-path handlers for the endpoints the layout shell polls.
// Individual tests can override these with `server.use(...)`.
export const handlers = [
  http.get('/api/v1/system/health', () =>
    HttpResponse.json({
      status: 'ok',
      version: '0.1.0',
      mlx_version: '0.20.0',
      mlx_lm_lora_version: '3.0.0',
    }),
  ),
  http.get('/api/v1/system/stats', () =>
    HttpResponse.json({
      memory: { total_gb: 32, used_gb: 12.3 },
      disk: { models_gb: 4.2, datasets_gb: 0.1, runs_gb: 0.3, exports_gb: 1.0, free_gb: 210.5 },
      active_run_id: null,
      data_dir: '/Users/x/.mlx-lora-finetuner',
    }),
  ),

  // Additional handlers for src/api/queries hook tests. Kept additive so the
  // two handlers above (relied on by TopBar/StatusFooter default-state tests)
  // keep working unmodified.
  http.get('/api/v1/models', () =>
    HttpResponse.json({
      models: [
        {
          model_id: 'mlx-community/SmolLM-135M-Instruct-4bit',
          path: '/models/mlx-community__SmolLM-135M-Instruct-4bit',
          size_bytes: 123456789,
          model_type: 'llama',
          quantization: { bits: 4, group_size: 64 },
          downloaded_at: '2026-07-12T10:00:00Z',
        },
        {
          model_id: 'mlx-community/Qwen2.5-0.5B-Instruct-4bit',
          path: '/models/mlx-community__Qwen2.5-0.5B-Instruct-4bit',
          size_bytes: 987654321,
          model_type: 'qwen2',
          quantization: { bits: 4, group_size: 64 },
          downloaded_at: '2026-07-12T10:05:00Z',
        },
      ],
    }),
  ),
  http.get('/api/v1/train/jobs', () => HttpResponse.json({ runs: [], total: 0 })),
  // Empty-list defaults so route-level smoke tests can render every page
  // without per-test overrides (pages fetch these on mount).
  http.get('/api/v1/datasets', () => HttpResponse.json({ datasets: [] })),
  http.get('/api/v1/adapters', () => HttpResponse.json({ adapters: [] })),
  http.get('/api/v1/export/artifacts', () => HttpResponse.json({ artifacts: [] })),
  http.get('/api/v1/models/downloads', () => HttpResponse.json({ downloads: [] })),
  http.post('/api/v1/train/jobs', () =>
    HttpResponse.json(
      {
        run_id: 'run_new',
        name: 'my-run',
        status: 'queued',
        config: {},
        created_at: '2026-07-12T10:00:00Z',
        started_at: null,
        finished_at: null,
        final_train_loss: null,
        final_val_loss: null,
        adapter_path: null,
        error: null,
      },
      { status: 201 },
    ),
  ),
  http.get('/api/v1/train/jobs/:runId', ({ params }) =>
    HttpResponse.json({
      run_id: params.runId,
      name: 'my-run',
      status: 'running',
      config: {},
      created_at: '2026-07-12T10:00:00Z',
      started_at: '2026-07-12T10:00:01Z',
      finished_at: null,
      final_train_loss: null,
      final_val_loss: null,
      adapter_path: null,
      error: null,
    }),
  ),
]
