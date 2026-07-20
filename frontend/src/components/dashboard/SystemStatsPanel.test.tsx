import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderWithProviders, screen, waitFor } from '../../test/render'
import { server } from '../../test/server'
import { SystemStatsPanel } from './SystemStatsPanel'

describe('SystemStatsPanel', () => {
  it('renders memory percentage and disk breakdown from default MSW data', async () => {
    renderWithProviders(<SystemStatsPanel />)

    await waitFor(() => expect(screen.getByText('12.3 GB / 32.0 GB')).toBeInTheDocument())
    // memory % = 12.3 / 32 * 100 = 38.4375 -> rounds to 38
    expect(screen.getByText('38%')).toBeInTheDocument()
    expect(screen.getByText('4.2 GB')).toBeInTheDocument() // models disk usage
    expect(screen.getByText('210.5 GB')).toBeInTheDocument() // free space
  })

  it('renders the backend health chip with app and library versions', async () => {
    renderWithProviders(<SystemStatsPanel />)

    expect(await screen.findByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText(/0\.20\.0/)).toBeInTheDocument()
  })

  it('degrades gracefully when the backend is unreachable', async () => {
    server.use(
      http.get('/api/v1/system/health', () => HttpResponse.error()),
      http.get('/api/v1/system/stats', () => HttpResponse.error()),
    )

    renderWithProviders(<SystemStatsPanel />)

    expect(await screen.findByText('Unreachable')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0))
  })
})
