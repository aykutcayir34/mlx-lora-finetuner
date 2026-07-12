import { useState } from 'react'
import { PageShell } from '../components/layout/PageShell'
import { ConfirmDialog } from '../components/common/ConfirmDialog'
import { EmptyState } from '../components/common/EmptyState'
import { Spinner } from '../components/common/Spinner'
import { ToastProvider, useToast } from '../components/common/Toast'
import { DatasetDetail } from '../components/datasets/DatasetDetail'
import { DatasetsTable } from '../components/datasets/DatasetsTable'
import { UploadDropzone } from '../components/datasets/UploadDropzone'
import { useDatasets, useDeleteDataset } from '../api/queries/datasets'
import { ApiError } from '../api/client'
import type { DatasetInfo } from '../api/types'

function DatasetsPageContent() {
  const { data, isLoading, isError } = useDatasets()
  const deleteDataset = useDeleteDataset()
  const { toast } = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DatasetInfo | null>(null)

  const datasets = data?.datasets ?? []
  const selectedDataset = datasets.find((dataset) => dataset.dataset_id === selectedId) ?? null

  function handleConfirmDelete() {
    if (!pendingDelete) return
    const target = pendingDelete
    deleteDataset.mutate(target.dataset_id, {
      onSuccess: () => {
        toast(`Deleted "${target.name}".`, { variant: 'success' })
        if (selectedId === target.dataset_id) setSelectedId(null)
        setPendingDelete(null)
      },
      onError: (error) => {
        const message =
          error instanceof ApiError && error.code === 'training_active'
            ? 'Cannot delete: dataset is used by an active training job.'
            : error instanceof ApiError
              ? error.message
              : 'Failed to delete dataset.'
        toast(message, { variant: 'error' })
        setPendingDelete(null)
      },
    })
  }

  return (
    <PageShell title="Datasets" description="Upload, validate, split and preview training datasets.">
      <UploadDropzone />

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <p className="text-sm text-danger">Failed to load datasets.</p>
      ) : datasets.length === 0 ? (
        <EmptyState title="No datasets yet" description="Upload a .jsonl file above to get started." />
      ) : (
        <DatasetsTable
          datasets={datasets}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
          onDelete={(dataset) => setPendingDelete(dataset)}
        />
      )}

      {selectedDataset && <DatasetDetail dataset={selectedDataset} />}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete dataset"
        message={`Delete "${pendingDelete?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
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
