import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { AppRoutes } from './App'
import { renderWithProviders } from './test/render'

const CASES: Array<[route: string, heading: string]> = [
  ['/', 'Dashboard'],
  ['/models', 'Models'],
  ['/datasets', 'Datasets'],
  ['/train', 'Train'],
  ['/chat', 'Chat'],
  ['/export', 'Export'],
]

describe('AppRoutes', () => {
  it.each(CASES)('renders the %s page at %s', (route, heading) => {
    renderWithProviders(<AppRoutes />, { route })

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByText('Coming in Wave 2')).toBeInTheDocument()
  })

  it('renders the layout shell (side nav + top bar) on every route', () => {
    renderWithProviders(<AppRoutes />, { route: '/models' })

    expect(screen.getByText('MLX LoRA Finetuner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })
})
