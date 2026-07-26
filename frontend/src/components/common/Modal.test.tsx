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

  // jsdom does no layout, so this pins the structure that makes tall content
  // scrollable rather than the resulting geometry: the body scrolls, and the
  // footer sits outside it so its buttons cannot be scrolled out of reach.
  // The geometry itself is checked against a real browser.
  it('keeps the footer outside the scrollable body', () => {
    const { container } = render(
      <Modal open={true} onClose={() => {}} title="Tall" footer={<button>Import</button>}>
        <p>content</p>
      </Modal>,
    )

    const dialog = screen.getByRole('dialog')
    const body = container.querySelector('[data-modal-body]')
    expect(body).not.toBeNull()
    expect(body?.className).toContain('overflow-y-auto')
    expect(body?.className).toContain('min-h-0')
    expect(dialog.className).toContain('max-h-')

    const importButton = screen.getByRole('button', { name: 'Import' })
    expect(body?.contains(importButton)).toBe(false)
    expect(dialog.contains(importButton)).toBe(true)
  })
})
