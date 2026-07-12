import {
  CartesianGrid,
  Legend,
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
const TRAIN_COLOR = 'var(--color-accent)'
const VAL_COLOR = 'var(--color-success)'
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-surface-raised)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
}

interface LossChartProps {
  data: MetricEvent[]
}

export function LossChart({ data }: LossChartProps) {
  const trainPoints = downsample(
    data.filter((event) => event.kind === 'train' && event.loss !== null),
  )
  const valPoints = downsample(data.filter((event) => event.kind === 'val' && event.loss !== null))

  if (trainPoints.length === 0 && valPoints.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-8 text-sm text-text-muted">
        No metrics yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
        <XAxis
          dataKey="step"
          type="number"
          allowDuplicatedCategory={false}
          stroke={AXIS_COLOR}
          tick={{ fill: AXIS_COLOR }}
          label={{ value: 'Step', position: 'insideBottom', offset: -4, fill: AXIS_COLOR }}
        />
        <YAxis
          dataKey="loss"
          stroke={AXIS_COLOR}
          tick={{ fill: AXIS_COLOR }}
          label={{ value: 'Loss', angle: -90, position: 'insideLeft', fill: AXIS_COLOR }}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: AXIS_COLOR }} />
        <Legend />
        <Line
          data={trainPoints}
          type="monotone"
          dataKey="loss"
          name="Train loss"
          stroke={TRAIN_COLOR}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          data={valPoints}
          type="monotone"
          dataKey="loss"
          name="Val loss"
          stroke={VAL_COLOR}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
