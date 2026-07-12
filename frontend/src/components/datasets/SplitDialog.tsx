import { useState } from 'react'
import { Button } from '../common/Button'
import { Field } from '../common/Field'
import { Input } from '../common/Input'
import { Modal } from '../common/Modal'
import { Slider } from '../common/Slider'
import { Switch } from '../common/Switch'
import { useToast } from '../common/Toast'
import { useSplitDataset } from '../../api/queries/datasets'
import { ApiError } from '../../api/client'

interface SplitDialogProps {
  open: boolean
  datasetId: string
  onClose: () => void
}

const SUM_TOLERANCE = 0.001

export function SplitDialog({ open, datasetId, onClose }: SplitDialogProps) {
  const [train, setTrain] = useState(0.8)
  const [valid, setValid] = useState(0.1)
  const [test, setTest] = useState(0.1)
  const [seed, setSeed] = useState(42)
  const [shuffle, setShuffle] = useState(true)
  const split = useSplitDataset()
  const { toast } = useToast()

  const sum = train + valid + test
  const sumIsValid = Math.abs(sum - 1) <= SUM_TOLERANCE

  function handleSubmit() {
    if (!sumIsValid) return
    split.mutate(
      { datasetId, body: { train, valid, test, seed, shuffle } },
      {
        onSuccess: () => {
          toast('Dataset split created.', { variant: 'success' })
          onClose()
        },
        onError: (error) => {
          toast(error instanceof ApiError ? error.message : 'Split failed.', { variant: 'error' })
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Split dataset"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!sumIsValid} loading={split.isPending}>
            Split
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Train ratio" htmlFor="split-train">
          <Slider
            id="split-train"
            min={0}
            max={1}
            step={0.01}
            value={train}
            showValue
            onChange={(event) => setTrain(Number(event.target.value))}
          />
        </Field>
        <Field label="Valid ratio" htmlFor="split-valid">
          <Slider
            id="split-valid"
            min={0}
            max={1}
            step={0.01}
            value={valid}
            showValue
            onChange={(event) => setValid(Number(event.target.value))}
          />
        </Field>
        <Field label="Test ratio" htmlFor="split-test">
          <Slider
            id="split-test"
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

        <Field label="Seed" htmlFor="split-seed">
          <Input
            id="split-seed"
            type="number"
            value={seed}
            onChange={(event) => setSeed(Number(event.target.value))}
          />
        </Field>

        <Switch checked={shuffle} onChange={setShuffle} label="Shuffle before splitting" />
      </div>
    </Modal>
  )
}
