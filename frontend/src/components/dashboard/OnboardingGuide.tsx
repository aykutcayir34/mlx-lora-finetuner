import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card } from '../common/Card'

const STEPS = [
  { step: 1, key: 'models', to: '/models' },
  { step: 2, key: 'datasets', to: '/datasets' },
  { step: 3, key: 'train', to: '/train' },
] as const

export function OnboardingGuide() {
  const { t } = useTranslation('dashboard')
  return (
    <Card title={t('onboarding.title')}>
      <p className="mb-4 text-sm text-text-muted">{t('onboarding.intro')}</p>
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((item) => (
          <li key={item.step} className="rounded-lg border border-border bg-surface-raised p-4">
            <span className="text-xs font-medium text-text-muted">
              {t('onboarding.step', { step: item.step })}
            </span>
            <h4 className="mt-1 text-sm font-semibold text-text">
              {t(`onboarding.${item.key}.title`)}
            </h4>
            <p className="mt-1 text-xs text-text-muted">{t(`onboarding.${item.key}.description`)}</p>
            <Link to={item.to} className="mt-3 inline-block text-sm text-accent hover:underline">
              {t(`onboarding.${item.key}.cta`)}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  )
}
