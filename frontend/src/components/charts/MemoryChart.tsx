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
import { useTranslation } from 'react-i18next'
import type { MetricEvent } from '../../api/types'
import { downsample } from './downsample'
import { COMPARE_COLOR, COMPARE_DASH, type CompareSeries } from './compare'

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
  compare?: CompareSeries
}

export function MemoryChart({ data, compare }: MemoryChartProps) {
  const { t } = useTranslation('train')
  const points = downsample(data.filter((event) => event.peak_memory_gb !== null))
  const comparePoints = compare
    ? downsample(compare.data.filter((event) => event.peak_memory_gb !== null))
    : []
  const hasCompare = comparePoints.length > 0

  if (points.length === 0 && !hasCompare) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-8 text-sm text-text-muted">
        {t('charts.empty')}
      </div>
    )
  }

  return (
    // Two runs end at different steps, so each line carries its own data while
    // comparing; without a comparison the chart keeps its original single
    // dataset shape.
    <ResponsiveContainer width="100%" height={300}>
      <LineChart
        data={hasCompare ? undefined : points}
        margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
      >
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
        <XAxis
          dataKey="step"
          type="number"
          stroke={AXIS_COLOR}
          tick={{ fill: AXIS_COLOR }}
          label={{ value: t('charts.step'), position: 'insideBottom', offset: -4, fill: AXIS_COLOR }}
        />
        <YAxis
          dataKey="peak_memory_gb"
          stroke={AXIS_COLOR}
          tick={{ fill: AXIS_COLOR }}
          label={{
            value: t('charts.peakMemoryGb'),
            angle: -90,
            position: 'insideLeft',
            fill: AXIS_COLOR,
          }}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: AXIS_COLOR }} />
        {hasCompare && <Legend />}
        <Line
          data={hasCompare ? points : undefined}
          type="monotone"
          dataKey="peak_memory_gb"
          name={
            hasCompare && compare
              ? t('charts.seriesRun', { series: t('charts.peakMemory'), run: compare.baseLabel })
              : t('charts.peakMemory')
          }
          stroke={MEMORY_COLOR}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        {hasCompare && compare && (
          <Line
            data={comparePoints}
            type="monotone"
            dataKey="peak_memory_gb"
            name={t('charts.seriesRun', { series: t('charts.peakMemory'), run: compare.label })}
            stroke={COMPARE_COLOR}
            strokeDasharray={COMPARE_DASH}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}
