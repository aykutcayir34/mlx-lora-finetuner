import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useChatSocket } from './useChatSocket'
import { useChatStore } from '../../stores/chatStore'
import type { ChatWsClientFrame } from '../../api/types'

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

const WebSocketImpl = MockWebSocket as unknown as typeof WebSocket

function makeGenerateFrame(content: string): ChatWsClientFrame {
  return {
    type: 'generate',
    model_id: 'mlx-community/SmolLM-135M-Instruct-4bit',
    adapter_path: null,
    messages: [{ role: 'user', content }],
    params: { max_tokens: 512, temperature: 0.7, top_p: 0.9, repetition_penalty: null },
  }
}

const doneUsage = { prompt_tokens: 10, completion_tokens: 5, tokens_per_sec: 42 }

describe('useChatSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.useFakeTimers()
    useChatStore.setState({ sessions: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderReady() {
    const hook = renderHook(() => useChatSocket({ WebSocketImpl }))
    expect(MockWebSocket.instances).toHaveLength(1)
    const socket = MockWebSocket.instances[0]
    act(() => socket.open())
    return { hook, socket }
  }

  it('queues an enqueue made while disconnected and dispatches it on open', () => {
    const hook = renderHook(() => useChatSocket({ WebSocketImpl }))
    const socket = MockWebSocket.instances[0]

    // isConnected starts true so the reconnect banner does not flash during
    // the initial handshake
    expect(hook.result.current.isConnected).toBe(true)

    const frame = makeGenerateFrame('hello')
    act(() => hook.result.current.enqueueGenerate('s1', frame))

    // socket not open yet: nothing sent, nothing active
    expect(socket.sentFrames).toHaveLength(0)
    expect(hook.result.current.activeSessionId).toBeNull()

    act(() => socket.open())

    expect(socket.sentFrames).toEqual([frame])
    expect(hook.result.current.activeSessionId).toBe('s1')
  })

  it('keeps a single generation in flight: a second enqueue waits for the done frame', () => {
    const { hook, socket } = renderReady()
    const frameA = makeGenerateFrame('first')
    const frameB = makeGenerateFrame('second')

    act(() => hook.result.current.enqueueGenerate('s1', frameA))
    act(() => hook.result.current.enqueueGenerate('s2', frameB))

    // only the first frame goes out while s1 is in flight
    expect(socket.sentFrames).toEqual([frameA])
    expect(hook.result.current.activeSessionId).toBe('s1')

    act(() => socket.emit({ type: 'token', text: 'Hi' }))
    act(() => socket.emit({ type: 'done', usage: doneUsage }))

    // done finalizes s1 into the store and dispatches the queued s2
    expect(useChatStore.getState().sessions.s1.messages).toEqual([
      { role: 'assistant', content: 'Hi' },
    ])
    expect(useChatStore.getState().sessions.s1.usage).toEqual(doneUsage)
    expect(socket.sentFrames).toEqual([frameA, frameB])
    expect(hook.result.current.activeSessionId).toBe('s2')

    act(() => socket.emit({ type: 'done', usage: doneUsage }))
    expect(hook.result.current.activeSessionId).toBeNull()
  })

  it('cancelActive sends a cancel frame and flags the active session as cancel-requested', () => {
    const { hook, socket } = renderReady()

    // cancel with nothing in flight is a no-op
    act(() => hook.result.current.cancelActive())
    expect(socket.sentFrames).toHaveLength(0)

    act(() => hook.result.current.enqueueGenerate('s1', makeGenerateFrame('hi')))
    act(() => hook.result.current.cancelActive())

    expect(socket.sentFrames).toHaveLength(2)
    expect(socket.sentFrames[1]).toEqual({ type: 'cancel' })
    expect(useChatStore.getState().sessions.s1.cancelRequested).toBe(true)
  })

  it('errors the active session and clears the active slot when the socket drops mid-stream', () => {
    const { hook, socket } = renderReady()

    act(() => hook.result.current.enqueueGenerate('s1', makeGenerateFrame('hi')))
    act(() => socket.emit({ type: 'token', text: 'partial' }))

    act(() => socket.close())

    const session = useChatStore.getState().sessions.s1
    expect(session.error).toBe('Connection lost')
    expect(session.isGenerating).toBe(false)
    // partial stream is kept so the UI can still show it
    expect(session.streamingText).toBe('partial')
    expect(hook.result.current.activeSessionId).toBeNull()
    expect(hook.result.current.isConnected).toBe(false)
  })

  it('a disconnect with nothing in flight errors no session', () => {
    const { hook, socket } = renderReady()

    act(() => socket.close())

    expect(useChatStore.getState().sessions).toEqual({})
    expect(hook.result.current.isConnected).toBe(false)
  })

  it('resumes queued items over the new socket after a reconnect', () => {
    const { hook, socket } = renderReady()
    const frameA = makeGenerateFrame('adapter half')
    const frameB = makeGenerateFrame('base half')

    act(() => hook.result.current.enqueueGenerate('s1', frameA))
    act(() => hook.result.current.enqueueGenerate('s2', frameB))
    expect(socket.sentFrames).toEqual([frameA])

    act(() => socket.close())

    // in-flight s1 is errored, queued s2 is not
    expect(useChatStore.getState().sessions.s1.error).toBe('Connection lost')
    expect(useChatStore.getState().sessions.s2).toBeUndefined()
    expect(hook.result.current.isConnected).toBe(false)

    // ReconnectingWS retries after the 500ms initial backoff
    act(() => vi.advanceTimersByTime(500))
    expect(MockWebSocket.instances).toHaveLength(2)
    const reconnected = MockWebSocket.instances[1]

    act(() => reconnected.open())

    // reopening resumes the queue without any new enqueue
    expect(hook.result.current.isConnected).toBe(true)
    expect(reconnected.sentFrames).toEqual([frameB])
    expect(hook.result.current.activeSessionId).toBe('s2')
  })

  it('invokes onTrainingActive for a training_active error frame and drops the queue', () => {
    const onTrainingActive = vi.fn()
    const onError = vi.fn()
    const hook = renderHook(() => useChatSocket({ WebSocketImpl, onTrainingActive, onError }))
    const socket = MockWebSocket.instances[0]
    act(() => socket.open())

    const frameA = makeGenerateFrame('first')
    const frameB = makeGenerateFrame('queued half')
    act(() => hook.result.current.enqueueGenerate('s1', frameA))
    act(() => hook.result.current.enqueueGenerate('s2', frameB))

    act(() =>
      socket.emit({ type: 'error', code: 'training_active', message: 'training in progress' }),
    )

    expect(onTrainingActive).toHaveBeenCalledWith('training in progress')
    expect(onError).not.toHaveBeenCalled()
    expect(useChatStore.getState().sessions.s1.error).toBe('training in progress')
    expect(hook.result.current.activeSessionId).toBeNull()

    // the queued frameB was dropped: a fresh enqueue goes out immediately
    // and frameB is never sent
    const frameC = makeGenerateFrame('retry')
    act(() => hook.result.current.enqueueGenerate('s3', frameC))
    expect(socket.sentFrames).toEqual([frameA, frameC])
  })

  it('routes model_not_found to onModelNotFound and other codes to onError', () => {
    const onTrainingActive = vi.fn()
    const onModelNotFound = vi.fn()
    const onError = vi.fn()
    const hook = renderHook(() =>
      useChatSocket({ WebSocketImpl, onTrainingActive, onModelNotFound, onError }),
    )
    const socket = MockWebSocket.instances[0]
    act(() => socket.open())

    act(() => hook.result.current.enqueueGenerate('s1', makeGenerateFrame('hi')))
    act(() =>
      socket.emit({ type: 'error', code: 'model_not_found', message: "model 'x' not found" }),
    )
    expect(onModelNotFound).toHaveBeenCalledWith("model 'x' not found")

    act(() => hook.result.current.enqueueGenerate('s2', makeGenerateFrame('again')))
    act(() => socket.emit({ type: 'error', code: 'internal', message: 'boom' }))
    expect(onError).toHaveBeenCalledWith('boom')
    expect(onTrainingActive).not.toHaveBeenCalled()
  })
})
