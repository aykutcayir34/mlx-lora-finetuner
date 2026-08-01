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
  Element.prototype.getBoundingClientRect = function (this: Element) {
    // Recharts subtracts the measured legend height from the plot area; a
    // uniform 300px would leave zero height and skip drawing the curves.
    const height = this.classList?.contains('recharts-legend-wrapper') ? 24 : 300
    return {
      width: 500,
      height,
      top: 0,
      left: 0,
      bottom: height,
      right: 500,
      x: 0,
      y: 0,
    } as DOMRect
  }
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

  it('renders a single, solid series when no compare prop is given', () => {
    const data: MetricEvent[] = [
      makeEvent({ step: 0, peak_memory_gb: 4.1 }),
      makeEvent({ step: 1, peak_memory_gb: 4.3 }),
    ]

    const { container } = render(<MemoryChart data={data} />)

    const curves = Array.from(container.querySelectorAll('.recharts-line-curve'))
    expect(curves).toHaveLength(1)
    expect(curves[0].getAttribute('stroke-dasharray')).toBeNull()
    expect(container.querySelector('.recharts-legend-wrapper')).toBeNull()
  })

  it('overlays a comparison run as a dashed, differently coloured series', () => {
    const data: MetricEvent[] = [
      makeEvent({ step: 0, peak_memory_gb: 4.1 }),
      makeEvent({ step: 1, peak_memory_gb: 4.3 }),
    ]
    const compareData: MetricEvent[] = [
      makeEvent({ run_id: 'run-2', step: 0, peak_memory_gb: 6.1 }),
      makeEvent({ run_id: 'run-2', step: 1, peak_memory_gb: 6.4 }),
      makeEvent({ run_id: 'run-2', step: 2, peak_memory_gb: 6.6 }),
    ]

    const { container } = render(
      <MemoryChart
        data={data}
        compare={{ data: compareData, label: 'run-b', baseLabel: 'run-a' }}
      />,
    )

    expect(screen.getByText('Peak memory · run-a')).toBeInTheDocument()
    expect(screen.getByText('Peak memory · run-b')).toBeInTheDocument()

    const curves = Array.from(container.querySelectorAll('.recharts-line-curve'))
    expect(curves).toHaveLength(2)
    const dashed = curves.filter((path) => path.getAttribute('stroke-dasharray'))
    expect(dashed).toHaveLength(1)
    expect(dashed[0].getAttribute('stroke')).toBe('var(--color-compare)')
  })

  it('keeps rendering the base run when the comparison run has no metrics', () => {
    const data: MetricEvent[] = [
      makeEvent({ step: 0, peak_memory_gb: 4.1 }),
      makeEvent({ step: 1, peak_memory_gb: 4.3 }),
    ]

    const { container } = render(
      <MemoryChart data={data} compare={{ data: [], label: 'run-b', baseLabel: 'run-a' }} />,
    )

    expect(screen.getByText('Peak memory (GB)')).toBeInTheDocument()
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(1)
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
