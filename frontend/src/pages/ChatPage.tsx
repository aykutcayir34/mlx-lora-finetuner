import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { PageShell } from '../components/layout/PageShell'
import { parseChatCheckpointNavState } from '../routes'
import { useModels } from '../api/queries/models'
import { useAdapters } from '../api/queries/adapters'
import { useChatStore, type ChatSessionState } from '../stores/chatStore'
import { useChatSocket } from '../components/chat/useChatSocket'
import { ChatTopBar } from '../components/chat/ChatTopBar'
import { GenParamsDrawer } from '../components/chat/GenParamsDrawer'
import { ChatWindow, type ChatColumnDescriptor } from '../components/chat/ChatWindow'
import { Button } from '../components/common/Button'
import type { GenerationParams } from '../api/types'

const SESSION_MAIN = 'chat:main'
const SESSION_ADAPTER = 'chat:adapter'
const SESSION_BASE = 'chat:base'

const DEFAULT_PARAMS: GenerationParams = {
  max_tokens: 512,
  temperature: 0.7,
  top_p: 0.9,
  repetition_penalty: null,
}

const TRAINING_ACTIVE_MESSAGE = 'Eğitim sürerken sohbet kapalı'

function buildWireMessages(session: ChatSessionState | undefined, systemPrompt: string) {
  const messages = session?.messages ?? []
  const trimmed = systemPrompt.trim()
  return trimmed ? [{ role: 'system' as const, content: trimmed }, ...messages] : messages
}

export function ChatPage() {
  const location = useLocation()
  // Optional checkpoint payload from the RunMonitor "Chat" action; absent
  // navigation state keeps the page behavior identical to before.
  const [checkpointNav] = useState(() => parseChatCheckpointNavState(location.state))

  const { data: models } = useModels()
  const { data: adapterData } = useAdapters()
  // A checkpoint adapter is not in GET /adapters — surface it as an extra
  // "external" picker entry following the same AdapterInfo data model.
  const adapters = useMemo(() => {
    const list = adapterData?.adapters ?? []
    if (!checkpointNav || list.some((a) => a.adapter_path === checkpointNav.adapter_path)) {
      return list
    }
    return [
      ...list,
      {
        adapter_path: checkpointNav.adapter_path,
        run_id: null,
        name: checkpointNav.label,
        base_model_id: checkpointNav.model_id,
        created_at: '',
      },
    ]
  }, [adapterData, checkpointNav])

  const [selectedModelId, setSelectedModelId] = useState(checkpointNav?.model_id ?? '')
  const [selectedAdapterPath, setSelectedAdapterPath] = useState(checkpointNav?.adapter_path ?? '')
  const [compareMode, setCompareMode] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [params, setParams] = useState<GenerationParams>(DEFAULT_PARAMS)
  const [trainingBanner, setTrainingBanner] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedModelId && models && models.length > 0) {
      setSelectedModelId(models[0].model_id)
    }
  }, [models, selectedModelId])

  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => setToastMessage(null), 4000)
    return () => clearTimeout(timer)
  }, [toastMessage])

  const chatSocket = useChatSocket({
    onTrainingActive: () => setTrainingBanner(TRAINING_ACTIVE_MESSAGE),
    onModelNotFound: (message) => setToastMessage(message),
    onError: (message) => setToastMessage(message),
  })

  const columns: ChatColumnDescriptor[] = useMemo(
    () =>
      compareMode && selectedAdapterPath
        ? [
            { sessionId: SESSION_ADAPTER, label: 'Adapter' },
            { sessionId: SESSION_BASE, label: 'Base' },
          ]
        : [{ sessionId: SESSION_MAIN }],
    [compareMode, selectedAdapterPath],
  )

  const sessions = useChatStore((state) => state.sessions)
  const isSending = columns.some((column) => sessions[column.sessionId]?.isGenerating)

  function handleSend(text: string) {
    setTrainingBanner(null)
    if (!selectedModelId) return

    if (compareMode && selectedAdapterPath) {
      useChatStore.getState().addUserMessage(SESSION_ADAPTER, text)
      useChatStore.getState().addUserMessage(SESSION_BASE, text)
      const state = useChatStore.getState().sessions
      chatSocket.enqueueGenerate(SESSION_ADAPTER, {
        type: 'generate',
        model_id: selectedModelId,
        adapter_path: selectedAdapterPath,
        messages: buildWireMessages(state[SESSION_ADAPTER], systemPrompt),
        params,
      })
      chatSocket.enqueueGenerate(SESSION_BASE, {
        type: 'generate',
        model_id: selectedModelId,
        adapter_path: null,
        messages: buildWireMessages(state[SESSION_BASE], systemPrompt),
        params,
      })
      return
    }

    useChatStore.getState().addUserMessage(SESSION_MAIN, text)
    const state = useChatStore.getState().sessions
    chatSocket.enqueueGenerate(SESSION_MAIN, {
      type: 'generate',
      model_id: selectedModelId,
      adapter_path: selectedAdapterPath || null,
      messages: buildWireMessages(state[SESSION_MAIN], systemPrompt),
      params,
    })
  }

  function handleClear() {
    columns.forEach((column) => useChatStore.getState().reset(column.sessionId))
  }

  return (
    <PageShell title="Chat" description="Chat with a base model or a trained adapter.">
      <ChatTopBar
        models={models ?? []}
        selectedModelId={selectedModelId}
        onModelChange={(modelId) => {
          setSelectedModelId(modelId)
          setSelectedAdapterPath('')
        }}
        adapters={adapters}
        selectedAdapterPath={selectedAdapterPath}
        onAdapterChange={setSelectedAdapterPath}
        compareMode={compareMode}
        onCompareModeChange={setCompareMode}
      />

      <GenParamsDrawer params={params} onChange={setParams} />

      {trainingBanner && (
        <div
          data-testid="training-banner"
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {trainingBanner}
        </div>
      )}

      {!chatSocket.isConnected && (
        <div
          data-testid="ws-reconnecting-banner"
          role="status"
          className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-400"
        >
          Connection lost — reconnecting…
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button variant="secondary" size="sm" onClick={handleClear} disabled={isSending}>
          Clear conversation
        </Button>
      </div>

      <ChatWindow
        columns={columns}
        systemPrompt={systemPrompt}
        onSystemPromptChange={setSystemPrompt}
        onSend={handleSend}
        onStop={chatSocket.cancelActive}
        isSending={isSending}
      />

      {toastMessage && (
        <div
          role="status"
          data-testid="chat-toast"
          className="fixed bottom-4 right-4 z-50 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent shadow-lg"
        >
          {toastMessage}
        </div>
      )}
    </PageShell>
  )
}
