import { PageShell } from '../components/layout/PageShell'
import { EmptyState } from '../components/EmptyState'

export function ChatPage() {
  return (
    <PageShell title="Chat" description="Chat with a base model or a trained adapter.">
      <EmptyState />
    </PageShell>
  )
}
