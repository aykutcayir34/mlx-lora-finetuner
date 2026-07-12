import { create } from 'zustand'
import type { ChatMessage } from '../api/types'

export interface ChatSessionState {
  messages: ChatMessage[]
  streamingText: string
  isGenerating: boolean
  cancelRequested: boolean
  usage: { prompt_tokens: number; completion_tokens: number; tokens_per_sec: number } | null
  error: string | null
}

export const defaultChatSessionState: ChatSessionState = {
  messages: [],
  streamingText: '',
  isGenerating: false,
  cancelRequested: false,
  usage: null,
  error: null,
}

export interface ChatState {
  sessions: Record<string, ChatSessionState>

  addUserMessage: (sessionId: string, content: string) => void
  appendToken: (sessionId: string, text: string) => void
  finalize: (sessionId: string, usage: ChatSessionState['usage']) => void
  setError: (sessionId: string, message: string) => void
  requestCancel: (sessionId: string) => void
  reset: (sessionId: string) => void
}

function getSession(sessions: Record<string, ChatSessionState>, sessionId: string): ChatSessionState {
  return sessions[sessionId] ?? defaultChatSessionState
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: {},

  addUserMessage: (sessionId, content) =>
    set((state) => {
      const session = getSession(state.sessions, sessionId)
      const message: ChatMessage = { role: 'user', content }
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            messages: [...session.messages, message],
            isGenerating: true,
            streamingText: '',
            error: null,
            cancelRequested: false,
            usage: null,
          },
        },
      }
    }),

  appendToken: (sessionId, text) =>
    set((state) => {
      const session = getSession(state.sessions, sessionId)
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            streamingText: session.streamingText + text,
          },
        },
      }
    }),

  finalize: (sessionId, usage) =>
    set((state) => {
      const session = getSession(state.sessions, sessionId)
      const messages = session.streamingText
        ? [...session.messages, { role: 'assistant', content: session.streamingText } as ChatMessage]
        : session.messages
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            messages,
            streamingText: '',
            isGenerating: false,
            cancelRequested: false,
            usage,
          },
        },
      }
    }),

  setError: (sessionId, message) =>
    set((state) => {
      const session = getSession(state.sessions, sessionId)
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            error: message,
            isGenerating: false,
            cancelRequested: false,
          },
        },
      }
    }),

  requestCancel: (sessionId) =>
    set((state) => {
      const session = getSession(state.sessions, sessionId)
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            cancelRequested: true,
          },
        },
      }
    }),

  reset: (sessionId) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { ...defaultChatSessionState },
      },
    })),
}))
