import { useState } from 'react'
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
import { ConfigViewer } from './ConfigViewer'
import { ConfigDiff } from './ConfigDiff'
import type { RunSummary } from '../../api/types'

interface RunDetailPanelProps {
  run: RunSummary
  /** Candidate runs for the config-diff picker (typically the currently loaded page of results). */
  otherRuns: RunSummary[]
}

type DetailTab = 'charts' | 'config' | 'diff'

export function RunDetailPanel({ run, otherRuns }: RunDetailPanelProps) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<DetailTab>('charts')
  const [diffRunId, setDiffRunId] = useState('')
  const metricsQuery = useRunMetrics(run.run_id, 0, undefined)
  const cloneRun = useCloneRun()

  const metrics = metricsQuery.data?.metrics ?? []
  const diffRun = otherRuns.find((candidate) => candidate.run_id === diffRunId) ?? null

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
          <Button size="sm" onClick={handleClone} loading={cloneRun.isPending}>
            Clone
          </Button>
          {cloneRun.isError && <p className="text-xs text-danger">Failed to clone this run.</p>}
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'charts', label: 'Charts' },
          { id: 'config', label: 'Config' },
          { id: 'diff', label: 'Diff' },
        ]}
        activeId={tab}
        onChange={(id) => setTab(id as DetailTab)}
      >
        {tab === 'charts' && (
          <div className="flex flex-col gap-4">
            <LossChart data={metrics} />
            <LRChart data={metrics} />
            <MemoryChart data={metrics} />
          </div>
        )}
        {tab === 'config' && <ConfigViewer config={run.config} />}
        {tab === 'diff' && (
          <div className="flex flex-col gap-4">
            <Field label="Compare against" htmlFor="history-diff-run">
              <Select
                id="history-diff-run"
                value={diffRunId}
                onChange={(event) => setDiffRunId(event.target.value)}
                options={[
                  { value: '', label: 'Select a run…' },
                  ...otherRuns
                    .filter((candidate) => candidate.run_id !== run.run_id)
                    .map((candidate) => ({
                      value: candidate.run_id,
                      label: `${candidate.name} (${candidate.run_id})`,
                    })),
                ]}
              />
            </Field>
            {diffRun ? (
              <ConfigDiff
                base={run.config}
                other={diffRun.config}
                baseLabel={run.name}
                otherLabel={diffRun.name}
              />
            ) : (
              <p className="text-sm text-text-muted">Select a run to compare configs.</p>
            )}
          </div>
        )}
      </Tabs>
    </div>
  )
}
