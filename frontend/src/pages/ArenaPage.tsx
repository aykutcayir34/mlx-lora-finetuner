import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { PageShell } from '../components/layout/PageShell'
import { useModels } from '../api/queries/models'
import { useAdapters } from '../api/queries/adapters'
import { GenParamsDrawer } from '../components/chat/GenParamsDrawer'
import { Button } from '../components/common/Button'
import { ArenaTopBar, type ArenaSidePickerValue } from '../components/arena/ArenaTopBar'
import { ArenaColumn } from '../components/arena/ArenaColumn'
import { useArenaStore } from '../components/arena/arenaStore'
import { useArenaSocket } from '../components/arena/useArenaSocket'
import type { GenerationParams } from '../api/types'

const DEFAULT_PARAMS: GenerationParams = {
  max_tokens: 512,
  temperature: 0.7,
  top_p: 0.9,
  repetition_penalty: null,
}

const TRAINING_ACTIVE_MESSAGE = 'Eğitim sürerken arena kapalı'

const EMPTY_SIDE: ArenaSidePickerValue = { modelId: '', adapterPath: '' }

export function ArenaPage() {
  const { data: models } = useModels()
  const { data: adapterData } = useAdapters()
  const adapters = useMemo(() => adapterData?.adapters ?? [], [adapterData])

  const [sideA, setSideA] = useState<ArenaSidePickerValue>(EMPTY_SIDE)
  const [sideB, setSideB] = useState<ArenaSidePickerValue>(EMPTY_SIDE)
  const [params, setParams] = useState<GenerationParams>(DEFAULT_PARAMS)
  const [draft, setDraft] = useState('')
  const [trainingBanner, setTrainingBanner] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!models || models.length === 0) return
    setSideA((prev) => (prev.modelId ? prev : { ...prev, modelId: models[0].model_id }))
    setSideB((prev) =>
      prev.modelId ? prev : { ...prev, modelId: models[Math.min(1, models.length - 1)].model_id },
    )
  }, [models])

  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => setToastMessage(null), 4000)
    return () => clearTimeout(timer)
  }, [toastMessage])

  const arenaSocket = useArenaSocket({
    onTrainingActive: () => setTrainingBanner(TRAINING_ACTIVE_MESSAGE),
    onError: (message) => setToastMessage(message),
  })

  const sideAState = useArenaStore((state) => state.sideA)
  const sideBState = useArenaStore((state) => state.sideB)
  const isGenerating =
    sideAState.status === 'waiting' ||
    sideAState.status === 'streaming' ||
    sideBState.status === 'waiting' ||
    sideBState.status === 'streaming'

  function submit() {
    const text = draft.trim()
    if (!text || isGenerating || !sideA.modelId || !sideB.modelId) return
    setTrainingBanner(null)
    useArenaStore.getState().addUserMessage(text)
    arenaSocket.sendGenerate({
      type: 'generate',
      side_a: { model_id: sideA.modelId, adapter_path: sideA.adapterPath || null },
      side_b: { model_id: sideB.modelId, adapter_path: sideB.adapterPath || null },
      messages: [{ role: 'user', content: text }],
      params,
    })
    setDraft('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  function handleClear() {
    useArenaStore.getState().reset()
  }

  return (
    <PageShell title="Arena" description="Compare two models or adapters side by side.">
      <ArenaTopBar
        models={models ?? []}
        adapters={adapters}
        sideA={sideA}
        onSideAChange={setSideA}
        sideB={sideB}
        onSideBChange={setSideB}
      />

      <GenParamsDrawer params={params} onChange={setParams} />

      <p className="text-xs text-text-muted">
        Each message starts a fresh single-turn comparison — prior turns are shown for reference
        but are not resent as conversation history to either side.
      </p>

      {trainingBanner && (
        <div
          data-testid="training-banner"
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {trainingBanner}
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button variant="secondary" size="sm" onClick={handleClear} disabled={isGenerating}>
          Clear
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ArenaColumn side="a" label="A" state={sideAState} />
        <ArenaColumn side="b" label="B" state={sideBState} />
      </div>

      <div className="flex items-end gap-2">
        <textarea
          aria-label="Message"
          className="h-16 flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message... (Enter to send, Shift+Enter for newline)"
        />
        {isGenerating ? (
          <Button variant="danger" onClick={arenaSocket.cancel}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={submit} disabled={!draft.trim()}>
            Send
          </Button>
        )}
      </div>

      {toastMessage && (
        <div
          role="status"
          data-testid="arena-toast"
          className="fixed bottom-4 right-4 z-50 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent shadow-lg"
        >
          {toastMessage}
        </div>
      )}
    </PageShell>
  )
}
