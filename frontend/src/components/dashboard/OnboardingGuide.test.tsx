import { describe, expect, it } from 'vitest'
import { renderWithProviders, screen } from '../../test/render'
import { OnboardingGuide } from './OnboardingGuide'

describe('OnboardingGuide', () => {
  it('renders the 3-step guide with links to models, datasets and train', () => {
    renderWithProviders(<OnboardingGuide />)

    expect(screen.getByText('Başlarken')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Modellere git' })).toHaveAttribute('href', '/models')
    expect(screen.getByRole('link', { name: 'Datasetlere git' })).toHaveAttribute(
      'href',
      '/datasets',
    )
    expect(screen.getByRole('link', { name: 'Eğitime git' })).toHaveAttribute('href', '/train')
  })
})
