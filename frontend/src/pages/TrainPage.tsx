import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { PageShell } from '../components/layout/PageShell'
import { ToastProvider } from '../components/common/Toast'
import { useRuns } from '../api/queries/training'
import { TrainConfigForm } from '../components/training/TrainConfigForm'
import { RunMonitor } from '../components/training/RunMonitor'
import { RunHistoryList } from '../components/training/RunHistoryList'
import type { TrainingConfig } from '../api/types'

const ACTIVE_STATUSES = new Set(['running', 'queued'])

interface TrainPageContentProps {
  /** Override for tests; forwarded to RunMonitor's WebSocket connection. */
  WebSocketImpl?: typeof WebSocket
}

function TrainPageContent({ WebSocketImpl }: TrainPageContentProps) {
  const [viewingRunId, setViewingRunId] = useState<string | null>(null)
  // Staged by the History page's "Clone" button via router navigation state.
  const location = useLocation()
  const cloneConfig = (location.state as { cloneConfig?: TrainingConfig } | null)?.cloneConfig
  const runsQuery = useRuns(undefined, 20, 0)
  const activeRun = runsQuery.data?.runs.find((r) => ACTIVE_STATUSES.has(r.status))

  // Default to the active run's live monitor if one exists and nothing else
  // has been explicitly selected yet — unless a cloned config was staged,
  // in which case the form (prefilled) stays in front.
  useEffect(() => {
    if (viewingRunId === null && activeRun && !cloneConfig) {
      setViewingRunId(activeRun.run_id)
    }
  }, [viewingRunId, activeRun, cloneConfig])

  return (
    <div className="flex flex-1 gap-6">
      <div className="min-w-0 flex-1">
        {viewingRunId ? (
          <RunMonitor runId={viewingRunId} WebSocketImpl={WebSocketImpl} />
        ) : (
          <TrainConfigForm
            initialConfig={cloneConfig}
            onCreated={(runId) => setViewingRunId(runId)}
          />
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
  const { t } = useTranslation('train')
  return (
    <PageShell title={t('page.title')} description={t('page.description')}>
      <ToastProvider>
        <TrainPageContent WebSocketImpl={WebSocketImpl} />
      </ToastProvider>
    </PageShell>
  )
}
