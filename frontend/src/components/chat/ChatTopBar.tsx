import type { AdapterInfo, ModelInfo } from '../../api/types'
import { Field } from '../common/Field'
import { Select, type SelectOption } from '../common/Select'
import { Switch } from '../common/Switch'

interface ChatTopBarProps {
  models: ModelInfo[]
  selectedModelId: string
  onModelChange: (modelId: string) => void
  adapters: AdapterInfo[]
  selectedAdapterPath: string
  onAdapterChange: (adapterPath: string) => void
  compareMode: boolean
  onCompareModeChange: (enabled: boolean) => void
}

const NONE_ADAPTER: SelectOption = { value: '', label: 'None (base model)' }

export function ChatTopBar({
  models,
  selectedModelId,
  onModelChange,
  adapters,
  selectedAdapterPath,
  onAdapterChange,
  compareMode,
  onCompareModeChange,
}: ChatTopBarProps) {
  const filteredAdapters = adapters.filter((adapter) => adapter.base_model_id === selectedModelId)
  const modelOptions: SelectOption[] = models.map((model) => ({
    value: model.model_id,
    label: model.model_id,
  }))
  const adapterOptions: SelectOption[] = [
    NONE_ADAPTER,
    ...filteredAdapters.map((adapter) => ({ value: adapter.adapter_path, label: adapter.name })),
  ]

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-surface p-3">
      <Field label="Model" className="min-w-[240px]">
        <Select
          aria-label="Model"
          options={modelOptions}
          value={selectedModelId}
          onChange={(event) => onModelChange(event.target.value)}
        />
      </Field>
      <Field label="Adapter" className="min-w-[240px]">
        <Select
          aria-label="Adapter"
          options={adapterOptions}
          value={selectedAdapterPath}
          onChange={(event) => onAdapterChange(event.target.value)}
        />
      </Field>
      <Switch
        checked={compareMode}
        onChange={onCompareModeChange}
        disabled={!selectedAdapterPath}
        label="Compare with/without adapter"
      />
    </div>
  )
}
