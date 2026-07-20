import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../common/Button'
import { Field } from '../common/Field'
import { Input } from '../common/Input'
import { Modal } from '../common/Modal'
import { Slider } from '../common/Slider'
import { Switch } from '../common/Switch'
import { useToast } from '../common/Toast'
import { useImportDataset } from '../../api/queries/datasets'
import { ApiError } from '../../api/client'
import type { SplitRequest } from '../../api/types'

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
  const importDataset = useImportDataset()
  const { toast } = useToast()

  const sum = train + valid + test
  const sumIsValid = Math.abs(sum - 1) <= SUM_TOLERANCE
  const canSubmit = !autoSplit || sumIsValid

  function handleSubmit() {
    if (!canSubmit) return
    const trimmedMaxRows = maxRows.trim()
    importDataset.mutate(
      {
        dataset_id: hfDatasetId,
        config: null,
        split: split.trim() || 'train',
        name: name.trim() || null,
        max_rows: trimmedMaxRows === '' ? null : Number(trimmedMaxRows),
      },
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
