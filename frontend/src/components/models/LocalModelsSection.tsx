import { useState } from 'react'
import { useDeleteModel, useModels } from '../../api/queries/models'
import { ApiError } from '../../api/client'
import type { ModelInfo } from '../../api/types'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { EmptyState } from '../common/EmptyState'
import { Spinner } from '../common/Spinner'
import { useToast } from '../common/Toast'
import { ModelCard } from './ModelCard'

interface LocalModelsSectionProps {
  onGoToSearch?: () => void
}

export function LocalModelsSection({ onGoToSearch }: LocalModelsSectionProps) {
  const { data: models, isLoading, isError } = useModels()
  const deleteModel = useDeleteModel()
  const { toast } = useToast()
  const [pendingDelete, setPendingDelete] = useState<ModelInfo | null>(null)

  function handleConfirmDelete() {
    if (!pendingDelete) return
    const target = pendingDelete
    deleteModel.mutate(target.model_id, {
      onSuccess: () => {
        toast(`Deleted "${target.model_id}".`, { variant: 'success' })
        setPendingDelete(null)
      },
      onError: (error) => {
        const message =
          error instanceof ApiError && error.code === 'training_active'
            ? 'Cannot delete: model is used by an active training job.'
            : error instanceof Error
              ? error.message
              : 'Failed to delete model.'
        toast(message, { variant: 'error' })
        setPendingDelete(null)
      },
    })
  }

  if (isLoading) {
    return <Spinner />
  }

  if (isError) {
    return <p className="text-sm text-danger">Failed to load local models.</p>
  }

  const list = models ?? []

  if (list.length === 0) {
    return (
      <EmptyState
        title="No local models"
        description="Download a model from Hugging Face to get started."
        action={
          onGoToSearch ? (
            <button
              type="button"
              onClick={onGoToSearch}
              className="text-sm font-medium text-accent hover:underline"
            >
              Search Hugging Face
            </button>
          ) : undefined
        }
      />
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((model) => (
          <ModelCard
            key={model.model_id}
            model={model}
            onDelete={setPendingDelete}
            isDeleting={deleteModel.isPending && pendingDelete?.model_id === model.model_id}
          />
        ))}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete model"
        message={`Delete "${pendingDelete?.model_id}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}
