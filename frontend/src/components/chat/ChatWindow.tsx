import { useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../common/Button'
import { ChatColumn } from './ChatColumn'

export interface ChatColumnDescriptor {
  sessionId: string
  label?: string
}

interface ChatWindowProps {
  columns: ChatColumnDescriptor[]
  systemPrompt: string
  onSystemPromptChange: (value: string) => void
  onSend: (text: string) => void
  onStop: () => void
  isSending: boolean
}

export function ChatWindow({
  columns,
  systemPrompt,
  onSystemPromptChange,
  onSend,
  onStop,
  isSending,
}: ChatWindowProps) {
  const { t } = useTranslation('chat')
  const [draft, setDraft] = useState('')

  function submit() {
    const text = draft.trim()
    if (!text || isSending) return
    onSend(text)
    setDraft('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <details className="rounded-xl border border-border bg-surface p-3">
        <summary className="cursor-pointer text-sm font-medium text-text">{t('window.systemPrompt')}</summary>
        <textarea
          aria-label={t('window.systemPrompt')}
          className="mt-2 h-20 w-full resize-none rounded-lg border border-border bg-surface-raised p-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          value={systemPrompt}
          onChange={(event) => onSystemPromptChange(event.target.value)}
          placeholder={t('window.systemPromptPlaceholder')}
        />
      </details>

      <div
        className={`grid min-h-0 flex-1 gap-3 ${columns.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}
      >
        {columns.map((column) => (
          <ChatColumn key={column.sessionId} sessionId={column.sessionId} label={column.label} />
        ))}
      </div>

      <div className="flex items-end gap-2">
        <textarea
          aria-label={t('window.message')}
          className="h-16 flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('window.messagePlaceholder')}
        />
        {isSending ? (
          <Button variant="danger" onClick={onStop}>
            {t('window.stop')}
          </Button>
        ) : (
          <Button variant="primary" onClick={submit} disabled={!draft.trim()}>
            {t('window.send')}
          </Button>
        )}
      </div>
    </div>
  )
}
