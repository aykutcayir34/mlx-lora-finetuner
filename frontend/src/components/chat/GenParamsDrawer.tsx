import { useTranslation } from 'react-i18next'
import type { GenerationParams } from '../../api/types'
import { Field } from '../common/Field'
import { Input } from '../common/Input'
import { Slider } from '../common/Slider'

interface GenParamsDrawerProps {
  params: GenerationParams
  onChange: (params: GenerationParams) => void
}

export function GenParamsDrawer({ params, onChange }: GenParamsDrawerProps) {
  const { t } = useTranslation('chat')
  return (
    <details className="rounded-xl border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-medium text-text">
        {t('genParams.title')}
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <Field label={t('genParams.maxTokens')} htmlFor="gen-max-tokens">
          <Input
            id="gen-max-tokens"
            type="number"
            min={1}
            value={params.max_tokens}
            onChange={(event) => onChange({ ...params, max_tokens: Number(event.target.value) })}
          />
        </Field>
        <Field label={t('genParams.temperature', { value: params.temperature })} htmlFor="gen-temperature">
          <Slider
            id="gen-temperature"
            min={0}
            max={2}
            step={0.05}
            showValue
            value={params.temperature}
            onChange={(event) =>
              onChange({ ...params, temperature: Number(event.target.value) })
            }
          />
        </Field>
        <Field label={t('genParams.topP', { value: params.top_p })} htmlFor="gen-top-p">
          <Slider
            id="gen-top-p"
            min={0}
            max={1}
            step={0.05}
            showValue
            value={params.top_p}
            onChange={(event) => onChange({ ...params, top_p: Number(event.target.value) })}
          />
        </Field>
        <Field label={t('genParams.repetitionPenalty')} htmlFor="gen-repetition-penalty">
          <Input
            id="gen-repetition-penalty"
            type="number"
            step={0.05}
            value={params.repetition_penalty ?? ''}
            placeholder={t('genParams.nonePlaceholder')}
            onChange={(event) =>
              onChange({
                ...params,
                repetition_penalty: event.target.value === '' ? null : Number(event.target.value),
              })
            }
          />
        </Field>
      </div>
    </details>
  )
}
