import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/render'
import { SideNav } from './SideNav'

describe('SideNav', () => {
  it('marks the link matching the current route as active', () => {
    renderWithProviders(<SideNav />, { route: '/datasets' })

    const activeLink = screen.getByRole('link', { name: 'Datasets' })
    const dashboardLink = screen.getByRole('link', { name: 'Dashboard' })

    expect(activeLink).toHaveAttribute('aria-current', 'page')
    expect(activeLink.className).toContain('active')
    expect(dashboardLink).not.toHaveAttribute('aria-current')
    expect(dashboardLink.className).not.toContain('active')
  })

  it('marks the dashboard link active on the root route', () => {
    renderWithProviders(<SideNav />, { route: '/' })

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
