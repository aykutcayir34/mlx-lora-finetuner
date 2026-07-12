import { describe, expect, it } from 'vitest'
import { useChatStore } from './chatStore'

let counter = 0
function freshSessionId(): string {
  counter += 1
  return `test-session-${counter}`
}

describe('chatStore', () => {
  it('addUserMessage adds a user message and sets isGenerating=true', () => {
    const sessionId = freshSessionId()
    useChatStore.getState().addUserMessage(sessionId, 'hello there')
    const session = useChatStore.getState().sessions[sessionId]
    expect(session.messages).toEqual([{ role: 'user', content: 'hello there' }])
    expect(session.isGenerating).toBe(true)
  })

  it('accumulates streamingText in order across several appendToken calls', () => {
    const sessionId = freshSessionId()
    const store = useChatStore.getState()
    store.addUserMessage(sessionId, 'hi')
    store.appendToken(sessionId, 'Hel')
    store.appendToken(sessionId, 'lo')
    store.appendToken(sessionId, ', world')
    expect(useChatStore.getState().sessions[sessionId].streamingText).toBe('Hello, world')
  })

  it('finalize moves streamingText into messages as an assistant message and resets state', () => {
    const sessionId = freshSessionId()
    const store = useChatStore.getState()
    store.addUserMessage(sessionId, 'hi')
    store.appendToken(sessionId, 'Hello')
    store.appendToken(sessionId, ' there')

    const usage = { prompt_tokens: 10, completion_tokens: 5, tokens_per_sec: 42 }
    store.finalize(sessionId, usage)

    const session = useChatStore.getState().sessions[sessionId]
    expect(session.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello there' },
    ])
    expect(session.streamingText).toBe('')
    expect(session.usage).toEqual(usage)
    expect(session.isGenerating).toBe(false)
    expect(session.cancelRequested).toBe(false)
  })

  it('finalize with empty streamingText does not add an assistant message', () => {
    const sessionId = freshSessionId()
    const store = useChatStore.getState()
    store.addUserMessage(sessionId, 'hi')
    store.finalize(sessionId, null)
    const session = useChatStore.getState().sessions[sessionId]
    expect(session.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(session.isGenerating).toBe(false)
  })

  it('setError sets error and isGenerating=false without touching accumulated messages', () => {
    const sessionId = freshSessionId()
    const store = useChatStore.getState()
    store.addUserMessage(sessionId, 'hi')
    store.appendToken(sessionId, 'partial')
    store.setError(sessionId, 'something broke')

    const session = useChatStore.getState().sessions[sessionId]
    expect(session.error).toBe('something broke')
    expect(session.isGenerating).toBe(false)
    expect(session.cancelRequested).toBe(false)
    expect(session.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(session.streamingText).toBe('partial')
  })

  it('requestCancel sets cancelRequested=true', () => {
    const sessionId = freshSessionId()
    const store = useChatStore.getState()
    store.addUserMessage(sessionId, 'hi')
    store.requestCancel(sessionId)
    expect(useChatStore.getState().sessions[sessionId].cancelRequested).toBe(true)
    expect(useChatStore.getState().sessions[sessionId].isGenerating).toBe(true)
  })

  it('actions on a never-created session id lazily initialize and do not affect other sessions', () => {
    const sessionA = freshSessionId()
    const sessionB = freshSessionId()

    useChatStore.getState().appendToken(sessionA, 'lazy init')

    const sessionAState = useChatStore.getState().sessions[sessionA]
    expect(sessionAState.streamingText).toBe('lazy init')

    const sessionBState = useChatStore.getState().sessions[sessionB]
    expect(sessionBState).toBeUndefined()
  })

  it('reset(sessionId) resets that session back to default empty state', () => {
    const sessionId = freshSessionId()
    const store = useChatStore.getState()
    store.addUserMessage(sessionId, 'hi')
    store.appendToken(sessionId, 'partial')
    store.reset(sessionId)

    const session = useChatStore.getState().sessions[sessionId]
    expect(session.messages).toEqual([])
    expect(session.streamingText).toBe('')
    expect(session.isGenerating).toBe(false)
    expect(session.cancelRequested).toBe(false)
    expect(session.usage).toBeNull()
    expect(session.error).toBeNull()
  })
})
