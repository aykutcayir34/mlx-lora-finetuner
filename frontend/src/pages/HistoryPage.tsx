import { useState } from 'react'
import { PageShell } from '../components/layout/PageShell'
import { EmptyState } from '../components/common/EmptyState'
import { Spinner } from '../components/common/Spinner'
import { Button } from '../components/common/Button'
import { useModels } from '../api/queries/models'
import { useRunHistory } from '../api/queries/history'
import { HistoryFilterBar, type HistoryFiltersState } from '../components/history/HistoryFilterBar'
import { HistoryTable } from '../components/history/HistoryTable'
import { RunDetailPanel } from '../components/history/RunDetailPanel'

const PAGE_SIZE = 20

const DEFAULT_FILTERS: HistoryFiltersState = {
  modelId: '',
  trainMode: '',
  status: '',
  sort: '-created_at',
}

function HistoryPageContent() {
  const [filters, setFilters] = useState<HistoryFiltersState>(DEFAULT_FILTERS)
  const [offset, setOffset] = useState(0)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const modelsQuery = useModels()
  const historyQuery = useRunHistory({
    modelId: filters.modelId || undefined,
    trainMode: filters.trainMode || undefined,
    status: filters.status || undefined,
    sort: filters.sort,
    limit: PAGE_SIZE,
    offset,
  })

  const runs = historyQuery.data?.runs ?? []
  const total = historyQuery.data?.total ?? 0
  const selectedRun = runs.find((run) => run.run_id === selectedRunId) ?? null

  function handleFiltersChange(next: HistoryFiltersState) {
    setFilters(next)
    setOffset(0)
    setSelectedRunId(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <HistoryFilterBar
        models={modelsQuery.data ?? []}
        filters={filters}
        onChange={handleFiltersChange}
      />

      {historyQuery.isLoading ? (
        <Spinner />
      ) : historyQuery.isError ? (
        <p className="text-sm text-danger">Failed to load run history.</p>
      ) : runs.length === 0 ? (
        <EmptyState
          title="No runs found"
          description="No training runs match the current filters."
        />
      ) : (
        <>
          <HistoryTable runs={runs} selectedRunId={selectedRunId} onSelect={setSelectedRunId} />
          <div className="flex items-center justify-between text-sm text-text-muted">
            <span>
              Showing {offset + 1}–{offset + runs.length} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={offset === 0}
                onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset((current) => current + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {selectedRun && <RunDetailPanel run={selectedRun} otherRuns={runs} />}
    </div>
  )
}

export function HistoryPage() {
  return (
    <PageShell title="History" description="Browse, inspect and clone past training runs.">
      <HistoryPageContent />
    </PageShell>
  )
}
