import { PageShell } from '../components/layout/PageShell'
import { EmptyState } from '../components/EmptyState'

export function ModelsPage() {
  return (
    <PageShell title="Models" description="Search, download and manage local MLX models.">
      <EmptyState />
    </PageShell>
  )
}
