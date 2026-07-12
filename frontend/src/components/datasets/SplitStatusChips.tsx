import { Badge } from '../common/Badge'
import type { DatasetSplits } from '../../api/types'

interface SplitStatusChipsProps {
  splits: DatasetSplits | null
}

export function SplitStatusChips({ splits }: SplitStatusChipsProps) {
  if (!splits) {
    return <Badge variant="neutral">Not split</Badge>
  }

  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant="info">train {splits.train}</Badge>
      <Badge variant="success">valid {splits.valid}</Badge>
      <Badge variant="warning">test {splits.test}</Badge>
    </div>
  )
}
