import { describe, expect, it } from 'vitest'
import { downsample } from './downsample'

describe('downsample', () => {
  it('returns input unchanged when shorter than max', () => {
    const points = [1, 2, 3, 4, 5]

    expect(downsample(points, 10)).toEqual(points)
  })

  it('returns input unchanged when equal to max', () => {
    const points = [1, 2, 3]

    expect(downsample(points, 3)).toEqual(points)
  })

  it('caps output to exactly max length when input is longer', () => {
    const points = Array.from({ length: 10_000 }, (_, i) => i)

    expect(downsample(points, 2000)).toHaveLength(2000)
  })

  it('preserves the first and last original elements', () => {
    const points = Array.from({ length: 5_000 }, (_, i) => ({ step: i }))

    const result = downsample(points, 500)

    expect(result[0]).toBe(points[0])
    expect(result[result.length - 1]).toBe(points[points.length - 1])
  })
})
