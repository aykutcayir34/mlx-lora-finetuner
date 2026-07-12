import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReconnectingWS } from './ws'

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

  // test helpers, not part of the real WebSocket API
  open() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateServerClose() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
}

describe('ReconnectingWS', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the helloFactory frame on connect and on every reconnect', () => {
    const helloFactory = vi.fn(() => ({ last_step: 5 }))
    const ws = new ReconnectingWS({
      path: '/api/v1/ws/train/run_1',
      onFrame: () => {},
      helloFactory,
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    })

    expect(MockWebSocket.instances).toHaveLength(1)
    MockWebSocket.instances[0].open()
    expect(MockWebSocket.instances[0].sent).toEqual([JSON.stringify({ last_step: 5 })])

    // server drops the connection -> should reconnect after backoff and
    // re-send the hello handshake on the new socket
    MockWebSocket.instances[0].simulateServerClose()
    vi.advanceTimersByTime(500)
    expect(MockWebSocket.instances).toHaveLength(2)
    MockWebSocket.instances[1].open()
    expect(MockWebSocket.instances[1].sent).toEqual([JSON.stringify({ last_step: 5 })])

    ws.close()
  })

  it('backs off exponentially from 0.5s, capped at 8s', () => {
    const ws = new ReconnectingWS({
      path: '/api/v1/ws/train/run_1',
      onFrame: () => {},
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    })

    MockWebSocket.instances[0].simulateServerClose()
    vi.advanceTimersByTime(499)
    expect(MockWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(MockWebSocket.instances).toHaveLength(2) // reconnected after 500ms

    MockWebSocket.instances[1].simulateServerClose()
    vi.advanceTimersByTime(999)
    expect(MockWebSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(MockWebSocket.instances).toHaveLength(3) // after 1000ms

    MockWebSocket.instances[2].simulateServerClose()
    vi.advanceTimersByTime(2000)
    expect(MockWebSocket.instances).toHaveLength(4) // after 2000ms

    MockWebSocket.instances[3].simulateServerClose()
    vi.advanceTimersByTime(4000)
    expect(MockWebSocket.instances).toHaveLength(5) // after 4000ms

    MockWebSocket.instances[4].simulateServerClose()
    vi.advanceTimersByTime(8000)
    expect(MockWebSocket.instances).toHaveLength(6) // capped at 8000ms

    MockWebSocket.instances[5].simulateServerClose()
    vi.advanceTimersByTime(8000)
    expect(MockWebSocket.instances).toHaveLength(7) // stays capped

    ws.close()
  })

  it('delivers parsed JSON frames via onFrame', () => {
    const onFrame = vi.fn()
    const ws = new ReconnectingWS({
      path: '/api/v1/ws/train/run_1',
      onFrame,
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    })

    const socket = MockWebSocket.instances[0]
    socket.open()
    socket.onmessage?.({
      data: JSON.stringify({ type: 'status', status: 'running', error: null }),
    })

    expect(onFrame).toHaveBeenCalledWith({ type: 'status', status: 'running', error: null })
    ws.close()
  })

  it('stops reconnecting once closed by the caller', () => {
    const ws = new ReconnectingWS({
      path: '/api/v1/ws/train/run_1',
      onFrame: () => {},
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    })

    ws.close()
    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSED)

    vi.advanceTimersByTime(10000)
    expect(MockWebSocket.instances).toHaveLength(1)
  })
})
