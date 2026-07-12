import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/server'
import { renderWithProviders } from '../../test/render'
import { useTrainingStore } from '../../stores/trainingStore'
import { RunMonitor } from './RunMonitor'
import { makeRunSummary } from '../../test/handlers/training'
import type { MetricEvent } from '../../api/types'

// Recharts' ResponsiveContainer needs a measurable DOM node under jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 500, height: 300, top: 0, left: 0, bottom: 300, right: 500, x: 0, y: 0 }) as DOMRect
})
afterAll(() => {
  vi.unstubAllGlobals()
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
})

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  sent: unknown[] = []
  url: string

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: unknown) {
    this.sent.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  open() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  emit(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}

function makeMetric(step: number, kind: 'train' | 'val', overrides: Partial<MetricEvent> = {}): MetricEvent {
  return {
    run_id: 'run_1',
    step,
    kind,
    loss: 2.5,
    learning_rate: 0.001,
    it_per_sec: 3,
    tokens_per_sec: 100,
    peak_memory_gb: 5,
    ts: '2026-07-12T10:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  MockWebSocket.instances = []
  useTrainingStore.getState().reset(null)
})

afterEach(() => {
  useTrainingStore.getState().reset(null)
})

describe('RunMonitor - live run', () => {
  it('connects over WS with a {last_step: 0} hello frame and renders incoming metric/log/checkpoint frames', async () => {
    let currentRun = makeRunSummary({ run_id: 'run_1', status: 'running' })
    server.use(
      http.get('/api/v1/train/jobs/run_1', () => HttpResponse.json(currentRun)),
      http.get('/api/v1/train/jobs/run_1/metrics', () => HttpResponse.json({ metrics: [] })),
      http.get('/api/v1/train/jobs/run_1/logs', () => HttpResponse.json({ lines: [] })),
    )

    renderWithProviders(
      <RunMonitor
        runId="run_1"
        onNewRun={() => {}}
        WebSocketImpl={MockWebSocket as unknown as typeof WebSocket}
      />,
    )

    await screen.findByText('my-run')

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1))
    expect(MockWebSocket.instances[0].url).toContain('/api/v1/ws/train/run_1')

    act(() => {
      MockWebSocket.instances[0].open()
    })
    expect(MockWebSocket.instances[0].sent).toEqual([JSON.stringify({ last_step: 0 })])

    act(() => {
      MockWebSocket.instances[0].emit({ type: 'status', status: 'running', error: null })
      MockWebSocket.instances[0].emit({ type: 'metric', data: makeMetric(1, 'train') })
      MockWebSocket.instances[0].emit({ type: 'log_line', line: 'starting step 1' })
      MockWebSocket.instances[0].emit({ type: 'checkpoint', step: 1, adapter_path: '/adapters/run_1' })
    })

    await screen.findByText('starting step 1')
    expect(screen.getByText('2.500')).toBeInTheDocument() // current loss stat tile
    expect(screen.getByText('Train loss')).toBeInTheDocument() // loss chart legend

    // Transition to a terminal status: REST refetch should surface final data.
    currentRun = makeRunSummary({
      run_id: 'run_1',
      status: 'completed',
      final_train_loss: 1.23,
      final_val_loss: 1.5,
      adapter_path: '/adapters/run_1',
    })
    act(() => {
      MockWebSocket.instances[0].emit({ type: 'status', status: 'completed', error: null })
    })

    await screen.findByText('Training complete')
    await waitFor(() => expect(screen.getByText('1.230')).toBeInTheDocument())
  })

  it('shows the Cancel confirm flow and posts to the cancel endpoint', async () => {
    const user = userEvent.setup()
    let cancelled = false
    server.use(
      http.get('/api/v1/train/jobs/run_1', () => HttpResponse.json(makeRunSummary({ run_id: 'run_1', status: 'running' }))),
      http.get('/api/v1/train/jobs/run_1/metrics', () => HttpResponse.json({ metrics: [] })),
      http.get('/api/v1/train/jobs/run_1/logs', () => HttpResponse.json({ lines: [] })),
      http.post('/api/v1/train/jobs/run_1/cancel', () => {
        cancelled = true
        return HttpResponse.json(makeRunSummary({ run_id: 'run_1', status: 'running' }), { status: 202 })
      }),
    )

    renderWithProviders(
      <RunMonitor
        runId="run_1"
        onNewRun={() => {}}
        WebSocketImpl={MockWebSocket as unknown as typeof WebSocket}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Cancel run' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }))

    await waitFor(() => expect(cancelled).toBe(true))
  })
})

describe('RunMonitor - past run', () => {
  it('renders static charts from REST metrics without opening a WebSocket', async () => {
    server.use(
      http.get('/api/v1/train/jobs/run_2', () =>
        HttpResponse.json(
          makeRunSummary({
            run_id: 'run_2',
            status: 'completed',
            final_train_loss: 0.9,
            final_val_loss: 1.1,
            adapter_path: '/adapters/run_2',
          }),
        ),
      ),
      http.get('/api/v1/train/jobs/run_2/metrics', () =>
        HttpResponse.json({ metrics: [makeMetric(1, 'train', { run_id: 'run_2' }), makeMetric(2, 'train', { run_id: 'run_2', loss: 1.1 })] }),
      ),
      http.get('/api/v1/train/jobs/run_2/logs', () => HttpResponse.json({ lines: ['line a', 'line b'] })),
    )

    renderWithProviders(
      <RunMonitor
        runId="run_2"
        onNewRun={() => {}}
        WebSocketImpl={MockWebSocket as unknown as typeof WebSocket}
      />,
    )

    await screen.findByText('Training complete')
    await screen.findByText('Train loss')
    expect(screen.getByText('line a')).toBeInTheDocument()
    expect(MockWebSocket.instances).toHaveLength(0)
  })
})
