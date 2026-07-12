import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { DatasetsPage } from './DatasetsPage'
import {
  deleteDatasetConflictHandler,
  deleteDatasetHandler,
  listDatasetsHandler,
  sampleChatDataset,
  sampleDpoDataset,
} from '../test/handlers/datasets'

describe('DatasetsPage', () => {
  it('renders the dataset list with format badges and split status', async () => {
    server.use(listDatasetsHandler())

    renderWithProviders(<DatasetsPage />)

    expect(await screen.findByText('chat-data')).toBeInTheDocument()
    expect(screen.getByText('dpo-data')).toBeInTheDocument()

    // Format badges
    expect(screen.getByText('Chat')).toBeInTheDocument()
    expect(screen.getByText('DPO')).toBeInTheDocument()

    // Split status: chat dataset is split, dpo dataset is not.
    expect(screen.getByText('train 160')).toBeInTheDocument()
    expect(screen.getByText('valid 20')).toBeInTheDocument()
    expect(screen.getByText('test 20')).toBeInTheDocument()
    expect(screen.getByText('Not split')).toBeInTheDocument()

    // Row counts
    expect(screen.getByText('200')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
  })

  it('shows an empty state when there are no datasets', async () => {
    server.use(listDatasetsHandler([]))

    renderWithProviders(<DatasetsPage />)

    expect(await screen.findByText('No datasets yet')).toBeInTheDocument()
  })

  it('deletes a dataset after confirming, and shows a success toast', async () => {
    const user = userEvent.setup()
    server.use(listDatasetsHandler([sampleChatDataset, sampleDpoDataset]))

    renderWithProviders(<DatasetsPage />)
    await screen.findByText('chat-data')

    server.use(deleteDatasetHandler())

    const row = screen.getByText('chat-data').closest('tr')
    expect(row).not.toBeNull()
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()

    // Once confirmed, the list is refetched without the deleted dataset.
    server.use(listDatasetsHandler([sampleDpoDataset]))

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('chat-data')).not.toBeInTheDocument())
    expect(await screen.findByText(/Deleted "chat-data"/)).toBeInTheDocument()
  })

  it('surfaces a training_active conflict toast when delete fails with 409', async () => {
    const user = userEvent.setup()
    server.use(listDatasetsHandler([sampleChatDataset]))

    renderWithProviders(<DatasetsPage />)
    await screen.findByText('chat-data')

    server.use(deleteDatasetConflictHandler())

    const row = screen.getByText('chat-data').closest('tr')
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText(/active training job/)).toBeInTheDocument()
    // The row should remain since the delete failed.
    expect(screen.getByText('chat-data')).toBeInTheDocument()
  })

  it('surfaces an error message when the dataset list request fails', async () => {
    server.use(
      http.get('/api/v1/datasets', () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom', detail: {} } }, { status: 500 }),
      ),
    )

    renderWithProviders(<DatasetsPage />)

    expect(await screen.findByText('Failed to load datasets.')).toBeInTheDocument()
  })
})
