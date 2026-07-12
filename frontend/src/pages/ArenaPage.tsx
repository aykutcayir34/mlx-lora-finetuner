// Faz-2 T17 replaces this placeholder with the side-by-side model arena.
import { PageShell } from '../components/layout/PageShell'
import { EmptyState } from '../components/common/EmptyState'

export function ArenaPage() {
  return (
    <PageShell title="Arena" description="Compare two models or adapters side by side.">
      <EmptyState title="Coming soon" description="Model Arena is being built in Faz 2." />
    </PageShell>
  )
}
