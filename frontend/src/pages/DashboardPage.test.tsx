import { describe, expect, it } from 'vitest'
import { renderWithProviders, screen } from '../test/render'
import { server } from '../test/server'
import {
  datasetsHandler,
  emptyDatasetsHandler,
  emptyModelsHandler,
  emptyRunsHandler,
  makeRunSummary,
  runsHandler,
} from '../test/handlers/dashboard'
import { DashboardPage } from './DashboardPage'

describe('DashboardPage', () => {
  it('shows the onboarding guide when there are no models and no runs', async () => {
    server.use(emptyModelsHandler(), emptyRunsHandler(), emptyDatasetsHandler())

    renderWithProviders(<DashboardPage />)

    expect(await screen.findByText('Getting started')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to models' })).toHaveAttribute('href', '/models')
    expect(screen.queryByText('Recent runs')).not.toBeInTheDocument()
  })

  it('shows the active-run/quick-counts row and recent runs list when data exists', async () => {
    server.use(datasetsHandler(), runsHandler([makeRunSummary()]))

    renderWithProviders(<DashboardPage />)

    expect(await screen.findByText('Recent runs')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start new training' })).toHaveAttribute(
      'href',
      '/train',
    )
    expect(screen.queryByText('Getting started')).not.toBeInTheDocument()
  })
})
