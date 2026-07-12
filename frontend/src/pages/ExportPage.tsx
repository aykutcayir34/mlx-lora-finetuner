import { useState } from 'react'
import { PageShell } from '../components/layout/PageShell'
import { Tabs } from '../components/common/Tabs'
import { ToastProvider } from '../components/common/Toast'
import { FuseWizard } from '../components/export/FuseWizard'
import { GGUFWizard } from '../components/export/GGUFWizard'
import { OllamaWizard } from '../components/export/OllamaWizard'
import { ArtifactTable } from '../components/export/ArtifactTable'

const TABS = [
  { id: 'fuse', label: 'Fuse' },
  { id: 'gguf', label: 'GGUF' },
  { id: 'ollama', label: 'Ollama' },
]

export function ExportPage() {
  const [activeTab, setActiveTab] = useState('fuse')

  return (
    <PageShell
      title="Export"
      description="Fuse adapters, convert to GGUF and generate Ollama Modelfiles."
    >
      <ToastProvider>
        <Tabs tabs={TABS} activeId={activeTab} onChange={setActiveTab}>
          {activeTab === 'fuse' && <FuseWizard />}
          {activeTab === 'gguf' && <GGUFWizard />}
          {activeTab === 'ollama' && <OllamaWizard />}
        </Tabs>
        <ArtifactTable />
      </ToastProvider>
    </PageShell>
  )
}
