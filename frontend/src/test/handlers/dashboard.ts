import { http, HttpResponse } from 'msw'
import type { DatasetInfo, MetricEvent, RunSummary } from '../../api/types'

// Dashboard-page-only MSW handlers. Kept out of the shared `handlers.ts` file
// (owned by the layout shell tests) and applied per-test via `server.use(...)`.

export const defaultDatasets: DatasetInfo[] = [
  {
    dataset_id: 'ds_1',
    name: 'chat-sample',
    format: 'chat',
    path: '/datasets/ds_1',
    row_count: 200,
    splits: { train: 160, valid: 20, test: 20 },
    created_at: '2026-07-10T10:00:00Z',
  },
]

export function datasetsHandler(datasets: DatasetInfo[] = defaultDatasets) {
  return http.get('/api/v1/datasets', () => HttpResponse.json({ datasets }))
}

export function emptyDatasetsHandler() {
  return datasetsHandler([])
}

export function emptyModelsHandler() {
  return http.get('/api/v1/models', () => HttpResponse.json({ models: [] }))
}

export function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'run_1',
    name: 'sft-run-1',
    status: 'completed',
    config: {
      name: 'sft-run-1',
      model_id: 'mlx-community/SmolLM-135M-Instruct-4bit',
      dataset_id: 'ds_1',
      train_mode: 'sft',
      train_type: 'lora',
      batch_size: 1,
      iters: 600,
      learning_rate: 1e-5,
      max_seq_length: 2048,
      num_layers: 16,
      lora: { rank: 8, scale: 20, dropout: 0 },
      optimizer: 'adamw',
      lr_schedule: 'cosine',
      load_in_bits: null,
      grad_checkpoint: false,
      save_every: 100,
      steps_per_report: 10,
      steps_per_eval: 100,
      val_batches: 25,
      seed: 42,
      gradient_accumulation_steps: null,
      beta: null,
      group_size: null,
      temperature: null,
      max_completion_length: null,
      reward_functions: null,
      sft_loss_type: null,
      lambda_mse_target: null,
      tau_mse_target: null,
      lambda_mse: null,
      clip_epsilon_logits: null,
    },
    created_at: '2026-07-12T09:00:00Z',
    started_at: '2026-07-12T09:00:01Z',
    finished_at: '2026-07-12T09:10:00Z',
    final_train_loss: 1.234,
    final_val_loss: 1.4,
    adapter_path: '/adapters/run_1',
    error: null,
    ...overrides,
  }
}

export function runsHandler(runs: RunSummary[] = [makeRunSummary()]) {
  return http.get('/api/v1/train/jobs', () => HttpResponse.json({ runs, total: runs.length }))
}

export function emptyRunsHandler() {
  return runsHandler([])
}

export function runHandler(run: RunSummary) {
  return http.get(`/api/v1/train/jobs/${run.run_id}`, () => HttpResponse.json(run))
}

export const defaultMetrics: MetricEvent[] = [
  {
    run_id: 'run_active',
    step: 0,
    kind: 'train',
    loss: 2.1,
    learning_rate: 1e-5,
    it_per_sec: 4,
    tokens_per_sec: 500,
    peak_memory_gb: 3.2,
    ts: '2026-07-12T09:00:05Z',
  },
  {
    run_id: 'run_active',
    step: 10,
    kind: 'train',
    loss: 1.8,
    learning_rate: 1e-5,
    it_per_sec: 4,
    tokens_per_sec: 500,
    peak_memory_gb: 3.3,
    ts: '2026-07-12T09:00:10Z',
  },
]

export function metricsHandler(runId: string, metrics: MetricEvent[] = defaultMetrics) {
  return http.get(`/api/v1/train/jobs/${runId}/metrics`, () => HttpResponse.json({ metrics }))
}
