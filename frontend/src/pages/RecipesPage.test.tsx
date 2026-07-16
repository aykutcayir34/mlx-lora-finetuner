import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import {
  completedTextJob,
  convertRecipeErrorHandler,
  convertRecipeHandler,
  failedJob,
  recipeJobHandler,
} from '../test/handlers/recipes'
import { RecipesPage } from './RecipesPage'

const txtFile = new File(['plain text content'], 'notes.txt', { type: 'text/plain' })

async function uploadAndSubmit(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.upload(screen.getByLabelText('Document file'), txtFile)
  await user.type(screen.getByLabelText('Dataset name'), name)
  await user.click(screen.getByRole('button', { name: 'Convert to dataset' }))
}

describe('RecipesPage', () => {
  it('renders the upload form without a job panel initially', () => {
    renderWithProviders(<RecipesPage />)

    expect(
      screen.getByText('Drag & drop a document here, or click to choose'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Dataset name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Convert to dataset' })).toBeDisabled()

    // No conversion has been started, so the poller section is absent.
    expect(screen.queryByText('Conversion job')).not.toBeInTheDocument()
  })

  it('converts a document end to end and renders the completed job with preview rows', async () => {
    const user = userEvent.setup()
    server.use(convertRecipeHandler('rj_pdf1', 'my-notes'), recipeJobHandler(completedTextJob))

    renderWithProviders(<RecipesPage />)
    await uploadAndSubmit(user, 'my-notes')

    // The progress section appears and the polled job settles as completed.
    expect(await screen.findByText('Conversion job')).toBeInTheDocument()
    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('3 rows emitted')).toBeInTheDocument()

    // Preview rows from the job response are rendered as JSON lines.
    expect(screen.getByText(/chunk one/)).toBeInTheDocument()
    expect(screen.getByText(/chunk two/)).toBeInTheDocument()
    expect(screen.getByText('See it on the Datasets page.')).toBeInTheDocument()

    // Page-level completion feedback (toast wired by RecipesPage.onSettled).
    expect(await screen.findByText(/Conversion completed/)).toBeInTheDocument()
  })

  it('shows the error when the conversion job fails', async () => {
    const user = userEvent.setup()
    server.use(convertRecipeHandler('rj_bad1', 'bad-notes'), recipeJobHandler(failedJob))

    renderWithProviders(<RecipesPage />)
    await uploadAndSubmit(user, 'bad-notes')

    expect(await screen.findByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('0 rows emitted')).toBeInTheDocument()

    // The job error appears both inline in the card and as an error toast.
    expect(await screen.findAllByText('could not parse document')).not.toHaveLength(0)
  })

  it('surfaces a submit error and does not start a job when the convert request fails', async () => {
    const user = userEvent.setup()
    server.use(convertRecipeErrorHandler('unsupported file type'))

    renderWithProviders(<RecipesPage />)
    await uploadAndSubmit(user, 'my-notes')

    expect(await screen.findByRole('alert')).toHaveTextContent('unsupported file type')
    expect(screen.queryByText('Conversion job')).not.toBeInTheDocument()
  })
})
