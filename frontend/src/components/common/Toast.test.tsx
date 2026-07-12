import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider, useToast } from './Toast'

function TestHarness() {
  const { toast } = useToast()
  return (
    <button type="button" onClick={() => toast('hello')}>
      Fire
    </button>
  )
}

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a toast and auto-dismisses it after the default duration', () => {
    vi.useFakeTimers()

    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    )

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Fire' }))
    })
    expect(screen.getByText('hello')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(4000)
    })

    expect(screen.queryByText('hello')).not.toBeInTheDocument()
  })

  it('dismisses a toast manually via the close button', async () => {
    const user = userEvent.setup()

    render(
      <ToastProvider>
        <TestHarness />
      </ToastProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Fire' }))
    expect(screen.getByText('hello')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
  })
})
