import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/server'
import { useModels } from './models'
import { useCreateRun, useRuns } from './training'
import { useSystemStats } from './system'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { Wrapper, queryClient }
}

describe('useModels', () => {
  it('resolves with the models returned by GET /models', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useModels(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toHaveLength(2)
    expect(result.current.data?.[0].model_id).toBe('mlx-community/SmolLM-135M-Instruct-4bit')
    expect(result.current.data?.[1].model_id).toBe('mlx-community/Qwen2.5-0.5B-Instruct-4bit')
  })
})

function CreateRunProbe() {
  const runs = useRuns()
  const createRun = useCreateRun()
  return (
    <div>
      <span data-testid="runs-count">{runs.data?.runs.length ?? 0}</span>
      <span data-testid="first-run-id">{runs.data?.runs[0]?.run_id ?? ''}</span>
      <button onClick={() => createRun.mutate({} as never)}>create</button>
    </div>
  )
}

describe('useCreateRun', () => {
  it('invalidates the training runs query on success, refetching useRuns()', async () => {
    const { Wrapper } = createWrapper()

    render(<CreateRunProbe />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByTestId('runs-count')).toHaveTextContent('0'))

    // Seed a distinct response so we can prove a refetch actually happened.
    server.use(
      http.post('/api/v1/train/jobs', () =>
        HttpResponse.json(
          {
            run_id: 'run_created',
            name: 'created-run',
            status: 'queued',
            config: {},
            created_at: '2026-07-12T10:00:00Z',
            started_at: null,
            finished_at: null,
            final_train_loss: null,
            final_val_loss: null,
            adapter_path: null,
            error: null,
          },
          { status: 201 },
        ),
      ),
      http.get('/api/v1/train/jobs', () =>
        HttpResponse.json({
          runs: [
            {
              run_id: 'run_created',
              name: 'created-run',
              status: 'queued',
              config: {},
              created_at: '2026-07-12T10:00:00Z',
              started_at: null,
              finished_at: null,
              final_train_loss: null,
              final_val_loss: null,
              adapter_path: null,
              error: null,
            },
          ],
          total: 1,
        }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'create' }))

    // The mutation's onSuccess invalidates the ['training', 'runs'] prefix,
    // which should trigger a refetch of the already-mounted useRuns() query.
    await waitFor(() => expect(screen.getByTestId('first-run-id')).toHaveTextContent('run_created'))
  })
})

describe('useSystemStats', () => {
  it('surfaces isError when the backend errors', async () => {
    server.use(
      http.get('/api/v1/system/stats', () =>
        HttpResponse.json(
          { error: { code: 'internal', message: 'boom', detail: {} } },
          { status: 500 },
        ),
      ),
    )

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSystemStats(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
