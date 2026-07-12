import { useCallback, useEffect, useRef, useState } from 'react'
import { ReconnectingWS } from '../../api/ws'
import type { ArenaWsClientFrame, ArenaWsServerFrame } from '../../api/types'
import { useArenaStore } from './arenaStore'

export interface UseArenaSocketOptions {
  /** code === 'training_active' (a whole-turn, side: null error) */
  onTrainingActive?: (message: string) => void
  /** any other whole-turn (side: null) error */
  onError?: (message: string) => void
  /** Override for tests; defaults to the global WebSocket constructor. */
  WebSocketImpl?: typeof WebSocket
}

export interface UseArenaSocketResult {
  /** Sends a `generate` frame carrying both side specs + shared params. */
  sendGenerate: (frame: Extract<ArenaWsClientFrame, { type: 'generate' }>) => void
  /** Sends `{"type":"cancel"}` — aborts whichever side is in flight. */
  cancel: () => void
  /** True from the moment `generate` is sent until the `done` frame arrives. */
  isGenerating: boolean
}

/**
 * Owns the single persistent WebSocket connection to /api/v1/ws/arena and
 * routes side-tagged frames into arenaStore. Only one `generate` turn is
 * ever in flight (the backend streams side "a" then side "b" sequentially
 * on the same socket), so there is no per-session queue like useChatSocket's.
 */
export function useArenaSocket(options: UseArenaSocketOptions = {}): UseArenaSocketResult {
  const { onTrainingActive, onError, WebSocketImpl } = options

  const socketRef = useRef<ReconnectingWS<ArenaWsServerFrame> | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  useEffect(() => {
    const socket = new ReconnectingWS<ArenaWsServerFrame>({
      path: '/api/v1/ws/arena',
      WebSocketImpl,
      onFrame: (frame) => {
        const store = useArenaStore.getState()
        switch (frame.type) {
          case 'side_start':
            store.startSide(frame.side)
            break
          case 'token':
            store.appendToken(frame.side, frame.text)
            break
          case 'side_done':
            store.finalizeSide(frame.side, frame.usage)
            break
          case 'error': {
            if (frame.side !== null) {
              store.setSideError(frame.side, frame.message)
              break
            }
            store.resetPending()
            setIsGenerating(false)
            if (frame.code === 'training_active') {
              onTrainingActive?.(frame.message)
            } else {
              onError?.(frame.message)
            }
            break
          }
          case 'done':
            setIsGenerating(false)
            break
        }
      },
    })
    socketRef.current = socket

    return () => {
      socket.close()
      socketRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- socket is created once per mount
  }, [])

  const sendGenerate = useCallback((frame: Extract<ArenaWsClientFrame, { type: 'generate' }>) => {
    setIsGenerating(true)
    socketRef.current?.send(frame)
  }, [])

  const cancel = useCallback(() => {
    socketRef.current?.send({ type: 'cancel' })
  }, [])

  return { sendGenerate, cancel, isGenerating }
}
