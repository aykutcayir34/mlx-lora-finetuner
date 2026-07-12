import { useEffect, useState } from 'react'
import { PageShell } from '../components/layout/PageShell'
import { ToastProvider } from '../components/common/Toast'
import { useRuns } from '../api/queries/training'
import { TrainConfigForm } from '../components/training/TrainConfigForm'
import { RunMonitor } from '../components/training/RunMonitor'
import { RunHistoryList } from '../components/training/RunHistoryList'

const ACTIVE_STATUSES = new Set(['running', 'queued'])

interface TrainPageContentProps {
  /** Override for tests; forwarded to RunMonitor's WebSocket connection. */
  WebSocketImpl?: typeof WebSocket
}

function TrainPageContent({ WebSocketImpl }: TrainPageContentProps) {
  const [viewingRunId, setViewingRunId] = useState<string | null>(null)
  const runsQuery = useRuns(undefined, 20, 0)
  const activeRun = runsQuery.data?.runs.find((r) => ACTIVE_STATUSES.has(r.status))

  // Default to the active run's live monitor if one exists and nothing else
  // has been explicitly selected yet.
  useEffect(() => {
    if (viewingRunId === null && activeRun) {
      setViewingRunId(activeRun.run_id)
    }
  }, [viewingRunId, activeRun])

  return (
    <div className="flex flex-1 gap-6">
      <div className="min-w-0 flex-1">
        {viewingRunId ? (
          <RunMonitor
            runId={viewingRunId}
            onNewRun={() => setViewingRunId(null)}
            WebSocketImpl={WebSocketImpl}
          />
        ) : (
          <TrainConfigForm onCreated={(runId) => setViewingRunId(runId)} />
        )}
      </div>
      <RunHistoryList
        selectedRunId={viewingRunId}
        onSelect={setViewingRunId}
        onNewRun={() => setViewingRunId(null)}
      />
    </div>
  )
}

export function TrainPage({ WebSocketImpl }: TrainPageContentProps = {}) {
  return (
    <PageShell
      title="Train"
      description="Configure and launch LoRA fine-tuning jobs, watch live metrics."
    >
      <ToastProvider>
        <TrainPageContent WebSocketImpl={WebSocketImpl} />
      </ToastProvider>
    </PageShell>
  )
}
