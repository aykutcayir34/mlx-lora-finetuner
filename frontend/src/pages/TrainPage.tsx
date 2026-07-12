import { PageShell } from '../components/layout/PageShell'
import { EmptyState } from '../components/EmptyState'

export function TrainPage() {
  return (
    <PageShell
      title="Train"
      description="Configure and launch LoRA fine-tuning jobs, watch live metrics."
    >
      <EmptyState />
    </PageShell>
  )
}
