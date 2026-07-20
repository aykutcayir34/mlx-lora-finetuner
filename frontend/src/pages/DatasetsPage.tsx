import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageShell } from '../components/layout/PageShell'
import { ConfirmDialog } from '../components/common/ConfirmDialog'
import { EmptyState } from '../components/common/EmptyState'
import { Spinner } from '../components/common/Spinner'
import { Tabs } from '../components/common/Tabs'
import { ToastProvider, useToast } from '../components/common/Toast'
import { DatasetDetail } from '../components/datasets/DatasetDetail'
import { DatasetImportsSection } from '../components/datasets/DatasetImportsSection'
import { DatasetSearchPanel } from '../components/datasets/DatasetSearchPanel'
import { DatasetsTable } from '../components/datasets/DatasetsTable'
import type { AutoSplitConfig } from '../components/datasets/ImportDatasetDialog'
import { UploadDropzone } from '../components/datasets/UploadDropzone'
import { useDatasets, useDeleteDataset } from '../api/queries/datasets'
import { ApiError } from '../api/client'
import type { DatasetInfo } from '../api/types'

type DatasetsPageTab = 'local' | 'search' | 'imports'

function DatasetsPageContent() {
  const { t } = useTranslation('datasets')
  const { data, isLoading, isError } = useDatasets()
  const deleteDataset = useDeleteDataset()
  const { toast } = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DatasetInfo | null>(null)
  const [activeTab, setActiveTab] = useState<DatasetsPageTab>('local')
  const [pendingAutoSplit, setPendingAutoSplit] = useState<Record<string, AutoSplitConfig>>({})

  const datasets = data?.datasets ?? []
  const selectedDataset = datasets.find((dataset) => dataset.dataset_id === selectedId) ?? null

  function handleImportQueued(importId: string, autoSplit: AutoSplitConfig | null) {
    if (!autoSplit) return
    setPendingAutoSplit((current) => ({ ...current, [importId]: autoSplit }))
  }

  function handleAutoSplitHandled(importId: string) {
    setPendingAutoSplit((current) => {
      const next = { ...current }
      delete next[importId]
      return next
    })
  }

  function handleConfirmDelete() {
    if (!pendingDelete) return
    const target = pendingDelete
    deleteDataset.mutate(target.dataset_id, {
      onSuccess: () => {
        toast(t('delete.deleted', { name: target.name }), { variant: 'success' })
        if (selectedId === target.dataset_id) setSelectedId(null)
        setPendingDelete(null)
      },
      onError: (error) => {
        const message =
          error instanceof ApiError && error.code === 'training_active'
            ? t('delete.blocked')
            : error instanceof ApiError
              ? error.message
              : t('delete.failed')
        toast(message, { variant: 'error' })
        setPendingDelete(null)
      },
    })
  }

  return (
    <PageShell title={t('title')} description={t('description')}>
      <Tabs
        tabs={[
          { id: 'local', label: t('tabs.local') },
          { id: 'search', label: t('common:search.huggingFace') },
          { id: 'imports', label: t('tabs.imports') },
        ]}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as DatasetsPageTab)}
      >
        {activeTab === 'local' ? (
          <div className="flex flex-col gap-6">
            <UploadDropzone />

            {isLoading ? (
              <Spinner />
            ) : isError ? (
              <p className="text-sm text-danger">{t('list.loadFailed')}</p>
            ) : datasets.length === 0 ? (
              <EmptyState title={t('list.emptyTitle')} description={t('list.emptyDescription')} />
            ) : (
              <DatasetsTable
                datasets={datasets}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
                onDelete={(dataset) => setPendingDelete(dataset)}
              />
            )}

            {selectedDataset && <DatasetDetail dataset={selectedDataset} />}
          </div>
        ) : activeTab === 'search' ? (
          <DatasetSearchPanel onImportQueued={handleImportQueued} />
        ) : (
          <DatasetImportsSection
            pendingAutoSplit={pendingAutoSplit}
            onAutoSplitHandled={handleAutoSplitHandled}
          />
        )}
      </Tabs>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('delete.title')}
        message={t('delete.message', { name: pendingDelete?.name })}
        confirmLabel={t('common:actions.delete')}
        danger
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </PageShell>
  )
}

export function DatasetsPage() {
  return (
    <ToastProvider>
      <DatasetsPageContent />
    </ToastProvider>
  )
}
