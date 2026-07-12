import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, screen, waitFor } from '../../test/render'
import { server } from '../../test/server'
import { exportHandlers } from '../../test/handlers/export'
import { GGUFWizard } from './GGUFWizard'
import { ToastProvider } from '../common/Toast'

function renderWizard() {
  return renderWithProviders(
    <ToastProvider>
      <GGUFWizard />
    </ToastProvider>,
  )
}

// The wizard renders two <select>s once a source is picked (fused-model
// picker + outtype picker); the fused-model picker is always the first one.
function sourceSelect() {
  return screen.getAllByRole('combobox')[0]
}

describe('GGUFWizard', () => {
  it('enables submit and shows all-green checks when the preflight passes', async () => {
    server.use(...exportHandlers)

    const user = userEvent.setup()
    renderWizard()

    await screen.findByRole('option', { name: '/abs/exports/my-model-fused' })
    await user.selectOptions(sourceSelect(), '/abs/exports/my-model-fused')

    expect(await screen.findByText('llama.cpp found')).toBeInTheDocument()
    expect(screen.getByText('weights are f16')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('my-model'), 'my-gguf')

    expect(screen.getByRole('button', { name: 'Convert' })).toBeEnabled()
  })

  it('disables submit and shows the failing message when weights_dequantized fails', async () => {
    server.use(...exportHandlers)
    server.use(
      http.get('/api/v1/export/gguf/preflight', () =>
        HttpResponse.json({
          ok: false,
          checks: [
            { name: 'llama_cpp_available', ok: true, message: 'llama.cpp found' },
            { name: 'arch_supported', ok: true, message: 'llama' },
            {
              name: 'weights_dequantized',
              ok: false,
              message: 'weights are 4-bit quantized; re-fuse with de_quantize=true',
            },
          ],
        }),
      ),
    )

    const user = userEvent.setup()
    renderWizard()

    await screen.findByRole('option', { name: '/abs/exports/my-model-fused' })
    await user.selectOptions(sourceSelect(), '/abs/exports/my-model-fused')
    await user.type(screen.getByPlaceholderText('my-model'), 'my-gguf')

    expect(
      await screen.findByText('weights are 4-bit quantized; re-fuse with de_quantize=true'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Convert' })).toBeDisabled()
  })

  it('submits the correct request body', async () => {
    server.use(...exportHandlers)
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/export/gguf', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ export_id: 'ex_gguf1', kind: 'gguf' }, { status: 202 })
      }),
    )

    const user = userEvent.setup()
    renderWizard()

    await screen.findByRole('option', { name: '/abs/exports/my-model-fused' })
    await user.selectOptions(sourceSelect(), '/abs/exports/my-model-fused')
    await screen.findByText('llama.cpp found')
    await user.type(screen.getByPlaceholderText('my-model'), 'my-gguf')

    await user.click(screen.getByRole('button', { name: 'Convert' }))

    await waitFor(() =>
      expect(capturedBody).toEqual({
        model_path: '/abs/exports/my-model-fused',
        outtype: 'f16',
        output_name: 'my-gguf',
      }),
    )
  })
})
