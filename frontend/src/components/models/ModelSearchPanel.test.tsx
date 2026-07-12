import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, screen, waitFor } from '../../test/render'
import { server } from '../../test/server'
import { ToastProvider } from '../common/Toast'
import { modelsHandlers } from '../../test/handlers/models'
import { ModelSearchPanel } from './ModelSearchPanel'

function renderPanel() {
  return renderWithProviders(
    <ToastProvider>
      <ModelSearchPanel />
    </ToastProvider>,
  )
}

describe('ModelSearchPanel', () => {
  it('shows a prompt before any query is typed', () => {
    renderPanel()
    expect(screen.getByText('Search Hugging Face')).toBeInTheDocument()
  })

  it('debounces the search query before calling GET /models/search', async () => {
    let searchRequestCount = 0
    server.use(
      http.get('/api/v1/models/search', () => {
        searchRequestCount += 1
        return HttpResponse.json({
          results: [
            {
              model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
              downloads: 12345,
              likes: 42,
              size_bytes: 900000000,
              downloaded: false,
            },
          ],
        })
      }),
    )

    const user = userEvent.setup()
    renderPanel()

    const input = screen.getByPlaceholderText('e.g. Llama-3.2-1B')
    await user.type(input, 'llama')

    // Right after typing, the debounce window (400ms) hasn't elapsed yet, so
    // no request should have fired and no results should be rendered.
    expect(searchRequestCount).toBe(0)
    expect(screen.queryByText('mlx-community/Llama-3.2-1B-Instruct-4bit')).not.toBeInTheDocument()

    // After the debounce window elapses, exactly one request is made for the
    // final value, not one per keystroke.
    await waitFor(
      () => expect(screen.getByText('mlx-community/Llama-3.2-1B-Instruct-4bit')).toBeInTheDocument(),
      { timeout: 2000 },
    )
    expect(searchRequestCount).toBe(1)
  })

  it('shows a Downloaded badge for models already downloaded, and POSTs a download request', async () => {
    const user = userEvent.setup()
    server.use(...modelsHandlers)
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/models/download', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(
          { download_id: 'dl_1', model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit' },
          { status: 202 },
        )
      }),
    )

    renderPanel()

    await user.type(screen.getByPlaceholderText('e.g. Llama-3.2-1B'), 'llama')
    await screen.findByText('mlx-community/Llama-3.2-1B-Instruct-4bit', {}, { timeout: 2000 })

    expect(screen.getByText('Downloaded')).toBeInTheDocument()

    const downloadButtons = screen.getAllByRole('button', { name: 'Download' })
    await user.click(downloadButtons[0])

    await waitFor(() =>
      expect(capturedBody).toEqual({ model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit' }),
    )
    expect(await screen.findByText(/Started download of/)).toBeInTheDocument()
  })

  it('shows a conflict error toast when the download request fails', async () => {
    const user = userEvent.setup()
    server.use(...modelsHandlers)
    server.use(
      http.post('/api/v1/models/download', () =>
        HttpResponse.json(
          { error: { code: 'conflict', message: 'Already downloading.', detail: {} } },
          { status: 409 },
        ),
      ),
    )

    renderPanel()

    await user.type(screen.getByPlaceholderText('e.g. Llama-3.2-1B'), 'llama')
    await screen.findByText('mlx-community/Llama-3.2-1B-Instruct-4bit', {}, { timeout: 2000 })

    const downloadButtons = screen.getAllByRole('button', { name: 'Download' })
    await user.click(downloadButtons[0])

    expect(
      await screen.findByText('This model is already downloading or already downloaded.'),
    ).toBeInTheDocument()
  })
})
