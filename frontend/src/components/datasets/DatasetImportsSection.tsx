import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useCancelImport, useDatasetImports, useImportDataset, useSplitDataset } from '../../api/queries/datasets'
import { queryKeys } from '../../api/queries/keys'
import { ApiError } from '../../api/client'
import type { DatasetImportInfo, DatasetImportStatus } from '../../api/types'
import { Badge, type BadgeVariant } from '../common/Badge'
import { Button } from '../common/Button'
import { Card } from '../common/Card'
import { EmptyState } from '../common/EmptyState'
import { Spinner } from '../common/Spinner'
import { useToast } from '../common/Toast'
import type { AutoSplitConfig } from './ImportDatasetDialog'

interface DatasetImportsSectionProps {
  /** Import ids awaiting an automatic split once they complete, keyed by import_id. */
  pendingAutoSplit: Record<string, AutoSplitConfig>
  /** Called once the pending auto-split for an import has been triggered. */
  onAutoSplitHandled: (importId: string) => void
}

const STATUS_VARIANT: Record<DatasetImportStatus, BadgeVariant> = {
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

export function DatasetImportsSection({ pendingAutoSplit, onAutoSplitHandled }: DatasetImportsSectionProps) {
  const { t } = useTranslation('datasets')
  const { data, isLoading, isError } = useDatasetImports()
  const cancelImport = useCancelImport()
  const retryImport = useImportDataset()
  const splitDataset = useSplitDataset()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const imports = data?.imports ?? []

  useEffect(() => {
    for (const item of imports) {
      const autoSplit = pendingAutoSplit[item.import_id]
      if (!autoSplit) continue
      if (item.status !== 'completed' || !item.dataset_id) continue

      const datasetId = item.dataset_id
      onAutoSplitHandled(item.import_id)
      splitDataset.mutate(
        { datasetId, body: autoSplit },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.datasets.list })
            toast(t('imports.autoSplitDone', { datasetId: item.hf_dataset_id }), {
              variant: 'success',
            })
          },
          onError: (error) => {
            toast(error instanceof ApiError ? error.message : t('imports.autoSplitFailed'), {
              variant: 'error',
            })
          },
        },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imports, pendingAutoSplit])

  function handleCancel(importId: string) {
    cancelImport.mutate(importId, {
      onError: (error) => {
        toast(error instanceof ApiError ? error.message : t('imports.cancelFailed'), {
          variant: 'error',
        })
      },
    })
  }

  function handleRetry(item: DatasetImportInfo) {
    retryImport.mutate(
      {
        dataset_id: item.hf_dataset_id,
        config: item.config,
        split: item.split,
        name: null,
        max_rows: null,
      },
      {
        onSuccess: () => {
          toast(t('imports.retrying', { datasetId: item.hf_dataset_id }), { variant: 'success' })
        },
        onError: (error) => {
          toast(error instanceof ApiError ? error.message : t('imports.retryFailed'), {
            variant: 'error',
          })
        },
      },
    )
  }

  if (isLoading) {
    return <Spinner />
  }

  if (isError) {
    return <p className="text-sm text-danger">{t('imports.loadFailed')}</p>
  }

  if (imports.length === 0) {
    return <EmptyState title={t('imports.emptyTitle')} description={t('imports.emptyDescription')} />
  }

  return (
    <div className="flex flex-col gap-3">
      {imports.map((item) => (
        <Card key={item.import_id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="break-all text-sm font-medium text-text">{item.hf_dataset_id}</p>
            <Badge variant={STATUS_VARIANT[item.status]}>
              {t(`common:rawStatus.${item.status}`)}
            </Badge>
          </div>

          <p className="mt-2 text-xs text-text-muted">
            {t('imports.rowsWritten', { rows: item.rows_written.toLocaleString() })}
          </p>

          {item.status === 'running' && (
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleCancel(item.import_id)}
                loading={cancelImport.isPending}
              >
                {t('common:actions.cancel')}
              </Button>
            </div>
          )}

          {(item.status === 'failed' || item.status === 'cancelled') && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-danger">{item.error ?? t('imports.incomplete')}</p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleRetry(item)}
                loading={retryImport.isPending}
              >
                {t('common:actions.retry')}
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}
