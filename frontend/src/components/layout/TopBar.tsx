import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { apiClient } from '../../api/client'
import type { HealthInfo } from '../../api/types'
import { SUPPORTED_LANGUAGES, setLanguage, type SupportedLanguage } from '../../i18n'

const HEALTH_POLL_MS = 5000

function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common')
  const current = (i18n.resolvedLanguage ?? 'en') as SupportedLanguage

  return (
    <div
      role="radiogroup"
      aria-label={t('language.label')}
      className="flex items-center rounded-md border border-border text-xs"
    >
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          role="radio"
          aria-checked={current === lang}
          onClick={() => setLanguage(lang)}
          className={`px-2 py-1 font-medium transition-colors first:rounded-l-md last:rounded-r-md ${
            current === lang
              ? 'bg-accent/20 text-accent'
              : 'text-text-muted hover:text-text'
          }`}
        >
          {t(`language.${lang}`)}
        </button>
      ))}
    </div>
  )
}

export function TopBar() {
  const { t } = useTranslation('layout')
  const { data, isError } = useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => apiClient.get<HealthInfo>('/system/health'),
    refetchInterval: HEALTH_POLL_MS,
    retry: false,
  })

  const isHealthy = !isError && data?.status === 'ok'
  const dotClass = isHealthy ? 'bg-success' : 'bg-danger'
  const label = isHealthy ? t('health.healthy') : t('health.unreachable')

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
      <span className="font-semibold tracking-tight text-text">MLX LoRA Finetuner</span>
      <div className="flex items-center gap-3">
        <LanguageSwitcher />
        <div className="flex items-center gap-2 text-sm text-text-muted" title={label}>
          <span
            data-testid="health-dot"
            aria-label={label}
            className={`h-2.5 w-2.5 rounded-full ${dotClass}`}
          />
          <span>{label}</span>
        </div>
      </div>
    </header>
  )
}
