import type { ChatMessage } from '../../api/types'

interface MessageBubbleProps {
  role: ChatMessage['role']
  content: string
  streaming?: boolean
}

export function MessageBubble({ role, content, streaming = false }: MessageBubbleProps) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
          isUser ? 'bg-accent text-bg' : 'bg-surface-raised text-text'
        }`}
      >
        {content}
        {streaming && (
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-current align-middle"
          />
        )}
      </div>
    </div>
  )
}
