import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useDatasets } from '../../api/queries/datasets'
import { useModels } from '../../api/queries/models'
import { Card } from '../common/Card'

export function QuickCounts() {
  const { t } = useTranslation('dashboard')
  const { data: models } = useModels()
  const { data: datasetsData } = useDatasets()
  const datasets = datasetsData?.datasets ?? []

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Link to="/models">
        <Card className="transition-colors hover:border-accent/50">
          <p className="text-xs text-text-muted">{t('quickCounts.localModels')}</p>
          <p className="mt-1 text-2xl font-semibold text-text">{models?.length ?? 0}</p>
        </Card>
      </Link>
      <Link to="/datasets">
        <Card className="transition-colors hover:border-accent/50">
          <p className="text-xs text-text-muted">{t('quickCounts.datasets')}</p>
          <p className="mt-1 text-2xl font-semibold text-text">{datasets.length}</p>
        </Card>
      </Link>
    </div>
  )
}
