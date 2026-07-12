import { useEffect, useRef } from 'react'
import { useRecipeJob } from '../../api/queries/recipes'
import type { RecipeJobInfo } from '../../api/types'
import { Badge } from '../common/Badge'
import { Card } from '../common/Card'
import { Spinner } from '../common/Spinner'

interface RecipeJobProgressProps {
  jobId: string | undefined
  datasetName?: string
  onSettled?: (job: RecipeJobInfo) => void
}

const STATUS_VARIANT = {
  running: 'info',
  completed: 'success',
  failed: 'danger',
} as const

/** Polls a running recipe conversion job and renders its status, row count,
 * a preview of the first emitted rows on success, or the error on failure. */
export function RecipeJobProgress({ jobId, datasetName, onSettled }: RecipeJobProgressProps) {
  const job = useRecipeJob(jobId)
  const settledFor = useRef<string | null>(null)

  useEffect(() => {
    if (!job.data || !jobId) return
    if (job.data.status === 'running') return
    if (settledFor.current === jobId) return
    settledFor.current = jobId
    onSettled?.(job.data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.data, jobId])

  if (!jobId) return null

  return (
    <Card title="Conversion job" className="mt-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {job.data ? (
            <Badge variant={STATUS_VARIANT[job.data.status]}>
              {job.data.status === 'running'
                ? 'Running'
                : job.data.status === 'completed'
                  ? 'Completed'
                  : 'Failed'}
            </Badge>
          ) : (
            <span className="flex items-center gap-2 text-sm text-text-muted">
              <Spinner size="sm" /> Loading job status…
            </span>
          )}
          {job.data && job.data.status !== 'running' && (
            <span className="text-sm text-text-muted">{job.data.rows_emitted} rows emitted</span>
          )}
        </div>

        {job.data?.status === 'completed' && (
          <>
            <p className="text-sm text-text">
              Dataset "{datasetName}" is ready.{' '}
              <span className="text-text-muted">See it on the Datasets page.</span>
            </p>
            {job.data.preview_rows.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap p-3 text-xs text-text-muted">
                  {job.data.preview_rows.map((row) => JSON.stringify(row)).join('\n')}
                </pre>
              </div>
            )}
          </>
        )}

        {job.data?.status === 'failed' && (
          <p className="text-sm text-danger">{job.data.error ?? 'Conversion failed.'}</p>
        )}
      </div>
    </Card>
  )
}
