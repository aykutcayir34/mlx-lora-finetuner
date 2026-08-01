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
const TRAIN_COLOR = 'var(--color-accent)'
const VAL_COLOR = 'var(--color-success)'
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-surface-raised)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
}

interface LossChartProps {
  data: MetricEvent[]
  compare?: CompareSeries
}

export function LossChart({ data, compare }: LossChartProps) {
  const { t } = useTranslation('train')
  const trainPoints = downsample(
    data.filter((event) => event.kind === 'train' && event.loss !== null),
  )
  const valPoints = downsample(data.filter((event) => event.kind === 'val' && event.loss !== null))
  // Only the comparison run's *train* loss is overlaid: four lines on one axis
  // is unreadable, and train loss is the one series every run always has.
  const comparePoints = compare
    ? downsample(compare.data.filter((event) => event.kind === 'train' && event.loss !== null))
    : []
  const hasCompare = comparePoints.length > 0

  if (trainPoints.length === 0 && valPoints.length === 0 && !hasCompare) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-8 text-sm text-text-muted">
        {t('charts.empty')}
      </div>
    )
  }

  // Legend labels only carry the run name while a comparison is active, so the
  // single-run chart keeps its original wording.
  const seriesName = (series: string) =>
    hasCompare && compare ? t('charts.seriesRun', { series, run: compare.baseLabel }) : series

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
          label={{ value: t('charts.step'), position: 'insideBottom', offset: -4, fill: AXIS_COLOR }}
        />
        <YAxis
          dataKey="loss"
          stroke={AXIS_COLOR}
          tick={{ fill: AXIS_COLOR }}
          label={{ value: t('charts.loss'), angle: -90, position: 'insideLeft', fill: AXIS_COLOR }}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: AXIS_COLOR }} />
        <Legend />
        <Line
          data={trainPoints}
          type="monotone"
          dataKey="loss"
          name={seriesName(t('charts.trainLoss'))}
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
          name={seriesName(t('charts.valLoss'))}
          stroke={VAL_COLOR}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        {hasCompare && compare && (
          <Line
            data={comparePoints}
            type="monotone"
            dataKey="loss"
            name={t('charts.seriesRun', { series: t('charts.trainLoss'), run: compare.label })}
            stroke={COMPARE_COLOR}
            strokeDasharray={COMPARE_DASH}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}
