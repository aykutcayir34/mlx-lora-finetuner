export interface RouteDef {
  path: string
  label: string
}

// Single source of truth for the top-level routes, shared by the router
// setup (App.tsx) and the side nav icon rail.
export const ROUTES: RouteDef[] = [
  { path: '/', label: 'Dashboard' },
  { path: '/models', label: 'Models' },
  { path: '/datasets', label: 'Datasets' },
  { path: '/train', label: 'Train' },
  { path: '/chat', label: 'Chat' },
  { path: '/arena', label: 'Arena' },
  { path: '/export', label: 'Export' },
  { path: '/recipes', label: 'Recipes' },
  { path: '/history', label: 'History' },
]

// ---------------------------------------------------------------------------
// Router navigation-state payloads (checkpoint quick actions)
// ---------------------------------------------------------------------------
// The RunMonitor checkpoint list navigates to /chat and /export with these
// payloads. Both pages treat the state as untrusted `unknown` (it can be
// absent, or left over from history restoration) and only act on a full match.

/** /chat: preselect the model and chat against a checkpoint adapter. */
export interface ChatCheckpointNavState {
  model_id: string
  adapter_path: string
  /** Display label for the (external) adapter-picker entry. */
  label: string
}

/** /export: prefill the fuse wizard's custom model_id+adapter_path source. */
export interface FuseCheckpointNavState {
  model_id: string
  adapter_path: string
  suggested_name: string
}

function hasStringProps<K extends string>(
  state: unknown,
  keys: K[],
): state is Record<K, string> {
  if (typeof state !== 'object' || state === null) return false
  return keys.every((key) => typeof (state as Record<string, unknown>)[key] === 'string')
}

export function parseChatCheckpointNavState(state: unknown): ChatCheckpointNavState | null {
  return hasStringProps(state, ['model_id', 'adapter_path', 'label'])
    ? { model_id: state.model_id, adapter_path: state.adapter_path, label: state.label }
    : null
}

export function parseFuseCheckpointNavState(state: unknown): FuseCheckpointNavState | null {
  return hasStringProps(state, ['model_id', 'adapter_path', 'suggested_name'])
    ? {
        model_id: state.model_id,
        adapter_path: state.adapter_path,
        suggested_name: state.suggested_name,
      }
    : null
}
