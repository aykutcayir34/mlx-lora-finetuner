import { useState } from 'react'
import { PageShell } from '../components/layout/PageShell'
import { Tabs } from '../components/common/Tabs'
import { ToastProvider } from '../components/common/Toast'
import { DownloadsSection } from '../components/models/DownloadsSection'
import { LocalModelsSection } from '../components/models/LocalModelsSection'
import { ModelSearchPanel } from '../components/models/ModelSearchPanel'

const TABS = [
  { id: 'local', label: 'Local Models' },
  { id: 'search', label: 'Search Hugging Face' },
  { id: 'downloads', label: 'Downloads' },
]

function ModelsPageContent() {
  const [activeTab, setActiveTab] = useState('local')

  return (
    <PageShell title="Models" description="Search, download and manage local MLX models.">
      <Tabs tabs={TABS} activeId={activeTab} onChange={setActiveTab}>
        {activeTab === 'local' && <LocalModelsSection onGoToSearch={() => setActiveTab('search')} />}
        {activeTab === 'search' && <ModelSearchPanel />}
        {activeTab === 'downloads' && <DownloadsSection />}
      </Tabs>
    </PageShell>
  )
}

export function ModelsPage() {
  return (
    <ToastProvider>
      <ModelsPageContent />
    </ToastProvider>
  )
}
