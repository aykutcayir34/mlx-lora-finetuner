import { useEffect, useMemo, useRef, useState } from 'react'
import type { Checkpoint } from '../../stores/trainingStore'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useCancelRun, useRun, useRunLogs, useRunMetrics } from '../../api/queries/training'
import { queryKeys } from '../../api/queries/keys'
import { ReconnectingWS } from '../../api/ws'
import type { JobStatus, MetricEvent, RunSummary, TrainWsServerFrame } from '../../api/types'
import { useTrainingStore } from '../../stores/trainingStore'
import { Card } from '../common/Card'
import { StatusBadge } from '../common/Badge'
import { Button } from '../common/Button'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { CodeBlock } from '../common/CodeBlock'
import { Tabs } from '../common/Tabs'
import { Spinner } from '../common/Spinner'
import { LossChart } from '../charts/LossChart'
import { LRChart } from '../charts/LRChart'
import { MemoryChart } from '../charts/MemoryChart'
import { StatTile } from './StatTile'
import { LiveLogViewer } from './LiveLogViewer'

const TERMINAL_STATUSES: JobStatus[] = ['completed', 'failed', 'cancelled']
const ACTIVE_STATUSES: JobStatus[] = ['running', 'queued']

interface RunMonitorProps {
  runId: string
  onNewRun: () => void
  /** Override for tests; forwarded to ReconnectingWS. */
  WebSocketImpl?: typeof WebSocket
}

type Mode = 'loading' | 'live' | 'past'

export function RunMonitor({ runId, WebSocketImpl }: RunMonitorProps) {
  const queryClient = useQueryClient()
  const runQuery = useRun(runId)
  const cancelRun = useCancelRun()
  const [mode, setMode] = useState<Mode>('loading')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [chartTab, setChartTab] = useState('loss')
  const [, forceTick] = useState(0)
  const wsRef = useRef<ReconnectingWS<TrainWsServerFrame> | null>(null)

  const reset = useTrainingStore((s) => s.reset)
  const applyWsFrame = useTrainingStore((s) => s.applyWsFrame)
  const storeRunId = useTrainingStore((s) => s.runId)
  const storeStatus = useTrainingStore((s) => s.status)
  const storeMetrics = useTrainingStore((s) => s.metrics)
  const storeLogLines = useTrainingStore((s) => s.logLines)
  const storeCheckpoints = useTrainingStore((s) => s.checkpoints)

  // Reset mode whenever the viewed run changes.
  useEffect(() => {
    setMode('loading')
  }, [runId])

  // Decide live vs. past once the initial REST fetch for this run resolves.
  useEffect(() => {
    if (mode !== 'loading' || !runQuery.data) return
    const initiallyLive = ACTIVE_STATUSES.includes(runQuery.data.status)
    if (initiallyLive) {
      reset(runId)
    }
    setMode(initiallyLive ? 'live' : 'past')
  }, [mode, runQuery.data, runId, reset])

  // Own the WebSocket connection for the lifetime of a "live" viewing session.
  useEffect(() => {
    if (mode !== 'live') return

    const ws = new ReconnectingWS<TrainWsServerFrame>({
      path: `/api/v1/ws/train/${encodeURIComponent(runId)}`,
      onFrame: applyWsFrame,
      helloFactory: () => {
        const lastStep = useTrainingStore
          .getState()
          .metrics.filter((m) => m.kind === 'train')
          .reduce((max, m) => Math.max(max, m.step), 0)
        return { last_step: lastStep }
      },
      WebSocketImpl,
    })
    wsRef.current = ws

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [mode, runId, applyWsFrame, WebSocketImpl])

  const isViewingLiveStore = mode === 'live' && storeRunId === runId
  const effectiveStatus: JobStatus | null = isViewingLiveStore
    ? (storeStatus ?? runQuery.data?.status ?? null)
    : (runQuery.data?.status ?? null)
  const isTerminal = effectiveStatus !== null && TERMINAL_STATUSES.includes(effectiveStatus)

  // Once the live connection reports a terminal status, stop reconnecting and
  // refresh the REST run summary so final_train_loss/adapter_path populate.
  useEffect(() => {
    if (!isViewingLiveStore || !isTerminal) return
    wsRef.current?.close()
    queryClient.invalidateQueries({ queryKey: queryKeys.training.run(runId) })
  }, [isViewingLiveStore, isTerminal, queryClient, runId])

  // Tick the elapsed-time label once a second while the run is active.
  useEffect(() => {
    if (effectiveStatus !== 'running' && effectiveStatus !== 'queued') return
    const id = setInterval(() => forceTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [effectiveStatus])

  // Disabled (empty runId) unless we actually need the REST-persisted view,
  // i.e. the "past run" path — live viewing gets everything over the socket.
  const pastMetrics = useRunMetrics(mode === 'past' ? runId : '', 0, undefined)
  const pastLogs = useRunLogs(mode === 'past' ? runId : '', 200)

  const metrics: MetricEvent[] = isViewingLiveStore ? storeMetrics : (pastMetrics.data?.metrics ?? [])
  const logLines: string[] = isViewingLiveStore ? storeLogLines : (pastLogs.data?.lines ?? [])
  // Checkpoints only stream over the live socket; the store keeps them
  // de-duplicated and sorted ascending by step.
  const checkpoints: Checkpoint[] = isViewingLiveStore ? storeCheckpoints : []

  const lastTrainMetric = useMemo(
    () => [...metrics].reverse().find((m) => m.kind === 'train'),
    [metrics],
  )
  const peakMemory = useMemo(() => {
    const values = metrics
      .map((m) => m.peak_memory_gb)
      .filter((v): v is number => v !== null)
    return values.length > 0 ? Math.max(...values) : null
  }, [metrics])

  if (runQuery.isLoading || mode === 'loading') {
    return (
      <Card>
        <div className="flex items-center justify-center gap-2 p-8 text-text-muted">
          <Spinner /> Loading run…
        </div>
      </Card>
    )
  }

  if (runQuery.isError || !runQuery.data) {
    return (
      <Card>
        <p className="p-4 text-sm text-danger">Failed to load run {runId}.</p>
      </Card>
    )
  }

  const run = runQuery.data
  const canCancel = effectiveStatus === 'running' || effectiveStatus === 'queued'
  const elapsed = formatElapsed(run.started_at, run.finished_at)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-text">{run.name}</h2>
              {effectiveStatus && <StatusBadge status={effectiveStatus} />}
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {run.config.model_id} · {run.config.dataset_id} · {elapsed}
            </p>
          </div>
          {canCancel && (
            <Button variant="danger" size="sm" onClick={() => setConfirmCancel(true)}>
              Cancel run
            </Button>
          )}
        </div>
      </Card>

      {isTerminal && effectiveStatus && (
        <TerminalPanel status={effectiveStatus} run={run} logLines={logLines} />
      )}

      <Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Current loss" value={formatNumber(lastTrainMetric?.loss)} />
          <StatTile label="it/s" value={formatNumber(lastTrainMetric?.it_per_sec)} />
          <StatTile label="tokens/s" value={formatNumber(lastTrainMetric?.tokens_per_sec)} />
          <StatTile label="Peak memory (GB)" value={formatNumber(peakMemory)} />
        </div>
      </Card>

      <Card>
        <Tabs
          tabs={[
            { id: 'loss', label: 'Loss' },
            { id: 'lr', label: 'Learning rate' },
            { id: 'memory', label: 'Memory' },
          ]}
          activeId={chartTab}
          onChange={setChartTab}
        >
          {chartTab === 'loss' && <LossChart data={metrics} />}
          {chartTab === 'lr' && <LRChart data={metrics} />}
          {chartTab === 'memory' && <MemoryChart data={metrics} />}
        </Tabs>
      </Card>

      {checkpoints.length > 0 && (
        <Card title="Checkpoints">
          <ul className="flex flex-col gap-1.5" data-testid="checkpoint-list">
            {checkpoints.map((cp) => (
              <li
                key={cp.step}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-sm"
              >
                <span className="shrink-0 font-medium text-text">Step {cp.step}</span>
                <span
                  className="min-w-0 flex-1 truncate text-right font-mono text-xs text-text-muted"
                  title={cp.adapter_path}
                >
                  {cp.adapter_path}
                </span>
                <CopyButton text={cp.adapter_path} label={`Copy adapter path for step ${cp.step}`} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <LiveLogViewer lines={logLines} />
      </Card>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel run"
        message={`Cancel "${run.name}"? This will stop training as soon as possible.`}
        confirmLabel="Cancel run"
        cancelLabel="Keep running"
        danger
        onConfirm={() => {
          cancelRun.mutate(runId)
          setConfirmCancel(false)
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  )
}

interface TerminalPanelProps {
  status: JobStatus
  run: RunSummary
  logLines: string[]
}

function TerminalPanel({ status, run, logLines }: TerminalPanelProps) {
  if (status === 'completed') {
    return (
      <Card title="Training complete">
        <div className="flex flex-col gap-3">
          <div className="flex gap-6 text-sm">
            <span>
              Final train loss:{' '}
              <span className="font-medium text-text">{formatNumber(run.final_train_loss)}</span>
            </span>
            <span>
              Final val loss:{' '}
              <span className="font-medium text-text">{formatNumber(run.final_val_loss)}</span>
            </span>
          </div>
          {run.adapter_path && (
            <div>
              <p className="mb-1 text-xs text-text-muted">Adapter path</p>
              <CodeBlock code={run.adapter_path} />
            </div>
          )}
          <div className="flex gap-3 text-sm">
            <Link to="/chat" className="text-accent hover:underline">
              Chat with this adapter
            </Link>
            <Link to="/export" className="text-accent hover:underline">
              Export this adapter
            </Link>
          </div>
        </div>
      </Card>
    )
  }

  if (status === 'failed') {
    return (
      <Card title="Training failed">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-danger">{run.error ?? 'Unknown error.'}</p>
          <LiveLogViewer lines={logLines} />
        </div>
      </Card>
    )
  }

  return (
    <Card title="Training cancelled">
      <p className="text-sm text-text-muted">This run was cancelled.</p>
    </Card>
  )
}

// Same copy-to-clipboard pattern as common/CodeBlock, in per-row size.
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
    } catch {
      // Clipboard unavailable or permission denied — nothing further to do.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      className="shrink-0 rounded px-2 py-0.5 text-xs text-text-muted hover:bg-surface hover:text-text"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

function formatElapsed(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt) return 'Not started'
  const start = new Date(startedAt).getTime()
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now()
  const seconds = Math.max(0, Math.floor((end - start) / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}
