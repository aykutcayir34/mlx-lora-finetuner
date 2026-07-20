import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

export type ToastVariant = 'success' | 'error' | 'info'

interface ToastOptions {
  variant?: ToastVariant
  durationMs?: number
}

interface ToastItem {
  id: string
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (message: string, opts?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const DEFAULT_DURATION_MS = 4000

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  error: 'border-danger/30 bg-danger/10 text-danger',
  info: 'border-accent/30 bg-accent/10 text-accent',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, opts: ToastOptions = {}) => {
      const id = `toast-${nextId.current++}`
      const variant = opts.variant ?? 'info'
      const durationMs = opts.durationMs ?? DEFAULT_DURATION_MS
      setToasts((current) => [...current, { id, message, variant }])
      setTimeout(() => dismiss(id), durationMs)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg ${VARIANT_CLASSES[item.variant]}`}
          >
            <span>{item.message}</span>
            <button
              type="button"
              aria-label={t('actions.dismiss')}
              onClick={() => dismiss(item.id)}
              className="text-text-muted hover:text-text"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}
