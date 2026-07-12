// Single query-key factory. Every hook in this directory derives its query
// key from here — no ad-hoc array literals scattered across hook files.
export const queryKeys = {
  health: ['system', 'health'] as const,
  stats: ['system', 'stats'] as const,
  models: {
    list: ['models', 'list'] as const,
    search: (q: string, author?: string) => ['models', 'search', q, author] as const,
    downloads: ['models', 'downloads'] as const,
  },
  datasets: {
    list: ['datasets', 'list'] as const,
    preview: (id: string, split: string, page: number, size: number) =>
      ['datasets', 'preview', id, split, page, size] as const,
    search: (q: string) => ['datasets', 'search', q] as const,
    imports: ['datasets', 'imports'] as const,
  },
  training: {
    runs: (status?: string, limit?: number, offset?: number) =>
      ['training', 'runs', status, limit, offset] as const,
    run: (id: string) => ['training', 'run', id] as const,
    metrics: (id: string, afterStep?: number, kind?: string) =>
      ['training', 'metrics', id, afterStep, kind] as const,
    logs: (id: string, tail?: number) => ['training', 'logs', id, tail] as const,
  },
  history: {
    list: (
      modelId?: string,
      trainMode?: string,
      status?: string,
      sort?: string,
      limit?: number,
      offset?: number,
    ) => ['history', 'list', modelId, trainMode, status, sort, limit, offset] as const,
  },
  adapters: { list: ['adapters', 'list'] as const },
  export: {
    job: (id: string) => ['export', 'job', id] as const,
    artifacts: ['export', 'artifacts'] as const,
    preflight: (modelPath: string) => ['export', 'preflight', modelPath] as const,
  },
  recipes: {
    job: (id: string) => ['recipes', 'job', id] as const,
  },
}
