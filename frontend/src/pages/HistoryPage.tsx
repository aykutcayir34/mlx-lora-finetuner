// Faz-2 T18 replaces this placeholder with the filterable run history.
import { PageShell } from '../components/layout/PageShell'
import { EmptyState } from '../components/common/EmptyState'

export function HistoryPage() {
  return (
    <PageShell title="History" description="Browse, inspect and clone past training runs.">
      <EmptyState title="Coming soon" description="Run history is being built in Faz 2." />
    </PageShell>
  )
}
