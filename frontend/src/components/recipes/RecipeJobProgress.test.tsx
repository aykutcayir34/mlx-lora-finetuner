import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/render'
import { server } from '../../test/server'
import { RecipeJobProgress } from './RecipeJobProgress'
import { completedTextJob, failedJob, recipeJobHandler } from '../../test/handlers/recipes'

describe('RecipeJobProgress', () => {
  it('renders nothing when there is no job id', () => {
    const { container } = renderWithProviders(<RecipeJobProgress jobId={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders Completed status, row count and a preview of emitted rows on success', async () => {
    server.use(recipeJobHandler(completedTextJob))
    const onSettled = vi.fn()

    renderWithProviders(
      <RecipeJobProgress jobId="rj_pdf1" datasetName="my-recipe" onSettled={onSettled} />,
    )

    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('3 rows emitted')).toBeInTheDocument()
    expect(screen.getByText(/my-recipe/)).toBeInTheDocument()
    expect(screen.getByText(/chunk one/)).toBeInTheDocument()

    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(completedTextJob))
  })

  it('renders Failed status with the error message and no preview', async () => {
    server.use(recipeJobHandler(failedJob))
    const onSettled = vi.fn()

    renderWithProviders(<RecipeJobProgress jobId="rj_bad1" onSettled={onSettled} />)

    expect(await screen.findByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('could not parse document')).toBeInTheDocument()
    expect(screen.queryByText(/rows emitted/)).toBeInTheDocument()

    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(failedJob))
  })

  it('shows a running state without calling onSettled', async () => {
    server.use(
      recipeJobHandler({
        recipe_job_id: 'rj_running',
        status: 'running',
        rows_emitted: 0,
        preview_rows: [],
        dataset_id: null,
        error: null,
      }),
    )
    const onSettled = vi.fn()

    renderWithProviders(<RecipeJobProgress jobId="rj_running" onSettled={onSettled} />)

    expect(await screen.findByText('Running')).toBeInTheDocument()
    expect(onSettled).not.toHaveBeenCalled()
  })
})
