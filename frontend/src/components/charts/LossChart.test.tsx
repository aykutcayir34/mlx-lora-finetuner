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

  it('renders only the base run series when no compare prop is given', () => {
    const data: MetricEvent[] = [
      makeEvent({ step: 0, kind: 'train', loss: 2 }),
      makeEvent({ step: 1, kind: 'train', loss: 1.5 }),
    ]

    const { container } = render(<LossChart data={data} />)

    // Plain, un-suffixed legend labels and no dashed comparison curve.
    expect(screen.getByText('Train loss')).toBeInTheDocument()
    expect(screen.queryByText(/Train loss ·/)).not.toBeInTheDocument()
    const dashed = Array.from(container.querySelectorAll('.recharts-line-curve')).filter((path) =>
      path.getAttribute('stroke-dasharray'),
    )
    expect(dashed).toHaveLength(0)
  })

  it('overlays a comparison run as a second, visually distinct series', () => {
    const data: MetricEvent[] = [
      makeEvent({ step: 0, kind: 'train', loss: 2 }),
      makeEvent({ step: 1, kind: 'train', loss: 1.5 }),
    ]
    const compareData: MetricEvent[] = [
      makeEvent({ run_id: 'run-2', step: 0, kind: 'train', loss: 3 }),
      makeEvent({ run_id: 'run-2', step: 1, kind: 'train', loss: 2.5 }),
      makeEvent({ run_id: 'run-2', step: 2, kind: 'train', loss: 2.2 }),
    ]

    const { container } = render(
      <LossChart
        data={data}
        compare={{ data: compareData, label: 'run-b', baseLabel: 'run-a' }}
      />,
    )

    // Legend names both runs.
    expect(screen.getByText('Train loss · run-a')).toBeInTheDocument()
    expect(screen.getByText('Train loss · run-b')).toBeInTheDocument()

    const curves = Array.from(container.querySelectorAll('.recharts-line-curve'))
    const dashed = curves.filter((path) => path.getAttribute('stroke-dasharray'))
    // Exactly one dashed curve (the comparison run) and it uses its own colour.
    expect(dashed).toHaveLength(1)
    expect(dashed[0].getAttribute('stroke')).toBe('var(--color-compare)')
    expect(dashed[0].getAttribute('stroke')).not.toBe(
      curves.find((path) => !path.getAttribute('stroke-dasharray'))?.getAttribute('stroke'),
    )
  })

  it('ignores the comparison run val series so only two loss curves are drawn', () => {
    const data: MetricEvent[] = [makeEvent({ step: 0, kind: 'train', loss: 2 })]
    const compareData: MetricEvent[] = [
      makeEvent({ run_id: 'run-2', step: 0, kind: 'train', loss: 3 }),
      makeEvent({ run_id: 'run-2', step: 0, kind: 'val', loss: 3.4 }),
    ]

    render(
      <LossChart
        data={data}
        compare={{ data: compareData, label: 'run-b', baseLabel: 'run-a' }}
      />,
    )

    expect(screen.getByText('Train loss · run-b')).toBeInTheDocument()
    expect(screen.queryByText('Val loss · run-b')).not.toBeInTheDocument()
  })

  it('keeps rendering the base run when the comparison run has no metrics', () => {
    const data: MetricEvent[] = [
      makeEvent({ step: 0, kind: 'train', loss: 2 }),
      makeEvent({ step: 1, kind: 'train', loss: 1.5 }),
    ]

    const { container } = render(
      <LossChart data={data} compare={{ data: [], label: 'run-b', baseLabel: 'run-a' }} />,
    )

    expect(screen.getByText('Train loss')).toBeInTheDocument()
    expect(
      Array.from(container.querySelectorAll('.recharts-line-curve')).filter((path) =>
        path.getAttribute('stroke-dasharray'),
      ),
    ).toHaveLength(0)
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
