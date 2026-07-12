import { PageShell } from '../components/layout/PageShell'
import { EmptyState } from '../components/EmptyState'

export function DashboardPage() {
  return (
    <PageShell
      title="Dashboard"
      description="System stats, active jobs and recent runs at a glance."
    >
      <EmptyState />
    </PageShell>
  )
}
