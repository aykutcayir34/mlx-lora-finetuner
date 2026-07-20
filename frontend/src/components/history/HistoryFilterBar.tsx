import { useTranslation } from 'react-i18next'
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

export function HistoryFilterBar({ models, filters, onChange }: HistoryFilterBarProps) {
  const { t } = useTranslation('history')

  const modelOptions = [
    { value: '', label: t('filters.allModels') },
    ...models.map((model) => ({ value: model.model_id, label: model.model_id })),
  ]

  const modeOptions = [
    { value: '', label: t('filters.allModes') },
    // Mode names are acronyms, identical in every language.
    { value: 'sft', label: 'SFT' },
    { value: 'dpo', label: 'DPO' },
    { value: 'orpo', label: 'ORPO' },
    { value: 'cpo', label: 'CPO' },
    { value: 'grpo', label: 'GRPO' },
  ]

  const statusOptions = [
    { value: '', label: t('filters.allStatuses') },
    { value: 'queued', label: t('common:status.queued') },
    { value: 'running', label: t('common:status.running') },
    { value: 'completed', label: t('common:status.completed') },
    { value: 'failed', label: t('common:status.failed') },
    { value: 'cancelled', label: t('common:status.cancelled') },
  ]

  const sortOptions: { value: HistorySort; label: string }[] = [
    { value: '-created_at', label: t('filters.sortOptions.newestFirst') },
    { value: 'created_at', label: t('filters.sortOptions.oldestFirst') },
    { value: 'final_train_loss', label: t('filters.sortOptions.trainLossAsc') },
    { value: '-final_train_loss', label: t('filters.sortOptions.trainLossDesc') },
  ]

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t('filters.model')} htmlFor="history-filter-model">
        <Select
          id="history-filter-model"
          value={filters.modelId}
          onChange={(event) => onChange({ ...filters, modelId: event.target.value })}
          options={modelOptions}
        />
      </Field>
      <Field label={t('filters.mode')} htmlFor="history-filter-mode">
        <Select
          id="history-filter-mode"
          value={filters.trainMode}
          onChange={(event) => onChange({ ...filters, trainMode: event.target.value })}
          options={modeOptions}
        />
      </Field>
      <Field label={t('filters.status')} htmlFor="history-filter-status">
        <Select
          id="history-filter-status"
          value={filters.status}
          onChange={(event) => onChange({ ...filters, status: event.target.value })}
          options={statusOptions}
        />
      </Field>
      <Field label={t('filters.sort')} htmlFor="history-filter-sort">
        <Select
          id="history-filter-sort"
          value={filters.sort}
          onChange={(event) => onChange({ ...filters, sort: event.target.value as HistorySort })}
          options={sortOptions}
        />
      </Field>
    </div>
  )
}
