import { PageShell } from '../components/layout/PageShell'
import { EmptyState } from '../components/EmptyState'

export function ExportPage() {
  return (
    <PageShell
      title="Export"
      description="Fuse adapters, convert to GGUF and generate Ollama Modelfiles."
    >
      <EmptyState />
    </PageShell>
  )
}
