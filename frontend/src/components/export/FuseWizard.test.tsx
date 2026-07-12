import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, screen, waitFor } from '../../test/render'
import { server } from '../../test/server'
import { exportHandlers } from '../../test/handlers/export'
import { FuseWizard } from './FuseWizard'
import { ToastProvider } from '../common/Toast'

function renderWizard() {
  return renderWithProviders(
    <ToastProvider>
      <FuseWizard />
    </ToastProvider>,
  )
}

describe('FuseWizard', () => {
  it('submits the run_id path when an adapter with a run_id is selected', async () => {
    server.use(...exportHandlers)
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/export/fuse', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ export_id: 'ex_fuse1', kind: 'fuse' }, { status: 202 })
      }),
    )

    const user = userEvent.setup()
    renderWizard()

    await screen.findByRole('option', { name: /my-run/ })
    await user.selectOptions(screen.getByRole('combobox'), '/abs/runs/run_abc/adapters')
    await user.type(screen.getByPlaceholderText('my-model'), 'fused-out')

    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    await waitFor(() => expect(capturedBody).toEqual({
      run_id: 'run_abc',
      de_quantize: false,
      output_name: 'fused-out',
    }))
  })

  it('includes de_quantize in the request body when the switch is toggled on', async () => {
    server.use(...exportHandlers)
    let capturedBody: Record<string, unknown> | null = null
    server.use(
      http.post('/api/v1/export/fuse', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ export_id: 'ex_fuse1', kind: 'fuse' }, { status: 202 })
      }),
    )

    const user = userEvent.setup()
    renderWizard()

    await screen.findByRole('option', { name: /my-run/ })
    await user.selectOptions(screen.getByRole('combobox'), '/abs/runs/run_abc/adapters')
    await user.type(screen.getByPlaceholderText('my-model'), 'fused-out')
    await user.click(screen.getByRole('switch'))

    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    await waitFor(() => expect(capturedBody?.de_quantize).toBe(true))
  })

  it('polls the job and renders the progress log until it completes', async () => {
    server.use(...exportHandlers)

    const user = userEvent.setup()
    renderWizard()

    await screen.findByRole('option', { name: /my-run/ })
    await user.selectOptions(screen.getByRole('combobox'), '/abs/runs/run_abc/adapters')
    await user.type(screen.getByPlaceholderText('my-model'), 'fused-out')
    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.getByText(/fusing weights…/)).toBeInTheDocument()
    expect(screen.getByText('/abs/exports/my-model-fused')).toBeInTheDocument()
  })

  it('shows a clear toast when the backend reports training_active (409)', async () => {
    server.use(...exportHandlers)
    server.use(
      http.post('/api/v1/export/fuse', () =>
        HttpResponse.json(
          { error: { code: 'training_active', message: 'A training job is active', detail: {} } },
          { status: 409 },
        ),
      ),
    )

    const user = userEvent.setup()
    renderWizard()

    await screen.findByRole('option', { name: /my-run/ })
    await user.selectOptions(screen.getByRole('combobox'), '/abs/runs/run_abc/adapters')
    await user.type(screen.getByPlaceholderText('my-model'), 'fused-out')
    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/Eğitim aktifken/)
  })
})
