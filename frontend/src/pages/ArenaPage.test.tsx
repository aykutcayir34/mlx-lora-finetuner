import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, renderWithProviders, screen, waitFor, within } from '../test/render'
import { server } from '../test/server'
import { arenaHandlers } from '../test/handlers/arena'
import { useArenaStore } from '../components/arena/arenaStore'
import { ArenaPage } from './ArenaPage'

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
  sent: string[] = []
  url: string

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: unknown) {
    this.sent.push(typeof data === 'string' ? data : JSON.stringify(data))
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  // test helpers, not part of the real WebSocket API
  open() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  emit(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }

  get sentFrames(): Record<string, unknown>[] {
    return this.sent.map((raw) => JSON.parse(raw))
  }
}

const MODEL_A = 'mlx-community/SmolLM-135M-Instruct-4bit'
const MODEL_B = 'mlx-community/Qwen2.5-0.5B-Instruct-4bit'

describe('ArenaPage', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    server.use(...arenaHandlers)
    useArenaStore.setState({
      sideA: { messages: [], streamingText: '', status: 'idle', usage: null, error: null },
      sideB: { messages: [], streamingText: '', status: 'idle', usage: null, error: null },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function renderReady() {
    const user = userEvent.setup()
    renderWithProviders(<ArenaPage />)

    expect(MockWebSocket.instances).toHaveLength(1)
    act(() => MockWebSocket.instances[0].open())

    await waitFor(() => expect(screen.getByLabelText('Side A Model')).toHaveValue(MODEL_A))
    await waitFor(() => expect(screen.getByLabelText('Side B Model')).toHaveValue(MODEL_B))
    return { user, socket: MockWebSocket.instances[0] }
  }

  it('sends a generate frame shaped per the contract with both side specs and shared params', async () => {
    const { user, socket } = await renderReady()

    await user.type(screen.getByLabelText('Message'), 'Hello{Enter}')

    await waitFor(() => expect(socket.sentFrames).toHaveLength(1))
    expect(socket.sentFrames[0]).toEqual({
      type: 'generate',
      side_a: { model_id: MODEL_A, adapter_path: null },
      side_b: { model_id: MODEL_B, adapter_path: null },
      messages: [{ role: 'user', content: 'Hello' }],
      params: { max_tokens: 512, temperature: 0.7, top_p: 0.9, repetition_penalty: null },
    })
  })

  it('renders interleaved side_start/token/side_done frames into the correct columns', async () => {
    const { user, socket } = await renderReady()

    await user.type(screen.getByLabelText('Message'), 'Hi{Enter}')
    await waitFor(() => expect(socket.sentFrames).toHaveLength(1))

    const columnA = screen.getByTestId('arena-column-a')
    const columnB = screen.getByTestId('arena-column-b')

    act(() => socket.emit({ type: 'side_start', side: 'a' }))
    act(() => socket.emit({ type: 'token', side: 'a', text: 'Hel' }))
    act(() => socket.emit({ type: 'token', side: 'a', text: 'lo' }))
    expect(within(columnA).getByText('Hello')).toBeInTheDocument()

    act(() =>
      socket.emit({
        type: 'side_done',
        side: 'a',
        usage: { prompt_tokens: 1, completion_tokens: 1, tokens_per_sec: 10 },
      }),
    )

    act(() => socket.emit({ type: 'side_start', side: 'b' }))
    act(() => socket.emit({ type: 'token', side: 'b', text: 'Yo' }))
    expect(within(columnB).getByText('Yo')).toBeInTheDocument()
    // side b's streamed text must not leak into column a
    expect(within(columnA).queryByText('Yo')).not.toBeInTheDocument()

    act(() =>
      socket.emit({
        type: 'side_done',
        side: 'b',
        usage: { prompt_tokens: 1, completion_tokens: 1, tokens_per_sec: 5 },
      }),
    )
    act(() => socket.emit({ type: 'done' }))

    expect(within(columnA).getByText(/10\.0 tok\/s/)).toBeInTheDocument()
    expect(within(columnB).getByText(/5\.0 tok\/s/)).toBeInTheDocument()
  })

  it('shows a per-side error in one column while the other side completes normally', async () => {
    const { user, socket } = await renderReady()

    await user.type(screen.getByLabelText('Message'), 'Hi{Enter}')
    await waitFor(() => expect(socket.sentFrames).toHaveLength(1))

    const columnA = screen.getByTestId('arena-column-a')
    const columnB = screen.getByTestId('arena-column-b')

    act(() => socket.emit({ type: 'side_start', side: 'a' }))
    act(() =>
      socket.emit({
        type: 'error',
        side: 'a',
        code: 'model_not_found',
        message: "model 'x' not found",
      }),
    )
    expect(within(columnA).getByRole('alert')).toHaveTextContent("model 'x' not found")

    act(() => socket.emit({ type: 'side_start', side: 'b' }))
    act(() => socket.emit({ type: 'token', side: 'b', text: 'ok' }))
    act(() =>
      socket.emit({
        type: 'side_done',
        side: 'b',
        usage: { prompt_tokens: 1, completion_tokens: 1, tokens_per_sec: 1 },
      }),
    )
    act(() => socket.emit({ type: 'done' }))

    expect(within(columnB).getByText('ok')).toBeInTheDocument()
    expect(within(columnB).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Stop sends a cancel frame while a side is streaming', async () => {
    const { user, socket } = await renderReady()

    await user.type(screen.getByLabelText('Message'), 'Hi{Enter}')
    await waitFor(() => expect(socket.sentFrames).toHaveLength(1))

    act(() => socket.emit({ type: 'side_start', side: 'a' }))
    act(() => socket.emit({ type: 'token', side: 'a', text: 'Par' }))

    const stopButton = await screen.findByRole('button', { name: 'Stop' })
    await user.click(stopButton)

    await waitFor(() => expect(socket.sentFrames).toHaveLength(2))
    expect(socket.sentFrames[1]).toEqual({ type: 'cancel' })
  })

  it('shows the training_active banner without closing the socket', async () => {
    const { user, socket } = await renderReady()

    await user.type(screen.getByLabelText('Message'), 'Hi{Enter}')
    await waitFor(() => expect(socket.sentFrames).toHaveLength(1))

    act(() =>
      socket.emit({ type: 'error', side: null, code: 'training_active', message: 'training in progress' }),
    )

    expect(await screen.findByTestId('training-banner')).toHaveTextContent(
      'Eğitim sürerken arena kapalı',
    )
    expect(socket.readyState).toBe(MockWebSocket.OPEN)
    expect(MockWebSocket.instances).toHaveLength(1)

    // socket stays usable — banner clears on the next send
    await user.type(screen.getByLabelText('Message'), 'Retry{Enter}')
    expect(screen.queryByTestId('training-banner')).not.toBeInTheDocument()
    await waitFor(() => expect(socket.sentFrames).toHaveLength(2))
  })
})
