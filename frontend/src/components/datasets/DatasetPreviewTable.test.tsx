import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../../test/server'
import { DatasetPreviewTable } from './DatasetPreviewTable'
import { previewDatasetHandler } from '../../test/handlers/datasets'

function renderPreview(format: 'chat' | 'dpo' | 'completions' | 'text' | 'orpo' | 'grpo', splits: { train: number; valid: number; test: number } | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DatasetPreviewTable datasetId="ds_1" format={format} splits={splits} />
    </QueryClientProvider>,
  )
}

describe('DatasetPreviewTable', () => {
  it('renders chat rows as message bubbles with role labels', async () => {
    server.use(
      previewDatasetHandler({
        rows: [{ messages: [{ role: 'user', content: 'Hi there' }, { role: 'assistant', content: 'Hello!' }] }],
        page: 1,
        size: 20,
        total_rows: 1,
      }),
    )

    renderPreview('chat')

    expect(await screen.findByText('Hi there')).toBeInTheDocument()
    expect(screen.getByText('Hello!')).toBeInTheDocument()
    expect(screen.getByText('user')).toBeInTheDocument()
    expect(screen.getByText('assistant')).toBeInTheDocument()
  })

  it('renders dpo rows as prompt/chosen/rejected columns', async () => {
    server.use(
      previewDatasetHandler({
        rows: [{ prompt: 'p1', chosen: 'good answer', rejected: 'bad answer' }],
        page: 1,
        size: 20,
        total_rows: 1,
      }),
    )

    renderPreview('dpo')

    expect(await screen.findByText('Prompt')).toBeInTheDocument()
    expect(screen.getByText('Chosen')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByText('good answer')).toBeInTheDocument()
    expect(screen.getByText('bad answer')).toBeInTheDocument()
  })

  it('shows an optional score column for orpo rows when present', async () => {
    server.use(
      previewDatasetHandler({
        rows: [{ prompt: 'p1', chosen: 'c1', rejected: 'r1', preference_score: 0.9 }],
        page: 1,
        size: 20,
        total_rows: 1,
      }),
    )

    renderPreview('orpo')

    expect(await screen.findByText('Score')).toBeInTheDocument()
    expect(screen.getByText('0.9')).toBeInTheDocument()
  })

  it('paginates through results with previous/next controls', async () => {
    const user = userEvent.setup()
    server.use(
      previewDatasetHandler({
        rows: [{ text: 'page one row' }],
        page: 1,
        size: 20,
        total_rows: 40,
      }),
    )

    renderPreview('text')

    expect(await screen.findByText('page one row')).toBeInTheDocument()
    const prevButton = screen.getByRole('button', { name: 'Previous' })
    const nextButton = screen.getByRole('button', { name: 'Next' })
    expect(prevButton).toBeDisabled()
    expect(nextButton).toBeEnabled()

    server.use(
      previewDatasetHandler({
        rows: [{ text: 'page two row' }],
        page: 2,
        size: 20,
        total_rows: 40,
      }),
    )

    await user.click(nextButton)

    expect(await screen.findByText('page two row')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled())
    // Second (last) page of a 40-row, 20-per-page dataset: Next is now disabled.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('only offers the raw split when the dataset has not been split', () => {
    renderPreview('text', null)

    const select = screen.getByLabelText('Preview split') as HTMLSelectElement
    const optionValues = Array.from(select.options).map((option) => option.value)
    expect(optionValues).toEqual(['raw'])
  })

  it('offers all splits once the dataset has been split', () => {
    renderPreview('text', { train: 10, valid: 2, test: 2 })

    const select = screen.getByLabelText('Preview split') as HTMLSelectElement
    const optionValues = Array.from(select.options).map((option) => option.value)
    expect(optionValues).toEqual(['raw', 'train', 'valid', 'test'])
  })
})
