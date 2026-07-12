import { http, HttpResponse } from 'msw'
import type { RunSummary, TrainingConfig } from '../../api/types'
import { makeRunSummary } from './training'

// Additive MSW handlers for the History page (GET /runs/history, POST
// /train/jobs/:id/clone). Registered per-test via `server.use(...)`.

export function listRunHistoryHandler(runs: RunSummary[] = [makeRunSummary()], total = runs.length) {
  return http.get('/api/v1/runs/history', () => HttpResponse.json({ runs, total }))
}

/** Same as `listRunHistoryHandler` but lets a test assert on the request URL/params. */
export function listRunHistoryHandlerSpy(
  onRequest: (url: URL) => void,
  runs: RunSummary[] = [makeRunSummary()],
  total = runs.length,
) {
  return http.get('/api/v1/runs/history', ({ request }) => {
    onRequest(new URL(request.url))
    return HttpResponse.json({ runs, total })
  })
}

export function cloneRunHandler(config: TrainingConfig) {
  return http.post('/api/v1/train/jobs/:runId/clone', () => HttpResponse.json(config))
}

export function cloneRunNotFoundHandler(message = "run 'run_missing' not found") {
  return http.post('/api/v1/train/jobs/:runId/clone', () =>
    HttpResponse.json({ error: { code: 'not_found', message, detail: {} } }, { status: 404 }),
  )
}
