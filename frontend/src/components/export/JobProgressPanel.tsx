import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useExportJob } from '../../api/queries/export'
import type { ExportJobInfo } from '../../api/types'
import { Card } from '../common/Card'
import { CodeBlock } from '../common/CodeBlock'
import { StatusBadge } from '../common/Badge'
import { Spinner } from '../common/Spinner'

interface JobProgressPanelProps {
  exportId: string | undefined
  onSettled?: (job: ExportJobInfo) => void
}

/** Polls a running export job and renders its progress log, status and output path.
 * Shared by the fuse and GGUF wizards, which only differ in the request they submit. */
export function JobProgressPanel({ exportId, onSettled }: JobProgressPanelProps) {
  const { t } = useTranslation('export')
  const job = useExportJob(exportId)
  const settledFor = useRef<string | null>(null)

  useEffect(() => {
    if (!job.data || !exportId) return
    if (job.data.status === 'running') return
    if (settledFor.current === exportId) return
    settledFor.current = exportId
    onSettled?.(job.data)
    // onSettled is expected to be referentially stable enough for this effect;
    // including it would risk re-firing on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.data, exportId])

  if (!exportId) return null

  return (
    <Card title={t('job.title')} className="mt-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {job.data ? (
            <StatusBadge status={job.data.status} />
          ) : (
            <span className="flex items-center gap-2 text-sm text-text-muted">
              <Spinner size="sm" /> {t('job.loading')}
            </span>
          )}
        </div>

        {job.data && job.data.progress_log.length > 0 && (
          <CodeBlock language="log" code={job.data.progress_log.join('\n')} />
        )}

        {job.data?.status === 'completed' && job.data.output_path && (
          <p className="text-sm text-text">
            {t('job.output')} <span className="font-mono text-text-muted">{job.data.output_path}</span>
          </p>
        )}

        {job.data?.status === 'failed' && (
          <p className="text-sm text-danger">{job.data.error ?? t('job.failed')}</p>
        )}
      </div>
    </Card>
  )
}
