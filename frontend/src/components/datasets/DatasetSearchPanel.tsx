import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDatasetSearch } from '../../api/queries/datasets'
import type { HFDatasetSearchResult } from '../../api/types'
import { Badge } from '../common/Badge'
import { Button } from '../common/Button'
import { EmptyState } from '../common/EmptyState'
import { Field } from '../common/Field'
import { Input } from '../common/Input'
import { Spinner } from '../common/Spinner'
import { useDebouncedValue } from '../models/useDebouncedValue'
import { ImportDatasetDialog, type AutoSplitConfig } from './ImportDatasetDialog'

const DEBOUNCE_MS = 400

interface DatasetSearchPanelProps {
  onImportQueued: (importId: string, autoSplit: AutoSplitConfig | null) => void
}

export function DatasetSearchPanel({ onImportQueued }: DatasetSearchPanelProps) {
  const { t } = useTranslation('datasets')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS)
  const search = useDatasetSearch(debouncedQuery)
  const [selected, setSelected] = useState<HFDatasetSearchResult | null>(null)

  const results = search.data?.results ?? []

  return (
    <div className="flex flex-col gap-4">
      <Field label={t('common:search.queryLabel')}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search.queryPlaceholder')}
        />
      </Field>

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
              key={result.dataset_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
            >
              <div className="min-w-0">
                <p className="break-all text-sm font-medium text-text">{result.dataset_id}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {t('common:hfStats', {
                    downloads: result.downloads.toLocaleString(),
                    likes: result.likes.toLocaleString(),
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {result.imported && <Badge variant="success">{t('search.imported')}</Badge>}
                <Button size="sm" variant="secondary" onClick={() => setSelected(result)}>
                  {t('search.import')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ImportDatasetDialog
        key={selected?.dataset_id ?? 'none'}
        open={selected !== null}
        hfDatasetId={selected?.dataset_id ?? ''}
        onClose={() => setSelected(null)}
        onImportQueued={onImportQueued}
      />
    </div>
  )
}
