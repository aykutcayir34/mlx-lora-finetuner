import { http, HttpResponse } from 'msw'
import type { AdapterInfo } from '../../api/types'

// Fixtures for chat-page tests: one adapter per base model already present in
// the shared handlers.ts GET /models response, so adapter-picker filtering
// can be exercised against real model ids.
export const adapterFixtures: AdapterInfo[] = [
  {
    adapter_path: '/data/runs/run_1/adapters',
    run_id: 'run_1',
    name: 'smol-lora-v1',
    base_model_id: 'mlx-community/SmolLM-135M-Instruct-4bit',
    created_at: '2026-07-10T10:00:00Z',
  },
  {
    adapter_path: '/data/runs/run_2/adapters',
    run_id: 'run_2',
    name: 'qwen-lora-v1',
    base_model_id: 'mlx-community/Qwen2.5-0.5B-Instruct-4bit',
    created_at: '2026-07-11T10:00:00Z',
  },
]

export const chatHandlers = [
  http.get('/api/v1/adapters', () => HttpResponse.json({ adapters: adapterFixtures })),
]
