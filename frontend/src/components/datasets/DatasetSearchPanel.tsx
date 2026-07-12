import { useState } from 'react'
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
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS)
  const search = useDatasetSearch(debouncedQuery)
  const [selected, setSelected] = useState<HFDatasetSearchResult | null>(null)

  const results = search.data?.results ?? []

  return (
    <div className="flex flex-col gap-4">
      <Field label="Search query">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. wikisql"
        />
      </Field>

      {debouncedQuery.length === 0 ? (
        <EmptyState title="Search Hugging Face" description="Type a query above to find datasets." />
      ) : search.isLoading ? (
        <Spinner />
      ) : search.isError ? (
        <p className="text-sm text-danger">Search failed.</p>
      ) : results.length === 0 ? (
        <EmptyState title="No results" description="No datasets matched your search." />
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
                  {result.downloads.toLocaleString()} downloads · {result.likes.toLocaleString()} likes
                </p>
              </div>
              <div className="flex items-center gap-2">
                {result.imported && <Badge variant="success">Imported</Badge>}
                <Button size="sm" variant="secondary" onClick={() => setSelected(result)}>
                  Import
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
