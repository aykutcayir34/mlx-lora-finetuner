import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageShell } from '../components/layout/PageShell'
import { Tabs } from '../components/common/Tabs'
import { ToastProvider } from '../components/common/Toast'
import { DownloadsSection } from '../components/models/DownloadsSection'
import { LocalModelsSection } from '../components/models/LocalModelsSection'
import { ModelSearchPanel } from '../components/models/ModelSearchPanel'

function ModelsPageContent() {
  const { t } = useTranslation('models')
  const [activeTab, setActiveTab] = useState('local')

  const tabs = [
    { id: 'local', label: t('tabs.local') },
    { id: 'search', label: t('common:search.huggingFace') },
    { id: 'downloads', label: t('tabs.downloads') },
  ]

  return (
    <PageShell title={t('title')} description={t('description')}>
      <Tabs tabs={tabs} activeId={activeTab} onChange={setActiveTab}>
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
