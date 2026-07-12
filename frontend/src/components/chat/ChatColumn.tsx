import { useChatStore } from '../../stores/chatStore'
import { MessageBubble } from './MessageBubble'

interface ChatColumnProps {
  sessionId: string
  label?: string
}

export function ChatColumn({ sessionId, label }: ChatColumnProps) {
  const session = useChatStore((state) => state.sessions[sessionId])
  const messages = session?.messages ?? []
  const streamingText = session?.streamingText ?? ''
  const isGenerating = session?.isGenerating ?? false
  const usage = session?.usage ?? null
  const error = session?.error ?? null

  return (
    <div
      data-testid={`chat-column-${sessionId}`}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface p-3"
    >
      {label && (
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      )}
      {messages.map((message, index) => (
        <MessageBubble key={index} role={message.role} content={message.content} />
      ))}
      {isGenerating && <MessageBubble role="assistant" content={streamingText} streaming />}
      {!isGenerating && usage && (
        <p className="text-xs text-text-muted">
          {usage.completion_tokens} tokens · {usage.tokens_per_sec.toFixed(1)} tok/s
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
