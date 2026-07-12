import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { act } from '@testing-library/react'
import { renderWithProviders, screen, waitFor } from '../../test/render'
import { server } from '../../test/server'
import { ToastProvider } from '../common/Toast'
import { DownloadsSection } from './DownloadsSection'

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  sent: unknown[] = []
  url: string

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: unknown) {
    this.sent.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  open() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }
}

function renderSection() {
  return renderWithProviders(
    <ToastProvider>
      <DownloadsSection WebSocketImpl={MockWebSocket as unknown as typeof WebSocket} />
    </ToastProvider>,
  )
}

function runningDownload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    download_id: 'dl_1',
    model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
    status: 'running',
    bytes_done: 250000,
    bytes_total: 1000000,
    files_done: 2,
    files_total: 10,
    error: null,
    started_at: '2026-07-12T10:00:00Z',
    finished_at: null,
    ...overrides,
  }
}

describe('DownloadsSection', () => {
  it('shows an empty state when there are no downloads', async () => {
    server.use(http.get('/api/v1/models/downloads', () => HttpResponse.json({ downloads: [] })))
    renderSection()
    expect(await screen.findByText('No downloads')).toBeInTheDocument()
  })

  it('renders progress from the polled DownloadInfo', async () => {
    MockWebSocket.instances = []
    server.use(
      http.get('/api/v1/models/downloads', () => HttpResponse.json({ downloads: [runningDownload()] })),
    )

    renderSection()

    expect(await screen.findByText('2/10 files')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  })

  it('updates progress when a WS progress frame arrives', async () => {
    MockWebSocket.instances = []
    server.use(
      http.get('/api/v1/models/downloads', () => HttpResponse.json({ downloads: [runningDownload()] })),
    )

    renderSection()
    await screen.findByText('2/10 files')

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1))
    const socket = MockWebSocket.instances[0]
    act(() => {
      socket.open()
      socket.onmessage?.({
        data: JSON.stringify({
          type: 'progress',
          bytes_done: 750000,
          bytes_total: 1000000,
          files_done: 8,
          files_total: 10,
        }),
      })
    })

    expect(await screen.findByText('8/10 files')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75')
  })

  it('retries a failed download by POSTing /models/download again', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/api/v1/models/downloads', () =>
        HttpResponse.json({
          downloads: [
            runningDownload({
              status: 'failed',
              error: 'Connection reset',
              finished_at: '2026-07-12T10:05:00Z',
            }),
          ],
        }),
      ),
    )
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/models/download', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(
          { download_id: 'dl_2', model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit' },
          { status: 202 },
        )
      }),
    )

    renderSection()

    expect(await screen.findByText('Connection reset')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry (resumes)' }))

    await waitFor(() =>
      expect(capturedBody).toEqual({ model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit' }),
    )
  })

  it('cancels a running download by POSTing the cancel endpoint', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/api/v1/models/downloads', () => HttpResponse.json({ downloads: [runningDownload()] })),
    )
    let capturedDownloadId: string | null = null
    server.use(
      http.post('/api/v1/models/downloads/:downloadId/cancel', ({ params }) => {
        capturedDownloadId = params.downloadId as string
        return HttpResponse.json(
          { ...runningDownload(), status: 'cancelled', finished_at: '2026-07-12T10:05:00Z' },
          { status: 202 },
        )
      }),
    )

    renderSection()

    await screen.findByText('2/10 files')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(capturedDownloadId).toBe('dl_1'))
  })

  it('shows a cancelled badge and a Retry button for a cancelled download', async () => {
    server.use(
      http.get('/api/v1/models/downloads', () =>
        HttpResponse.json({
          downloads: [
            runningDownload({ status: 'cancelled', finished_at: '2026-07-12T10:05:00Z' }),
          ],
        }),
      ),
    )

    renderSection()

    expect(await screen.findByText('cancelled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry (resumes)' })).toBeInTheDocument()
  })

  it('treats a WS cancelled frame as terminal and refetches downloads', async () => {
    MockWebSocket.instances = []
    server.use(
      http.get('/api/v1/models/downloads', () => HttpResponse.json({ downloads: [runningDownload()] })),
    )

    renderSection()
    await screen.findByText('2/10 files')

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1))
    const socket = MockWebSocket.instances[0]

    server.use(
      http.get('/api/v1/models/downloads', () =>
        HttpResponse.json({
          downloads: [
            runningDownload({ status: 'cancelled', finished_at: '2026-07-12T10:05:00Z' }),
          ],
        }),
      ),
    )

    act(() => {
      socket.open()
      socket.onmessage?.({ data: JSON.stringify({ type: 'cancelled' }) })
    })

    expect(await screen.findByText('cancelled')).toBeInTheDocument()
    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
  })
})
