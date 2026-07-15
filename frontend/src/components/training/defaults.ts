import type { DatasetFormat, TrainingConfig, TrainMode, TrainType } from '../../api/types'

// Sensible defaults mirrored from the TrainingConfig example in docs/api.md.
export const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  name: '',
  model_id: '',
  dataset_id: '',
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
}

export interface ModeOption {
  value: TrainMode
  label: string
  enabled: boolean
}

// Faz 2 (T15): all modes are wired end to end against mlx-lm-lora 3.0.0 and
// verified with real training runs (see task report). All enabled.
export const MODE_OPTIONS: ModeOption[] = [
  { value: 'sft', label: 'SFT', enabled: true },
  { value: 'dpo', label: 'DPO', enabled: true },
  { value: 'orpo', label: 'ORPO', enabled: true },
  { value: 'cpo', label: 'CPO', enabled: true },
  { value: 'grpo', label: 'GRPO', enabled: true },
  // FTPO = final-token preference optimization (mlx-lm-lora 3.0.0).
  { value: 'ftpo', label: 'FTPO', enabled: true },
]

// Suggested per-mode defaults for the mode-specific fields, mirrored
// from `backend/app/training/presets.py::suggest_hyperparameters`. Applied
// when the user switches `train_mode` so the form starts from sane values;
// fields unused by the newly selected mode are reset to `null` (the backend
// 422s when a mode-specific field is set on the wrong mode).
type ModeSpecificFields = Pick<
  TrainingConfig,
  | 'beta'
  | 'group_size'
  | 'temperature'
  | 'max_completion_length'
  | 'sft_loss_type'
  | 'lambda_mse_target'
  | 'tau_mse_target'
  | 'lambda_mse'
  | 'clip_epsilon_logits'
>

const MODE_FIELDS_CLEARED: ModeSpecificFields = {
  beta: null,
  group_size: null,
  temperature: null,
  max_completion_length: null,
  sft_loss_type: null,
  lambda_mse_target: null,
  tau_mse_target: null,
  lambda_mse: null,
  clip_epsilon_logits: null,
}

export function defaultOverridesForMode(mode: TrainMode): ModeSpecificFields {
  if (mode === 'dpo' || mode === 'orpo' || mode === 'cpo') {
    return { ...MODE_FIELDS_CLEARED, beta: 0.1 }
  }
  if (mode === 'grpo') {
    return { ...MODE_FIELDS_CLEARED, group_size: 4, temperature: 0.8, max_completion_length: 512 }
  }
  // sft (sft_loss_type stays null → library default nll) and ftpo (all four
  // hyperparameters stay null → library defaults 0.05 / 1.0 / 0.4 / 2.0).
  return { ...MODE_FIELDS_CLEARED }
}

export const TRAIN_TYPE_OPTIONS: { value: TrainType; label: string }[] = [
  { value: 'lora', label: 'LoRA' },
  { value: 'dora', label: 'DoRA' },
  { value: 'full', label: 'Full fine-tune' },
]

export const OPTIMIZER_OPTIONS = [
  { value: 'adamw', label: 'AdamW' },
  { value: 'adam', label: 'Adam' },
  { value: 'sgd', label: 'SGD' },
]

export const LR_SCHEDULE_OPTIONS = [
  { value: 'cosine', label: 'Cosine' },
  { value: 'linear', label: 'Linear' },
  { value: 'constant', label: 'Constant' },
]

// '' maps to null → the backend/library default (nll), same trick as
// LOAD_IN_BITS_OPTIONS below.
export const SFT_LOSS_OPTIONS = [
  { value: '', label: 'Library default (nll)' },
  { value: 'nll', label: 'NLL' },
  { value: 'chunked_nll', label: 'Chunked NLL' },
  { value: 'dft', label: 'DFT (Dynamic Fine-Tuning)' },
]

export const LOAD_IN_BITS_OPTIONS = [
  { value: '', label: 'None (full precision)' },
  { value: '4', label: '4-bit' },
  { value: '6', label: '6-bit' },
  { value: '8', label: '8-bit' },
]

const MODE_COMPATIBLE_FORMATS: Record<TrainMode, DatasetFormat[]> = {
  sft: ['chat', 'completions', 'text'],
  dpo: ['dpo'],
  cpo: ['dpo'],
  orpo: ['orpo', 'dpo'],
  grpo: ['grpo'],
  ftpo: ['ftpo'],
}

export function compatibleFormatsForMode(mode: TrainMode): DatasetFormat[] {
  return MODE_COMPATIBLE_FORMATS[mode]
}

export function isFormatCompatibleWithMode(format: DatasetFormat, mode: TrainMode): boolean {
  return MODE_COMPATIBLE_FORMATS[mode].includes(format)
}

export type FormErrors = Partial<Record<keyof TrainingConfig | 'lora' | 'dataset_format', string>>

/** Client-side validation mirroring the contract in docs/api.md. */
export function validateTrainingConfig(
  config: TrainingConfig,
  datasetFormat: DatasetFormat | null,
): FormErrors {
  const errors: FormErrors = {}

  if (!config.name.trim()) errors.name = 'Run name is required.'
  if (!config.model_id) errors.model_id = 'Select a model.'
  if (!config.dataset_id) errors.dataset_id = 'Select a dataset with splits.'

  if (config.dataset_id && datasetFormat && !isFormatCompatibleWithMode(datasetFormat, config.train_mode)) {
    errors.dataset_format = `Dataset format "${datasetFormat}" is not compatible with mode "${config.train_mode}". Needs: ${compatibleFormatsForMode(config.train_mode).join(', ')}.`
  }

  if (!Number.isFinite(config.batch_size) || config.batch_size < 1) {
    errors.batch_size = 'Batch size must be at least 1.'
  }
  if (!Number.isFinite(config.iters) || config.iters < 1) {
    errors.iters = 'Iterations must be at least 1.'
  }
  if (!Number.isFinite(config.learning_rate) || config.learning_rate <= 0) {
    errors.learning_rate = 'Learning rate must be greater than 0.'
  }
  if (!Number.isFinite(config.max_seq_length) || config.max_seq_length < 1) {
    errors.max_seq_length = 'Max sequence length must be at least 1.'
  }
  if (!Number.isFinite(config.num_layers) || config.num_layers < 1) {
    errors.num_layers = 'Number of layers must be at least 1.'
  }
  if (!Number.isFinite(config.seed) || config.seed < 0) {
    errors.seed = 'Seed must be zero or greater.'
  }
  if (!Number.isFinite(config.save_every) || config.save_every < 1) {
    errors.save_every = 'Save every must be at least 1.'
  }
  if (!Number.isFinite(config.steps_per_report) || config.steps_per_report < 1) {
    errors.steps_per_report = 'Steps per report must be at least 1.'
  }
  if (!Number.isFinite(config.steps_per_eval) || config.steps_per_eval < 1) {
    errors.steps_per_eval = 'Steps per eval must be at least 1.'
  }
  if (!Number.isFinite(config.val_batches) || config.val_batches < 1) {
    errors.val_batches = 'Validation batches must be at least 1.'
  }

  if (config.train_type !== 'full') {
    if (!Number.isFinite(config.lora.rank) || config.lora.rank < 1) {
      errors.lora = 'LoRA rank must be at least 1.'
    } else if (!Number.isFinite(config.lora.scale) || config.lora.scale <= 0) {
      errors.lora = 'LoRA scale must be greater than 0.'
    } else if (!Number.isFinite(config.lora.dropout) || config.lora.dropout < 0 || config.lora.dropout >= 1) {
      errors.lora = 'LoRA dropout must be between 0 and 1.'
    }
  }

  if (config.train_mode === 'dpo' || config.train_mode === 'orpo' || config.train_mode === 'cpo') {
    if (config.beta === null) {
      errors.beta = 'Beta is required for dpo/orpo/cpo.'
    } else if (!Number.isFinite(config.beta) || config.beta <= 0) {
      errors.beta = 'Beta must be greater than 0.'
    }
  }
  if (config.train_mode === 'grpo') {
    if (config.group_size === null) {
      errors.group_size = 'Group size is required for grpo.'
    } else if (!Number.isFinite(config.group_size) || config.group_size < 1) {
      errors.group_size = 'Group size must be at least 1.'
    }
    if (config.temperature !== null && (!Number.isFinite(config.temperature) || config.temperature <= 0)) {
      errors.temperature = 'Temperature must be greater than 0.'
    }
    if (
      config.max_completion_length !== null &&
      (!Number.isFinite(config.max_completion_length) || config.max_completion_length < 1)
    ) {
      errors.max_completion_length = 'Max completion length must be at least 1.'
    }
  }
  if (config.train_mode === 'ftpo') {
    // All four are optional; null falls back to the library defaults.
    if (
      config.lambda_mse_target !== null &&
      (!Number.isFinite(config.lambda_mse_target) || config.lambda_mse_target < 0)
    ) {
      errors.lambda_mse_target = 'Lambda MSE target must be zero or greater.'
    }
    if (
      config.tau_mse_target !== null &&
      (!Number.isFinite(config.tau_mse_target) || config.tau_mse_target <= 0)
    ) {
      errors.tau_mse_target = 'Tau MSE target must be greater than 0.'
    }
    if (config.lambda_mse !== null && (!Number.isFinite(config.lambda_mse) || config.lambda_mse < 0)) {
      errors.lambda_mse = 'Lambda MSE must be zero or greater.'
    }
    if (
      config.clip_epsilon_logits !== null &&
      (!Number.isFinite(config.clip_epsilon_logits) || config.clip_epsilon_logits <= 0)
    ) {
      errors.clip_epsilon_logits = 'Clip epsilon must be greater than 0.'
    }
  }

  return errors
}
