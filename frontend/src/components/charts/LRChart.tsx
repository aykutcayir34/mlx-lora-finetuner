import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useTranslation } from 'react-i18next'
import type { MetricEvent } from '../../api/types'
import { downsample } from './downsample'

const GRID_COLOR = 'var(--color-border)'
const AXIS_COLOR = 'var(--color-text-muted)'
const LR_COLOR = 'var(--color-accent)'
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-surface-raised)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
}

interface LRChartProps {
  data: MetricEvent[]
}

export function LRChart({ data }: LRChartProps) {
  const { t } = useTranslation('train')
  const points = downsample(
    data.filter((event) => event.kind === 'train' && event.learning_rate !== null),
  )

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-8 text-sm text-text-muted">
        {t('charts.empty')}
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
          label={{ value: t('charts.step'), position: 'insideBottom', offset: -4, fill: AXIS_COLOR }}
        />
        <YAxis
          dataKey="learning_rate"
          stroke={AXIS_COLOR}
          tick={{ fill: AXIS_COLOR }}
          label={{
            value: t('charts.learningRate'),
            angle: -90,
            position: 'insideLeft',
            fill: AXIS_COLOR,
          }}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: AXIS_COLOR }} />
        <Line
          type="monotone"
          dataKey="learning_rate"
          name={t('charts.learningRate')}
          stroke={LR_COLOR}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
