import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MetricEvent } from '../../api/types'
import { downsample } from './downsample'

const GRID_COLOR = 'var(--color-border)'
const AXIS_COLOR = 'var(--color-text-muted)'
const MEMORY_COLOR = 'var(--color-accent-strong)'
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-surface-raised)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
}

interface MemoryChartProps {
  data: MetricEvent[]
}

export function MemoryChart({ data }: MemoryChartProps) {
  const points = downsample(data.filter((event) => event.peak_memory_gb !== null))

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-8 text-sm text-text-muted">
        No metrics yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={points} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
        <XAxis
          dataKey="step"
          type="number"
          stroke={AXIS_COLOR}
          tick={{ fill: AXIS_COLOR }}
          label={{ value: 'Step', position: 'insideBottom', offset: -4, fill: AXIS_COLOR }}
        />
        <YAxis
          dataKey="peak_memory_gb"
          stroke={AXIS_COLOR}
          tick={{ fill: AXIS_COLOR }}
          label={{
            value: 'Peak memory (GB)',
            angle: -90,
            position: 'insideLeft',
            fill: AXIS_COLOR,
          }}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: AXIS_COLOR }} />
        <Line
          type="monotone"
          dataKey="peak_memory_gb"
          name="Peak memory"
          stroke={MEMORY_COLOR}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
