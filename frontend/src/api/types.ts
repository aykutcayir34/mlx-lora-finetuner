// TypeScript mirror of docs/api.md — the frozen frontend/backend contract.
// Keep in sync with that document; update the doc first on any change.

// ---------------------------------------------------------------------------
// Shared / errors
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | 'not_found'
  | 'conflict'
  | 'validation_error'
  | 'training_active'
  | 'internal'

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode | string
    message: string
    detail: Record<string, unknown>
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export interface HealthInfo {
  status: string
  version: string
  mlx_version: string
  mlx_lm_lora_version: string
}

export interface SystemStats {
  memory: { total_gb: number; used_gb: number }
  disk: {
    models_gb: number
    datasets_gb: number
    runs_gb: number
    exports_gb: number
    free_gb: number
  }
  active_run_id: string | null
  data_dir: string
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface ModelQuantization {
  bits: number
  group_size: number
}

export interface ModelInfo {
  model_id: string
  path: string
  size_bytes: number
  model_type: string
  quantization: ModelQuantization | null
  downloaded_at: string
}

export interface HFSearchResult {
  model_id: string
  downloads: number
  likes: number
  size_bytes: number | null
  downloaded: boolean
}

export interface DownloadRequest {
  model_id: string
}

export type DownloadStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface DownloadInfo {
  download_id: string
  model_id: string
  status: DownloadStatus
  bytes_done: number
  bytes_total: number
  files_done: number
  files_total: number
  error: string | null
  started_at: string
  finished_at: string | null
}

export type DownloadWsFrame =
  | {
      type: 'progress'
      bytes_done: number
      bytes_total: number
      files_done: number
      files_total: number
    }
  | { type: 'done' }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

export type DatasetFormat = 'chat' | 'completions' | 'text' | 'dpo' | 'orpo' | 'grpo'

export interface DatasetSplits {
  train: number
  valid: number
  test: number
}

export interface DatasetInfo {
  dataset_id: string
  name: string
  format: DatasetFormat
  path: string
  row_count: number
  splits: DatasetSplits | null
  created_at: string
}

export interface LineIssue {
  line: number
  message: string
}

export interface ValidationReport {
  dataset_id: string
  format: DatasetFormat
  valid_rows: number
  total_rows: number
  errors: LineIssue[]
  warnings: LineIssue[]
}

export interface SplitRequest {
  train: number
  valid: number
  test: number
  seed: number
  shuffle: boolean
}

export type PreviewSplit = 'raw' | 'train' | 'valid' | 'test'

export interface PreviewPage {
  rows: Record<string, unknown>[]
  page: number
  size: number
  total_rows: number
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export type TrainMode = 'sft' | 'dpo' | 'orpo' | 'cpo' | 'grpo'
export type TrainType = 'lora' | 'dora' | 'full'
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface LoraParams {
  rank: number
  scale: number
  dropout: number
}

export interface TrainingConfig {
  name: string
  model_id: string
  dataset_id: string
  train_mode: TrainMode
  train_type: TrainType
  batch_size: number
  iters: number
  learning_rate: number
  max_seq_length: number
  num_layers: number
  lora: LoraParams
  optimizer: string
  lr_schedule: string
  load_in_bits: number | null
  grad_checkpoint: boolean
  save_every: number
  steps_per_report: number
  steps_per_eval: number
  val_batches: number
  seed: number
  beta: number | null
  group_size: number | null
  temperature: number | null
  max_completion_length: number | null
  reward_functions: string[] | null
}

export interface RunSummary {
  run_id: string
  name: string
  status: JobStatus
  config: TrainingConfig
  created_at: string
  started_at: string | null
  finished_at: string | null
  final_train_loss: number | null
  final_val_loss: number | null
  adapter_path: string | null
  error: string | null
}

export type MetricKind = 'train' | 'val'

export interface MetricEvent {
  run_id: string
  step: number
  kind: MetricKind
  loss: number | null
  learning_rate: number | null
  it_per_sec: number | null
  tokens_per_sec: number | null
  peak_memory_gb: number | null
  ts: string
}

export type TrainWsClientFrame = { last_step: number }

export type TrainWsServerFrame =
  | { type: 'metric'; data: MetricEvent }
  | { type: 'status'; status: JobStatus; error: string | null }
  | { type: 'log_line'; line: string }
  | { type: 'checkpoint'; step: number; adapter_path: string }

// ---------------------------------------------------------------------------
// Worker event protocol (internal: worker subprocess stdout -> manager)
// ---------------------------------------------------------------------------

export type WorkerEvent =
  | { event: 'started'; pid: number }
  | {
      event: 'metric'
      step: number
      loss: number
      learning_rate: number
      it_per_sec: number
      tokens_per_sec: number
      peak_memory_gb: number
    }
  | { event: 'val_metric'; step: number; loss: number }
  | { event: 'checkpoint'; step: number; adapter_path: string }
  | {
      event: 'done'
      adapter_path: string
      final_train_loss: number
      final_val_loss: number
    }
  | { event: 'error'; message: string; traceback: string }

// ---------------------------------------------------------------------------
// Adapters & Chat
// ---------------------------------------------------------------------------

export interface AdapterInfo {
  adapter_path: string
  run_id: string | null
  name: string
  base_model_id: string
  created_at: string
}

export interface GenerationParams {
  max_tokens: number
  temperature: number
  top_p: number
  repetition_penalty: number | null
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type ChatWsClientFrame =
  | {
      type: 'generate'
      model_id: string
      adapter_path: string | null
      messages: ChatMessage[]
      params: GenerationParams
    }
  | { type: 'cancel' }

export type ChatWsServerFrame =
  | { type: 'token'; text: string }
  | {
      type: 'done'
      usage: { prompt_tokens: number; completion_tokens: number; tokens_per_sec: number }
    }
  | {
      type: 'error'
      code: 'training_active' | 'model_not_found' | 'internal'
      message: string
    }

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type FuseRequest =
  | { run_id: string; de_quantize: boolean; output_name: string }
  | { model_id: string; adapter_path: string; de_quantize: boolean; output_name: string }

export interface PreflightCheck {
  name: string
  ok: boolean
  message: string
}

export interface PreflightReport {
  ok: boolean
  checks: PreflightCheck[]
}

export type GGUFOuttype = 'f16' | 'q8_0'

export interface GGUFRequest {
  model_path: string
  outtype: GGUFOuttype
  output_name: string
}

export type OllamaModelFamily = 'qwen' | 'llama' | 'smollm' | 'mistral' | 'custom'

export interface OllamaModelfileRequest {
  gguf_path: string
  model_family: OllamaModelFamily
  name: string
  custom_template: string | null
}

export type ExportKind = 'fuse' | 'gguf'
export type ExportStatus = 'running' | 'completed' | 'failed'

export interface ExportJobInfo {
  export_id: string
  kind: ExportKind
  status: ExportStatus
  progress_log: string[]
  output_path: string | null
  error: string | null
}

export type ExportArtifactKind = 'fused' | 'gguf' | 'modelfile'

export interface ExportArtifact {
  id: string
  kind: ExportArtifactKind
  path: string
  size_bytes: number
  source_run_id: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Arena (Faz 2)
// ---------------------------------------------------------------------------

export type ArenaSide = 'a' | 'b'

export interface ArenaSideSpec {
  model_id: string
  adapter_path: string | null
}

export type ArenaWsClientFrame =
  | {
      type: 'generate'
      side_a: ArenaSideSpec
      side_b: ArenaSideSpec
      messages: ChatMessage[]
      params: GenerationParams
    }
  | { type: 'cancel' }

export type ArenaWsServerFrame =
  | { type: 'side_start'; side: ArenaSide }
  | { type: 'token'; side: ArenaSide; text: string }
  | {
      type: 'side_done'
      side: ArenaSide
      usage: { prompt_tokens: number; completion_tokens: number; tokens_per_sec: number }
    }
  | { type: 'done' }
  | {
      type: 'error'
      side: ArenaSide | null
      code: 'training_active' | 'model_not_found' | 'internal'
      message: string
    }

// ---------------------------------------------------------------------------
// Data Recipes (Faz 2)
// ---------------------------------------------------------------------------

export type RecipeOutputFormat = 'text' | 'completions' | 'chat'
export type RecipeJobStatus = 'running' | 'completed' | 'failed'

export interface RecipeConvertResponse {
  recipe_job_id: string
  name: string
}

export interface RecipeJobInfo {
  recipe_job_id: string
  status: RecipeJobStatus
  rows_emitted: number
  preview_rows: Record<string, unknown>[]
  dataset_id: string | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Dataset import from Hugging Face Hub
// ---------------------------------------------------------------------------

export interface HFDatasetSearchResult {
  dataset_id: string
  downloads: number
  likes: number
  imported: boolean
}

export interface DatasetImportRequest {
  dataset_id: string
  config: string | null
  split: string
  name: string | null
  max_rows: number | null
}

export interface DatasetImportResponse {
  import_id: string
  dataset_id: string
}

export type DatasetImportStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface DatasetImportInfo {
  import_id: string
  hf_dataset_id: string
  config: string | null
  split: string
  status: DatasetImportStatus
  rows_written: number
  dataset_id: string | null
  error: string | null
  started_at: string
  finished_at: string | null
}
