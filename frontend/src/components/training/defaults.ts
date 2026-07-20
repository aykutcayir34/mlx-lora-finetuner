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
  gradient_accumulation_steps: null,
  beta: null,
  group_size: null,
  temperature: null,
  max_completion_length: null,
  reward_functions: null,
  reward_functions_file: null,
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

/** Option whose visible label is a train-namespace i18n key resolved at render time. */
export interface TranslatableOption<V extends string = string> {
  value: V
  labelKey: string
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
  | 'reward_functions'
  | 'reward_functions_file'
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
  reward_functions: null,
  // grpo-only, like reward_functions: cleared on every mode switch so a
  // custom file never leaks into a non-grpo config (the backend 422s).
  reward_functions_file: null,
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

// GRPO reward function registry, pinned by mlx-lm-lora 3.0.0 (see docs/api.md).
// Array order is the canonical submit order; the backend 422s on unknown names.
// Nothing selected → `reward_functions: null` → the library uses all five.
export const GRPO_REWARD_FUNCTIONS: TranslatableOption[] = [
  { value: 'r1_accuracy_reward_func', labelKey: 'form.options.rewards.r1_accuracy_reward_func' },
  { value: 'r1_int_reward_func', labelKey: 'form.options.rewards.r1_int_reward_func' },
  { value: 'r1_strict_format_reward_func', labelKey: 'form.options.rewards.r1_strict_format_reward_func' },
  { value: 'r1_soft_format_reward_func', labelKey: 'form.options.rewards.r1_soft_format_reward_func' },
  { value: 'r1_count_xml', labelKey: 'form.options.rewards.r1_count_xml' },
]

export const TRAIN_TYPE_OPTIONS: TranslatableOption<TrainType>[] = [
  { value: 'lora', labelKey: 'form.options.trainType.lora' },
  { value: 'dora', labelKey: 'form.options.trainType.dora' },
  { value: 'full', labelKey: 'form.options.trainType.full' },
]

// Proper names, identical in every language — no i18n keys needed.
export const OPTIMIZER_OPTIONS = [
  { value: 'adamw', label: 'AdamW' },
  { value: 'adam', label: 'Adam' },
  { value: 'sgd', label: 'SGD' },
]

export const LR_SCHEDULE_OPTIONS: TranslatableOption[] = [
  { value: 'cosine', labelKey: 'form.options.lrSchedule.cosine' },
  { value: 'linear', labelKey: 'form.options.lrSchedule.linear' },
  { value: 'constant', labelKey: 'form.options.lrSchedule.constant' },
]

// '' maps to null → the backend/library default (nll), same trick as
// LOAD_IN_BITS_OPTIONS below.
export const SFT_LOSS_OPTIONS: TranslatableOption[] = [
  { value: '', labelKey: 'form.options.sftLoss.default' },
  { value: 'nll', labelKey: 'form.options.sftLoss.nll' },
  { value: 'chunked_nll', labelKey: 'form.options.sftLoss.chunkedNll' },
  { value: 'dft', labelKey: 'form.options.sftLoss.dft' },
]

export const LOAD_IN_BITS_OPTIONS: TranslatableOption[] = [
  { value: '', labelKey: 'form.options.loadInBits.none' },
  { value: '4', labelKey: 'form.options.loadInBits.bits4' },
  { value: '6', labelKey: 'form.options.loadInBits.bits6' },
  { value: '8', labelKey: 'form.options.loadInBits.bits8' },
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

/**
 * A validation finding, identified by its key under `train:form.errors.*`.
 * The English locale values are the canonical messages (byte-identical to the
 * strings this validator used to return); rendering goes through t() so the
 * same finding surfaces in the active language.
 */
export interface FormError {
  key: string
  params?: Record<string, string>
}

export type FormErrors = Partial<
  Record<keyof TrainingConfig | 'lora' | 'dataset_format', FormError>
>

/** Client-side validation mirroring the contract in docs/api.md. */
export function validateTrainingConfig(
  config: TrainingConfig,
  datasetFormat: DatasetFormat | null,
): FormErrors {
  const errors: FormErrors = {}

  if (!config.name.trim()) errors.name = { key: 'nameRequired' }
  if (!config.model_id) errors.model_id = { key: 'modelRequired' }
  if (!config.dataset_id) errors.dataset_id = { key: 'datasetRequired' }

  if (config.dataset_id && datasetFormat && !isFormatCompatibleWithMode(datasetFormat, config.train_mode)) {
    errors.dataset_format = {
      key: 'datasetFormat',
      params: {
        format: datasetFormat,
        mode: config.train_mode,
        needs: compatibleFormatsForMode(config.train_mode).join(', '),
      },
    }
  }

  if (!Number.isFinite(config.batch_size) || config.batch_size < 1) {
    errors.batch_size = { key: 'batchSize' }
  }
  if (!Number.isFinite(config.iters) || config.iters < 1) {
    errors.iters = { key: 'iters' }
  }
  if (!Number.isFinite(config.learning_rate) || config.learning_rate <= 0) {
    errors.learning_rate = { key: 'learningRate' }
  }
  if (!Number.isFinite(config.max_seq_length) || config.max_seq_length < 1) {
    errors.max_seq_length = { key: 'maxSeqLength' }
  }
  if (!Number.isFinite(config.num_layers) || config.num_layers < 1) {
    errors.num_layers = { key: 'numLayers' }
  }
  if (!Number.isFinite(config.seed) || config.seed < 0) {
    errors.seed = { key: 'seed' }
  }
  if (!Number.isFinite(config.save_every) || config.save_every < 1) {
    errors.save_every = { key: 'saveEvery' }
  }
  if (!Number.isFinite(config.steps_per_report) || config.steps_per_report < 1) {
    errors.steps_per_report = { key: 'stepsPerReport' }
  }
  if (!Number.isFinite(config.steps_per_eval) || config.steps_per_eval < 1) {
    errors.steps_per_eval = { key: 'stepsPerEval' }
  }
  if (!Number.isFinite(config.val_batches) || config.val_batches < 1) {
    errors.val_batches = { key: 'valBatches' }
  }
  // Optional for every mode; null → library default 1.
  if (
    config.gradient_accumulation_steps !== null &&
    (!Number.isInteger(config.gradient_accumulation_steps) || config.gradient_accumulation_steps < 1)
  ) {
    errors.gradient_accumulation_steps = { key: 'gradAccum' }
  }

  if (config.train_type !== 'full') {
    if (!Number.isFinite(config.lora.rank) || config.lora.rank < 1) {
      errors.lora = { key: 'loraRank' }
    } else if (!Number.isFinite(config.lora.scale) || config.lora.scale <= 0) {
      errors.lora = { key: 'loraScale' }
    } else if (!Number.isFinite(config.lora.dropout) || config.lora.dropout < 0 || config.lora.dropout >= 1) {
      errors.lora = { key: 'loraDropout' }
    }
  }

  if (config.train_mode === 'dpo' || config.train_mode === 'orpo' || config.train_mode === 'cpo') {
    if (config.beta === null) {
      errors.beta = { key: 'betaRequired' }
    } else if (!Number.isFinite(config.beta) || config.beta <= 0) {
      errors.beta = { key: 'betaPositive' }
    }
  }
  if (config.train_mode === 'grpo') {
    if (config.group_size === null) {
      errors.group_size = { key: 'groupSizeRequired' }
    } else if (!Number.isFinite(config.group_size) || config.group_size < 1) {
      errors.group_size = { key: 'groupSizeMin' }
    }
    if (config.temperature !== null && (!Number.isFinite(config.temperature) || config.temperature <= 0)) {
      errors.temperature = { key: 'temperaturePositive' }
    }
    if (
      config.max_completion_length !== null &&
      (!Number.isFinite(config.max_completion_length) || config.max_completion_length < 1)
    ) {
      errors.max_completion_length = { key: 'maxCompletionLengthMin' }
    }
  }
  if (config.train_mode === 'ftpo') {
    // All four are optional; null falls back to the library defaults.
    if (
      config.lambda_mse_target !== null &&
      (!Number.isFinite(config.lambda_mse_target) || config.lambda_mse_target < 0)
    ) {
      errors.lambda_mse_target = { key: 'lambdaMseTarget' }
    }
    if (
      config.tau_mse_target !== null &&
      (!Number.isFinite(config.tau_mse_target) || config.tau_mse_target <= 0)
    ) {
      errors.tau_mse_target = { key: 'tauMseTarget' }
    }
    if (config.lambda_mse !== null && (!Number.isFinite(config.lambda_mse) || config.lambda_mse < 0)) {
      errors.lambda_mse = { key: 'lambdaMse' }
    }
    if (
      config.clip_epsilon_logits !== null &&
      (!Number.isFinite(config.clip_epsilon_logits) || config.clip_epsilon_logits <= 0)
    ) {
      errors.clip_epsilon_logits = { key: 'clipEpsilon' }
    }
  }

  return errors
}
