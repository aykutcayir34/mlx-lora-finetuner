import { http, HttpResponse } from 'msw'

// Default happy-path handlers for the export page (fuse/GGUF/Ollama wizards +
// artifact table). Tests pull these in with `server.use(...exportHandlers)`
// and override individual endpoints per-case as needed.
export const exportHandlers = [
  http.get('/api/v1/adapters', () =>
    HttpResponse.json({
      adapters: [
        {
          adapter_path: '/abs/runs/run_abc/adapters',
          run_id: 'run_abc',
          name: 'my-run',
          base_model_id: 'mlx-community/SmolLM-135M-Instruct-4bit',
          created_at: '2026-07-12T10:00:00Z',
        },
      ],
    }),
  ),

  http.get('/api/v1/export/artifacts', () =>
    HttpResponse.json({
      artifacts: [
        {
          id: 'art_fused_1',
          kind: 'fused',
          path: '/abs/exports/my-model-fused',
          size_bytes: 268435456,
          source_run_id: 'run_abc',
          created_at: '2026-07-12T10:10:00Z',
        },
        {
          id: 'art_gguf_1',
          kind: 'gguf',
          path: '/abs/exports/my-model.gguf',
          size_bytes: 134217728,
          source_run_id: 'run_abc',
          created_at: '2026-07-12T10:20:00Z',
        },
      ],
    }),
  ),

  http.post('/api/v1/export/fuse', () =>
    HttpResponse.json({ export_id: 'ex_fuse1', kind: 'fuse' }, { status: 202 }),
  ),

  http.get('/api/v1/export/gguf/preflight', () =>
    HttpResponse.json({
      ok: true,
      checks: [
        { name: 'llama_cpp_available', ok: true, message: 'llama.cpp found' },
        { name: 'arch_supported', ok: true, message: 'llama' },
        { name: 'weights_dequantized', ok: true, message: 'weights are f16' },
      ],
    }),
  ),

  http.post('/api/v1/export/gguf', () =>
    HttpResponse.json({ export_id: 'ex_gguf1', kind: 'gguf' }, { status: 202 }),
  ),

  http.post('/api/v1/export/ollama-modelfile', () =>
    HttpResponse.json({
      modelfile: 'FROM /abs/exports/my-model.gguf\nTEMPLATE "..."\n',
      path: '/abs/exports/Modelfile',
    }),
  ),

  http.get('/api/v1/export/jobs/:exportId', ({ params }) =>
    HttpResponse.json({
      export_id: params.exportId,
      kind: 'fuse',
      status: 'completed',
      progress_log: ['starting…', 'fusing weights…', 'done'],
      output_path: '/abs/exports/my-model-fused',
      error: null,
    }),
  ),
]
