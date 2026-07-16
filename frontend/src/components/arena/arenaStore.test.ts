import { beforeEach, describe, expect, it } from 'vitest'
import { useArenaStore } from './arenaStore'
import type { ArenaSideState } from './arenaStore'

const usage = { prompt_tokens: 10, completion_tokens: 5, tokens_per_sec: 42 }

function freshSide(): ArenaSideState {
  return { messages: [], streamingText: '', status: 'idle', usage: null, error: null }
}

describe('arenaStore', () => {
  beforeEach(() => {
    useArenaStore.setState({ sideA: freshSide(), sideB: freshSide() })
  })

  it('addUserMessage appends the shared prompt to both sides and marks both waiting', () => {
    useArenaStore.getState().addUserMessage('hello there')

    const { sideA, sideB } = useArenaStore.getState()
    for (const side of [sideA, sideB]) {
      expect(side.messages).toEqual([{ role: 'user', content: 'hello there' }])
      expect(side.status).toBe('waiting')
      expect(side.streamingText).toBe('')
      expect(side.usage).toBeNull()
      expect(side.error).toBeNull()
    }
  })

  it('addUserMessage clears stale usage/error from the previous turn but keeps history', () => {
    const store = useArenaStore.getState()
    store.addUserMessage('first')
    store.startSide('a')
    store.appendToken('a', 'reply-a')
    store.finalizeSide('a', usage)
    store.setSideError('b', 'side b broke')

    useArenaStore.getState().addUserMessage('second')

    const { sideA, sideB } = useArenaStore.getState()
    expect(sideA.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply-a' },
      { role: 'user', content: 'second' },
    ])
    expect(sideA.usage).toBeNull()
    expect(sideA.status).toBe('waiting')
    expect(sideB.error).toBeNull()
    expect(sideB.status).toBe('waiting')
  })

  it('startSide moves only the given side from waiting to streaming', () => {
    const store = useArenaStore.getState()
    store.addUserMessage('hi')
    store.startSide('a')

    expect(useArenaStore.getState().sideA.status).toBe('streaming')
    expect(useArenaStore.getState().sideB.status).toBe('waiting')
  })

  it('appendToken accumulates streamingText in order, independently per side', () => {
    const store = useArenaStore.getState()
    store.addUserMessage('hi')
    store.appendToken('a', 'Hel')
    store.appendToken('b', 'Yo')
    store.appendToken('a', 'lo')

    expect(useArenaStore.getState().sideA.streamingText).toBe('Hello')
    expect(useArenaStore.getState().sideB.streamingText).toBe('Yo')
  })

  it('finalizeSide flushes streamed text as an assistant message and records usage', () => {
    const store = useArenaStore.getState()
    store.addUserMessage('hi')
    store.startSide('a')
    store.appendToken('a', 'Hello')
    store.appendToken('a', ' there')
    store.finalizeSide('a', usage)

    const { sideA, sideB } = useArenaStore.getState()
    expect(sideA.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello there' },
    ])
    expect(sideA.streamingText).toBe('')
    expect(sideA.status).toBe('done')
    expect(sideA.usage).toEqual(usage)
    // the other side is untouched
    expect(sideB.status).toBe('waiting')
    expect(sideB.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('finalizeSide with empty streamingText does not add an assistant message', () => {
    const store = useArenaStore.getState()
    store.addUserMessage('hi')
    store.startSide('b')
    store.finalizeSide('b', usage)

    const { sideB } = useArenaStore.getState()
    expect(sideB.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(sideB.status).toBe('done')
  })

  it('setSideError preserves partially streamed text as an assistant message', () => {
    const store = useArenaStore.getState()
    store.addUserMessage('hi')
    store.startSide('a')
    store.appendToken('a', 'partial answ')
    store.setSideError('a', 'Connection lost')

    const { sideA } = useArenaStore.getState()
    expect(sideA.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'partial answ' },
    ])
    expect(sideA.streamingText).toBe('')
    expect(sideA.status).toBe('error')
    expect(sideA.error).toBe('Connection lost')
  })

  it('setSideError without streamed text records the error without adding a message', () => {
    const store = useArenaStore.getState()
    store.addUserMessage('hi')
    store.setSideError('b', "model 'x' not found")

    const { sideB } = useArenaStore.getState()
    expect(sideB.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(sideB.status).toBe('error')
    expect(sideB.error).toBe("model 'x' not found")
  })

  it('resetPending drops waiting/streaming sides back to idle without recording an error', () => {
    const store = useArenaStore.getState()
    store.addUserMessage('hi') // both waiting
    store.startSide('a') // a streaming

    useArenaStore.getState().resetPending()

    const { sideA, sideB } = useArenaStore.getState()
    expect(sideA.status).toBe('idle')
    expect(sideB.status).toBe('idle')
    expect(sideA.error).toBeNull()
    expect(sideB.error).toBeNull()
    // history from the aborted turn is kept
    expect(sideA.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('resetPending leaves done and error sides untouched', () => {
    const store = useArenaStore.getState()
    store.addUserMessage('hi')
    store.appendToken('a', 'answer')
    store.finalizeSide('a', usage)
    store.setSideError('b', 'boom')

    useArenaStore.getState().resetPending()

    const { sideA, sideB } = useArenaStore.getState()
    expect(sideA.status).toBe('done')
    expect(sideA.usage).toEqual(usage)
    expect(sideB.status).toBe('error')
    expect(sideB.error).toBe('boom')
  })

  it('resetPending does not flush partially streamed text (pins current behavior)', () => {
    // Whole-turn errors arrive before any tokens in practice (e.g.
    // training_active is rejected up front), so resetPending only drops the
    // status; any streamed text stays in streamingText rather than being
    // flushed into messages. Pinned here so a behavior change is deliberate.
    const store = useArenaStore.getState()
    store.addUserMessage('hi')
    store.startSide('a')
    store.appendToken('a', 'partial')

    useArenaStore.getState().resetPending()

    const { sideA } = useArenaStore.getState()
    expect(sideA.status).toBe('idle')
    expect(sideA.streamingText).toBe('partial')
    expect(sideA.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('reset returns both sides to the default empty state', () => {
    const store = useArenaStore.getState()
    store.addUserMessage('hi')
    store.startSide('a')
    store.appendToken('a', 'text')
    store.finalizeSide('a', usage)
    store.setSideError('b', 'boom')

    useArenaStore.getState().reset()

    const { sideA, sideB } = useArenaStore.getState()
    for (const side of [sideA, sideB]) {
      expect(side.messages).toEqual([])
      expect(side.streamingText).toBe('')
      expect(side.status).toBe('idle')
      expect(side.usage).toBeNull()
      expect(side.error).toBeNull()
    }
  })
})
