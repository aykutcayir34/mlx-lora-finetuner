import { Field } from '../common/Field'
import { Select } from '../common/Select'
import type { ModelInfo } from '../../api/types'
import type { HistorySort } from '../../api/queries/history'

export interface HistoryFiltersState {
  modelId: string
  trainMode: string
  status: string
  sort: HistorySort
}

interface HistoryFilterBarProps {
  models: ModelInfo[]
  filters: HistoryFiltersState
  onChange: (filters: HistoryFiltersState) => void
}

const MODE_OPTIONS = [
  { value: '', label: 'All modes' },
  { value: 'sft', label: 'SFT' },
  { value: 'dpo', label: 'DPO' },
  { value: 'orpo', label: 'ORPO' },
  { value: 'cpo', label: 'CPO' },
  { value: 'grpo', label: 'GRPO' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const SORT_OPTIONS: { value: HistorySort; label: string }[] = [
  { value: '-created_at', label: 'Newest first' },
  { value: 'created_at', label: 'Oldest first' },
  { value: 'final_train_loss', label: 'Train loss (low to high)' },
  { value: '-final_train_loss', label: 'Train loss (high to low)' },
]

export function HistoryFilterBar({ models, filters, onChange }: HistoryFilterBarProps) {
  const modelOptions = [
    { value: '', label: 'All models' },
    ...models.map((model) => ({ value: model.model_id, label: model.model_id })),
  ]

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Model" htmlFor="history-filter-model">
        <Select
          id="history-filter-model"
          value={filters.modelId}
          onChange={(event) => onChange({ ...filters, modelId: event.target.value })}
          options={modelOptions}
        />
      </Field>
      <Field label="Mode" htmlFor="history-filter-mode">
        <Select
          id="history-filter-mode"
          value={filters.trainMode}
          onChange={(event) => onChange({ ...filters, trainMode: event.target.value })}
          options={MODE_OPTIONS}
        />
      </Field>
      <Field label="Status" htmlFor="history-filter-status">
        <Select
          id="history-filter-status"
          value={filters.status}
          onChange={(event) => onChange({ ...filters, status: event.target.value })}
          options={STATUS_OPTIONS}
        />
      </Field>
      <Field label="Sort" htmlFor="history-filter-sort">
        <Select
          id="history-filter-sort"
          value={filters.sort}
          onChange={(event) => onChange({ ...filters, sort: event.target.value as HistorySort })}
          options={SORT_OPTIONS}
        />
      </Field>
    </div>
  )
}
