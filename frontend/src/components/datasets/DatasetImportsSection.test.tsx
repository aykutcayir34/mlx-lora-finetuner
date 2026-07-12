import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, screen, waitFor } from '../../test/render'
import { server } from '../../test/server'
import { ToastProvider } from '../common/Toast'
import {
  cancelImportHandler,
  importDatasetHandler,
  listDatasetImportsHandler,
  sampleImportInfo,
} from '../../test/handlers/datasets'
import { DatasetImportsSection } from './DatasetImportsSection'
import type { AutoSplitConfig } from './ImportDatasetDialog'

function renderSection(
  pendingAutoSplit: Record<string, AutoSplitConfig> = {},
  onAutoSplitHandled: (importId: string) => void = () => {},
) {
  return renderWithProviders(
    <ToastProvider>
      <DatasetImportsSection pendingAutoSplit={pendingAutoSplit} onAutoSplitHandled={onAutoSplitHandled} />
    </ToastProvider>,
  )
}

describe('DatasetImportsSection', () => {
  it('shows an empty state when there are no imports', async () => {
    server.use(listDatasetImportsHandler([]))
    renderSection()
    expect(await screen.findByText('No imports')).toBeInTheDocument()
  })

  it('renders import status and rows written', async () => {
    server.use(listDatasetImportsHandler([{ ...sampleImportInfo, rows_written: 1200 }]))
    renderSection()

    expect(await screen.findByText(sampleImportInfo.hf_dataset_id)).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.getByText('1,200 rows written')).toBeInTheDocument()
  })

  it('cancels a running import', async () => {
    const user = userEvent.setup()
    server.use(listDatasetImportsHandler([sampleImportInfo]))
    renderSection()
    await screen.findByText(sampleImportInfo.hf_dataset_id)

    server.use(cancelImportHandler({ ...sampleImportInfo, status: 'cancelled' }))
    server.use(listDatasetImportsHandler([{ ...sampleImportInfo, status: 'cancelled' }]))

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('cancelled')).toBeInTheDocument()
  })

  it('shows an error message and retries a failed import with the same dataset_id/split', async () => {
    const user = userEvent.setup()
    const failed = { ...sampleImportInfo, status: 'failed' as const, error: 'Connection reset' }
    server.use(listDatasetImportsHandler([failed]))
    let capturedBody: unknown = null
    server.use(
      http.post('/api/v1/datasets/import', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ import_id: 'di_2', dataset_id: failed.hf_dataset_id }, { status: 202 })
      }),
    )

    renderSection()
    expect(await screen.findByText('Connection reset')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(capturedBody).toEqual({
        dataset_id: failed.hf_dataset_id,
        config: failed.config,
        split: failed.split,
        name: null,
        max_rows: null,
      }),
    )
  })

  it('retries a cancelled import via the same import endpoint', async () => {
    const user = userEvent.setup()
    const cancelled = { ...sampleImportInfo, status: 'cancelled' as const }
    server.use(listDatasetImportsHandler([cancelled]))
    server.use(importDatasetHandler({ import_id: 'di_3', dataset_id: cancelled.hf_dataset_id }))

    renderSection()
    await screen.findByText(cancelled.hf_dataset_id)

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText(/Retrying import of/)).toBeInTheDocument()
  })

  it('triggers a pending auto-split when the import completes, then clears the pending entry', async () => {
    const completed = { ...sampleImportInfo, status: 'completed' as const, dataset_id: 'ds_new', rows_written: 500 }
    server.use(listDatasetImportsHandler([completed]))

    let capturedBody: unknown = null
    let capturedId: string | undefined
    server.use(
      http.post('/api/v1/datasets/:id/split', async ({ request, params }) => {
        capturedBody = await request.json()
        capturedId = params.id as string
        return HttpResponse.json(sampleImportInfo)
      }),
    )

    let handledId: string | null = null
    renderSection({ [completed.import_id]: { train: 0.8, valid: 0.1, test: 0.1, seed: 42, shuffle: true } }, (importId) => {
      handledId = importId
    })

    await waitFor(() =>
      expect(capturedBody).toEqual({ train: 0.8, valid: 0.1, test: 0.1, seed: 42, shuffle: true }),
    )
    expect(capturedId).toBe('ds_new')
    expect(await screen.findByText(/Dataset ready/)).toBeInTheDocument()
    await waitFor(() => expect(handledId).toBe(completed.import_id))
  })

  it('does not auto-split a completed import that has no pending entry', async () => {
    const completed = { ...sampleImportInfo, status: 'completed' as const, dataset_id: 'ds_new' }
    server.use(listDatasetImportsHandler([completed]))

    let splitCalled = false
    server.use(
      http.post('/api/v1/datasets/:id/split', () => {
        splitCalled = true
        return HttpResponse.json(sampleImportInfo)
      }),
    )

    renderSection()
    await screen.findByText(completed.hf_dataset_id)

    expect(splitCalled).toBe(false)
  })
})
