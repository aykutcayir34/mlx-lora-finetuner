import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../common/Button'
import { Field } from '../common/Field'
import { Input } from '../common/Input'
import { Modal } from '../common/Modal'
import { Select, type SelectOption } from '../common/Select'
import { Slider } from '../common/Slider'
import { Switch } from '../common/Switch'
import { useToast } from '../common/Toast'
import { useImportDataset } from '../../api/queries/datasets'
import { ApiError } from '../../api/client'
import type { DatasetFormat, DatasetImportRequest, SplitRequest } from '../../api/types'

/** The split ratios/seed to apply automatically once an import completes. */
export type AutoSplitConfig = SplitRequest

interface ImportDatasetDialogProps {
  open: boolean
  hfDatasetId: string
  onClose: () => void
  /** Called after the import has been queued (POST succeeded). */
  onImportQueued: (importId: string, autoSplit: AutoSplitConfig | null) => void
}

const SUM_TOLERANCE = 0.001

/** Client-side only: which canonical keys `column_map` needs for a given
 * target format. Never sent to the API — only used to decide which column
 * inputs to show and which keys are required before submitting. */
const CANONICAL_FIELDS: Record<DatasetFormat, { required: string[]; optional?: string[] }> = {
  chat: { required: ['messages'] },
  completions: { required: ['prompt', 'completion'] },
  text: { required: ['text'] },
  dpo: { required: ['prompt', 'chosen', 'rejected'] },
  orpo: { required: ['prompt', 'chosen', 'rejected', 'preference_score'] },
  grpo: { required: ['prompt', 'answer'], optional: ['system'] },
  ftpo: { required: ['context_with_chat_template', 'rejected_decoded', 'multi_chosen_decoded'] },
}

const TARGET_FORMATS: DatasetFormat[] = ['chat', 'completions', 'text', 'dpo', 'orpo', 'grpo', 'ftpo']

type TargetFormat = 'auto' | DatasetFormat

function slugify(hfDatasetId: string) {
  return hfDatasetId.replace('/', '-')
}

export function ImportDatasetDialog({
  open,
  hfDatasetId,
  onClose,
  onImportQueued,
}: ImportDatasetDialogProps) {
  const { t } = useTranslation('datasets')
  const [name, setName] = useState('')
  const [split, setSplit] = useState('train')
  const [maxRows, setMaxRows] = useState('5000')
  const [autoSplit, setAutoSplit] = useState(true)
  const [train, setTrain] = useState(0.8)
  const [valid, setValid] = useState(0.1)
  const [test, setTest] = useState(0.1)
  const [seed, setSeed] = useState(42)
  const [targetFormat, setTargetFormat] = useState<TargetFormat>('auto')
  const [columnValues, setColumnValues] = useState<Record<string, string>>({})
  const importDataset = useImportDataset()
  const { toast } = useToast()

  const formatOptions: SelectOption[] = [
    { value: 'auto', label: t('importDialog.columnMap.autoDetect') },
    ...TARGET_FORMATS.map((format) => ({ value: format, label: t(`formats.${format}`) })),
  ]

  const formatSpec = targetFormat === 'auto' ? null : CANONICAL_FIELDS[targetFormat]
  const missingRequiredColumn = formatSpec
    ? formatSpec.required.some((key) => !(columnValues[key] ?? '').trim())
    : false

  const sum = train + valid + test
  const sumIsValid = Math.abs(sum - 1) <= SUM_TOLERANCE
  const canSubmit = (!autoSplit || sumIsValid) && !missingRequiredColumn

  function handleTargetFormatChange(value: string) {
    setTargetFormat(value as TargetFormat)
    setColumnValues({})
  }

  function handleColumnValueChange(key: string, value: string) {
    setColumnValues((prev) => ({ ...prev, [key]: value }))
  }

  function buildColumnMap(): Record<string, string> | undefined {
    if (!formatSpec) return undefined
    const map: Record<string, string> = {}
    for (const key of [...formatSpec.required, ...(formatSpec.optional ?? [])]) {
      const value = (columnValues[key] ?? '').trim()
      if (value) map[key] = value
    }
    return map
  }

  function handleSubmit() {
    if (!canSubmit) return
    const trimmedMaxRows = maxRows.trim()
    const columnMap = buildColumnMap()
    const body: DatasetImportRequest = {
      dataset_id: hfDatasetId,
      config: null,
      split: split.trim() || 'train',
      name: name.trim() || null,
      max_rows: trimmedMaxRows === '' ? null : Number(trimmedMaxRows),
    }
    // An empty map is a 422 from the API, so never send one — `canSubmit`
    // already blocks it, but not in a way this function can see.
    if (columnMap && Object.keys(columnMap).length > 0) {
      body.column_map = columnMap
    }
    importDataset.mutate(
      body,
      {
        onSuccess: (response) => {
          toast(t('importDialog.started', { datasetId: hfDatasetId }), { variant: 'success' })
          onImportQueued(response.import_id, autoSplit ? { train, valid, test, seed, shuffle: true } : null)
          onClose()
        },
        onError: (error) => {
          const message =
            error instanceof ApiError && error.code === 'conflict'
              ? t('importDialog.alreadyImporting')
              : error instanceof ApiError
                ? error.message
                : t('importDialog.startFailed')
          toast(message, { variant: 'error' })
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('importDialog.title')}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit} loading={importDataset.isPending}>
            {t('search.import')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="break-all text-xs text-text-muted">{hfDatasetId}</p>

        <Field label={t('importDialog.nameLabel')} htmlFor="import-name" hint={t('importDialog.nameHint')}>
          <Input
            id="import-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={slugify(hfDatasetId)}
          />
        </Field>

        <Field label={t('importDialog.splitLabel')} htmlFor="import-split">
          <Input
            id="import-split"
            value={split}
            onChange={(event) => setSplit(event.target.value)}
            placeholder={t('importDialog.splitPlaceholder')}
          />
        </Field>

        <Field
          label={t('importDialog.maxRowsLabel')}
          htmlFor="import-max-rows"
          hint={t('importDialog.maxRowsHint')}
        >
          <Input
            id="import-max-rows"
            type="number"
            value={maxRows}
            onChange={(event) => setMaxRows(event.target.value)}
            placeholder={t('importDialog.maxRowsPlaceholder')}
          />
        </Field>

        <Field
          label={t('importDialog.columnMap.formatLabel')}
          htmlFor="import-column-map-format"
          hint={t('importDialog.columnMap.formatHint')}
        >
          <Select
            id="import-column-map-format"
            options={formatOptions}
            value={targetFormat}
            onChange={(event) => handleTargetFormatChange(event.target.value)}
          />
        </Field>

        {formatSpec && (
          <>
            {[...formatSpec.required, ...(formatSpec.optional ?? [])].map((key) => (
              <Field
                key={key}
                label={t(`importDialog.columnMap.fields.${key}.label`)}
                htmlFor={`import-column-map-${key}`}
              >
                <Input
                  id={`import-column-map-${key}`}
                  value={columnValues[key] ?? ''}
                  onChange={(event) => handleColumnValueChange(key, event.target.value)}
                  placeholder={t(`importDialog.columnMap.fields.${key}.placeholder`)}
                />
              </Field>
            ))}
            {missingRequiredColumn && (
              <p className="text-xs text-danger">{t('importDialog.columnMap.missingRequired')}</p>
            )}
          </>
        )}

        <Switch checked={autoSplit} onChange={setAutoSplit} label={t('importDialog.autoSplitLabel')} />

        {autoSplit && (
          <>
            <Field label={t('splitForm.trainRatio')} htmlFor="import-split-train">
              <Slider
                id="import-split-train"
                min={0}
                max={1}
                step={0.01}
                value={train}
                showValue
                onChange={(event) => setTrain(Number(event.target.value))}
              />
            </Field>
            <Field label={t('splitForm.validRatio')} htmlFor="import-split-valid">
              <Slider
                id="import-split-valid"
                min={0}
                max={1}
                step={0.01}
                value={valid}
                showValue
                onChange={(event) => setValid(Number(event.target.value))}
              />
            </Field>
            <Field label={t('splitForm.testRatio')} htmlFor="import-split-test">
              <Slider
                id="import-split-test"
                min={0}
                max={1}
                step={0.01}
                value={test}
                showValue
                onChange={(event) => setTest(Number(event.target.value))}
              />
            </Field>

            <p className={`text-xs ${sumIsValid ? 'text-text-muted' : 'text-danger'}`}>
              {t('splitForm.sum', { sum: sum.toFixed(2) })}
              {sumIsValid ? '' : t('splitForm.sumError')}
            </p>

            <Field label={t('splitForm.seed')} htmlFor="import-split-seed">
              <Input
                id="import-split-seed"
                type="number"
                value={seed}
                onChange={(event) => setSeed(Number(event.target.value))}
              />
            </Field>
          </>
        )}
      </div>
    </Modal>
  )
}
