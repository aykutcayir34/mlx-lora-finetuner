import { describe, expect, it } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/render'
import { server } from '../../test/server'
import { datasetsHandler, defaultDatasets } from '../../test/handlers/dashboard'
import { QuickCounts } from './QuickCounts'

describe('QuickCounts', () => {
  it('renders model and dataset counts linking to their pages', async () => {
    server.use(datasetsHandler(defaultDatasets))

    renderWithProviders(<QuickCounts />)

    // Default MSW handlers.ts seeds 2 models; defaultDatasets seeds 1 dataset.
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
    expect(screen.getByText('1')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /Yerel modeller/ })).toHaveAttribute('href', '/models')
    expect(screen.getByRole('link', { name: /Datasetler/ })).toHaveAttribute('href', '/datasets')
  })
})
