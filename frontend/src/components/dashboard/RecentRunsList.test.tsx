import { describe, expect, it } from 'vitest'
import { renderWithProviders, screen } from '../../test/render'
import { server } from '../../test/server'
import { makeRunSummary, runsHandler } from '../../test/handlers/dashboard'
import { RecentRunsList } from './RecentRunsList'

describe('RecentRunsList', () => {
  it('renders run statuses, mode/type, final loss and links each row to /train', async () => {
    const runs = [
      makeRunSummary({
        run_id: 'run_a',
        name: 'run-a',
        status: 'completed',
        final_train_loss: 0.512,
      }),
      makeRunSummary({ run_id: 'run_b', name: 'run-b', status: 'failed', final_train_loss: null }),
    ]
    server.use(runsHandler(runs))

    renderWithProviders(<RecentRunsList />)

    expect(await screen.findByText('run-a')).toBeInTheDocument()
    expect(screen.getByText('run-b')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('0.512')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getAllByText('sft / lora')).toHaveLength(2)

    const links = screen.getAllByRole('link', { name: 'View' })
    expect(links).toHaveLength(2)
    links.forEach((link) => expect(link).toHaveAttribute('href', '/train'))
  })

  it('renders an empty message when there are no runs', async () => {
    server.use(runsHandler([]))

    renderWithProviders(<RecentRunsList />)

    expect(await screen.findByText('No runs yet')).toBeInTheDocument()
  })
})
