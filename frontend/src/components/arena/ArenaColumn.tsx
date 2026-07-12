import type { ArenaSide } from '../../api/types'
import { MessageBubble } from '../chat/MessageBubble'
import type { ArenaSideState } from './arenaStore'

interface ArenaColumnProps {
  side: ArenaSide
  label: string
  state: ArenaSideState
}

export function ArenaColumn({ side, label, state }: ArenaColumnProps) {
  return (
    <div
      data-testid={`arena-column-${side}`}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface p-3"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      {state.messages.map((message, index) => (
        <MessageBubble key={index} role={message.role} content={message.content} />
      ))}
      {state.status === 'streaming' && (
        <MessageBubble role="assistant" content={state.streamingText} streaming />
      )}
      {state.status === 'waiting' && (
        <p data-testid={`arena-waiting-${side}`} className="text-xs italic text-text-muted">
          Waiting…
        </p>
      )}
      {state.status === 'done' && state.usage && (
        <p className="text-xs text-text-muted">
          {state.usage.completion_tokens} tokens · {state.usage.tokens_per_sec.toFixed(1)} tok/s
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      )}
    </div>
  )
}
