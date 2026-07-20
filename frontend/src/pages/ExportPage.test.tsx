import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { exportHandlers } from '../test/handlers/export'
import { ExportPage } from './ExportPage'

describe('ExportPage', () => {
  it('renders the artifact table from GET /export/artifacts', async () => {
    server.use(...exportHandlers)

    renderWithProviders(<ExportPage />)

    expect(await screen.findByText('/abs/exports/my-model-fused')).toBeInTheDocument()
    expect(screen.getByText('/abs/exports/my-model.gguf')).toBeInTheDocument()

    // Kind badges (lowercase, distinct from the "GGUF" tab label).
    expect(screen.getByText('fused')).toBeInTheDocument()
    expect(screen.getByText('gguf')).toBeInTheDocument()
    expect(screen.getAllByText('run_abc')).toHaveLength(2)
  })

  it('shows an empty state when there are no artifacts', async () => {
    // Global defaults return empty artifacts/adapters lists.
    renderWithProviders(<ExportPage />)

    expect(await screen.findByText('No artifacts yet')).toBeInTheDocument()
  })

  it('switches between the Fuse, GGUF and Ollama wizards while keeping the artifact table', async () => {
    const user = userEvent.setup()
    server.use(...exportHandlers)

    renderWithProviders(<ExportPage />)

    // Fuse is the default tab.
    expect(await screen.findByText('Fuse adapter into base model')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'GGUF' }))
    expect(await screen.findByText('Convert fused model to GGUF')).toBeInTheDocument()
    expect(screen.queryByText('Fuse adapter into base model')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Ollama' }))
    expect(await screen.findByText('Generate Ollama Modelfile')).toBeInTheDocument()

    // The artifact table sits below the tabs and stays mounted throughout.
    expect(screen.getByText('Artifacts')).toBeInTheDocument()
    expect(screen.getByText('/abs/exports/my-model-fused')).toBeInTheDocument()
  })

  it('runs a fuse job end to end and refreshes the artifact table on completion', async () => {
    const user = userEvent.setup()
    server.use(...exportHandlers)
    // Start with an empty artifact table so the post-completion refetch is visible.
    server.use(http.get('/api/v1/export/artifacts', () => HttpResponse.json({ artifacts: [] })))

    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/export/fuse', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ export_id: 'ex_fuse1', kind: 'fuse' }, { status: 202 })
      }),
    )

    renderWithProviders(<ExportPage />)

    expect(await screen.findByText('No artifacts yet')).toBeInTheDocument()

    await screen.findByRole('option', { name: /my-run/ })
    await user.selectOptions(screen.getByRole('combobox'), '/abs/runs/run_abc/adapters')
    await user.type(screen.getByPlaceholderText('my-model'), 'fused-out')

    // Once the job completes, the invalidated artifacts query refetches and
    // should pick up the newly created artifact.
    server.use(
      http.get('/api/v1/export/artifacts', () =>
        HttpResponse.json({
          artifacts: [
            {
              id: 'art_new',
              kind: 'fused',
              path: '/abs/exports/fused-out',
              size_bytes: 268435456,
              source_run_id: 'run_abc',
              created_at: '2026-07-12T11:00:00Z',
            },
          ],
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    await waitFor(() =>
      expect(capturedBody).toEqual({ run_id: 'run_abc', de_quantize: false, output_name: 'fused-out' }),
    )

    // The job progress panel appears and reports completion with the output path.
    expect(await screen.findByText('Export job')).toBeInTheDocument()
    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('/abs/exports/my-model-fused')).toBeInTheDocument()
    expect(await screen.findByText('Fuse completed.')).toBeInTheDocument()

    // The artifact table refreshed with the new artifact.
    expect(await screen.findByText('/abs/exports/fused-out')).toBeInTheDocument()
    expect(screen.queryByText('No artifacts yet')).not.toBeInTheDocument()
  })

  it('surfaces the training_active feedback when an export is rejected with 409', async () => {
    const user = userEvent.setup()
    server.use(...exportHandlers)
    server.use(
      http.post('/api/v1/export/fuse', () =>
        HttpResponse.json(
          { error: { code: 'training_active', message: 'A training job is active', detail: {} } },
          { status: 409 },
        ),
      ),
    )

    renderWithProviders(<ExportPage />)

    await screen.findByRole('option', { name: /my-run/ })
    await user.selectOptions(screen.getByRole('combobox'), '/abs/runs/run_abc/adapters')
    await user.type(screen.getByPlaceholderText('my-model'), 'fused-out')
    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/while training is active/)
    // No job was started, so no progress panel appears.
    expect(screen.queryByText('Export job')).not.toBeInTheDocument()
  })
})
