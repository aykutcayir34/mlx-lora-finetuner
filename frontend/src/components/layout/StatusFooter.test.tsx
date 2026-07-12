import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderWithProviders, screen, waitFor } from '../../test/render'
import { server } from '../../test/server'
import { StatusFooter } from './StatusFooter'

describe('StatusFooter', () => {
  it('renders a healthy dot, memory usage and "No active job" by default', async () => {
    renderWithProviders(<StatusFooter />)

    await waitFor(() => expect(screen.getByTestId('footer-health-dot')).toHaveClass('bg-success'))
    expect(screen.getByText('No active job')).toBeInTheDocument()
    expect(screen.getByText('Memory: 12.3 / 32.0 GB')).toBeInTheDocument()
  })

  it('degrades gracefully when the backend is unreachable', async () => {
    server.use(
      http.get('/api/v1/system/health', () => HttpResponse.error()),
      http.get('/api/v1/system/stats', () => HttpResponse.error()),
    )

    renderWithProviders(<StatusFooter />)

    await waitFor(() => expect(screen.getByTestId('footer-health-dot')).toHaveClass('bg-danger'))
    expect(screen.getByText('Memory: —')).toBeInTheDocument()
    expect(screen.getByText('No active job')).toBeInTheDocument()
  })

  it('renders an active-run badge linking to /train when a run is active', async () => {
    server.use(
      http.get('/api/v1/system/stats', () =>
        HttpResponse.json({
          memory: { total_gb: 32, used_gb: 12.3 },
          disk: { models_gb: 4.2, datasets_gb: 0.1, runs_gb: 0.3, exports_gb: 1.0, free_gb: 210.5 },
          active_run_id: 'run_abc',
          data_dir: '/Users/x/.mlx-lora-finetuner',
        }),
      ),
      http.get('/api/v1/train/jobs/run_abc', () =>
        HttpResponse.json({
          run_id: 'run_abc',
          name: 'my-run',
          status: 'running',
          config: {},
          created_at: '2026-07-12T10:00:00Z',
          started_at: '2026-07-12T10:00:01Z',
          finished_at: null,
          final_train_loss: null,
          final_val_loss: null,
          adapter_path: null,
          error: null,
        }),
      ),
    )

    renderWithProviders(<StatusFooter />)

    const link = await screen.findByRole('link', { name: /run_abc/ })
    expect(link).toHaveAttribute('href', '/train')
    expect(screen.getByText(/running/)).toBeInTheDocument()
  })
})
