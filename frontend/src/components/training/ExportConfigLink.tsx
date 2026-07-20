import { useTranslation } from 'react-i18next'
import { runConfigYamlUrl } from '../../api/queries/training'

// Styled to match <Button variant="secondary" size="sm"> — a native anchor so
// the browser handles the attachment download without any JS fetch/blob work.
export function ExportConfigLink({ runId }: { runId: string }) {
  const { t } = useTranslation('train')
  return (
    <a
      href={runConfigYamlUrl(runId)}
      download
      className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised px-3 text-sm font-medium text-text transition-colors hover:bg-surface"
    >
      {t('exportYaml')}
    </a>
  )
}
