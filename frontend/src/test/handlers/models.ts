import { http, HttpResponse } from 'msw'

// Default happy-path handlers for the Models page (search, downloads,
// download POST, delete). Tests pull these in with `server.use(...modelsHandlers)`
// and override individual endpoints per-case as needed. The base `GET /api/v1/models`
// handler already lives in ../handlers.ts and is left untouched.
export const modelsHandlers = [
  http.get('/api/v1/models/search', () =>
    HttpResponse.json({
      results: [
        {
          model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
          downloads: 12345,
          likes: 42,
          size_bytes: 900000000,
          downloaded: false,
        },
        {
          model_id: 'mlx-community/SmolLM-135M-Instruct-4bit',
          downloads: 6789,
          likes: 10,
          size_bytes: 123456789,
          downloaded: true,
        },
      ],
    }),
  ),

  http.post('/api/v1/models/download', () =>
    HttpResponse.json({ download_id: 'dl_1', model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit' }, { status: 202 }),
  ),

  http.get('/api/v1/models/downloads', () => HttpResponse.json({ downloads: [] })),

  http.delete('/api/v1/models/:modelId', () => new HttpResponse(null, { status: 204 })),
]
