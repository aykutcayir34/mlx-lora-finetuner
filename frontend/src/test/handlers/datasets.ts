import { http, HttpResponse } from 'msw'
import type {
  DatasetImportInfo,
  DatasetImportResponse,
  DatasetInfo,
  HFDatasetSearchResult,
  PreviewPage,
  ValidationReport,
} from '../../api/types'

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

// ---------------------------------------------------------------------------
// Hugging Face dataset import
// ---------------------------------------------------------------------------

export const sampleSearchResult: HFDatasetSearchResult = {
  dataset_id: 'mlx-community/wikisql',
  downloads: 1234,
  likes: 5,
  imported: false,
}

export const sampleImportInfo: DatasetImportInfo = {
  import_id: 'di_1',
  hf_dataset_id: 'mlx-community/wikisql',
  config: null,
  split: 'train',
  status: 'running',
  rows_written: 0,
  dataset_id: null,
  error: null,
  started_at: '2026-07-12T10:00:00Z',
  finished_at: null,
}

export function searchDatasetsHandler(results: HFDatasetSearchResult[] = [sampleSearchResult]) {
  return http.get('/api/v1/datasets/search', () => HttpResponse.json({ results }))
}

export function importDatasetHandler(
  response: DatasetImportResponse = { import_id: 'di_1', dataset_id: 'mlx-community/wikisql' },
) {
  return http.post('/api/v1/datasets/import', () => HttpResponse.json(response, { status: 202 }))
}

export function importDatasetConflictHandler(message = 'This dataset is already importing.') {
  return http.post('/api/v1/datasets/import', () =>
    HttpResponse.json({ error: { code: 'conflict', message, detail: {} } }, { status: 409 }),
  )
}

export function listDatasetImportsHandler(imports: DatasetImportInfo[] = [sampleImportInfo]) {
  return http.get('/api/v1/datasets/imports', () => HttpResponse.json({ imports }))
}

export function cancelImportHandler(
  response: DatasetImportInfo = { ...sampleImportInfo, status: 'cancelled' },
) {
  return http.post('/api/v1/datasets/imports/:id/cancel', () => HttpResponse.json(response, { status: 202 }))
}

export function cancelImportConflictHandler(message = 'Import already finished.') {
  return http.post('/api/v1/datasets/imports/:id/cancel', () =>
    HttpResponse.json({ error: { code: 'conflict', message, detail: {} } }, { status: 409 }),
  )
}

export function cancelImportNotFoundHandler(message = 'Import not found.') {
  return http.post('/api/v1/datasets/imports/:id/cancel', () =>
    HttpResponse.json({ error: { code: 'not_found', message, detail: {} } }, { status: 404 }),
  )
}
