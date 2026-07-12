import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field } from './Field'

describe('Field', () => {
  it('renders the label and error text', () => {
    render(
      <Field label="Name" error="Required">
        <input />
      </Field>,
    )

    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Required')).toBeInTheDocument()
  })
})
