import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDownloadModel, useModelSearch } from '../../api/queries/models'
import { ApiError } from '../../api/client'
import type { HFSearchResult } from '../../api/types'
import { Badge } from '../common/Badge'
import { Button } from '../common/Button'
import { EmptyState } from '../common/EmptyState'
import { Field } from '../common/Field'
import { Input } from '../common/Input'
import { Spinner } from '../common/Spinner'
import { useToast } from '../common/Toast'
import { useDebouncedValue } from './useDebouncedValue'

const DEBOUNCE_MS = 400

export function ModelSearchPanel() {
  const { t } = useTranslation('models')
  const [query, setQuery] = useState('')
  const [author, setAuthor] = useState('mlx-community')
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS)
  const debouncedAuthor = useDebouncedValue(author, DEBOUNCE_MS)

  const search = useModelSearch(debouncedQuery, debouncedAuthor || undefined)
  const downloadModel = useDownloadModel()
  const { toast } = useToast()
  const [pendingModelId, setPendingModelId] = useState<string | null>(null)

  function handleDownload(result: HFSearchResult) {
    setPendingModelId(result.model_id)
    downloadModel.mutate(
      { model_id: result.model_id },
      {
        onSuccess: () => {
          toast(t('search.started', { modelId: result.model_id }), { variant: 'success' })
          setPendingModelId(null)
        },
        onError: (error) => {
          const message =
            error instanceof ApiError && error.code === 'conflict'
              ? t('search.alreadyDownloading')
              : error instanceof Error
                ? error.message
                : t('search.startFailed')
          toast(message, { variant: 'error' })
          setPendingModelId(null)
        },
      },
    )
  }

  const results = search.data?.results ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Field label={t('common:search.queryLabel')} className="flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.queryPlaceholder')}
          />
        </Field>
        <Field label={t('search.authorLabel')} className="sm:w-56">
          <Input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder={t('search.authorPlaceholder')}
          />
        </Field>
      </div>

      {debouncedQuery.length === 0 ? (
        <EmptyState title={t('common:search.huggingFace')} description={t('search.emptyDescription')} />
      ) : search.isLoading ? (
        <Spinner />
      ) : search.isError ? (
        <p className="text-sm text-danger">{t('common:errors.searchFailed')}</p>
      ) : results.length === 0 ? (
        <EmptyState title={t('common:search.noResults')} description={t('search.noResultsDescription')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {results.map((result) => (
            <li
              key={result.model_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
            >
              <div className="min-w-0">
                <p className="break-all text-sm font-medium text-text">{result.model_id}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t('common:hfStats', {
                    downloads: result.downloads.toLocaleString(),
                    likes: result.likes.toLocaleString(),
                  })}
                  {result.size_bytes != null && ` · ${(result.size_bytes / 1024 ** 3).toFixed(1)} GB`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {result.downloaded && <Badge variant="success">{t('search.downloaded')}</Badge>}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleDownload(result)}
                  disabled={result.downloaded}
                  loading={downloadModel.isPending && pendingModelId === result.model_id}
                >
                  {t('common:actions.download')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
