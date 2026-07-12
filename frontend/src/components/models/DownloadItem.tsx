import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ReconnectingWS } from '../../api/ws'
import { useCancelDownload, useDownloadModel } from '../../api/queries/models'
import { queryKeys } from '../../api/queries/keys'
import type { DownloadInfo, DownloadStatus, DownloadWsFrame } from '../../api/types'
import { Badge, type BadgeVariant } from '../common/Badge'
import { Button } from '../common/Button'
import { Card } from '../common/Card'
import { ProgressBar } from '../common/ProgressBar'
import { useToast } from '../common/Toast'

interface DownloadItemProps {
  download: DownloadInfo
  /** Override for tests; forwarded to ReconnectingWS. */
  WebSocketImpl?: typeof WebSocket
}

const STATUS_VARIANT: Record<DownloadStatus, BadgeVariant> = {
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

interface LiveProgress {
  bytes_done: number
  bytes_total: number
  files_done: number
  files_total: number
}

export function DownloadItem({ download, WebSocketImpl }: DownloadItemProps) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const retryDownload = useDownloadModel()
  const cancelDownload = useCancelDownload()
  const [liveProgress, setLiveProgress] = useState<LiveProgress | null>(null)
  const wsRef = useRef<ReconnectingWS<DownloadWsFrame> | null>(null)

  useEffect(() => {
    if (download.status !== 'running') return

    const ws = new ReconnectingWS<DownloadWsFrame>({
      path: `/api/v1/ws/downloads/${download.download_id}`,
      onFrame: (frame) => {
        if (frame.type === 'progress') {
          setLiveProgress({
            bytes_done: frame.bytes_done,
            bytes_total: frame.bytes_total,
            files_done: frame.files_done,
            files_total: frame.files_total,
          })
        } else if (frame.type === 'done' || frame.type === 'error' || frame.type === 'cancelled') {
          queryClient.invalidateQueries({ queryKey: queryKeys.models.downloads })
          ws.close()
        }
      },
      WebSocketImpl,
    })
    wsRef.current = ws

    return () => {
      ws.close()
      wsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [download.download_id, download.status])

  const bytesDone = liveProgress?.bytes_done ?? download.bytes_done
  const bytesTotal = liveProgress?.bytes_total ?? download.bytes_total
  const filesDone = liveProgress?.files_done ?? download.files_done
  const filesTotal = liveProgress?.files_total ?? download.files_total
  const progressValue = bytesTotal > 0 ? (bytesDone / bytesTotal) * 100 : 0

  function handleRetry() {
    retryDownload.mutate(
      { model_id: download.model_id },
      {
        onSuccess: () => {
          toast(`Retrying download of "${download.model_id}".`, { variant: 'success' })
        },
        onError: (error) => {
          toast(error instanceof Error ? error.message : 'Failed to retry download.', {
            variant: 'error',
          })
        },
      },
    )
  }

  function handleCancel() {
    cancelDownload.mutate(download.download_id, {
      onSuccess: () => {
        toast(`Cancelled download of "${download.model_id}".`, { variant: 'success' })
      },
      onError: (error) => {
        toast(error instanceof Error ? error.message : 'Failed to cancel download.', {
          variant: 'error',
        })
      },
    })
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="break-all text-sm font-medium text-text">{download.model_id}</p>
        <Badge variant={STATUS_VARIANT[download.status]}>{download.status}</Badge>
      </div>

      {download.status === 'running' && (
        <div className="mt-3">
          <ProgressBar
            value={progressValue}
            indeterminate={bytesTotal <= 0}
            label={`${filesDone}/${filesTotal} files`}
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="danger" onClick={handleCancel} loading={cancelDownload.isPending}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {download.status === 'failed' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-danger">{download.error ?? 'Download failed.'}</p>
          <Button size="sm" variant="secondary" onClick={handleRetry} loading={retryDownload.isPending}>
            Retry (resumes)
          </Button>
        </div>
      )}

      {download.status === 'cancelled' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-text-muted">Download was cancelled.</p>
          <Button size="sm" variant="secondary" onClick={handleRetry} loading={retryDownload.isPending}>
            Retry (resumes)
          </Button>
        </div>
      )}

      {download.status === 'completed' && (
        <p className="mt-3 text-xs text-text-muted">
          {filesDone}/{filesTotal} files
        </p>
      )}
    </Card>
  )
}
