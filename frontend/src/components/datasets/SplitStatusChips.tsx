import { useTranslation } from 'react-i18next'
import { Badge } from '../common/Badge'
import type { DatasetSplits } from '../../api/types'

interface SplitStatusChipsProps {
  splits: DatasetSplits | null
}

export function SplitStatusChips({ splits }: SplitStatusChipsProps) {
  const { t } = useTranslation('datasets')
  if (!splits) {
    return <Badge variant="neutral">{t('chips.notSplit')}</Badge>
  }

  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant="info">{t('chips.train', { n: splits.train })}</Badge>
      <Badge variant="success">{t('chips.valid', { n: splits.valid })}</Badge>
      <Badge variant="warning">{t('chips.test', { n: splits.test })}</Badge>
    </div>
  )
}
