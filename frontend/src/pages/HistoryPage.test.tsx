import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { HistoryPage } from './HistoryPage'
import { AppRoutes } from '../App'
import { makeRunSummary } from '../test/handlers/training'
import {
  cloneRunHandler,
  cloneRunNotFoundHandler,
  listRunHistoryHandler,
  listRunHistoryHandlerSpy,
} from '../test/handlers/history'

// Recharts' ResponsiveContainer measures its DOM node via ResizeObserver +
// getBoundingClientRect, both of which jsdom leaves at zero size.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 500, height: 300, top: 0, left: 0, bottom: 300, right: 500, x: 0, y: 0 }) as DOMRect
})
afterAll(() => {
  vi.unstubAllGlobals()
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
})

beforeEach(() => {
  sessionStorage.clear()
})
afterEach(() => {
  sessionStorage.clear()
})

describe('HistoryPage', () => {
  it('renders the run table with filtered runs', async () => {
    const run = makeRunSummary({ run_id: 'run_1', name: 'first-run' })
    server.use(listRunHistoryHandler([run], 1))

    renderWithProviders(<HistoryPage />)

    const table = await screen.findByTestId('history-table')
    expect(within(table).getByText('first-run')).toBeInTheDocument()
    expect(within(table).getByText(run.config.model_id)).toBeInTheDocument()
    expect(within(table).getByText(run.config.dataset_id)).toBeInTheDocument()
  })

  it('shows an empty state when no runs match the filters', async () => {
    server.use(listRunHistoryHandler([], 0))

    renderWithProviders(<HistoryPage />)

    expect(await screen.findByText('No runs found')).toBeInTheDocument()
  })

  it('drives GET /runs/history query params from the filter bar', async () => {
    const user = userEvent.setup()
    const requests: URL[] = []
    const run = makeRunSummary({ run_id: 'run_1', name: 'first-run' })
    server.use(listRunHistoryHandlerSpy((url) => requests.push(url), [run], 1))

    renderWithProviders(<HistoryPage />)
    await screen.findByTestId('history-table')

    expect(requests.at(-1)?.searchParams.get('sort')).toBe('-created_at')
    expect(requests.at(-1)?.searchParams.has('model_id')).toBe(false)

    await user.selectOptions(screen.getByLabelText('Status'), 'failed')
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('status')).toBe('failed'))

    await user.selectOptions(screen.getByLabelText('Mode'), 'dpo')
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('train_mode')).toBe('dpo'))

    await user.selectOptions(screen.getByLabelText('Sort'), 'final_train_loss')
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('sort')).toBe('final_train_loss'))

    await user.selectOptions(screen.getByLabelText('Model'), run.config.model_id)
    await waitFor(() =>
      expect(requests.at(-1)?.searchParams.get('model_id')).toBe(run.config.model_id),
    )
  })

  it("changing filters resets the selected run's detail panel", async () => {
    const user = userEvent.setup()
    const run = makeRunSummary({ run_id: 'run_1', name: 'first-run' })
    server.use(listRunHistoryHandler([run], 1))

    renderWithProviders(<HistoryPage />)
    const table = await screen.findByTestId('history-table')
    await user.click(within(table).getByText('first-run'))
    expect(await screen.findByTestId('run-detail-panel')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Status'), 'failed')
    await waitFor(() => expect(screen.queryByTestId('run-detail-panel')).not.toBeInTheDocument())
  })

  it('selects a run and shows its config in the detail panel', async () => {
    const user = userEvent.setup()
    const run = makeRunSummary({ run_id: 'run_1', name: 'first-run' })
    server.use(listRunHistoryHandler([run], 1))

    renderWithProviders(<HistoryPage />)
    const table = await screen.findByTestId('history-table')
    await user.click(within(table).getByText('first-run'))

    const panel = await screen.findByTestId('run-detail-panel')
    await user.click(within(panel).getByRole('tab', { name: 'Config' }))
    expect(within(panel).getByText(run.config.dataset_id)).toBeInTheDocument()
    expect(within(panel).getByText(run.config.model_id)).toBeInTheDocument()
  })

  it("fetches and renders the selected run's metrics as charts", async () => {
    const user = userEvent.setup()
    const run = makeRunSummary({ run_id: 'run_1', name: 'first-run' })
    server.use(listRunHistoryHandler([run], 1))
    server.use(
      http.get('/api/v1/train/jobs/:runId/metrics', () =>
        HttpResponse.json({
          metrics: [
            {
              run_id: 'run_1',
              step: 0,
              kind: 'train',
              loss: 2.1,
              learning_rate: 1e-5,
              it_per_sec: 3,
              tokens_per_sec: 100,
              peak_memory_gb: 4,
              ts: '2026-07-12T10:00:00Z',
            },
          ],
        }),
      ),
    )

    renderWithProviders(<HistoryPage />)
    const table = await screen.findByTestId('history-table')
    await user.click(within(table).getByText('first-run'))

    const panel = await screen.findByTestId('run-detail-panel')
    expect(await within(panel).findByText('Train loss')).toBeInTheDocument()
  })

  it('offers an Export YAML download link for the selected run', async () => {
    const user = userEvent.setup()
    const run = makeRunSummary({ run_id: 'run_1', name: 'first-run' })
    server.use(listRunHistoryHandler([run], 1))

    renderWithProviders(<HistoryPage />)
    const table = await screen.findByTestId('history-table')
    await user.click(within(table).getByText('first-run'))

    const panel = await screen.findByTestId('run-detail-panel')
    const link = within(panel).getByRole('link', { name: 'Export YAML' })
    expect(link).toHaveAttribute('href', '/api/v1/train/jobs/run_1/config.yaml')
    expect(link).toHaveAttribute('download')
  })

  it('clones a run: navigates to /train with the config prefilled', async () => {
    const user = userEvent.setup()
    const run = makeRunSummary({ run_id: 'run_1', name: 'first-run' })
    server.use(listRunHistoryHandler([run], 1))
    server.use(cloneRunHandler(run.config))

    renderWithProviders(<AppRoutes />, { route: '/history' })
    const table = await screen.findByTestId('history-table')
    await user.click(within(table).getByText('first-run'))

    const panel = await screen.findByTestId('run-detail-panel')
    await user.click(within(panel).getByRole('button', { name: 'Clone' }))

    expect(await screen.findByRole('heading', { name: 'Train' })).toBeInTheDocument()
    // TrainPage reads the cloned config from router state and prefills the form.
    expect(await screen.findByDisplayValue(run.config.name)).toBeInTheDocument()
  })

  it('surfaces an error and does not navigate when clone fails', async () => {
    const user = userEvent.setup()
    const run = makeRunSummary({ run_id: 'run_1', name: 'first-run' })
    server.use(listRunHistoryHandler([run], 1))
    server.use(cloneRunNotFoundHandler())

    renderWithProviders(<HistoryPage />)
    const table = await screen.findByTestId('history-table')
    await user.click(within(table).getByText('first-run'))

    const panel = await screen.findByTestId('run-detail-panel')
    await user.click(within(panel).getByRole('button', { name: 'Clone' }))

    expect(await within(panel).findByText('Failed to clone this run.')).toBeInTheDocument()
    // Still on the History page — no navigation happened.
    expect(screen.queryByRole('heading', { name: 'Train' })).not.toBeInTheDocument()
  })

  it('shows a diff between two runs highlighting changed fields', async () => {
    const user = userEvent.setup()
    const base = makeRunSummary()
    const runA = makeRunSummary({
      run_id: 'run_1',
      name: 'run-a',
      config: { ...base.config, dataset_id: 'ds_1' },
    })
    const runB = makeRunSummary({
      run_id: 'run_2',
      name: 'run-b',
      config: { ...base.config, dataset_id: 'ds_2' },
    })
    server.use(listRunHistoryHandler([runA, runB], 2))

    renderWithProviders(<HistoryPage />)
    const table = await screen.findByTestId('history-table')
    await user.click(within(table).getByText('run-a'))

    const panel = await screen.findByTestId('run-detail-panel')
    await user.click(within(panel).getByRole('tab', { name: 'Diff' }))
    await user.selectOptions(within(panel).getByLabelText('Compare against'), 'run_2')

    const row = within(panel).getByText('dataset_id').closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('ds_1')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText('ds_2')).toBeInTheDocument()
    expect((row as HTMLElement).querySelectorAll('[data-changed="true"]').length).toBe(2)
  })
})
