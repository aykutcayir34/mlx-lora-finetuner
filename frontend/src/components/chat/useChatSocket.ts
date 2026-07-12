import { useCallback, useEffect, useRef, useState } from 'react'
import { ReconnectingWS } from '../../api/ws'
import type { ChatWsClientFrame, ChatWsServerFrame } from '../../api/types'
import { useChatStore } from '../../stores/chatStore'

interface QueueItem {
  sessionId: string
  frame: ChatWsClientFrame
}

export interface UseChatSocketOptions {
  /** code === 'training_active' */
  onTrainingActive?: (message: string) => void
  /** code === 'model_not_found' */
  onModelNotFound?: (message: string) => void
  /** any other error code */
  onError?: (message: string) => void
  /** Override for tests; defaults to the global WebSocket constructor. */
  WebSocketImpl?: typeof WebSocket
}

export interface UseChatSocketResult {
  /** Queues a generate frame for sessionId; sent immediately if nothing else is in flight
   *  (the backend serializes generation, so only one `generate` is ever outstanding). */
  enqueueGenerate: (sessionId: string, frame: ChatWsClientFrame) => void
  /** Sends {"type":"cancel"} for the currently in-flight generation, if any. */
  cancelActive: () => void
  /** sessionId of the generation currently streaming, or null if idle. */
  activeSessionId: string | null
}

/**
 * Owns the single persistent WebSocket connection to /api/v1/ws/chat and
 * routes token/done/error frames to the right chatStore session. Multiple
 * `generate` requests (e.g. the two columns of "compare" mode) are queued
 * and sent one at a time, matching the backend's serialized generation.
 */
export function useChatSocket(options: UseChatSocketOptions = {}): UseChatSocketResult {
  const { onTrainingActive, onModelNotFound, onError, WebSocketImpl } = options

  const socketRef = useRef<ReconnectingWS<ChatWsServerFrame> | null>(null)
  const queueRef = useRef<QueueItem[]>([])
  const activeSessionRef = useRef<string | null>(null)
  const connectedRef = useRef(false)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const dispatchNext = useCallback(() => {
    if (activeSessionRef.current) return
    if (!connectedRef.current) return
    const next = queueRef.current.shift()
    if (!next) return
    activeSessionRef.current = next.sessionId
    setActiveSessionId(next.sessionId)
    socketRef.current?.send(next.frame)
  }, [])

  useEffect(() => {
    const socket = new ReconnectingWS<ChatWsServerFrame>({
      path: '/api/v1/ws/chat',
      WebSocketImpl,
      onOpen: () => {
        connectedRef.current = true
        dispatchNext()
      },
      onClose: () => {
        connectedRef.current = false
      },
      onFrame: (frame) => {
        const store = useChatStore.getState()
        switch (frame.type) {
          case 'token': {
            if (activeSessionRef.current) {
              store.appendToken(activeSessionRef.current, frame.text)
            }
            break
          }
          case 'done': {
            if (activeSessionRef.current) {
              store.finalize(activeSessionRef.current, frame.usage)
            }
            activeSessionRef.current = null
            setActiveSessionId(null)
            dispatchNext()
            break
          }
          case 'error': {
            if (activeSessionRef.current) {
              store.setError(activeSessionRef.current, frame.message)
            }
            activeSessionRef.current = null
            setActiveSessionId(null)
            // Drop anything still queued (e.g. the "base" half of a compare
            // request) — the failure applies to this socket/model, not just
            // the in-flight generation, so retrying it blindly would fail too.
            queueRef.current = []
            if (frame.code === 'training_active') {
              onTrainingActive?.(frame.message)
            } else if (frame.code === 'model_not_found') {
              onModelNotFound?.(frame.message)
            } else {
              onError?.(frame.message)
            }
            break
          }
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

  const enqueueGenerate = useCallback(
    (sessionId: string, frame: ChatWsClientFrame) => {
      queueRef.current.push({ sessionId, frame })
      dispatchNext()
    },
    [dispatchNext],
  )

  const cancelActive = useCallback(() => {
    if (!activeSessionRef.current) return
    useChatStore.getState().requestCancel(activeSessionRef.current)
    socketRef.current?.send({ type: 'cancel' })
  }, [])

  return { enqueueGenerate, cancelActive, activeSessionId }
}
