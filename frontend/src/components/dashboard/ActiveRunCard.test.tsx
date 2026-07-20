import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/render'
import { server } from '../../test/server'
import { makeRunSummary, metricsHandler, runHandler } from '../../test/handlers/dashboard'
import { ActiveRunCard } from './ActiveRunCard'

// Recharts' ResponsiveContainer measures its DOM node via ResizeObserver +
// getBoundingClientRect, both of which jsdom leaves at zero size. Stubbing
// them (same approach as LossChart.test.tsx) lets the chart render its SVG.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 500, height: 300, top: 0, left: 0, bottom: 300, right: 500, x: 0, y: 0 }) as DOMRect
})

afterAll(() => {
  vi.unstubAllGlobals()
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
})

describe('ActiveRunCard', () => {
  it('renders a quick-start CTA linking to /train when idle', () => {
    renderWithProviders(<ActiveRunCard activeRunId={null} />)

    const link = screen.getByRole('link', { name: 'Start new training' })
    expect(link).toHaveAttribute('href', '/train')
  })

  it('renders run name, status badge and a metrics chart when a run is active', async () => {
    const run = makeRunSummary({ run_id: 'run_active', name: 'active-run', status: 'running' })
    server.use(runHandler(run), metricsHandler('run_active'))

    renderWithProviders(<ActiveRunCard activeRunId="run_active" />)

    expect(await screen.findByText('active-run')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Go to monitor' })
    expect(link).toHaveAttribute('href', '/train')

    await waitFor(() => expect(screen.getByText('Train loss')).toBeInTheDocument())
  })
})
