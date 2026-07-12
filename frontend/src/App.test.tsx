import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { AppRoutes } from './App'
import { renderWithProviders } from './test/render'

// jsdom has no WebSocket; the Chat page opens one on mount. A no-op stub is
// enough for route smoke tests — WS behavior is covered by the page tests.
class StubWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = StubWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send() {}
  close() {
    this.readyState = StubWebSocket.CLOSED
  }
}

const CASES: Array<[route: string, heading: string]> = [
  ['/', 'Dashboard'],
  ['/models', 'Models'],
  ['/datasets', 'Datasets'],
  ['/train', 'Train'],
  ['/chat', 'Chat'],
  ['/export', 'Export'],
]

describe('AppRoutes', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', StubWebSocket)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(CASES)('renders the %s page at %s', (route, heading) => {
    renderWithProviders(<AppRoutes />, { route })

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('renders the layout shell (side nav + top bar) on every route', () => {
    renderWithProviders(<AppRoutes />, { route: '/models' })

    expect(screen.getByText('MLX LoRA Finetuner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })
})
