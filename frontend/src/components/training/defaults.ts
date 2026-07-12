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
}

export interface ModeOption {
  value: TrainMode
  label: string
  enabled: boolean
}

// Faz 2 (T15): all modes are wired end to end against mlx-lm-lora 2.1.0 and
// verified with real training runs (see task report). All enabled.
export const MODE_OPTIONS: ModeOption[] = [
  { value: 'sft', label: 'SFT', enabled: true },
  { value: 'dpo', label: 'DPO', enabled: true },
  { value: 'orpo', label: 'ORPO', enabled: true },
  { value: 'cpo', label: 'CPO', enabled: true },
  { value: 'grpo', label: 'GRPO', enabled: true },
]

// Suggested per-mode defaults for the preference/RL-only fields, mirrored
// from `backend/app/training/presets.py::suggest_hyperparameters`. Applied
// when the user switches `train_mode` so the form starts from sane values;
// fields unused by the newly selected mode are reset to `null`.
export function defaultOverridesForMode(
  mode: TrainMode,
): Pick<TrainingConfig, 'beta' | 'group_size' | 'temperature' | 'max_completion_length'> {
  if (mode === 'dpo' || mode === 'orpo' || mode === 'cpo') {
    return { beta: 0.1, group_size: null, temperature: null, max_completion_length: null }
  }
  if (mode === 'grpo') {
    return { beta: null, group_size: 4, temperature: 0.8, max_completion_length: 512 }
  }
  return { beta: null, group_size: null, temperature: null, max_completion_length: null }
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

  return errors
}
