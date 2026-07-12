import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, screen, waitFor } from '../../test/render'
import { server } from '../../test/server'
import { ToastProvider } from '../common/Toast'
import { LocalModelsSection } from './LocalModelsSection'

function renderSection() {
  return renderWithProviders(
    <ToastProvider>
      <LocalModelsSection />
    </ToastProvider>,
  )
}

describe('LocalModelsSection', () => {
  it('renders local models from GET /models', async () => {
    renderSection()

    expect(await screen.findByText('mlx-community/SmolLM-135M-Instruct-4bit')).toBeInTheDocument()
    expect(screen.getByText('mlx-community/Qwen2.5-0.5B-Instruct-4bit')).toBeInTheDocument()
    expect(screen.getAllByText('4-bit')).toHaveLength(2)
  })

  it('deletes a model after confirming, and shows a success toast', async () => {
    const user = userEvent.setup()
    let deletedId: string | null = null
    server.use(
      http.delete('/api/v1/models/:modelId', ({ params }) => {
        deletedId = params.modelId as string
        return new HttpResponse(null, { status: 204 })
      }),
    )

    renderSection()

    await screen.findByText('mlx-community/SmolLM-135M-Instruct-4bit')
    await user.click(
      screen.getByRole('button', { name: 'Delete mlx-community/SmolLM-135M-Instruct-4bit' }),
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deletedId).not.toBeNull())
    expect(deletedId).toContain('SmolLM-135M-Instruct-4bit')
    expect(await screen.findByText(/Deleted "mlx-community\/SmolLM-135M-Instruct-4bit"/)).toBeInTheDocument()
  })

  it('shows an error toast when delete fails because training is active', async () => {
    const user = userEvent.setup()
    server.use(
      http.delete('/api/v1/models/:modelId', () =>
        HttpResponse.json(
          { error: { code: 'training_active', message: 'Model is in use.', detail: {} } },
          { status: 409 },
        ),
      ),
    )

    renderSection()

    await screen.findByText('mlx-community/SmolLM-135M-Instruct-4bit')
    await user.click(
      screen.getByRole('button', { name: 'Delete mlx-community/SmolLM-135M-Instruct-4bit' }),
    )
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Cannot delete: model is used by an active training job.')).toBeInTheDocument()
  })
})
