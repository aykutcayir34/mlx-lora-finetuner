import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from './IconButton'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const { t } = useTranslation('common')
  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      {/* Capped to the viewport and laid out as a column: the header and
          footer keep their size while the body takes the rest and scrolls.
          Without the cap a dialog taller than the window grows past it in
          both directions — it is centred — so the footer's buttons become
          unreachable with nothing to scroll. `min-h-0` is what lets the body
          shrink below its content height; a flex child refuses to by
          default, and overflow never kicks in. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col rounded-xl border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex shrink-0 items-center justify-between">
          {title && <h2 className="text-base font-semibold text-text">{title}</h2>}
          <IconButton aria-label={t('actions.close')} variant="ghost" onClick={onClose} className="ml-auto">
            <CloseIcon />
          </IconButton>
        </div>
        <div data-modal-body className="min-h-0 flex-1 overflow-y-auto text-sm text-text">
          {children}
        </div>
        {footer && <div className="mt-5 flex shrink-0 justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
