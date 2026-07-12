import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import { renderWithProviders } from '../test/render'
import { TrainPage } from './TrainPage'
import { makeRunSummary, trainingHandlers } from '../test/handlers/training'
import { DEFAULT_TRAINING_CONFIG } from '../components/training/defaults'

describe('TrainPage', () => {
  it('shows the config form when there is no active run', async () => {
    server.use(...trainingHandlers)

    renderWithProviders(<TrainPage />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start training' })).toBeInTheDocument())
  })

  it('defaults to the live monitor when an active run already exists', async () => {
    server.use(
      ...trainingHandlers,
      http.get('/api/v1/train/jobs', () =>
        HttpResponse.json({ runs: [makeRunSummary({ run_id: 'run_active', status: 'running' })], total: 1 }),
      ),
      http.get('/api/v1/train/jobs/run_active', () =>
        HttpResponse.json(makeRunSummary({ run_id: 'run_active', status: 'running' })),
      ),
    )

    renderWithProviders(<TrainPage />)

    await screen.findByText('my-run')
    expect(screen.queryByRole('button', { name: 'Start training' })).not.toBeInTheDocument()
  })

  it('prefills the form from a cloned config in router navigation state', async () => {
    server.use(...trainingHandlers)

    renderWithProviders(<TrainPage />, {
      route: '/train',
      routeState: {
        cloneConfig: { ...DEFAULT_TRAINING_CONFIG, name: 'cloned-run', iters: 1234 },
      },
    })

    await waitFor(() => expect(screen.getByDisplayValue('cloned-run')).toBeInTheDocument())
    expect(screen.getByDisplayValue('1234')).toBeInTheDocument()
  })
})
