import { http, HttpResponse } from 'msw'
import type { DatasetInfo, ModelInfo, RunSummary } from '../../api/types'

// Additional MSW handlers for Train-page tests (TrainConfigForm, RunMonitor,
// TrainPage). These are additive overrides applied per-test via
// `server.use(...)` — the global handlers.ts already covers the shell-level
// /models and /train/jobs endpoints, this file adds /datasets and the
// per-run metrics/logs/cancel endpoints exercised by the monitor.

export const trainModel: ModelInfo = {
  model_id: 'mlx-community/SmolLM-135M-Instruct-4bit',
  path: '/models/mlx-community__SmolLM-135M-Instruct-4bit',
  size_bytes: 123456789,
  model_type: 'llama',
  quantization: { bits: 4, group_size: 64 },
  downloaded_at: '2026-07-12T10:00:00Z',
}

export const splitDataset: DatasetInfo = {
  dataset_id: 'ds_1',
  name: 'my-chat-data',
  format: 'chat',
  path: '/datasets/ds_1',
  row_count: 200,
  splits: { train: 160, valid: 20, test: 20 },
  created_at: '2026-07-12T10:00:00Z',
}

export const ftpoDataset: DatasetInfo = {
  dataset_id: 'ds_ftpo',
  name: 'my-ftpo-data',
  format: 'ftpo',
  path: '/datasets/ds_ftpo',
  row_count: 120,
  splits: { train: 96, valid: 12, test: 12 },
  created_at: '2026-07-12T10:00:00Z',
}

export const unsplitDataset: DatasetInfo = {
  dataset_id: 'ds_2',
  name: 'no-splits-yet',
  format: 'chat',
  path: '/datasets/ds_2',
  row_count: 50,
  splits: null,
  created_at: '2026-07-12T10:00:00Z',
}

export function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'run_1',
    name: 'my-run',
    status: 'running',
    config: {
      name: 'my-run',
      model_id: trainModel.model_id,
      dataset_id: splitDataset.dataset_id,
      train_mode: 'sft',
      train_type: 'lora',
      batch_size: 1,
      iters: 600,
      learning_rate: 1e-5,
      max_seq_length: 2048,
      num_layers: 16,
      lora: { rank: 8, scale: 20.0, dropout: 0.0 },
      optimizer: 'adamw',
      lr_schedule: 'cosine',
      load_in_bits: null,
      grad_checkpoint: false,
      save_every: 100,
      steps_per_report: 10,
      steps_per_eval: 100,
      val_batches: 25,
      seed: 42,
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
    created_at: '2026-07-12T10:00:00Z',
    started_at: '2026-07-12T10:00:01Z',
    finished_at: null,
    final_train_loss: null,
    final_val_loss: null,
    adapter_path: null,
    error: null,
    ...overrides,
  }
}

export const trainingHandlers = [
  http.get('/api/v1/datasets', () =>
    HttpResponse.json({ datasets: [splitDataset, ftpoDataset, unsplitDataset] }),
  ),
  http.get('/api/v1/train/jobs/:runId/metrics', () => HttpResponse.json({ metrics: [] })),
  http.get('/api/v1/train/jobs/:runId/logs', () => HttpResponse.json({ lines: [] })),
  http.post('/api/v1/train/jobs/:runId/cancel', ({ params }) =>
    HttpResponse.json(makeRunSummary({ run_id: params.runId as string, status: 'cancelled' }), {
      status: 202,
    }),
  ),
]
