import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { MetricEvent } from '../../api/types'
import { LossChart } from './LossChart'

// Recharts' ResponsiveContainer measures its DOM node via ResizeObserver +
// getBoundingClientRect, both of which jsdom leaves at zero size. Stubbing them
// lets the chart actually render its SVG contents (legend, axis labels, ...)
// instead of bailing out to an empty, zero-size wrapper.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 500, height: 300, top: 0, left: 0, bottom: 300, right: 500, x: 0, y: 0 }) as DOMRect
})

afterAll(() => {
  vi.unstubAllGlobals()
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
})

function makeEvent(overrides: Partial<MetricEvent>): MetricEvent {
  return {
    run_id: 'run-1',
    step: 0,
    kind: 'train',
    loss: 1,
    learning_rate: 0.001,
    it_per_sec: 1,
    tokens_per_sec: 100,
    peak_memory_gb: 4,
    ts: '2026-07-12T00:00:00Z',
    ...overrides,
  }
}

describe('LossChart', () => {
  it('renders train and val legend labels without throwing given metric data', () => {
    const data: MetricEvent[] = [
      makeEvent({ step: 0, kind: 'train', loss: 2 }),
      makeEvent({ step: 1, kind: 'train', loss: 1.5 }),
      makeEvent({ step: 0, kind: 'val', loss: 2.2 }),
      makeEvent({ step: 1, kind: 'val', loss: 1.8 }),
    ]

    const { container } = render(<LossChart data={data} />)

    expect(container.querySelector('.recharts-responsive-container')).toBeTruthy()
    expect(screen.getByText('Train loss')).toBeInTheDocument()
    expect(screen.getByText('Val loss')).toBeInTheDocument()
  })

  it('renders the empty state when given no data', () => {
    render(<LossChart data={[]} />)

    expect(screen.getByText('No metrics yet')).toBeInTheDocument()
  })

  it('renders the empty state when all loss values are null', () => {
    const data: MetricEvent[] = [
      makeEvent({ step: 0, kind: 'train', loss: null }),
      makeEvent({ step: 0, kind: 'val', loss: null }),
    ]

    render(<LossChart data={data} />)

    expect(screen.getByText('No metrics yet')).toBeInTheDocument()
  })
})
