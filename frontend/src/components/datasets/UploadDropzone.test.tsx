import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../common/Toast'
import { server } from '../../test/server'
import { UploadDropzone } from './UploadDropzone'
import { sampleChatDataset, uploadDatasetErrorHandler, uploadDatasetHandler } from '../../test/handlers/datasets'

function renderDropzone() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <UploadDropzone />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('UploadDropzone', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Reading a jsdom File's bytes back out of a live Request body (via msw's
  // request.formData()/.text()) hangs in this jsdom + msw combination, so we
  // assert the multipart payload by spying on the underlying fetch call
  // directly instead of round-tripping it through the network layer.
  it('uploads the selected file as multipart form data', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(sampleChatDataset), { status: 201 }))

    renderDropzone()

    const file = new File(['{"messages": []}'], 'data.jsonl', { type: 'application/jsonl' })
    const input = screen.getByLabelText('Dataset file')
    await user.upload(input, file)

    await user.type(screen.getByLabelText('Name (optional)'), 'my-dataset')
    await user.click(screen.getByRole('button', { name: 'Upload dataset' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/v1/datasets/upload')
    expect(init?.body).toBeInstanceOf(FormData)
    const formData = init?.body as FormData
    expect((formData.get('file') as File).name).toBe('data.jsonl')
    expect(formData.get('name')).toBe('my-dataset')
  })

  it('shows a success toast after a successful upload', async () => {
    const user = userEvent.setup()
    server.use(uploadDatasetHandler(sampleChatDataset))

    renderDropzone()

    const file = new File(['{"messages": []}'], 'data.jsonl')
    await user.upload(screen.getByLabelText('Dataset file'), file)
    await user.click(screen.getByRole('button', { name: 'Upload dataset' }))

    expect(await screen.findByText(/Uploaded "chat-data"/)).toBeInTheDocument()
  })

  it('surfaces the validation_error message on a 422 response', async () => {
    const user = userEvent.setup()
    server.use(uploadDatasetErrorHandler('No line could be parsed as a supported format.'))

    renderDropzone()

    const file = new File(['not json'], 'bad.jsonl')
    await user.upload(screen.getByLabelText('Dataset file'), file)
    await user.click(screen.getByRole('button', { name: 'Upload dataset' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No line could be parsed as a supported format.')
  })

  it('disables the upload button until a file is selected', () => {
    renderDropzone()
    expect(screen.getByRole('button', { name: 'Upload dataset' })).toBeDisabled()
  })
})
