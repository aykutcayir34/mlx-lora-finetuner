import { useState } from 'react'
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
          toast(`Import started for "${hfDatasetId}".`, { variant: 'success' })
          onImportQueued(response.import_id, autoSplit ? { train, valid, test, seed, shuffle: true } : null)
          onClose()
        },
        onError: (error) => {
          const message =
            error instanceof ApiError && error.code === 'conflict'
              ? 'This dataset is already importing.'
              : error instanceof ApiError
                ? error.message
                : 'Failed to start import.'
          toast(message, { variant: 'error' })
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import dataset"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit} loading={importDataset.isPending}>
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="break-all text-xs text-text-muted">{hfDatasetId}</p>

        <Field label="Name" htmlFor="import-name" hint="Leave blank to auto-generate from the dataset id.">
          <Input
            id="import-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={slugify(hfDatasetId)}
          />
        </Field>

        <Field label="Split" htmlFor="import-split">
          <Input
            id="import-split"
            value={split}
            onChange={(event) => setSplit(event.target.value)}
            placeholder="train"
          />
        </Field>

        <Field label="Max rows" htmlFor="import-max-rows" hint="Leave blank to import all rows.">
          <Input
            id="import-max-rows"
            type="number"
            value={maxRows}
            onChange={(event) => setMaxRows(event.target.value)}
            placeholder="5000"
          />
        </Field>

        <Switch checked={autoSplit} onChange={setAutoSplit} label="Split automatically after import" />

        {autoSplit && (
          <>
            <Field label="Train ratio" htmlFor="import-split-train">
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
            <Field label="Valid ratio" htmlFor="import-split-valid">
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
            <Field label="Test ratio" htmlFor="import-split-test">
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
              Sum: {sum.toFixed(2)}
              {sumIsValid ? '' : ' — ratios must sum to 1.00'}
            </p>

            <Field label="Seed" htmlFor="import-split-seed">
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
