import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// A fresh QueryClient per render avoids cross-test cache bleed, and disables
// retries so failed-request tests resolve immediately.
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

interface RenderWithProvidersOptions {
  route?: string
  /** Optional react-router location state for the initial entry. */
  routeState?: unknown
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', routeState }: RenderWithProvidersOptions = {},
) {
  const queryClient = createTestQueryClient()

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: route, state: routeState }]}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  return render(ui, { wrapper: Wrapper })
}

export * from '@testing-library/react'
