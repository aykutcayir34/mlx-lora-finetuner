// Evenly-spaced downsampling for chart series. Keeps chart rendering fast for
// long training runs (thousands of steps) without distorting the trend line.
export function downsample<T>(points: T[], max = 2000): T[] {
  if (points.length <= max) {
    return points
  }

  const result: T[] = new Array(max)
  const lastIndex = points.length - 1
  const step = lastIndex / (max - 1)

  for (let i = 0; i < max; i++) {
    result[i] = points[Math.round(i * step)]
  }
  // Guard against rounding drift so the last original point is always kept.
  result[max - 1] = points[lastIndex]

  return result
}
