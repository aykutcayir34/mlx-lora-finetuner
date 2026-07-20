import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageShell } from '../components/layout/PageShell'
import { Tabs } from '../components/common/Tabs'
import { ToastProvider } from '../components/common/Toast'
import { FuseWizard } from '../components/export/FuseWizard'
import { GGUFWizard } from '../components/export/GGUFWizard'
import { OllamaWizard } from '../components/export/OllamaWizard'
import { ArtifactTable } from '../components/export/ArtifactTable'

export function ExportPage() {
  const { t } = useTranslation('export')
  const [activeTab, setActiveTab] = useState('fuse')

  const tabs = [
    { id: 'fuse', label: t('tabs.fuse') },
    { id: 'gguf', label: t('tabs.gguf') },
    { id: 'ollama', label: t('tabs.ollama') },
  ]

  return (
    <PageShell title={t('page.title')} description={t('page.description')}>
      <ToastProvider>
        <Tabs tabs={tabs} activeId={activeTab} onChange={setActiveTab}>
          {activeTab === 'fuse' && <FuseWizard />}
          {activeTab === 'gguf' && <GGUFWizard />}
          {activeTab === 'ollama' && <OllamaWizard />}
        </Tabs>
        <ArtifactTable />
      </ToastProvider>
    </PageShell>
  )
}
