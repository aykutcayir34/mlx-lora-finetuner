import { describe, expect, it } from 'vitest'
import { renderWithProviders, screen } from '../../test/render'
import { OnboardingGuide } from './OnboardingGuide'

describe('OnboardingGuide', () => {
  it('renders the 3-step guide with links to models, datasets and train', () => {
    renderWithProviders(<OnboardingGuide />)

    expect(screen.getByText('Getting started')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to models' })).toHaveAttribute('href', '/models')
    expect(screen.getByRole('link', { name: 'Go to datasets' })).toHaveAttribute(
      'href',
      '/datasets',
    )
    expect(screen.getByRole('link', { name: 'Go to training' })).toHaveAttribute('href', '/train')
  })
})
