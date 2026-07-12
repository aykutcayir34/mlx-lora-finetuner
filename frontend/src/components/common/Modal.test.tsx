import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './Modal'

describe('Modal', () => {
  it('renders nothing when open is false', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hidden">
        <p>content</p>
      </Modal>,
    )

    expect(screen.queryByText('content')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders content and title when open is true', () => {
    render(
      <Modal open={true} onClose={() => {}} title="My Title">
        <p>content</p>
      </Modal>,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('My Title')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose} title="My Title">
        <p>content</p>
      </Modal>,
    )

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = render(
      <Modal open={true} onClose={onClose} title="My Title">
        <p>content</p>
      </Modal>,
    )

    const backdrop = container.querySelector('[aria-hidden="true"]')
    expect(backdrop).not.toBeNull()
    await user.click(backdrop as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
