import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, renderWithProviders, screen, waitFor, within } from '../test/render'
import { server } from '../test/server'
import { chatHandlers } from '../test/handlers/chat'
import { useChatStore } from '../stores/chatStore'
import { ChatPage } from './ChatPage'

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

// Matches the hardcoded session ids in ChatPage.tsx.
const ADAPTER_COLUMN_TESTID = 'chat-column-chat:adapter'
const BASE_COLUMN_TESTID = 'chat-column-chat:base'

describe('ChatPage', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    server.use(...chatHandlers)
    useChatStore.setState({ sessions: {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function renderReady() {
    const user = userEvent.setup()
    renderWithProviders(<ChatPage />)

    expect(MockWebSocket.instances).toHaveLength(1)
    act(() => MockWebSocket.instances[0].open())

    await waitFor(() =>
      expect(screen.getByLabelText('Model')).toHaveValue(
        'mlx-community/SmolLM-135M-Instruct-4bit',
      ),
    )
    return { user, socket: MockWebSocket.instances[0] }
  }

  it('sends a generate frame shaped per the contract, streams tokens, and renders usage on done', async () => {
    const { user, socket } = await renderReady()

    await user.selectOptions(screen.getByLabelText('Adapter'), 'smol-lora-v1')

    await user.type(screen.getByLabelText('Message'), 'Hello{Enter}')

    await waitFor(() => expect(socket.sentFrames).toHaveLength(1))
    expect(socket.sentFrames[0]).toEqual({
      type: 'generate',
      model_id: 'mlx-community/SmolLM-135M-Instruct-4bit',
      adapter_path: '/data/runs/run_1/adapters',
      messages: [{ role: 'user', content: 'Hello' }],
      params: { max_tokens: 512, temperature: 0.7, top_p: 0.9, repetition_penalty: null },
    })

    act(() => socket.emit({ type: 'token', text: 'Hel' }))
    act(() => socket.emit({ type: 'token', text: 'lo' }))
    // one "Hello" bubble for the user's own echoed message, one for the
    // in-progress streaming assistant reply
    expect(screen.getAllByText('Hello')).toHaveLength(2)

    act(() =>
      socket.emit({
        type: 'done',
        usage: { prompt_tokens: 10, completion_tokens: 5, tokens_per_sec: 42.5 },
      }),
    )

    expect(screen.getByText(/5 tokens/)).toBeInTheDocument()
    expect(screen.getByText(/42\.5 tok\/s/)).toBeInTheDocument()
    // finalized text stays visible after streaming ends (user turn + assistant reply)
    expect(screen.getAllByText('Hello')).toHaveLength(2)
  })

  it('Stop sends a cancel frame and finalizes the partial message once done arrives', async () => {
    const { user, socket } = await renderReady()

    await user.type(screen.getByLabelText('Message'), 'Hi{Enter}')
    await waitFor(() => expect(socket.sentFrames).toHaveLength(1))

    act(() => socket.emit({ type: 'token', text: 'Par' }))

    const stopButton = await screen.findByRole('button', { name: 'Stop' })
    await user.click(stopButton)

    await waitFor(() => expect(socket.sentFrames).toHaveLength(2))
    expect(socket.sentFrames[1]).toEqual({ type: 'cancel' })

    act(() =>
      socket.emit({
        type: 'done',
        usage: { prompt_tokens: 3, completion_tokens: 1, tokens_per_sec: 10 },
      }),
    )

    expect(screen.getByText('Par')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('shows the training_active banner without closing the socket, and clears it on retry', async () => {
    const { user, socket } = await renderReady()

    await user.type(screen.getByLabelText('Message'), 'Hi{Enter}')
    await waitFor(() => expect(socket.sentFrames).toHaveLength(1))

    act(() =>
      socket.emit({ type: 'error', code: 'training_active', message: 'training in progress' }),
    )

    expect(await screen.findByTestId('training-banner')).toHaveTextContent(
      'Eğitim sürerken sohbet kapalı',
    )
    expect(socket.readyState).toBe(MockWebSocket.OPEN)
    expect(MockWebSocket.instances).toHaveLength(1)

    await user.type(screen.getByLabelText('Message'), 'Retry{Enter}')

    expect(screen.queryByTestId('training-banner')).not.toBeInTheDocument()
    await waitFor(() => expect(socket.sentFrames).toHaveLength(2))
    expect(socket.sentFrames[1]).toMatchObject({ type: 'generate' })
  })

  it('filters the adapter picker to the selected base model', async () => {
    await renderReady()

    const adapterSelect = screen.getByLabelText('Adapter') as HTMLSelectElement
    const optionLabels = Array.from(adapterSelect.options).map((o) => o.textContent)
    expect(optionLabels).toContain('smol-lora-v1')
    expect(optionLabels).not.toContain('qwen-lora-v1')

    const { user } = { user: userEvent.setup() }
    await user.selectOptions(
      screen.getByLabelText('Model'),
      'mlx-community/Qwen2.5-0.5B-Instruct-4bit',
    )

    await waitFor(() => {
      const options = Array.from(
        (screen.getByLabelText('Adapter') as HTMLSelectElement).options,
      ).map((o) => o.textContent)
      expect(options).toContain('qwen-lora-v1')
      expect(options).not.toContain('smol-lora-v1')
    })
  })

  it('compare mode sends two sequential generates (adapter then base) and renders two columns', async () => {
    const { user, socket } = await renderReady()

    await user.selectOptions(screen.getByLabelText('Adapter'), 'smol-lora-v1')
    await user.click(screen.getByRole('switch', { name: 'Compare with/without adapter' }))

    const adapterColumn = screen.getByTestId(ADAPTER_COLUMN_TESTID)
    const baseColumn = screen.getByTestId(BASE_COLUMN_TESTID)
    expect(within(adapterColumn).getByText('Adapter')).toBeInTheDocument()
    expect(within(baseColumn).getByText('Base')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Message'), 'Hi{Enter}')

    await waitFor(() => expect(socket.sentFrames).toHaveLength(1))
    expect(socket.sentFrames[0]).toMatchObject({
      type: 'generate',
      adapter_path: '/data/runs/run_1/adapters',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    act(() => socket.emit({ type: 'token', text: 'adapter-says-hi' }))
    expect(within(adapterColumn).getByText('adapter-says-hi')).toBeInTheDocument()

    act(() =>
      socket.emit({
        type: 'done',
        usage: { prompt_tokens: 1, completion_tokens: 1, tokens_per_sec: 1 },
      }),
    )

    await waitFor(() => expect(socket.sentFrames).toHaveLength(2))
    expect(socket.sentFrames[1]).toMatchObject({
      type: 'generate',
      adapter_path: null,
      messages: [{ role: 'user', content: 'Hi' }],
    })

    act(() => socket.emit({ type: 'token', text: 'base-says-hi' }))
    expect(within(baseColumn).getByText('base-says-hi')).toBeInTheDocument()

    act(() =>
      socket.emit({
        type: 'done',
        usage: { prompt_tokens: 1, completion_tokens: 1, tokens_per_sec: 1 },
      }),
    )

    expect(within(adapterColumn).getByText('adapter-says-hi')).toBeInTheDocument()
    expect(within(baseColumn).getByText('base-says-hi')).toBeInTheDocument()
  })

  it('marks the in-flight message as errored and recovers after a reconnect when the socket drops mid-stream', async () => {
    const { user, socket } = await renderReady()

    await user.type(screen.getByLabelText('Message'), 'Hi{Enter}')
    await waitFor(() => expect(socket.sentFrames).toHaveLength(1))
    act(() => socket.emit({ type: 'token', text: 'Par' }))

    act(() => socket.close())

    // in-flight session errored + generating flag cleared so the user can retry
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost')
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.getByTestId('ws-reconnecting-banner')).toBeInTheDocument()

    // ReconnectingWS retries with backoff and opens a fresh socket
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2), { timeout: 3000 })
    const reconnected = MockWebSocket.instances[1]
    act(() => reconnected.open())
    expect(screen.queryByTestId('ws-reconnecting-banner')).not.toBeInTheDocument()

    // the queue is not blocked by the dead generation — a retry goes out
    await user.type(screen.getByLabelText('Message'), 'Retry{Enter}')
    await waitFor(() => expect(reconnected.sentFrames).toHaveLength(1))
    expect(reconnected.sentFrames[0]).toMatchObject({
      type: 'generate',
      messages: [{ role: 'user', content: 'Hi' }, { role: 'user', content: 'Retry' }],
    })
  })

  it('compare mode: resumes the queued base generate after reconnect when the socket drops mid-adapter-stream', async () => {
    const { user, socket } = await renderReady()

    await user.selectOptions(screen.getByLabelText('Adapter'), 'smol-lora-v1')
    await user.click(screen.getByRole('switch', { name: 'Compare with/without adapter' }))
    await user.type(screen.getByLabelText('Message'), 'Hi{Enter}')
    await waitFor(() => expect(socket.sentFrames).toHaveLength(1))

    act(() => socket.emit({ type: 'token', text: 'partial' }))
    act(() => socket.close())

    // only the in-flight adapter column is errored; the base half stays queued
    const adapterColumn = screen.getByTestId(ADAPTER_COLUMN_TESTID)
    const baseColumn = screen.getByTestId(BASE_COLUMN_TESTID)
    expect(within(adapterColumn).getByRole('alert')).toHaveTextContent('Connection lost')
    expect(within(baseColumn).queryByRole('alert')).not.toBeInTheDocument()

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2), { timeout: 3000 })
    const reconnected = MockWebSocket.instances[1]
    act(() => reconnected.open())

    // reopening dispatches the queued base generate without user action
    await waitFor(() => expect(reconnected.sentFrames).toHaveLength(1))
    expect(reconnected.sentFrames[0]).toMatchObject({
      type: 'generate',
      adapter_path: null,
      messages: [{ role: 'user', content: 'Hi' }],
    })
  })

  it('includes prior turns as history in subsequent generate frames', async () => {
    const { user, socket } = await renderReady()

    await user.type(screen.getByLabelText('Message'), 'Hi{Enter}')
    await waitFor(() => expect(socket.sentFrames).toHaveLength(1))

    act(() => socket.emit({ type: 'token', text: 'Hello there' }))
    act(() =>
      socket.emit({
        type: 'done',
        usage: { prompt_tokens: 1, completion_tokens: 1, tokens_per_sec: 1 },
      }),
    )

    await user.type(screen.getByLabelText('Message'), 'How are you?{Enter}')
    await waitFor(() => expect(socket.sentFrames).toHaveLength(2))
    expect(socket.sentFrames[1]).toMatchObject({
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello there' },
        { role: 'user', content: 'How are you?' },
      ],
    })
  })
})
