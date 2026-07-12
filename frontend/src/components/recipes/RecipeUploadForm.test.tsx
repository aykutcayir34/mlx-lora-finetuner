import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, screen } from '../../test/render'
import { server } from '../../test/server'
import { ToastProvider } from '../common/Toast'
import { RecipeUploadForm } from './RecipeUploadForm'
import { convertRecipeErrorHandler, convertRecipeHandler } from '../../test/handlers/recipes'

function renderForm(onJobStarted = vi.fn()) {
  renderWithProviders(
    <ToastProvider>
      <RecipeUploadForm onJobStarted={onJobStarted} />
    </ToastProvider>,
  )
  return onJobStarted
}

const pdfFile = new File(['%PDF-1.4 fake content'], 'doc.pdf', { type: 'application/pdf' })
const csvFile = new File(['question,answer\nhi,hello'], 'qa.csv', { type: 'text/csv' })

describe('RecipeUploadForm', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('disables submit until a file and dataset name are provided', async () => {
    const user = userEvent.setup()
    renderForm()

    expect(screen.getByRole('button', { name: 'Convert to dataset' })).toBeDisabled()

    await user.upload(screen.getByLabelText('Document file'), pdfFile)
    expect(screen.getByRole('button', { name: 'Convert to dataset' })).toBeDisabled()

    await user.type(screen.getByLabelText('Dataset name'), 'my-recipe')
    expect(screen.getByRole('button', { name: 'Convert to dataset' })).toBeEnabled()
  })

  it('shows chunk_size/chunk_overlap fields for a doc file and hides csv column fields', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.upload(screen.getByLabelText('Document file'), pdfFile)

    expect(screen.getByLabelText('Chunk size (chars)')).toBeInTheDocument()
    expect(screen.getByLabelText('Chunk overlap (chars)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Prompt column')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Completion column')).not.toBeInTheDocument()

    // Only "text" is offered for doc uploads.
    expect(screen.getByRole('combobox', { name: 'Output format' })).toHaveValue('text')
    expect(screen.queryByRole('option', { name: 'Chat' })).not.toBeInTheDocument()
  })

  it('shows prompt/completion column fields for a csv file and hides chunk fields', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.upload(screen.getByLabelText('Document file'), csvFile)

    expect(screen.getByLabelText('Prompt column')).toBeInTheDocument()
    expect(screen.getByLabelText('Completion column')).toBeInTheDocument()
    expect(screen.queryByLabelText('Chunk size (chars)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Chunk overlap (chars)')).not.toBeInTheDocument()

    // csv defaults to completions; chat is also offered.
    expect(screen.getByRole('combobox', { name: 'Output format' })).toHaveValue('completions')
    expect(screen.getByRole('option', { name: 'Chat' })).toBeInTheDocument()
  })

  it('reveals the system prompt field only when output_format is chat', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.upload(screen.getByLabelText('Document file'), csvFile)
    expect(screen.queryByLabelText('System prompt (optional)')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Output format' }), 'chat')
    expect(screen.getByLabelText('System prompt (optional)')).toBeInTheDocument()
  })

  it('requires prompt/completion columns before a csv upload can submit', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.upload(screen.getByLabelText('Document file'), csvFile)
    await user.type(screen.getByLabelText('Dataset name'), 'my-csv-recipe')
    expect(screen.getByRole('button', { name: 'Convert to dataset' })).toBeDisabled()

    await user.type(screen.getByLabelText('Prompt column'), 'question')
    await user.type(screen.getByLabelText('Completion column'), 'answer')
    expect(screen.getByRole('button', { name: 'Convert to dataset' })).toBeEnabled()
  })

  it('submits multipart form data with doc-specific fields for a pdf upload', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ recipe_job_id: 'rj_1', name: 'pdf-recipe' }), {
          status: 202,
        }),
      )

    renderForm()

    await user.upload(screen.getByLabelText('Document file'), pdfFile)
    await user.type(screen.getByLabelText('Dataset name'), 'pdf-recipe')
    await user.clear(screen.getByLabelText('Chunk size (chars)'))
    await user.type(screen.getByLabelText('Chunk size (chars)'), '500')

    await user.click(screen.getByRole('button', { name: 'Convert to dataset' }))

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/v1/recipes/convert')
    const formData = init?.body as FormData
    expect((formData.get('file') as File).name).toBe('doc.pdf')
    expect(formData.get('name')).toBe('pdf-recipe')
    expect(formData.get('output_format')).toBe('text')
    expect(formData.get('chunk_size')).toBe('500')
    expect(formData.get('prompt_column')).toBeNull()
  })

  it('submits multipart form data with column fields for a csv upload', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ recipe_job_id: 'rj_2', name: 'csv-recipe' }), {
          status: 202,
        }),
      )

    renderForm()

    await user.upload(screen.getByLabelText('Document file'), csvFile)
    await user.type(screen.getByLabelText('Dataset name'), 'csv-recipe')
    await user.type(screen.getByLabelText('Prompt column'), 'question')
    await user.type(screen.getByLabelText('Completion column'), 'answer')

    await user.click(screen.getByRole('button', { name: 'Convert to dataset' }))

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [, init] = fetchSpy.mock.calls[0]
    const formData = init?.body as FormData
    expect(formData.get('output_format')).toBe('completions')
    expect(formData.get('prompt_column')).toBe('question')
    expect(formData.get('completion_column')).toBe('answer')
    expect(formData.get('chunk_size')).toBeNull()
  })

  it('calls onJobStarted with the returned job id on a successful submit', async () => {
    const user = userEvent.setup()
    server.use(convertRecipeHandler('rj_success', 'pdf-recipe'))
    const onJobStarted = renderForm()

    await user.upload(screen.getByLabelText('Document file'), pdfFile)
    await user.type(screen.getByLabelText('Dataset name'), 'pdf-recipe')
    await user.click(screen.getByRole('button', { name: 'Convert to dataset' }))

    await vi.waitFor(() =>
      expect(onJobStarted).toHaveBeenCalledWith('rj_success', 'pdf-recipe'),
    )
  })

  it('shows a toast with the backend message on a 422 response', async () => {
    const user = userEvent.setup()
    server.use(convertRecipeErrorHandler('unsupported file type'))
    renderForm()

    await user.upload(screen.getByLabelText('Document file'), pdfFile)
    await user.type(screen.getByLabelText('Dataset name'), 'pdf-recipe')
    await user.click(screen.getByRole('button', { name: 'Convert to dataset' }))

    expect(await screen.findByRole('status')).toHaveTextContent('unsupported file type')
  })
})
