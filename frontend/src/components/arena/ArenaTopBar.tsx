import type { AdapterInfo, ModelInfo } from '../../api/types'
import { Field } from '../common/Field'
import { Select, type SelectOption } from '../common/Select'

export interface ArenaSidePickerValue {
  modelId: string
  adapterPath: string
}

const NONE_ADAPTER: SelectOption = { value: '', label: 'None (base)' }

interface ArenaSidePickerProps {
  label: string
  models: ModelInfo[]
  adapters: AdapterInfo[]
  value: ArenaSidePickerValue
  onChange: (value: ArenaSidePickerValue) => void
}

function ArenaSidePicker({ label, models, adapters, value, onChange }: ArenaSidePickerProps) {
  const filteredAdapters = adapters.filter((adapter) => adapter.base_model_id === value.modelId)
  const modelOptions: SelectOption[] = models.map((model) => ({
    value: model.model_id,
    label: model.model_id,
  }))
  const adapterOptions: SelectOption[] = [
    NONE_ADAPTER,
    ...filteredAdapters.map((adapter) => ({ value: adapter.adapter_path, label: adapter.name })),
  ]

  return (
    <div className="flex flex-1 flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3">
      <p className="w-full text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <Field label="Model" className="min-w-[220px] flex-1">
        <Select
          aria-label={`${label} Model`}
          options={modelOptions}
          value={value.modelId}
          onChange={(event) => onChange({ modelId: event.target.value, adapterPath: '' })}
        />
      </Field>
      <Field label="Adapter" className="min-w-[220px] flex-1">
        <Select
          aria-label={`${label} Adapter`}
          options={adapterOptions}
          value={value.adapterPath}
          onChange={(event) => onChange({ ...value, adapterPath: event.target.value })}
        />
      </Field>
    </div>
  )
}

interface ArenaTopBarProps {
  models: ModelInfo[]
  adapters: AdapterInfo[]
  sideA: ArenaSidePickerValue
  onSideAChange: (value: ArenaSidePickerValue) => void
  sideB: ArenaSidePickerValue
  onSideBChange: (value: ArenaSidePickerValue) => void
}

export function ArenaTopBar({
  models,
  adapters,
  sideA,
  onSideAChange,
  sideB,
  onSideBChange,
}: ArenaTopBarProps) {
  return (
    <div className="flex flex-wrap gap-4">
      <ArenaSidePicker label="Side A" models={models} adapters={adapters} value={sideA} onChange={onSideAChange} />
      <ArenaSidePicker label="Side B" models={models} adapters={adapters} value={sideB} onChange={onSideBChange} />
    </div>
  )
}
