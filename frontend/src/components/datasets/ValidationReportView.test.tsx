import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../../test/server'
import { ValidationReportView } from './ValidationReportView'
import { validateDatasetHandler } from '../../test/handlers/datasets'

function renderReport() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ValidationReportView datasetId="ds_chat" />
    </QueryClientProvider>,
  )
}

describe('ValidationReportView', () => {
  it('runs validation on demand and renders the report with line errors and warnings', async () => {
    const user = userEvent.setup()
    server.use(
      validateDatasetHandler({
        dataset_id: 'ds_chat',
        format: 'chat',
        valid_rows: 198,
        total_rows: 200,
        errors: [{ line: 7, message: "missing 'messages' key" }],
        warnings: [{ line: 12, message: 'empty assistant turn' }],
      }),
    )

    renderReport()

    // No report until the user runs validation.
    expect(screen.queryByText(/rows valid/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Run validation' }))

    expect(await screen.findByText(/rows valid/)).toBeInTheDocument()
    expect(screen.getByText('198', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText("missing 'messages' key")).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('empty assistant turn')).toBeInTheDocument()
    expect(screen.getByText('Errors')).toBeInTheDocument()
    expect(screen.getByText('Warnings')).toBeInTheDocument()
  })

  it('shows a clean message when there are no errors or warnings', async () => {
    const user = userEvent.setup()
    server.use(
      validateDatasetHandler({
        dataset_id: 'ds_chat',
        format: 'chat',
        valid_rows: 10,
        total_rows: 10,
        errors: [],
        warnings: [],
      }),
    )

    renderReport()
    await user.click(screen.getByRole('button', { name: 'Run validation' }))

    expect(await screen.findByText('No issues found.')).toBeInTheDocument()
  })
})
