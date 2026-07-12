import { create } from 'zustand'
import type { ArenaSide, ChatMessage } from '../../api/types'

export type ArenaSideStatus = 'idle' | 'waiting' | 'streaming' | 'done' | 'error'

export interface ArenaSideState {
  messages: ChatMessage[]
  streamingText: string
  status: ArenaSideStatus
  usage: { prompt_tokens: number; completion_tokens: number; tokens_per_sec: number } | null
  error: string | null
}

const defaultSideState: ArenaSideState = {
  messages: [],
  streamingText: '',
  status: 'idle',
  usage: null,
  error: null,
}

export interface ArenaState {
  sideA: ArenaSideState
  sideB: ArenaSideState

  /** Appends the shared user prompt to both sides and marks both "waiting". */
  addUserMessage: (content: string) => void
  startSide: (side: ArenaSide) => void
  appendToken: (side: ArenaSide, text: string) => void
  finalizeSide: (side: ArenaSide, usage: ArenaSideState['usage']) => void
  setSideError: (side: ArenaSide, message: string) => void
  /** Called on a whole-turn (side: null) error — drops the "waiting"/"streaming"
   *  state on both sides without recording a per-side error. */
  resetPending: () => void
  reset: () => void
}

function withStreamingFlushed(side: ArenaSideState): ChatMessage[] {
  return side.streamingText
    ? [...side.messages, { role: 'assistant', content: side.streamingText } as ChatMessage]
    : side.messages
}

function droppedIfPending(side: ArenaSideState): ArenaSideState {
  return side.status === 'waiting' || side.status === 'streaming' ? { ...side, status: 'idle' } : side
}

export const useArenaStore = create<ArenaState>((set) => ({
  sideA: { ...defaultSideState },
  sideB: { ...defaultSideState },

  addUserMessage: (content) =>
    set((state) => {
      const message: ChatMessage = { role: 'user', content }
      const pending = (side: ArenaSideState): ArenaSideState => ({
        ...side,
        messages: [...side.messages, message],
        streamingText: '',
        status: 'waiting',
        usage: null,
        error: null,
      })
      return { sideA: pending(state.sideA), sideB: pending(state.sideB) }
    }),

  startSide: (side) =>
    set((state) =>
      side === 'a'
        ? { sideA: { ...state.sideA, status: 'streaming' } }
        : { sideB: { ...state.sideB, status: 'streaming' } },
    ),

  appendToken: (side, text) =>
    set((state) =>
      side === 'a'
        ? { sideA: { ...state.sideA, streamingText: state.sideA.streamingText + text } }
        : { sideB: { ...state.sideB, streamingText: state.sideB.streamingText + text } },
    ),

  finalizeSide: (side, usage) =>
    set((state) => {
      if (side === 'a') {
        const messages = withStreamingFlushed(state.sideA)
        return { sideA: { ...state.sideA, messages, streamingText: '', status: 'done', usage } }
      }
      const messages = withStreamingFlushed(state.sideB)
      return { sideB: { ...state.sideB, messages, streamingText: '', status: 'done', usage } }
    }),

  setSideError: (side, message) =>
    set((state) => {
      if (side === 'a') {
        const messages = withStreamingFlushed(state.sideA)
        return {
          sideA: { ...state.sideA, messages, streamingText: '', status: 'error', error: message },
        }
      }
      const messages = withStreamingFlushed(state.sideB)
      return {
        sideB: { ...state.sideB, messages, streamingText: '', status: 'error', error: message },
      }
    }),

  resetPending: () =>
    set((state) => ({
      sideA: droppedIfPending(state.sideA),
      sideB: droppedIfPending(state.sideB),
    })),

  reset: () => set({ sideA: { ...defaultSideState }, sideB: { ...defaultSideState } }),
}))
