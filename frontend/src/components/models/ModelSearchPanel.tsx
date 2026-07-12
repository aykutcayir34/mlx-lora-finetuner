import { useState } from 'react'
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
          toast(`Started download of "${result.model_id}".`, { variant: 'success' })
          setPendingModelId(null)
        },
        onError: (error) => {
          const message =
            error instanceof ApiError && error.code === 'conflict'
              ? 'This model is already downloading or already downloaded.'
              : error instanceof Error
                ? error.message
                : 'Failed to start download.'
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
        <Field label="Search query" className="flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Llama-3.2-1B"
          />
        </Field>
        <Field label="Author" className="sm:w-56">
          <Input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="mlx-community"
          />
        </Field>
      </div>

      {debouncedQuery.length === 0 ? (
        <EmptyState title="Search Hugging Face" description="Type a query above to find MLX models." />
      ) : search.isLoading ? (
        <Spinner />
      ) : search.isError ? (
        <p className="text-sm text-danger">Search failed.</p>
      ) : results.length === 0 ? (
        <EmptyState title="No results" description="No models matched your search." />
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
                  {result.downloads.toLocaleString()} downloads · {result.likes.toLocaleString()} likes
                  {result.size_bytes != null && ` · ${(result.size_bytes / 1024 ** 3).toFixed(1)} GB`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {result.downloaded && <Badge variant="success">Downloaded</Badge>}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleDownload(result)}
                  disabled={result.downloaded}
                  loading={downloadModel.isPending && pendingModelId === result.model_id}
                >
                  Download
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
