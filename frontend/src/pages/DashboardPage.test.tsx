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

    expect(await screen.findByText('Başlarken')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Modellere git' })).toHaveAttribute('href', '/models')
    expect(screen.queryByText('Son eğitimler')).not.toBeInTheDocument()
  })

  it('shows the active-run/quick-counts row and recent runs list when data exists', async () => {
    server.use(datasetsHandler(), runsHandler([makeRunSummary()]))

    renderWithProviders(<DashboardPage />)

    expect(await screen.findByText('Son eğitimler')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Yeni eğitim başlat' })).toHaveAttribute(
      'href',
      '/train',
    )
    expect(screen.queryByText('Başlarken')).not.toBeInTheDocument()
  })
})
