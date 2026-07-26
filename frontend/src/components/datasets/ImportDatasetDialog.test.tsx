import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@testing-library/react'
import { server } from '../../test/server'
import { ToastProvider } from '../common/Toast'
import { ImportDatasetDialog } from './ImportDatasetDialog'

const HF_DATASET_ID = 'mlx-community/wikisql'

function renderDialog(onImportQueued: (...args: unknown[]) => void = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ImportDatasetDialog
          open
          hfDatasetId={HF_DATASET_ID}
          onClose={() => {}}
          onImportQueued={onImportQueued}
        />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function mockImportEndpoint() {
  let capturedBody: unknown = null
  server.use(
    http.post('/api/v1/datasets/import', async ({ request }) => {
      capturedBody = await request.json()
      return HttpResponse.json({ import_id: 'di_1', dataset_id: HF_DATASET_ID }, { status: 202 })
    }),
  )
  return () => capturedBody
}

describe('ImportDatasetDialog column mapping', () => {
  it('sends no column_map by default (auto-detect)', async () => {
    const user = userEvent.setup()
    const getBody = mockImportEndpoint()

    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => expect(getBody()).not.toBeNull())
    const body = getBody() as Record<string, unknown>
    expect('column_map' in body).toBe(false)
    expect(body).toEqual({
      dataset_id: HF_DATASET_ID,
      config: null,
      split: 'train',
      name: null,
      max_rows: 5000,
    })
  })

  it('sends column_map with the mapped keys once a format is selected and filled in', async () => {
    const user = userEvent.setup()
    const getBody = mockImportEndpoint()

    renderDialog()

    await user.selectOptions(screen.getByLabelText('Target format'), 'GRPO')
    await user.type(screen.getByLabelText('prompt'), 'problem')
    await user.type(screen.getByLabelText('answer'), 'solution')

    await user.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => expect(getBody()).not.toBeNull())
    const body = getBody() as Record<string, unknown>
    expect(body.column_map).toEqual({ prompt: 'problem', answer: 'solution' })
  })

  it('disables submit while a required column for the selected format is empty', async () => {
    const user = userEvent.setup()
    mockImportEndpoint()

    renderDialog()

    await user.selectOptions(screen.getByLabelText('Target format'), 'GRPO')
    await user.type(screen.getByLabelText('prompt'), 'problem')
    // 'answer' left empty.

    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(
      screen.getByText('Fill in all required columns for this format before continuing.'),
    ).toBeInTheDocument()
  })

  it('omits an optional column (grpo system) from column_map when left blank', async () => {
    const user = userEvent.setup()
    const getBody = mockImportEndpoint()

    renderDialog()

    await user.selectOptions(screen.getByLabelText('Target format'), 'GRPO')
    await user.type(screen.getByLabelText('prompt'), 'problem')
    await user.type(screen.getByLabelText('answer'), 'solution')
    // 'system (optional)' left blank.

    await user.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => expect(getBody()).not.toBeNull())
    const body = getBody() as Record<string, unknown>
    expect(body.column_map).toEqual({ prompt: 'problem', answer: 'solution' })
    expect(body.column_map).not.toHaveProperty('system')
  })
})
