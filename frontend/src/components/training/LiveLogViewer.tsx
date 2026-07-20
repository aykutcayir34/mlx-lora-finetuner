import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch } from '../common/Switch'

interface LiveLogViewerProps {
  lines: string[]
}

/** Scrolling log buffer with a "follow output" toggle (auto-scrolls to the newest line). */
export function LiveLogViewer({ lines }: LiveLogViewerProps) {
  const { t } = useTranslation('train')
  const [follow, setFollow] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!follow) return
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines, follow])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">{t('logs.title')}</span>
        <Switch checked={follow} onChange={setFollow} label={t('logs.follow')} />
      </div>
      <div
        ref={containerRef}
        data-testid="log-viewer"
        className="h-64 overflow-y-auto rounded-lg border border-border bg-surface-raised p-3 font-mono text-xs text-text-muted"
      >
        {lines.length === 0 ? (
          <p className="text-text-muted">{t('logs.empty')}</p>
        ) : (
          lines.map((line, index) => (
            <div key={index} className="whitespace-pre-wrap">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
