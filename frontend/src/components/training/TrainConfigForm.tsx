import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useModels } from '../../api/queries/models'
import { useDatasets } from '../../api/queries/datasets'
import {
  useCreateRun,
  useDeleteRewardFile,
  useImportTrainingConfig,
  useRewardFiles,
  useUploadRewardFile,
} from '../../api/queries/training'
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
  type FormError,
  type TranslatableOption,
} from './defaults'

interface TrainConfigFormProps {
  onCreated: (runId: string) => void
  /** Prefill (e.g. a cloned run's config); falls back to the defaults. */
  initialConfig?: TrainingConfig
}

export function TrainConfigForm({ onCreated, initialConfig }: TrainConfigFormProps) {
  const { t } = useTranslation('train')
  const { toast } = useToast()
  const modelsQuery = useModels()
  const datasetsQuery = useDatasets()
  const createRun = useCreateRun()

  const [config, setConfig] = useState<TrainingConfig>(initialConfig ?? DEFAULT_TRAINING_CONFIG)
  const [touched, setTouched] = useState(false)

  const importConfig = useImportTrainingConfig()
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const rewardFilesQuery = useRewardFiles()
  const uploadRewardFile = useUploadRewardFile()
  const deleteRewardFile = useDeleteRewardFile()
  const [rewardUploadError, setRewardUploadError] = useState<string | null>(null)
  const rewardFileInputRef = useRef<HTMLInputElement>(null)

  const splitDatasets = useMemo(
    () => (datasetsQuery.data?.datasets ?? []).filter((d) => d.splits !== null),
    [datasetsQuery.data],
  )
  const selectedDataset = splitDatasets.find((d) => d.dataset_id === config.dataset_id) ?? null

  const rewardFiles = rewardFilesQuery.data?.files ?? []
  const selectedRewardFile =
    rewardFiles.find((f) => f.name === config.reward_functions_file) ?? null
  // Custom names never duplicate a built-in checkbox: a file function shadowing
  // a registry name is driven by the built-in checkbox above it.
  const customRewardFunctions = (selectedRewardFile?.functions ?? []).filter(
    (name) => !GRPO_REWARD_FUNCTIONS.some((fn) => fn.value === name),
  )

  const errors = validateTrainingConfig(config, selectedDataset?.format ?? null)
  const hasErrors = Object.keys(errors).length > 0

  /** Resolve a validator finding to its message in the active language. */
  function errorText(error: FormError | undefined): string | undefined {
    return error ? t(`form.errors.${error.key}`, error.params) : undefined
  }

  function translateOptions(options: TranslatableOption[]) {
    return options.map((option) => ({ value: option.value, label: t(option.labelKey) }))
  }

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
    const fileFunctions = customRewardFunctions
    setConfig((prev) => {
      const selected = new Set(prev.reward_functions ?? [])
      if (selected.has(name)) {
        selected.delete(name)
      } else {
        selected.add(name)
      }
      // Always submit in a stable order, never click order: built-ins in
      // registry order first, then custom functions in file order.
      const ordered = [
        ...GRPO_REWARD_FUNCTIONS.map((fn) => fn.value).filter((v) => selected.has(v)),
        ...fileFunctions.filter((v) => selected.has(v)),
      ]
      return { ...prev, reward_functions: ordered.length > 0 ? ordered : null }
    })
  }

  /**
   * Select (or deselect with null) the custom reward file. Custom function
   * names from the previous file are dropped from `reward_functions` — only
   * built-in registry names survive a file change.
   */
  function selectRewardFile(name: string | null) {
    setConfig((prev) => {
      const builtinsOnly = (prev.reward_functions ?? []).filter((v) =>
        GRPO_REWARD_FUNCTIONS.some((fn) => fn.value === v),
      )
      return {
        ...prev,
        reward_functions_file: name,
        reward_functions: builtinsOnly.length > 0 ? builtinsOnly : null,
      }
    })
  }

  function handleRewardFileUpload(files: FileList | null) {
    const file = files?.[0]
    // Reset so picking the same file again re-fires the change event.
    if (rewardFileInputRef.current) rewardFileInputRef.current.value = ''
    if (!file) return
    setRewardUploadError(null)
    uploadRewardFile.mutate(file, {
      onSuccess: (info) => {
        toast(t('form.toasts.rewardUploaded', { name: info.name }), { variant: 'success' })
        selectRewardFile(info.name)
      },
      onError: (error) => {
        // 422s explain what is wrong (bad name / syntax error / no decorated
        // function / oversize) — surface the backend message verbatim.
        setRewardUploadError(
          error instanceof ApiError ? error.message : t('form.toasts.rewardUploadFailed'),
        )
      },
    })
  }

  function handleDeleteRewardFile(name: string) {
    deleteRewardFile.mutate(name, {
      onSuccess: () => {
        toast(t('form.toasts.rewardDeleted', { name }), { variant: 'success' })
        selectRewardFile(null)
      },
      onError: (error) => {
        // 409 conflict when the active run references the file.
        toast(
          error instanceof ApiError ? error.message : t('form.toasts.rewardDeleteFailed'),
          { variant: 'error' },
        )
      },
    })
  }

  function handleImportFile(files: FileList | null) {
    const file = files?.[0]
    // Reset so picking the same file again re-fires the change event.
    if (importInputRef.current) importInputRef.current.value = ''
    if (!file) return
    setImportError(null)
    importConfig.mutate(file, {
      onSuccess: (loaded) => {
        setConfig(loaded)
        setTouched(false)
        toast(t('form.toasts.configLoaded'), { variant: 'success' })
      },
      onError: (error) => {
        // 422s name the offending keys — surface the backend message verbatim.
        setImportError(
          error instanceof ApiError ? error.message : t('form.toasts.importFailed'),
        )
      },
    })
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (hasErrors) return

    createRun.mutate(config, {
      onSuccess: (run) => {
        toast(t('form.toasts.runCreated', { name: run.name }), { variant: 'success' })
        onCreated(run.run_id)
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'training_active') {
          toast(t('form.toasts.trainingActive'), { variant: 'error' })
        } else if (error instanceof ApiError) {
          toast(error.message, { variant: 'error' })
        } else {
          toast(t('form.toasts.createFailed'), { variant: 'error' })
        }
      },
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="secondary"
          size="sm"
          loading={importConfig.isPending}
          onClick={() => importInputRef.current?.click()}
        >
          {t('form.loadYaml')}
        </Button>
        <input
          ref={importInputRef}
          type="file"
          accept=".yaml,.yml"
          className="hidden"
          aria-label={t('form.yamlFileAria')}
          onChange={(e) => handleImportFile(e.target.files)}
        />
        {importError && (
          <p role="alert" className="text-xs text-danger">
            {importError}
          </p>
        )}
      </div>
      <Card title={t('form.cards.run')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t('form.fields.runName')}
            htmlFor="run-name"
            error={touched ? errorText(errors.name) : undefined}
          >
            <Input
              id="run-name"
              value={config.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder={t('form.fields.runNamePlaceholder')}
            />
          </Field>
        </div>
      </Card>

      <Card title={t('form.cards.model')}>
        {modelsQuery.isError ? (
          <FetchErrorNotice
            message={t('form.loadModelsFailed')}
            onRetry={() => modelsQuery.refetch()}
          />
        ) : modelsQuery.data && modelsQuery.data.length === 0 ? (
          <p className="text-sm text-text-muted">
            {t('form.noModels.text')}{' '}
            <Link to="/models" className="text-accent hover:underline">
              {t('form.noModels.link')}
            </Link>{' '}
            {t('form.noModels.suffix')}
          </p>
        ) : (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('form.cards.model')}>
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
        {touched && errors.model_id && (
          <p className="mt-2 text-xs text-danger">{errorText(errors.model_id)}</p>
        )}
      </Card>

      <Card title={t('form.cards.dataset')}>
        {datasetsQuery.isError ? (
          <FetchErrorNotice
            message={t('form.loadDatasetsFailed')}
            onRetry={() => datasetsQuery.refetch()}
          />
        ) : splitDatasets.length === 0 ? (
          <p className="text-sm text-text-muted">
            {t('form.noDatasets.text')}{' '}
            <Link to="/datasets" className="text-accent hover:underline">
              {t('form.noDatasets.link')}
            </Link>{' '}
            {t('form.noDatasets.suffix')}
          </p>
        ) : (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('form.cards.dataset')}>
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
                    {dataset.name}{' '}
                    <span className="text-text-muted">
                      {t('form.datasetRows', { n: dataset.row_count })}
                    </span>
                  </span>
                  <Badge variant="info">{dataset.format}</Badge>
                </button>
              )
            })}
          </div>
        )}
        {touched && errors.dataset_id && (
          <p className="mt-2 text-xs text-danger">{errorText(errors.dataset_id)}</p>
        )}
        {errors.dataset_format && (
          <p className="mt-2 text-xs text-danger">{errorText(errors.dataset_format)}</p>
        )}
      </Card>

      <Card title={t('form.cards.modeType')}>
        <div className="flex flex-col gap-4">
          <div>
            <span className="mb-2 block text-sm font-medium text-text">
              {t('form.fields.trainMode')}
            </span>
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-label={t('form.fields.trainMode')}
            >
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

          <Field label={t('form.fields.trainType')} htmlFor="train-type">
            <Select
              id="train-type"
              options={translateOptions(TRAIN_TYPE_OPTIONS)}
              value={config.train_type}
              onChange={(e) => update('train_type', e.target.value as TrainType)}
            />
          </Field>
        </div>
      </Card>

      {config.train_mode === 'sft' && (
        <Card title={t('form.cards.sft')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('form.fields.sftLoss')} htmlFor="sft-loss-type">
              <Select
                id="sft-loss-type"
                options={translateOptions(SFT_LOSS_OPTIONS)}
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
        <Card title={t('form.cards.preferenceRl')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              label={t('form.fields.beta')}
              htmlFor="beta"
              error={touched ? errorText(errors.beta) : undefined}
            >
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
        <Card title={t('form.cards.preferenceRl')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              label={t('form.fields.groupSize')}
              htmlFor="group-size"
              error={touched ? errorText(errors.group_size) : undefined}
            >
              <Input
                id="group-size"
                type="number"
                value={config.group_size ?? ''}
                onChange={(e) => update('group_size', e.target.value === '' ? null : Number(e.target.value))}
              />
            </Field>
            <Field
              label={t('form.fields.temperature')}
              htmlFor="temperature"
              error={touched ? errorText(errors.temperature) : undefined}
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
              label={t('form.fields.maxCompletionLength')}
              htmlFor="max-completion-length"
              error={touched ? errorText(errors.max_completion_length) : undefined}
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
            <legend className="mb-2 block text-sm font-medium text-text">
              {t('form.rewards.legend')}
            </legend>
            <div className="mb-3 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Field
                  label={t('form.rewards.customFile')}
                  htmlFor="reward-functions-file"
                  className="min-w-48"
                >
                  <Select
                    id="reward-functions-file"
                    options={[
                      { value: '', label: t('form.rewards.none') },
                      ...rewardFiles.map((f) => ({ value: f.name, label: `${f.name}.py` })),
                      // Keep a referenced-but-missing name visible instead of
                      // silently snapping the select to "None".
                      ...(config.reward_functions_file && !selectedRewardFile
                        ? [
                            {
                              value: config.reward_functions_file,
                              label: t('form.rewards.missingFile', {
                                name: config.reward_functions_file,
                              }),
                            },
                          ]
                        : []),
                    ]}
                    value={config.reward_functions_file ?? ''}
                    onChange={(e) => selectRewardFile(e.target.value === '' ? null : e.target.value)}
                  />
                </Field>
                <div className="flex items-end gap-2 self-stretch pb-0.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={uploadRewardFile.isPending}
                    onClick={() => rewardFileInputRef.current?.click()}
                  >
                    {t('form.rewards.upload')}
                  </Button>
                  {selectedRewardFile && (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={deleteRewardFile.isPending}
                      onClick={() => handleDeleteRewardFile(selectedRewardFile.name)}
                    >
                      {t('form.rewards.deleteFile')}
                    </Button>
                  )}
                </div>
              </div>
              <input
                ref={rewardFileInputRef}
                type="file"
                accept=".py"
                className="hidden"
                aria-label={t('form.rewards.fileAria')}
                onChange={(e) => handleRewardFileUpload(e.target.files)}
              />
              {rewardUploadError && (
                <p role="alert" className="text-xs text-danger">
                  {rewardUploadError}
                </p>
              )}
            </div>
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
                    {t(fn.labelKey)}{' '}
                    <code className="font-mono text-xs text-text-muted">({fn.value})</code>
                  </span>
                </label>
              ))}
            </div>
            {selectedRewardFile && customRewardFunctions.length > 0 && (
              <div className="mt-3">
                <p className="mb-2 text-xs font-medium text-text-muted">
                  {t('form.rewards.fromFile', { name: selectedRewardFile.name })}
                </p>
                <div className="flex flex-col gap-2">
                  {customRewardFunctions.map((name) => (
                    <label key={name} className="flex items-center gap-2 text-sm text-text" title={name}>
                      <input
                        type="checkbox"
                        checked={(config.reward_functions ?? []).includes(name)}
                        onChange={() => toggleRewardFunction(name)}
                        className="h-4 w-4 accent-accent"
                      />
                      <code className="font-mono text-xs">{name}</code>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-2 text-xs text-text-muted">
              {selectedRewardFile
                ? t('form.rewards.noneSelectedBuiltins')
                : t('form.rewards.noneSelected')}
            </p>
          </fieldset>
        </Card>
      )}

      {config.train_mode === 'ftpo' && (
        <Card title={t('form.cards.preferenceRl')}>
          <p className="mb-4 text-xs text-text-muted">{t('form.ftpoHint')}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={t('form.fields.lambdaMseTarget')}
              htmlFor="lambda-mse-target"
              error={touched ? errorText(errors.lambda_mse_target) : undefined}
            >
              <Input
                id="lambda-mse-target"
                type="number"
                step="0.01"
                placeholder={t('form.fields.defaultPlaceholder', { value: '0.05' })}
                value={config.lambda_mse_target ?? ''}
                onChange={(e) =>
                  update('lambda_mse_target', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
            <Field
              label={t('form.fields.tauMseTarget')}
              htmlFor="tau-mse-target"
              error={touched ? errorText(errors.tau_mse_target) : undefined}
            >
              <Input
                id="tau-mse-target"
                type="number"
                step="0.1"
                placeholder={t('form.fields.defaultPlaceholder', { value: '1.0' })}
                value={config.tau_mse_target ?? ''}
                onChange={(e) =>
                  update('tau_mse_target', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
            <Field
              label={t('form.fields.lambdaMse')}
              htmlFor="lambda-mse"
              error={touched ? errorText(errors.lambda_mse) : undefined}
            >
              <Input
                id="lambda-mse"
                type="number"
                step="0.1"
                placeholder={t('form.fields.defaultPlaceholder', { value: '0.4' })}
                value={config.lambda_mse ?? ''}
                onChange={(e) =>
                  update('lambda_mse', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
            <Field
              label={t('form.fields.clipEpsilonLogits')}
              htmlFor="clip-epsilon-logits"
              error={touched ? errorText(errors.clip_epsilon_logits) : undefined}
            >
              <Input
                id="clip-epsilon-logits"
                type="number"
                step="0.1"
                placeholder={t('form.fields.defaultPlaceholder', { value: '2.0' })}
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
        <Card title={t('form.cards.lora')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t('form.fields.rank')} htmlFor="lora-rank">
              <Input
                id="lora-rank"
                type="number"
                value={config.lora.rank}
                onChange={(e) => updateLora('rank', Number(e.target.value))}
              />
            </Field>
            <Field label={t('form.fields.scale')} htmlFor="lora-scale">
              <Input
                id="lora-scale"
                type="number"
                step="0.1"
                value={config.lora.scale}
                onChange={(e) => updateLora('scale', Number(e.target.value))}
              />
            </Field>
            <Field label={t('form.fields.dropout')} htmlFor="lora-dropout">
              <Input
                id="lora-dropout"
                type="number"
                step="0.01"
                value={config.lora.dropout}
                onChange={(e) => updateLora('dropout', Number(e.target.value))}
              />
            </Field>
          </div>
          {touched && errors.lora && (
            <p className="mt-2 text-xs text-danger">{errorText(errors.lora)}</p>
          )}
        </Card>
      )}

      <Card title={t('form.cards.basics')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field
            label={t('form.fields.batchSize')}
            htmlFor="batch-size"
            error={touched ? errorText(errors.batch_size) : undefined}
          >
            <Input
              id="batch-size"
              type="number"
              value={config.batch_size}
              onChange={(e) => update('batch_size', Number(e.target.value))}
            />
          </Field>
          <Field
            label={t('form.fields.gradAccumSteps')}
            htmlFor="gradient-accumulation-steps"
            error={touched ? errorText(errors.gradient_accumulation_steps) : undefined}
            hint={t('form.fields.gradAccumHint')}
          >
            <Input
              id="gradient-accumulation-steps"
              type="number"
              placeholder={t('form.fields.defaultPlaceholder', { value: '1' })}
              value={config.gradient_accumulation_steps ?? ''}
              onChange={(e) =>
                update('gradient_accumulation_steps', e.target.value === '' ? null : Number(e.target.value))
              }
            />
          </Field>
          <Field
            label={t('form.fields.iterations')}
            htmlFor="iters"
            error={touched ? errorText(errors.iters) : undefined}
          >
            <Input
              id="iters"
              type="number"
              value={config.iters}
              onChange={(e) => update('iters', Number(e.target.value))}
            />
          </Field>
          <Field
            label={t('form.fields.learningRate')}
            htmlFor="learning-rate"
            error={touched ? errorText(errors.learning_rate) : undefined}
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
            label={t('form.fields.maxSeqLength')}
            htmlFor="max-seq-length"
            error={touched ? errorText(errors.max_seq_length) : undefined}
          >
            <Input
              id="max-seq-length"
              type="number"
              value={config.max_seq_length}
              onChange={(e) => update('max_seq_length', Number(e.target.value))}
            />
          </Field>
          <Field
            label={t('form.fields.numLayers')}
            htmlFor="num-layers"
            error={touched ? errorText(errors.num_layers) : undefined}
          >
            <Input
              id="num-layers"
              type="number"
              value={config.num_layers}
              onChange={(e) => update('num_layers', Number(e.target.value))}
            />
          </Field>
          <Field
            label={t('form.fields.seed')}
            htmlFor="seed"
            error={touched ? errorText(errors.seed) : undefined}
          >
            <Input
              id="seed"
              type="number"
              value={config.seed}
              onChange={(e) => update('seed', Number(e.target.value))}
            />
          </Field>
        </div>
      </Card>

      <Card title={t('form.cards.optimizer')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('form.fields.optimizer')} htmlFor="optimizer">
            <Select
              id="optimizer"
              options={OPTIMIZER_OPTIONS}
              value={config.optimizer}
              onChange={(e) => update('optimizer', e.target.value)}
            />
          </Field>
          <Field label={t('form.fields.lrSchedule')} htmlFor="lr-schedule">
            <Select
              id="lr-schedule"
              options={translateOptions(LR_SCHEDULE_OPTIONS)}
              value={config.lr_schedule}
              onChange={(e) => update('lr_schedule', e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card title={t('form.cards.memory')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('form.fields.loadInBits')} htmlFor="load-in-bits">
            <Select
              id="load-in-bits"
              options={translateOptions(LOAD_IN_BITS_OPTIONS)}
              value={config.load_in_bits === null ? '' : String(config.load_in_bits)}
              onChange={(e) => update('load_in_bits', e.target.value === '' ? null : Number(e.target.value))}
            />
          </Field>
          <div className="flex items-end">
            <Switch
              checked={config.grad_checkpoint}
              onChange={(checked) => update('grad_checkpoint', checked)}
              label={t('form.fields.gradCheckpoint')}
            />
          </div>
        </div>
      </Card>

      <Card title={t('form.cards.reporting')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field
            label={t('form.fields.saveEvery')}
            htmlFor="save-every"
            error={touched ? errorText(errors.save_every) : undefined}
          >
            <Input
              id="save-every"
              type="number"
              value={config.save_every}
              onChange={(e) => update('save_every', Number(e.target.value))}
            />
          </Field>
          <Field
            label={t('form.fields.stepsPerReport')}
            htmlFor="steps-per-report"
            error={touched ? errorText(errors.steps_per_report) : undefined}
          >
            <Input
              id="steps-per-report"
              type="number"
              value={config.steps_per_report}
              onChange={(e) => update('steps_per_report', Number(e.target.value))}
            />
          </Field>
          <Field
            label={t('form.fields.stepsPerEval')}
            htmlFor="steps-per-eval"
            error={touched ? errorText(errors.steps_per_eval) : undefined}
          >
            <Input
              id="steps-per-eval"
              type="number"
              value={config.steps_per_eval}
              onChange={(e) => update('steps_per_eval', Number(e.target.value))}
            />
          </Field>
          <Field
            label={t('form.fields.valBatches')}
            htmlFor="val-batches"
            error={touched ? errorText(errors.val_batches) : undefined}
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
          {t('form.startTraining')}
        </Button>
      </div>
    </form>
  )
}

/** Same error copy as the Models/Datasets pages, plus an inline retry. */
function FetchErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation('common')
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-danger">{message}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t('actions.retry')}
      </Button>
    </div>
  )
}
