import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../common/Toast'
import { server } from '../../test/server'
import { SplitDialog } from './SplitDialog'
import { sampleChatDataset } from '../../test/handlers/datasets'

function renderDialog(onClose = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SplitDialog open datasetId="ds_chat" onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('SplitDialog', () => {
  it('disables submit when the ratios do not sum to 1', () => {
    renderDialog()

    const submit = screen.getByRole('button', { name: 'Split' })
    // Default values (0.8 / 0.1 / 0.1) sum to 1 already.
    expect(submit).toBeEnabled()

    const trainSlider = screen.getByLabelText('Train ratio')
    fireEvent.change(trainSlider, { target: { value: '0.5' } })

    expect(screen.getByText(/must sum to 1.00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled()
  })

  it('posts the correct body when ratios are valid', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown = null

    server.use(
      http.post('/api/v1/datasets/:id/split', async ({ request, params }) => {
        capturedBody = await request.json()
        expect(params.id).toBe('ds_chat')
        return HttpResponse.json(sampleChatDataset)
      }),
    )

    const onClose = () => {}
    renderDialog(onClose)

    const seedInput = screen.getByLabelText('Seed')
    await user.clear(seedInput)
    await user.type(seedInput, '7')

    await user.click(screen.getByRole('button', { name: 'Split' }))

    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect(capturedBody).toEqual({ train: 0.8, valid: 0.1, test: 0.1, seed: 7, shuffle: true })
  })
})
