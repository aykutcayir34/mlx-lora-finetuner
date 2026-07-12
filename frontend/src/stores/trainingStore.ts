import { create } from 'zustand'
import type { JobStatus, MetricEvent, MetricKind, TrainWsServerFrame } from '../api/types'

const MAX_LOG_LINES = 500

export interface Checkpoint {
  step: number
  adapter_path: string
}

export interface TrainingState {
  runId: string | null
  status: JobStatus | null
  error: string | null
  metrics: MetricEvent[]
  logLines: string[]
  checkpoints: Checkpoint[]

  applyWsFrame: (frame: TrainWsServerFrame) => void
  reset: (runId: string | null) => void
}

function upsertMetric(metrics: MetricEvent[], next: MetricEvent): MetricEvent[] {
  const filtered = metrics.filter((m) => !(m.step === next.step && m.kind === next.kind))
  const result = [...filtered, next]
  result.sort((a, b) => a.step - b.step)
  return result
}

export const useTrainingStore = create<TrainingState>((set) => ({
  runId: null,
  status: null,
  error: null,
  metrics: [],
  logLines: [],
  checkpoints: [],

  applyWsFrame: (frame) => {
    switch (frame.type) {
      case 'metric':
        set((state) => ({ metrics: upsertMetric(state.metrics, frame.data) }))
        break
      case 'status':
        set({ status: frame.status, error: frame.error })
        break
      case 'log_line':
        set((state) => {
          const logLines = [...state.logLines, frame.line]
          if (logLines.length > MAX_LOG_LINES) {
            logLines.splice(0, logLines.length - MAX_LOG_LINES)
          }
          return { logLines }
        })
        break
      case 'checkpoint':
        set((state) => ({
          checkpoints: [...state.checkpoints, { step: frame.step, adapter_path: frame.adapter_path }],
        }))
        break
    }
  },

  reset: (runId) =>
    set({
      runId,
      status: null,
      error: null,
      metrics: [],
      logLines: [],
      checkpoints: [],
    }),
}))

export const selectMetricsByKind = (kind: MetricKind) => (state: TrainingState): MetricEvent[] =>
  state.metrics.filter((m) => m.kind === kind)
export const selectTrainSeries = (state: TrainingState) => selectMetricsByKind('train')(state)
export const selectValSeries = (state: TrainingState) => selectMetricsByKind('val')(state)
