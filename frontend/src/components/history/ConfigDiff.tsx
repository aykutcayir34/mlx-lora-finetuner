import { useTranslation } from 'react-i18next'
import type { TrainingConfig } from '../../api/types'
import { formatConfigValue } from './format'

interface ConfigDiffProps {
  base: TrainingConfig
  other: TrainingConfig
  baseLabel: string
  otherLabel: string
}

function flatten(config: TrainingConfig): [string, unknown][] {
  const { lora, ...rest } = config
  const entries = Object.entries(rest) as [string, unknown][]
  entries.push(['lora.rank', lora.rank], ['lora.scale', lora.scale], ['lora.dropout', lora.dropout])
  return entries.sort((a, b) => a[0].localeCompare(b[0]))
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Plain two-column diff: every field from `base`, highlighting rows that changed in `other`. */
export function ConfigDiff({ base, other, baseLabel, otherLabel }: ConfigDiffProps) {
  const { t } = useTranslation('history')
  const baseEntries = flatten(base)
  const otherMap = new Map(flatten(other))

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-text-muted">
            <th className="px-3 py-2 font-medium">{t('diff.field')}</th>
            <th className="px-3 py-2 font-medium">{baseLabel}</th>
            <th className="px-3 py-2 font-medium">{otherLabel}</th>
          </tr>
        </thead>
        <tbody>
          {baseEntries.map(([key, baseValue]) => {
            const otherValue = otherMap.get(key)
            const changed = !valuesEqual(baseValue, otherValue)
            return (
              <tr key={key} className="border-b border-border/60">
                <td className="px-3 py-2 text-text-muted">{key}</td>
                <td
                  data-changed={changed}
                  className={`px-3 py-2 ${changed ? 'bg-amber-400/15 font-medium text-text' : 'text-text'}`}
                >
                  {formatConfigValue(baseValue)}
                </td>
                <td
                  data-changed={changed}
                  className={`px-3 py-2 ${changed ? 'bg-amber-400/15 font-medium text-text' : 'text-text'}`}
                >
                  {formatConfigValue(otherValue)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
