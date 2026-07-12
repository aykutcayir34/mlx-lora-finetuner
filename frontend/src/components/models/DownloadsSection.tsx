import { useDownloads } from '../../api/queries/models'
import { EmptyState } from '../common/EmptyState'
import { Spinner } from '../common/Spinner'
import { DownloadItem } from './DownloadItem'

interface DownloadsSectionProps {
  /** Override for tests; forwarded to each DownloadItem's ReconnectingWS. */
  WebSocketImpl?: typeof WebSocket
}

export function DownloadsSection({ WebSocketImpl }: DownloadsSectionProps = {}) {
  const { data, isLoading, isError } = useDownloads()

  if (isLoading) {
    return <Spinner />
  }

  if (isError) {
    return <p className="text-sm text-danger">Failed to load downloads.</p>
  }

  const downloads = data?.downloads ?? []

  if (downloads.length === 0) {
    return <EmptyState title="No downloads" description="Downloads you start will show up here." />
  }

  return (
    <div className="flex flex-col gap-3">
      {downloads.map((download) => (
        <DownloadItem key={download.download_id} download={download} WebSocketImpl={WebSocketImpl} />
      ))}
    </div>
  )
}
