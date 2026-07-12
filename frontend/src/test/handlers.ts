import { http, HttpResponse } from 'msw'

// Default happy-path handlers for the endpoints the layout shell polls.
// Individual tests can override these with `server.use(...)`.
export const handlers = [
  http.get('/api/v1/system/health', () =>
    HttpResponse.json({
      status: 'ok',
      version: '0.1.0',
      mlx_version: '0.20.0',
      mlx_lm_lora_version: '0.1.0',
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
]
