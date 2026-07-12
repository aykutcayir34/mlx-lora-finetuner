const MIN_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 8000

export interface ReconnectingWSOptions<T> {
  /** Path relative to the current origin, e.g. "/api/v1/ws/train/run_123". */
  path: string
  /** Called with each parsed JSON frame received from the server. */
  onFrame: (frame: T) => void
  /** Produces the first frame to send on every (re)connection, if the protocol needs a handshake. */
  helloFactory?: () => unknown
  /** Called whenever the socket transitions open/closed, useful for UI status. */
  onOpen?: () => void
  onClose?: () => void
  /** Override for tests; defaults to the global WebSocket constructor. */
  WebSocketImpl?: typeof WebSocket
}

/**
 * A small WebSocket wrapper that reconnects with exponential backoff
 * (0.5s -> 8s cap) and re-sends an optional "hello" handshake frame on
 * every (re)connection, e.g. the `{ last_step }` backfill handshake used
 * by `/ws/train/{run_id}`.
 */
export class ReconnectingWS<T = unknown> {
  private readonly path: string
  private readonly onFrame: (frame: T) => void
  private readonly helloFactory?: () => unknown
  private readonly onOpen?: () => void
  private readonly onClose?: () => void
  private readonly WebSocketImpl: typeof WebSocket

  private socket: WebSocket | null = null
  private backoffMs = MIN_BACKOFF_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closedByUser = false

  constructor(options: ReconnectingWSOptions<T>) {
    this.path = options.path
    this.onFrame = options.onFrame
    this.helloFactory = options.helloFactory
    this.onOpen = options.onOpen
    this.onClose = options.onClose
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket
    this.connect()
  }

  private buildUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}${this.path}`
  }

  private connect(): void {
    if (this.closedByUser) return

    const socket = new this.WebSocketImpl(this.buildUrl())
    this.socket = socket

    socket.onopen = () => {
      this.backoffMs = MIN_BACKOFF_MS
      if (this.helloFactory) {
        this.send(this.helloFactory())
      }
      this.onOpen?.()
    }

    socket.onmessage = (event: MessageEvent) => {
      try {
        const frame = JSON.parse(event.data as string) as T
        this.onFrame(frame)
      } catch {
        // ignore malformed frames
      }
    }

    socket.onclose = () => {
      this.onClose?.()
      if (this.closedByUser) return
      this.scheduleReconnect()
    }

    socket.onerror = () => {
      socket.close()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
      this.connect()
    }, this.backoffMs)
  }

  send(data: unknown): void {
    if (this.socket?.readyState === this.WebSocketImpl.OPEN) {
      this.socket.send(typeof data === 'string' ? data : JSON.stringify(data))
    }
  }

  close(): void {
    this.closedByUser = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.socket?.close()
  }
}
