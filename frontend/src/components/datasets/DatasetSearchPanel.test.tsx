import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, screen, waitFor, within } from '../../test/render'
import { server } from '../../test/server'
import { ToastProvider } from '../common/Toast'
import { sampleSearchResult, searchDatasetsHandler } from '../../test/handlers/datasets'
import { DatasetSearchPanel } from './DatasetSearchPanel'
import type { AutoSplitConfig } from './ImportDatasetDialog'

function renderPanel(onImportQueued: (importId: string, autoSplit: AutoSplitConfig | null) => void = () => {}) {
  return renderWithProviders(
    <ToastProvider>
      <DatasetSearchPanel onImportQueued={onImportQueued} />
    </ToastProvider>,
  )
}

describe('DatasetSearchPanel', () => {
  it('shows a prompt before any query is typed', () => {
    renderPanel()
    expect(screen.getByText('Search Hugging Face')).toBeInTheDocument()
  })

  it('renders search results with downloads/likes and an Imported badge', async () => {
    const user = userEvent.setup()
    server.use(searchDatasetsHandler([{ ...sampleSearchResult, imported: true }]))

    renderPanel()

    await user.type(screen.getByPlaceholderText('e.g. wikisql'), 'wikisql')
    await screen.findByText(sampleSearchResult.dataset_id, {}, { timeout: 2000 })

    expect(screen.getByText(/1,234 downloads/)).toBeInTheDocument()
    expect(screen.getByText('Imported')).toBeInTheDocument()
  })

  it('opens the import dialog when "Import" is clicked', async () => {
    const user = userEvent.setup()
    server.use(searchDatasetsHandler([sampleSearchResult]))

    renderPanel()

    await user.type(screen.getByPlaceholderText('e.g. wikisql'), 'wikisql')
    await screen.findByText(sampleSearchResult.dataset_id, {}, { timeout: 2000 })

    await user.click(screen.getByRole('button', { name: 'Import' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Import dataset')).toBeInTheDocument()
    expect(within(dialog).getByText(sampleSearchResult.dataset_id)).toBeInTheDocument()
  })

  it('submits the correct body to POST /datasets/import and reports the auto-split config', async () => {
    const user = userEvent.setup()
    server.use(searchDatasetsHandler([sampleSearchResult]))
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/datasets/import', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(
          { import_id: 'di_1', dataset_id: sampleSearchResult.dataset_id },
          { status: 202 },
        )
      }),
    )

    let queued: [string, AutoSplitConfig | null] | null = null
    renderPanel((importId, autoSplit) => {
      queued = [importId, autoSplit]
    })

    await user.type(screen.getByPlaceholderText('e.g. wikisql'), 'wikisql')
    await screen.findByText(sampleSearchResult.dataset_id, {}, { timeout: 2000 })
    await user.click(screen.getByRole('button', { name: 'Import' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))

    await waitFor(() =>
      expect(capturedBody).toEqual({
        dataset_id: sampleSearchResult.dataset_id,
        config: null,
        split: 'train',
        name: null,
        max_rows: 5000,
      }),
    )
    await waitFor(() =>
      expect(queued).toEqual(['di_1', { train: 0.8, valid: 0.1, test: 0.1, seed: 42, shuffle: true }]),
    )
  })
})
