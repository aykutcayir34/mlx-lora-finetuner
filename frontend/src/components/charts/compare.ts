import type { MetricEvent } from '../../api/types'

/**
 * Optional second run overlaid on a metrics chart so two experiments can be
 * read curve-by-curve. Alignment is purely by `step` on the x-axis: runs with
 * different `iters` simply end at different points, nothing is truncated or
 * resampled.
 */
export interface CompareSeries {
  /** Persisted metrics of the run being compared against. */
  data: MetricEvent[]
  /** Display name of the comparison run, used in the legend. */
  label: string
  /** Display name of the base run, used in the legend. */
  baseLabel: string
}

// The comparison series must stay tellable-apart in greyscale and for
// colour-blind viewers, so it differs from the base run by hue *and* by stroke
// pattern rather than by colour alone.
export const COMPARE_COLOR = 'var(--color-compare)'
export const COMPARE_DASH = '6 4'
