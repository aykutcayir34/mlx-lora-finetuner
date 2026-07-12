import { PageShell } from '../components/layout/PageShell'
import { EmptyState } from '../components/EmptyState'

export function DatasetsPage() {
  return (
    <PageShell
      title="Datasets"
      description="Upload, validate, split and preview training datasets."
    >
      <EmptyState />
    </PageShell>
  )
}
