import { http, HttpResponse } from 'msw'
import type { DatasetInfo, PreviewPage, ValidationReport } from '../../api/types'

// Reusable fixtures + handler factories for the Datasets page tests.
// Register the handlers you need per-test with `server.use(...)`; the
// global handlers.ts / server.ts remain untouched.

export const sampleChatDataset: DatasetInfo = {
  dataset_id: 'ds_chat',
  name: 'chat-data',
  format: 'chat',
  path: '/data/ds_chat',
  row_count: 200,
  splits: { train: 160, valid: 20, test: 20 },
  created_at: '2026-07-10T10:00:00Z',
}

export const sampleDpoDataset: DatasetInfo = {
  dataset_id: 'ds_dpo',
  name: 'dpo-data',
  format: 'dpo',
  path: '/data/ds_dpo',
  row_count: 50,
  splits: null,
  created_at: '2026-07-11T10:00:00Z',
}

export function listDatasetsHandler(datasets: DatasetInfo[] = [sampleChatDataset, sampleDpoDataset]) {
  return http.get('/api/v1/datasets', () => HttpResponse.json({ datasets }))
}

export function uploadDatasetHandler(response: DatasetInfo = sampleChatDataset) {
  return http.post('/api/v1/datasets/upload', () => HttpResponse.json(response, { status: 201 }))
}

export function uploadDatasetErrorHandler(message = 'Could not detect a supported dataset format.') {
  return http.post('/api/v1/datasets/upload', () =>
    HttpResponse.json({ error: { code: 'validation_error', message, detail: {} } }, { status: 422 }),
  )
}

export function deleteDatasetHandler(status = 204) {
  return http.delete('/api/v1/datasets/:id', () => new HttpResponse(null, { status }))
}

export function deleteDatasetConflictHandler(message = 'Dataset is used by the active training job.') {
  return http.delete('/api/v1/datasets/:id', () =>
    HttpResponse.json({ error: { code: 'training_active', message, detail: {} } }, { status: 409 }),
  )
}

export function validateDatasetHandler(report: ValidationReport) {
  return http.post('/api/v1/datasets/:id/validate', () => HttpResponse.json(report))
}

export function splitDatasetHandler(result: DatasetInfo = sampleChatDataset) {
  return http.post('/api/v1/datasets/:id/split', () => HttpResponse.json(result))
}

export function splitDatasetErrorHandler(message = 'Ratios must sum to 1.0.') {
  return http.post('/api/v1/datasets/:id/split', () =>
    HttpResponse.json({ error: { code: 'validation_error', message, detail: {} } }, { status: 422 }),
  )
}

export function previewDatasetHandler(page: PreviewPage) {
  return http.get('/api/v1/datasets/:id/preview', () => HttpResponse.json(page))
}
