import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useRunMetrics } from '../../api/queries/training'
import { useCloneRun } from '../../api/queries/history'
import { Button } from '../common/Button'
import { StatusBadge } from '../common/Badge'
import { Tabs } from '../common/Tabs'
import { Select } from '../common/Select'
import { Field } from '../common/Field'
import { LossChart } from '../charts/LossChart'
import { LRChart } from '../charts/LRChart'
import { MemoryChart } from '../charts/MemoryChart'
import type { CompareSeries } from '../charts/compare'
import { ExportConfigLink } from '../training/ExportConfigLink'
import { ConfigViewer } from './ConfigViewer'
import { ConfigDiff } from './ConfigDiff'
import type { RunSummary } from '../../api/types'

interface RunDetailPanelProps {
  run: RunSummary
  /** Candidate runs for the comparison picker (typically the currently loaded page of results). */
  otherRuns: RunSummary[]
}

type DetailTab = 'charts' | 'config' | 'diff'

export function RunDetailPanel({ run, otherRuns }: RunDetailPanelProps) {
  const { t } = useTranslation('history')
  const navigate = useNavigate()
  const [tab, setTab] = useState<DetailTab>('charts')
  const [compareRunId, setCompareRunId] = useState('')
  const metricsQuery = useRunMetrics(run.run_id, 0, undefined)
  const cloneRun = useCloneRun()

  const metrics = metricsQuery.data?.metrics ?? []
  const compareRun = otherRuns.find((candidate) => candidate.run_id === compareRunId) ?? null
  // Disabled (never fetched) while no comparison run is picked — `useRunMetrics`
  // keys off a falsy run id.
  const compareMetricsQuery = useRunMetrics(compareRun?.run_id ?? '', 0, undefined)
  const compareMetrics = compareMetricsQuery.data?.metrics ?? []

  // A comparison run that is still loading, failed to fetch, or simply has no
  // metrics (e.g. a run that failed before its first step) degrades to a note:
  // the base run's charts keep rendering untouched.
  const compare: CompareSeries | undefined =
    compareRun && compareMetrics.length > 0
      ? { data: compareMetrics, label: compareRun.name, baseLabel: run.name }
      : undefined

  let compareNote: string | null = null
  if (compareRun && !compare) {
    if (compareMetricsQuery.isError) {
      compareNote = t('detail.compareFailed', { name: compareRun.name })
    } else if (compareMetricsQuery.isLoading) {
      compareNote = t('detail.compareLoading', { name: compareRun.name })
    } else {
      compareNote = t('detail.compareEmpty', { name: compareRun.name })
    }
  }

  function handleClone() {
    cloneRun.mutate(run.run_id, {
      onSuccess: (config) => {
        // Router state survives the remounts a v7 navigation can trigger,
        // unlike a consume-once sessionStorage read.
        navigate('/train', { state: { cloneConfig: config } })
      },
    })
  }

  return (
    <div
      data-testid="run-detail-panel"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text">{run.name}</h3>
            <StatusBadge status={run.status} />
          </div>
          <p className="text-xs text-text-muted">{run.run_id}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <ExportConfigLink runId={run.run_id} />
            <Button size="sm" onClick={handleClone} loading={cloneRun.isPending}>
              {t('detail.clone')}
            </Button>
          </div>
          {cloneRun.isError && <p className="text-xs text-danger">{t('detail.cloneFailed')}</p>}
        </div>
      </div>

      {/* One comparison run governs both tabs: the charts overlay it and the
          diff tab diffs its config against the base run. */}
      <Field
        label={t('detail.compareAgainst')}
        htmlFor="history-compare-run"
        hint={t('detail.compareHint')}
      >
        <Select
          id="history-compare-run"
          value={compareRunId}
          onChange={(event) => setCompareRunId(event.target.value)}
          options={[
            { value: '', label: t('detail.selectRun') },
            ...otherRuns
              .filter((candidate) => candidate.run_id !== run.run_id)
              .map((candidate) => ({
                value: candidate.run_id,
                label: `${candidate.name} (${candidate.run_id})`,
              })),
          ]}
        />
      </Field>

      <Tabs
        tabs={[
          { id: 'charts', label: t('detail.tabs.charts') },
          { id: 'config', label: t('detail.tabs.config') },
          { id: 'diff', label: t('detail.tabs.diff') },
        ]}
        activeId={tab}
        onChange={(id) => setTab(id as DetailTab)}
      >
        {tab === 'charts' && (
          <div className="flex flex-col gap-4">
            {compare && (
              <p data-testid="compare-summary" className="text-xs text-text-muted">
                {t('detail.compareActive', { base: run.name, other: compareRun?.name ?? '' })}
              </p>
            )}
            {compareNote && (
              <p data-testid="compare-note" className="text-xs text-text-muted">
                {compareNote}
              </p>
            )}
            <LossChart data={metrics} compare={compare} />
            <LRChart data={metrics} compare={compare} />
            <MemoryChart data={metrics} compare={compare} />
          </div>
        )}
        {tab === 'config' && <ConfigViewer config={run.config} />}
        {tab === 'diff' && (
          <div className="flex flex-col gap-4">
            {compareRun ? (
              <ConfigDiff
                base={run.config}
                other={compareRun.config}
                baseLabel={run.name}
                otherLabel={compareRun.name}
              />
            ) : (
              <p className="text-sm text-text-muted">{t('detail.selectRunHint')}</p>
            )}
          </div>
        )}
      </Tabs>
    </div>
  )
}
