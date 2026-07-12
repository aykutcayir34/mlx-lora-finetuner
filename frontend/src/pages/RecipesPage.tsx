// Faz-2 T16 replaces this placeholder with document→dataset conversion.
import { PageShell } from '../components/layout/PageShell'
import { EmptyState } from '../components/common/EmptyState'

export function RecipesPage() {
  return (
    <PageShell title="Recipes" description="Convert documents into training datasets.">
      <EmptyState title="Coming soon" description="Data Recipes is being built in Faz 2." />
    </PageShell>
  )
}
