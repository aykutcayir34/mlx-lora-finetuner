import { beforeEach, describe, expect, it } from 'vitest'
import { useTrainingStore } from './trainingStore'
import type { MetricEvent, TrainWsServerFrame } from '../api/types'

function makeMetric(step: number, kind: 'train' | 'val', overrides: Partial<MetricEvent> = {}): MetricEvent {
  return {
    run_id: 'run-1',
    step,
    kind,
    loss: 1.0,
    learning_rate: 0.001,
    it_per_sec: 1.5,
    tokens_per_sec: 100,
    peak_memory_gb: 4.2,
    ts: new Date().toISOString(),
    ...overrides,
  }
}

describe('trainingStore', () => {
  beforeEach(() => {
    useTrainingStore.getState().reset(null)
  })

  it('adds a metric frame to metrics', () => {
    const frame: TrainWsServerFrame = { type: 'metric', data: makeMetric(1, 'train') }
    useTrainingStore.getState().applyWsFrame(frame)
    expect(useTrainingStore.getState().metrics).toHaveLength(1)
    expect(useTrainingStore.getState().metrics[0]).toEqual(frame.data)
  })

  it('dedupes two metric frames with the same (step, kind), keeping the latest values', () => {
    const first = makeMetric(1, 'train', { loss: 2.0 })
    const second = makeMetric(1, 'train', { loss: 0.5 })
    useTrainingStore.getState().applyWsFrame({ type: 'metric', data: first })
    useTrainingStore.getState().applyWsFrame({ type: 'metric', data: second })
    const { metrics } = useTrainingStore.getState()
    expect(metrics).toHaveLength(1)
    expect(metrics[0].loss).toBe(0.5)
  })

  it('keeps metrics sorted ascending by step regardless of arrival order, deduping backfill/live overlap', () => {
    const store = useTrainingStore.getState()
    // simulate backfill arriving with steps [1,2,3]
    store.applyWsFrame({ type: 'metric', data: makeMetric(1, 'train') })
    store.applyWsFrame({ type: 'metric', data: makeMetric(2, 'train') })
    store.applyWsFrame({ type: 'metric', data: makeMetric(3, 'train') })
    // live frame re-sends step 2 (duplicate)
    store.applyWsFrame({ type: 'metric', data: makeMetric(2, 'train', { loss: 9.9 }) })

    const { metrics } = useTrainingStore.getState()
    expect(metrics).toHaveLength(3)
    expect(metrics.map((m) => m.step)).toEqual([1, 2, 3])
    expect(metrics.find((m) => m.step === 2)?.loss).toBe(9.9)
  })

  it('updates status and error on a status frame', () => {
    useTrainingStore.getState().applyWsFrame({ type: 'status', status: 'running', error: null })
    expect(useTrainingStore.getState().status).toBe('running')
    expect(useTrainingStore.getState().error).toBeNull()

    useTrainingStore.getState().applyWsFrame({ type: 'status', status: 'failed', error: 'boom' })
    expect(useTrainingStore.getState().status).toBe('failed')
    expect(useTrainingStore.getState().error).toBe('boom')
  })

  it('drops oldest log lines beyond 500, keeping the most recent 500', () => {
    const store = useTrainingStore.getState()
    for (let i = 0; i < 505; i++) {
      store.applyWsFrame({ type: 'log_line', line: `line-${i}` })
    }
    const { logLines } = useTrainingStore.getState()
    expect(logLines).toHaveLength(500)
    // first 5 original lines (0-4) should be gone
    expect(logLines).not.toContain('line-0')
    expect(logLines).not.toContain('line-4')
    expect(logLines[0]).toBe('line-5')
    expect(logLines[logLines.length - 1]).toBe('line-504')
  })

  it('appends checkpoint frames to checkpoints', () => {
    const store = useTrainingStore.getState()
    store.applyWsFrame({ type: 'checkpoint', step: 10, adapter_path: '/adapters/a' })
    store.applyWsFrame({ type: 'checkpoint', step: 20, adapter_path: '/adapters/b' })
    const { checkpoints } = useTrainingStore.getState()
    expect(checkpoints).toEqual([
      { step: 10, adapter_path: '/adapters/a' },
      { step: 20, adapter_path: '/adapters/b' },
    ])
  })

  it('reset(runId) clears metrics/logLines/checkpoints/error and sets the new runId', () => {
    const store = useTrainingStore.getState()
    store.applyWsFrame({ type: 'metric', data: makeMetric(1, 'train') })
    store.applyWsFrame({ type: 'log_line', line: 'hello' })
    store.applyWsFrame({ type: 'checkpoint', step: 5, adapter_path: '/x' })
    store.applyWsFrame({ type: 'status', status: 'failed', error: 'oops' })

    store.reset('run-2')

    const state = useTrainingStore.getState()
    expect(state.runId).toBe('run-2')
    expect(state.status).toBeNull()
    expect(state.error).toBeNull()
    expect(state.metrics).toEqual([])
    expect(state.logLines).toEqual([])
    expect(state.checkpoints).toEqual([])
  })
})
