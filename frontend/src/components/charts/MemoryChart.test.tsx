import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { MetricEvent } from '../../api/types'
import { MemoryChart } from './MemoryChart'

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

describe('MemoryChart', () => {
  it('renders without throwing given metric data with memory readings', () => {
    const data: MetricEvent[] = [
      makeEvent({ step: 0, kind: 'train', peak_memory_gb: 4.1 }),
      makeEvent({ step: 1, kind: 'train', peak_memory_gb: 4.3 }),
    ]

    const { container } = render(<MemoryChart data={data} />)

    expect(container.querySelector('.recharts-responsive-container')).toBeTruthy()
    expect(screen.getByText('Peak memory (GB)')).toBeInTheDocument()
  })

  it('renders the empty state when given no data', () => {
    render(<MemoryChart data={[]} />)

    expect(screen.getByText('No metrics yet')).toBeInTheDocument()
  })

  it('renders the empty state when all memory values are null', () => {
    const data: MetricEvent[] = [makeEvent({ step: 0, kind: 'train', peak_memory_gb: null })]

    render(<MemoryChart data={data} />)

    expect(screen.getByText('No metrics yet')).toBeInTheDocument()
  })
})
