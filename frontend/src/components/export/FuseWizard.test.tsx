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

  it('prefills the manual source from checkpoint navigation state and submits model_id+adapter_path', async () => {
    server.use(...exportHandlers)
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/export/fuse', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ export_id: 'ex_fuse1', kind: 'fuse' }, { status: 202 })
      }),
    )

    const user = userEvent.setup()
    renderWithProviders(
      <ToastProvider>
        <FuseWizard />
      </ToastProvider>,
      {
        route: '/export',
        routeState: {
          model_id: 'mlx-community/Qwen2.5-0.5B-Instruct-4bit',
          adapter_path: '/abs/runs/run_abc/checkpoints/0000200_adapters.safetensors',
          suggested_name: 'my-run-step-200',
        },
      },
    )

    // The wizard opens on the manual model_id+adapter_path source, prefilled.
    expect(screen.getByPlaceholderText('mlx-community/SmolLM-135M-Instruct-4bit')).toHaveValue(
      'mlx-community/Qwen2.5-0.5B-Instruct-4bit',
    )
    expect(screen.getByPlaceholderText('/abs/path/to/adapters')).toHaveValue(
      '/abs/runs/run_abc/checkpoints/0000200_adapters.safetensors',
    )
    expect(screen.getByPlaceholderText('my-model')).toHaveValue('my-run-step-200')

    await user.click(screen.getByRole('button', { name: 'Fuse' }))

    await waitFor(() =>
      expect(capturedBody).toEqual({
        model_id: 'mlx-community/Qwen2.5-0.5B-Instruct-4bit',
        adapter_path: '/abs/runs/run_abc/checkpoints/0000200_adapters.safetensors',
        de_quantize: false,
        output_name: 'my-run-step-200',
      }),
    )
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
