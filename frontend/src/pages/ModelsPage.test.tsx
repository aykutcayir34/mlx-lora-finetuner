import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { modelsHandlers } from '../test/handlers/models'
import { ModelsPage } from './ModelsPage'

// The HF search input debounces for 400ms before firing, so result assertions
// use a slightly longer findBy timeout (same convention as ModelSearchPanel.test).
const SEARCH_TIMEOUT = { timeout: 2000 }

async function openSearchTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Search Hugging Face' }))
  return screen.getByPlaceholderText('e.g. Llama-3.2-1B')
}

describe('ModelsPage', () => {
  it('renders local models from GET /models on the default tab', async () => {
    // The global handlers.ts default returns two local models.
    renderWithProviders(<ModelsPage />)

    expect(
      await screen.findByText('mlx-community/SmolLM-135M-Instruct-4bit'),
    ).toBeInTheDocument()
    expect(screen.getByText('mlx-community/Qwen2.5-0.5B-Instruct-4bit')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Local Models' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('shows an empty state whose action jumps to the search tab', async () => {
    const user = userEvent.setup()
    server.use(http.get('/api/v1/models', () => HttpResponse.json({ models: [] })))

    renderWithProviders(<ModelsPage />)

    expect(await screen.findByText('No local models')).toBeInTheDocument()

    // The empty-state action is a plain button (the tab has role="tab", so this
    // targets only the EmptyState action) and must switch the active tab.
    await user.click(screen.getByRole('button', { name: 'Search Hugging Face' }))

    expect(screen.getByRole('tab', { name: 'Search Hugging Face' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByPlaceholderText('e.g. Llama-3.2-1B')).toBeInTheDocument()
  })

  it('searches Hugging Face and reflects the downloaded flag in the results', async () => {
    const user = userEvent.setup()
    server.use(...modelsHandlers)

    renderWithProviders(<ModelsPage />)
    await screen.findByText('mlx-community/SmolLM-135M-Instruct-4bit')

    const queryInput = await openSearchTab(user)
    await user.type(queryInput, 'llama')

    expect(
      await screen.findByText('mlx-community/Llama-3.2-1B-Instruct-4bit', {}, SEARCH_TIMEOUT),
    ).toBeInTheDocument()

    // The already-downloaded result carries a badge and a disabled Download button.
    const downloadedRow = screen
      .getAllByText('mlx-community/SmolLM-135M-Instruct-4bit')
      .map((el) => el.closest('li'))
      .find((li) => li !== null) as HTMLElement
    expect(within(downloadedRow).getByText('Downloaded')).toBeInTheDocument()
    expect(within(downloadedRow).getByRole('button', { name: 'Download' })).toBeDisabled()

    // The not-yet-downloaded result stays actionable.
    const freshRow = screen
      .getByText('mlx-community/Llama-3.2-1B-Instruct-4bit')
      .closest('li') as HTMLElement
    expect(within(freshRow).queryByText('Downloaded')).not.toBeInTheDocument()
    expect(within(freshRow).getByRole('button', { name: 'Download' })).toBeEnabled()
  })

  it('starts a download from search and shows it on the Downloads tab', async () => {
    const user = userEvent.setup()
    server.use(...modelsHandlers)

    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/models/download', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(
          { download_id: 'dl_new', model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit' },
          { status: 202 },
        )
      }),
    )

    renderWithProviders(<ModelsPage />)
    await screen.findByText('mlx-community/SmolLM-135M-Instruct-4bit')

    const queryInput = await openSearchTab(user)
    await user.type(queryInput, 'llama')
    const result = await screen.findByText(
      'mlx-community/Llama-3.2-1B-Instruct-4bit',
      {},
      SEARCH_TIMEOUT,
    )

    await user.click(
      within(result.closest('li') as HTMLElement).getByRole('button', { name: 'Download' }),
    )

    await waitFor(() =>
      expect(capturedBody).toEqual({ model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit' }),
    )
    expect(await screen.findByText(/Started download of/)).toBeInTheDocument()

    // The backend now reports the download. A "completed" status keeps
    // DownloadItem from opening a live WebSocket (only "running" does that),
    // which jsdom cannot service.
    server.use(
      http.get('/api/v1/models/downloads', () =>
        HttpResponse.json({
          downloads: [
            {
              download_id: 'dl_new',
              model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
              status: 'completed',
              bytes_done: 900000000,
              bytes_total: 900000000,
              files_done: 5,
              files_total: 5,
              error: null,
              started_at: '2026-07-12T10:00:00Z',
              finished_at: '2026-07-12T10:05:00Z',
            },
          ],
        }),
      ),
    )

    await user.click(screen.getByRole('tab', { name: 'Downloads' }))

    expect(await screen.findByText('completed')).toBeInTheDocument()
    expect(screen.getByText('mlx-community/Llama-3.2-1B-Instruct-4bit')).toBeInTheDocument()
    expect(screen.getByText('5/5 files')).toBeInTheDocument()
  })

  it('surfaces an error state when /models/search fails with a 502', async () => {
    const user = userEvent.setup()
    // docs/api.md documents 502 code "internal" for Hugging Face failures; the
    // search panel surfaces any search error as a generic inline message.
    server.use(
      http.get('/api/v1/models/search', () =>
        HttpResponse.json(
          { error: { code: 'internal', message: 'HF request failed', detail: {} } },
          { status: 502 },
        ),
      ),
    )

    renderWithProviders(<ModelsPage />)
    await screen.findByText('mlx-community/SmolLM-135M-Instruct-4bit')

    const queryInput = await openSearchTab(user)
    await user.type(queryInput, 'llama')

    expect(await screen.findByText('Search failed.', {}, SEARCH_TIMEOUT)).toBeInTheDocument()
  })

  it('surfaces an error message when the local model list request fails', async () => {
    server.use(
      http.get('/api/v1/models', () =>
        HttpResponse.json(
          { error: { code: 'internal', message: 'boom', detail: {} } },
          { status: 500 },
        ),
      ),
    )

    renderWithProviders(<ModelsPage />)

    expect(await screen.findByText('Failed to load local models.')).toBeInTheDocument()
  })
})
