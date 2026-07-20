import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('chat')
  const filteredAdapters = adapters.filter((adapter) => adapter.base_model_id === selectedModelId)
  const modelOptions: SelectOption[] = models.map((model) => ({
    value: model.model_id,
    label: model.model_id,
  }))
  const adapterOptions: SelectOption[] = [
    { value: '', label: t('topBar.noneAdapter') },
    ...filteredAdapters.map((adapter) => ({ value: adapter.adapter_path, label: adapter.name })),
  ]

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-surface p-3">
      <Field label={t('topBar.model')} className="min-w-[240px]">
        <Select
          aria-label={t('topBar.model')}
          options={modelOptions}
          value={selectedModelId}
          onChange={(event) => onModelChange(event.target.value)}
        />
      </Field>
      <Field label={t('topBar.adapter')} className="min-w-[240px]">
        <Select
          aria-label={t('topBar.adapter')}
          options={adapterOptions}
          value={selectedAdapterPath}
          onChange={(event) => onAdapterChange(event.target.value)}
        />
      </Field>
      <Switch
        checked={compareMode}
        onChange={onCompareModeChange}
        disabled={!selectedAdapterPath}
        label={t('topBar.compare')}
      />
    </div>
  )
}
