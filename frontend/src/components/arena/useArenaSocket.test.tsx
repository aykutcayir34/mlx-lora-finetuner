import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useArenaSocket } from './useArenaSocket'
import { useArenaStore } from './arenaStore'
import type { ArenaSideState } from './arenaStore'
import type { ArenaWsClientFrame } from '../../api/types'

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

function freshSide(): ArenaSideState {
  return { messages: [], streamingText: '', status: 'idle', usage: null, error: null }
}

function makeGenerateFrame(content: string): Extract<ArenaWsClientFrame, { type: 'generate' }> {
  return {
    type: 'generate',
    side_a: { model_id: 'mlx-community/SmolLM-135M-Instruct-4bit', adapter_path: null },
    side_b: { model_id: 'mlx-community/Qwen2.5-0.5B-Instruct-4bit', adapter_path: null },
    messages: [{ role: 'user', content }],
    params: { max_tokens: 512, temperature: 0.7, top_p: 0.9, repetition_penalty: null },
  }
}

const usage = { prompt_tokens: 10, completion_tokens: 5, tokens_per_sec: 42 }

describe('useArenaSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.useFakeTimers()
    useArenaStore.setState({ sideA: freshSide(), sideB: freshSide() })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderReady(options: Parameters<typeof useArenaSocket>[0] = {}) {
    const hook = renderHook(() => useArenaSocket({ WebSocketImpl, ...options }))
    expect(MockWebSocket.instances).toHaveLength(1)
    const socket = MockWebSocket.instances[0]
    act(() => socket.open())
    return { hook, socket }
  }

  it('sendGenerate flips isGenerating and sends the generate frame', () => {
    const { hook, socket } = renderReady()
    expect(hook.result.current.isGenerating).toBe(false)

    const frame = makeGenerateFrame('hello')
    act(() => hook.result.current.sendGenerate(frame))

    expect(hook.result.current.isGenerating).toBe(true)
    expect(socket.sentFrames).toEqual([frame])
  })

  it('routes side_start/token/side_done into the store and resets isGenerating on done', () => {
    const { hook, socket } = renderReady()
    useArenaStore.getState().addUserMessage('hi')
    act(() => hook.result.current.sendGenerate(makeGenerateFrame('hi')))

    act(() => socket.emit({ type: 'side_start', side: 'a' }))
    expect(useArenaStore.getState().sideA.status).toBe('streaming')

    act(() => socket.emit({ type: 'token', side: 'a', text: 'Hel' }))
    act(() => socket.emit({ type: 'token', side: 'a', text: 'lo' }))
    expect(useArenaStore.getState().sideA.streamingText).toBe('Hello')

    act(() => socket.emit({ type: 'side_done', side: 'a', usage }))
    expect(useArenaStore.getState().sideA.status).toBe('done')
    expect(useArenaStore.getState().sideA.usage).toEqual(usage)
    expect(useArenaStore.getState().sideA.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello' },
    ])

    // still generating until the whole-turn done frame
    expect(hook.result.current.isGenerating).toBe(true)

    act(() => socket.emit({ type: 'side_done', side: 'b', usage }))
    act(() => socket.emit({ type: 'done' }))
    expect(hook.result.current.isGenerating).toBe(false)
  })

  it('a per-side error frame errors that side in the store and keeps the turn going', () => {
    const { hook, socket } = renderReady()
    useArenaStore.getState().addUserMessage('hi')
    act(() => hook.result.current.sendGenerate(makeGenerateFrame('hi')))

    act(() =>
      socket.emit({
        type: 'error',
        side: 'a',
        code: 'model_not_found',
        message: "model 'x' not found",
      }),
    )

    expect(useArenaStore.getState().sideA.status).toBe('error')
    expect(useArenaStore.getState().sideA.error).toBe("model 'x' not found")
    expect(useArenaStore.getState().sideB.status).toBe('waiting')
    // side b still streams and a whole-turn done frame is still expected
    expect(hook.result.current.isGenerating).toBe(true)

    act(() => socket.emit({ type: 'done' }))
    expect(hook.result.current.isGenerating).toBe(false)
  })

  it('a whole-turn training_active error resets pending sides and invokes onTrainingActive', () => {
    const onTrainingActive = vi.fn()
    const onError = vi.fn()
    const { hook, socket } = renderReady({ onTrainingActive, onError })
    useArenaStore.getState().addUserMessage('hi')
    act(() => hook.result.current.sendGenerate(makeGenerateFrame('hi')))

    act(() =>
      socket.emit({
        type: 'error',
        side: null,
        code: 'training_active',
        message: 'training in progress',
      }),
    )

    expect(onTrainingActive).toHaveBeenCalledWith('training in progress')
    expect(onError).not.toHaveBeenCalled()
    expect(hook.result.current.isGenerating).toBe(false)
    // pending sides are dropped to idle without a per-side error
    expect(useArenaStore.getState().sideA.status).toBe('idle')
    expect(useArenaStore.getState().sideB.status).toBe('idle')
    expect(useArenaStore.getState().sideA.error).toBeNull()
    expect(useArenaStore.getState().sideB.error).toBeNull()
  })

  it('a whole-turn error with any other code invokes onError', () => {
    const onTrainingActive = vi.fn()
    const onError = vi.fn()
    const { hook, socket } = renderReady({ onTrainingActive, onError })
    useArenaStore.getState().addUserMessage('hi')
    act(() => hook.result.current.sendGenerate(makeGenerateFrame('hi')))

    act(() => socket.emit({ type: 'error', side: null, code: 'internal', message: 'boom' }))

    expect(onError).toHaveBeenCalledWith('boom')
    expect(onTrainingActive).not.toHaveBeenCalled()
    expect(hook.result.current.isGenerating).toBe(false)
  })

  it('cancel sends a cancel frame', () => {
    const { hook, socket } = renderReady()
    act(() => hook.result.current.sendGenerate(makeGenerateFrame('hi')))

    act(() => hook.result.current.cancel())

    expect(socket.sentFrames).toHaveLength(2)
    expect(socket.sentFrames[1]).toEqual({ type: 'cancel' })
  })

  it('errors pending sides via the store and resets isGenerating when the socket drops mid-generation', () => {
    const { hook, socket } = renderReady()
    useArenaStore.getState().addUserMessage('hi')
    act(() => hook.result.current.sendGenerate(makeGenerateFrame('hi')))
    act(() => socket.emit({ type: 'side_start', side: 'a' }))
    act(() => socket.emit({ type: 'token', side: 'a', text: 'Par' }))

    act(() => socket.close())

    const { sideA, sideB } = useArenaStore.getState()
    // streaming side a: partial text flushed as a message, then errored
    expect(sideA.status).toBe('error')
    expect(sideA.error).toBe('Connection lost')
    expect(sideA.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Par' },
    ])
    // still-waiting side b is errored too
    expect(sideB.status).toBe('error')
    expect(sideB.error).toBe('Connection lost')

    expect(hook.result.current.isGenerating).toBe(false)
    expect(hook.result.current.isConnected).toBe(false)
  })

  it('a disconnect while idle errors nothing and isConnected recovers on reconnect', () => {
    const { hook, socket } = renderReady()

    act(() => socket.close())

    expect(hook.result.current.isConnected).toBe(false)
    expect(useArenaStore.getState().sideA.status).toBe('idle')
    expect(useArenaStore.getState().sideB.status).toBe('idle')
    expect(useArenaStore.getState().sideA.error).toBeNull()
    expect(useArenaStore.getState().sideB.error).toBeNull()

    // ReconnectingWS retries after the 500ms initial backoff
    act(() => vi.advanceTimersByTime(500))
    expect(MockWebSocket.instances).toHaveLength(2)
    act(() => MockWebSocket.instances[1].open())
    expect(hook.result.current.isConnected).toBe(true)
  })

  it('a disconnect after the turn completed does not error the finished sides', () => {
    const { hook, socket } = renderReady()
    useArenaStore.getState().addUserMessage('hi')
    act(() => hook.result.current.sendGenerate(makeGenerateFrame('hi')))
    act(() => socket.emit({ type: 'side_done', side: 'a', usage }))
    act(() => socket.emit({ type: 'side_done', side: 'b', usage }))
    act(() => socket.emit({ type: 'done' }))

    act(() => socket.close())

    expect(hook.result.current.isConnected).toBe(false)
    expect(useArenaStore.getState().sideA.status).toBe('done')
    expect(useArenaStore.getState().sideB.status).toBe('done')
    expect(useArenaStore.getState().sideA.error).toBeNull()
    expect(useArenaStore.getState().sideB.error).toBeNull()
  })
})
