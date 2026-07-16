import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useModels } from '../../api/queries/models'
import { useDatasets } from '../../api/queries/datasets'
import { useCreateRun } from '../../api/queries/training'
import { ApiError } from '../../api/client'
import type { LoraParams, SftLossType, TrainingConfig, TrainMode, TrainType } from '../../api/types'
import { Card } from '../common/Card'
import { Field } from '../common/Field'
import { Input } from '../common/Input'
import { Select } from '../common/Select'
import { Switch } from '../common/Switch'
import { Button } from '../common/Button'
import { Badge } from '../common/Badge'
import { useToast } from '../common/Toast'
import {
  DEFAULT_TRAINING_CONFIG,
  defaultOverridesForMode,
  GRPO_REWARD_FUNCTIONS,
  LOAD_IN_BITS_OPTIONS,
  LR_SCHEDULE_OPTIONS,
  MODE_OPTIONS,
  OPTIMIZER_OPTIONS,
  SFT_LOSS_OPTIONS,
  TRAIN_TYPE_OPTIONS,
  validateTrainingConfig,
} from './defaults'

interface TrainConfigFormProps {
  onCreated: (runId: string) => void
  /** Prefill (e.g. a cloned run's config); falls back to the defaults. */
  initialConfig?: TrainingConfig
}

export function TrainConfigForm({ onCreated, initialConfig }: TrainConfigFormProps) {
  const { toast } = useToast()
  const modelsQuery = useModels()
  const datasetsQuery = useDatasets()
  const createRun = useCreateRun()

  const [config, setConfig] = useState<TrainingConfig>(initialConfig ?? DEFAULT_TRAINING_CONFIG)
  const [touched, setTouched] = useState(false)

  const splitDatasets = useMemo(
    () => (datasetsQuery.data?.datasets ?? []).filter((d) => d.splits !== null),
    [datasetsQuery.data],
  )
  const selectedDataset = splitDatasets.find((d) => d.dataset_id === config.dataset_id) ?? null

  const errors = validateTrainingConfig(config, selectedDataset?.format ?? null)
  const hasErrors = Object.keys(errors).length > 0

  function update<K extends keyof TrainingConfig>(key: K, value: TrainingConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  function updateLora<K extends keyof LoraParams>(key: K, value: LoraParams[K]) {
    setConfig((prev) => ({ ...prev, lora: { ...prev.lora, [key]: value } }))
  }

  function updateMode(mode: TrainMode) {
    setConfig((prev) => ({ ...prev, train_mode: mode, ...defaultOverridesForMode(mode) }))
  }

  function toggleRewardFunction(name: string) {
    setConfig((prev) => {
      const selected = new Set(prev.reward_functions ?? [])
      if (selected.has(name)) {
        selected.delete(name)
      } else {
        selected.add(name)
      }
      // Always submit in the fixed registry order, never click order.
      const ordered = GRPO_REWARD_FUNCTIONS.map((fn) => fn.value).filter((v) => selected.has(v))
      return { ...prev, reward_functions: ordered.length > 0 ? ordered : null }
    })
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (hasErrors) return

    createRun.mutate(config, {
      onSuccess: (run) => {
        toast(`Run "${run.name}" created.`, { variant: 'success' })
        onCreated(run.run_id)
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'training_active') {
          toast('A training job is already queued or running.', { variant: 'error' })
        } else if (error instanceof ApiError) {
          toast(error.message, { variant: 'error' })
        } else {
          toast('Failed to create the training run.', { variant: 'error' })
        }
      },
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Card title="Run">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Run name" htmlFor="run-name" error={touched ? errors.name : undefined}>
            <Input
              id="run-name"
              value={config.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="my-run"
            />
          </Field>
        </div>
      </Card>

      <Card title="Model">
        {modelsQuery.isError ? (
          <FetchErrorNotice
            message="Failed to load local models."
            onRetry={() => modelsQuery.refetch()}
          />
        ) : modelsQuery.data && modelsQuery.data.length === 0 ? (
          <p className="text-sm text-text-muted">
            No local models yet.{' '}
            <Link to="/models" className="text-accent hover:underline">
              Go to the Models page
            </Link>{' '}
            to download one.
          </p>
        ) : (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Model">
            {(modelsQuery.data ?? []).map((model) => {
              const selected = model.model_id === config.model_id
              return (
                <button
                  key={model.model_id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => update('model_id', model.model_id)}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? 'border-accent bg-accent/10 text-text'
                      : 'border-border bg-surface-raised text-text-muted hover:text-text'
                  }`}
                >
                  <span>{model.model_id}</span>
                  {model.quantization && (
                    <Badge variant="neutral">{model.quantization.bits}-bit</Badge>
                  )}
                </button>
              )
            })}
          </div>
        )}
        {touched && errors.model_id && <p className="mt-2 text-xs text-danger">{errors.model_id}</p>}
      </Card>

      <Card title="Dataset">
        {datasetsQuery.isError ? (
          <FetchErrorNotice
            message="Failed to load datasets."
            onRetry={() => datasetsQuery.refetch()}
          />
        ) : splitDatasets.length === 0 ? (
          <p className="text-sm text-text-muted">
            No datasets with train/valid/test splits yet.{' '}
            <Link to="/datasets" className="text-accent hover:underline">
              Go to the Datasets page
            </Link>{' '}
            to upload and split one.
          </p>
        ) : (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Dataset">
            {splitDatasets.map((dataset) => {
              const selected = dataset.dataset_id === config.dataset_id
              return (
                <button
                  key={dataset.dataset_id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => update('dataset_id', dataset.dataset_id)}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? 'border-accent bg-accent/10 text-text'
                      : 'border-border bg-surface-raised text-text-muted hover:text-text'
                  }`}
                >
                  <span>
                    {dataset.name} <span className="text-text-muted">({dataset.row_count} rows)</span>
                  </span>
                  <Badge variant="info">{dataset.format}</Badge>
                </button>
              )
            })}
          </div>
        )}
        {touched && errors.dataset_id && (
          <p className="mt-2 text-xs text-danger">{errors.dataset_id}</p>
        )}
        {errors.dataset_format && (
          <p className="mt-2 text-xs text-danger">{errors.dataset_format}</p>
        )}
      </Card>

      <Card title="Mode & type">
        <div className="flex flex-col gap-4">
          <div>
            <span className="mb-2 block text-sm font-medium text-text">Train mode</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Train mode">
              {MODE_OPTIONS.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  role="radio"
                  aria-checked={config.train_mode === mode.value}
                  disabled={!mode.enabled}
                  onClick={() => updateMode(mode.value)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    config.train_mode === mode.value
                      ? 'border-accent bg-accent/10 text-text'
                      : 'border-border bg-surface-raised text-text-muted hover:text-text'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <Field label="Train type" htmlFor="train-type">
            <Select
              id="train-type"
              options={TRAIN_TYPE_OPTIONS}
              value={config.train_type}
              onChange={(e) => update('train_type', e.target.value as TrainType)}
            />
          </Field>
        </div>
      </Card>

      {config.train_mode === 'sft' && (
        <Card title="SFT">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="SFT loss" htmlFor="sft-loss-type">
              <Select
                id="sft-loss-type"
                options={SFT_LOSS_OPTIONS}
                value={config.sft_loss_type ?? ''}
                onChange={(e) =>
                  update('sft_loss_type', e.target.value === '' ? null : (e.target.value as SftLossType))
                }
              />
            </Field>
          </div>
        </Card>
      )}

      {(config.train_mode === 'dpo' || config.train_mode === 'orpo' || config.train_mode === 'cpo') && (
        <Card title="Preference / RL">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Beta" htmlFor="beta" error={touched ? errors.beta : undefined}>
              <Input
                id="beta"
                type="number"
                step="0.01"
                value={config.beta ?? ''}
                onChange={(e) => update('beta', e.target.value === '' ? null : Number(e.target.value))}
              />
            </Field>
          </div>
        </Card>
      )}

      {config.train_mode === 'grpo' && (
        <Card title="Preference / RL">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Group size" htmlFor="group-size" error={touched ? errors.group_size : undefined}>
              <Input
                id="group-size"
                type="number"
                value={config.group_size ?? ''}
                onChange={(e) => update('group_size', e.target.value === '' ? null : Number(e.target.value))}
              />
            </Field>
            <Field
              label="Temperature"
              htmlFor="temperature"
              error={touched ? errors.temperature : undefined}
            >
              <Input
                id="temperature"
                type="number"
                step="0.05"
                value={config.temperature ?? ''}
                onChange={(e) => update('temperature', e.target.value === '' ? null : Number(e.target.value))}
              />
            </Field>
            <Field
              label="Max completion length"
              htmlFor="max-completion-length"
              error={touched ? errors.max_completion_length : undefined}
            >
              <Input
                id="max-completion-length"
                type="number"
                value={config.max_completion_length ?? ''}
                onChange={(e) =>
                  update('max_completion_length', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
          </div>
          <fieldset className="mt-4">
            <legend className="mb-2 block text-sm font-medium text-text">Reward functions</legend>
            <div className="flex flex-col gap-2">
              {GRPO_REWARD_FUNCTIONS.map((fn) => (
                <label
                  key={fn.value}
                  className="flex items-center gap-2 text-sm text-text"
                  title={fn.value}
                >
                  <input
                    type="checkbox"
                    checked={(config.reward_functions ?? []).includes(fn.value)}
                    onChange={() => toggleRewardFunction(fn.value)}
                    className="h-4 w-4 accent-accent"
                  />
                  <span>
                    {fn.label}{' '}
                    <code className="font-mono text-xs text-text-muted">({fn.value})</code>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-text-muted">
              None selected → library default (all five).
            </p>
          </fieldset>
        </Card>
      )}

      {config.train_mode === 'ftpo' && (
        <Card title="Preference / RL">
          <p className="mb-4 text-xs text-text-muted">
            All optional — leave empty to use the library defaults.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Lambda MSE target"
              htmlFor="lambda-mse-target"
              error={touched ? errors.lambda_mse_target : undefined}
            >
              <Input
                id="lambda-mse-target"
                type="number"
                step="0.01"
                placeholder="0.05 (default)"
                value={config.lambda_mse_target ?? ''}
                onChange={(e) =>
                  update('lambda_mse_target', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
            <Field
              label="Tau MSE target"
              htmlFor="tau-mse-target"
              error={touched ? errors.tau_mse_target : undefined}
            >
              <Input
                id="tau-mse-target"
                type="number"
                step="0.1"
                placeholder="1.0 (default)"
                value={config.tau_mse_target ?? ''}
                onChange={(e) =>
                  update('tau_mse_target', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
            <Field label="Lambda MSE" htmlFor="lambda-mse" error={touched ? errors.lambda_mse : undefined}>
              <Input
                id="lambda-mse"
                type="number"
                step="0.1"
                placeholder="0.4 (default)"
                value={config.lambda_mse ?? ''}
                onChange={(e) =>
                  update('lambda_mse', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
            <Field
              label="Clip epsilon (logits)"
              htmlFor="clip-epsilon-logits"
              error={touched ? errors.clip_epsilon_logits : undefined}
            >
              <Input
                id="clip-epsilon-logits"
                type="number"
                step="0.1"
                placeholder="2.0 (default)"
                value={config.clip_epsilon_logits ?? ''}
                onChange={(e) =>
                  update('clip_epsilon_logits', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
          </div>
        </Card>
      )}

      {config.train_type !== 'full' && (
        <Card title="LoRA">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Rank" htmlFor="lora-rank">
              <Input
                id="lora-rank"
                type="number"
                value={config.lora.rank}
                onChange={(e) => updateLora('rank', Number(e.target.value))}
              />
            </Field>
            <Field label="Scale" htmlFor="lora-scale">
              <Input
                id="lora-scale"
                type="number"
                step="0.1"
                value={config.lora.scale}
                onChange={(e) => updateLora('scale', Number(e.target.value))}
              />
            </Field>
            <Field label="Dropout" htmlFor="lora-dropout">
              <Input
                id="lora-dropout"
                type="number"
                step="0.01"
                value={config.lora.dropout}
                onChange={(e) => updateLora('dropout', Number(e.target.value))}
              />
            </Field>
          </div>
          {touched && errors.lora && <p className="mt-2 text-xs text-danger">{errors.lora}</p>}
        </Card>
      )}

      <Card title="Basics">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Batch size" htmlFor="batch-size" error={touched ? errors.batch_size : undefined}>
            <Input
              id="batch-size"
              type="number"
              value={config.batch_size}
              onChange={(e) => update('batch_size', Number(e.target.value))}
            />
          </Field>
          <Field label="Iterations" htmlFor="iters" error={touched ? errors.iters : undefined}>
            <Input
              id="iters"
              type="number"
              value={config.iters}
              onChange={(e) => update('iters', Number(e.target.value))}
            />
          </Field>
          <Field
            label="Learning rate"
            htmlFor="learning-rate"
            error={touched ? errors.learning_rate : undefined}
          >
            <Input
              id="learning-rate"
              type="number"
              step="0.000001"
              value={config.learning_rate}
              onChange={(e) => update('learning_rate', Number(e.target.value))}
            />
          </Field>
          <Field
            label="Max sequence length"
            htmlFor="max-seq-length"
            error={touched ? errors.max_seq_length : undefined}
          >
            <Input
              id="max-seq-length"
              type="number"
              value={config.max_seq_length}
              onChange={(e) => update('max_seq_length', Number(e.target.value))}
            />
          </Field>
          <Field label="Num layers" htmlFor="num-layers" error={touched ? errors.num_layers : undefined}>
            <Input
              id="num-layers"
              type="number"
              value={config.num_layers}
              onChange={(e) => update('num_layers', Number(e.target.value))}
            />
          </Field>
          <Field label="Seed" htmlFor="seed" error={touched ? errors.seed : undefined}>
            <Input
              id="seed"
              type="number"
              value={config.seed}
              onChange={(e) => update('seed', Number(e.target.value))}
            />
          </Field>
        </div>
      </Card>

      <Card title="Optimizer">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Optimizer" htmlFor="optimizer">
            <Select
              id="optimizer"
              options={OPTIMIZER_OPTIONS}
              value={config.optimizer}
              onChange={(e) => update('optimizer', e.target.value)}
            />
          </Field>
          <Field label="LR schedule" htmlFor="lr-schedule">
            <Select
              id="lr-schedule"
              options={LR_SCHEDULE_OPTIONS}
              value={config.lr_schedule}
              onChange={(e) => update('lr_schedule', e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card title="Memory">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Load in bits" htmlFor="load-in-bits">
            <Select
              id="load-in-bits"
              options={LOAD_IN_BITS_OPTIONS}
              value={config.load_in_bits === null ? '' : String(config.load_in_bits)}
              onChange={(e) => update('load_in_bits', e.target.value === '' ? null : Number(e.target.value))}
            />
          </Field>
          <div className="flex items-end">
            <Switch
              checked={config.grad_checkpoint}
              onChange={(checked) => update('grad_checkpoint', checked)}
              label="Gradient checkpointing"
            />
          </div>
        </div>
      </Card>

      <Card title="Reporting">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field label="Save every" htmlFor="save-every" error={touched ? errors.save_every : undefined}>
            <Input
              id="save-every"
              type="number"
              value={config.save_every}
              onChange={(e) => update('save_every', Number(e.target.value))}
            />
          </Field>
          <Field
            label="Steps per report"
            htmlFor="steps-per-report"
            error={touched ? errors.steps_per_report : undefined}
          >
            <Input
              id="steps-per-report"
              type="number"
              value={config.steps_per_report}
              onChange={(e) => update('steps_per_report', Number(e.target.value))}
            />
          </Field>
          <Field
            label="Steps per eval"
            htmlFor="steps-per-eval"
            error={touched ? errors.steps_per_eval : undefined}
          >
            <Input
              id="steps-per-eval"
              type="number"
              value={config.steps_per_eval}
              onChange={(e) => update('steps_per_eval', Number(e.target.value))}
            />
          </Field>
          <Field
            label="Val batches"
            htmlFor="val-batches"
            error={touched ? errors.val_batches : undefined}
          >
            <Input
              id="val-batches"
              type="number"
              value={config.val_batches}
              onChange={(e) => update('val_batches', Number(e.target.value))}
            />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={createRun.isPending}>
          Start training
        </Button>
      </div>
    </form>
  )
}

/** Same error copy as the Models/Datasets pages, plus an inline retry. */
function FetchErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-danger">{message}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
