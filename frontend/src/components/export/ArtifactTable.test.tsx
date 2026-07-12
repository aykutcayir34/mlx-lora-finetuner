import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderWithProviders, screen } from '../../test/render'
import { server } from '../../test/server'
import { exportHandlers } from '../../test/handlers/export'
import { ArtifactTable } from './ArtifactTable'

describe('ArtifactTable', () => {
  it('renders artifact kinds, human-readable sizes and source runs', async () => {
    server.use(...exportHandlers)
    renderWithProviders(<ArtifactTable />)

    expect(await screen.findByText('fused')).toBeInTheDocument()
    expect(screen.getByText('gguf')).toBeInTheDocument()
    expect(screen.getByText('256.0 MB')).toBeInTheDocument()
    expect(screen.getByText('128.0 MB')).toBeInTheDocument()
    expect(screen.getAllByText('run_abc')).toHaveLength(2)
  })

  it('shows an empty state when there are no artifacts', async () => {
    server.use(...exportHandlers)
    server.use(http.get('/api/v1/export/artifacts', () => HttpResponse.json({ artifacts: [] })))

    renderWithProviders(<ArtifactTable />)

    expect(await screen.findByText('No artifacts yet')).toBeInTheDocument()
  })
})
