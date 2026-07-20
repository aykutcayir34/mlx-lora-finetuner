import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('models')
  const { data: models, isLoading, isError } = useModels()
  const deleteModel = useDeleteModel()
  const { toast } = useToast()
  const [pendingDelete, setPendingDelete] = useState<ModelInfo | null>(null)

  function handleConfirmDelete() {
    if (!pendingDelete) return
    const target = pendingDelete
    deleteModel.mutate(target.model_id, {
      onSuccess: () => {
        toast(t('local.deleted', { modelId: target.model_id }), { variant: 'success' })
        setPendingDelete(null)
      },
      onError: (error) => {
        const message =
          error instanceof ApiError && error.code === 'training_active'
            ? t('local.deleteBlocked')
            : error instanceof Error
              ? error.message
              : t('local.deleteFailed')
        toast(message, { variant: 'error' })
        setPendingDelete(null)
      },
    })
  }

  if (isLoading) {
    return <Spinner />
  }

  if (isError) {
    return <p className="text-sm text-danger">{t('local.loadFailed')}</p>
  }

  const list = models ?? []

  if (list.length === 0) {
    return (
      <EmptyState
        title={t('local.emptyTitle')}
        description={t('local.emptyDescription')}
        action={
          onGoToSearch ? (
            <button
              type="button"
              onClick={onGoToSearch}
              className="text-sm font-medium text-accent hover:underline"
            >
              {t('common:search.huggingFace')}
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
        title={t('local.deleteTitle')}
        message={t('local.deleteMessage', { modelId: pendingDelete?.model_id })}
        confirmLabel={t('common:actions.delete')}
        danger
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}
