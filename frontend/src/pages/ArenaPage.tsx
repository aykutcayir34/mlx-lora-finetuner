import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
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

const EMPTY_SIDE: ArenaSidePickerValue = { modelId: '', adapterPath: '' }

export function ArenaPage() {
  const { t } = useTranslation('arena')
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
    onTrainingActive: () => setTrainingBanner(t('trainingActive')),
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
    <PageShell title={t('page.title')} description={t('page.description')}>
      <ArenaTopBar
        models={models ?? []}
        adapters={adapters}
        sideA={sideA}
        onSideAChange={setSideA}
        sideB={sideB}
        onSideBChange={setSideB}
      />

      <GenParamsDrawer params={params} onChange={setParams} />

      <p className="text-xs text-text-muted">{t('intro')}</p>

      {trainingBanner && (
        <div
          data-testid="training-banner"
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {trainingBanner}
        </div>
      )}

      {!arenaSocket.isConnected && (
        <div
          data-testid="ws-reconnecting-banner"
          role="status"
          className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-400"
        >
          {t('reconnecting')}
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button variant="secondary" size="sm" onClick={handleClear} disabled={isGenerating}>
          {t('common:actions.clear')}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ArenaColumn side="a" label={t('sides.a')} state={sideAState} />
        <ArenaColumn side="b" label={t('sides.b')} state={sideBState} />
      </div>

      <div className="flex items-end gap-2">
        <textarea
          aria-label={t('composer.message')}
          className="h-16 flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('composer.placeholder')}
        />
        {isGenerating ? (
          <Button variant="danger" onClick={arenaSocket.cancel}>
            {t('composer.stop')}
          </Button>
        ) : (
          <Button variant="primary" onClick={submit} disabled={!draft.trim()}>
            {t('composer.send')}
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
