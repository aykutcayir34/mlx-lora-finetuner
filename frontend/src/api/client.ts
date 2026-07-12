import type { ApiErrorBody, ApiErrorCode } from './types'

const BASE_URL = '/api/v1'

export class ApiError extends Error {
  code: ApiErrorCode | string
  detail: Record<string, unknown>

  constructor(code: ApiErrorCode | string, message: string, detail: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.detail = detail
  }
}

async function parseErrorBody(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody
    if (body?.error?.code && body?.error?.message) {
      return new ApiError(body.error.code, body.error.message, body.error.detail ?? {})
    }
  } catch {
    // response body was not the expected JSON shape; fall through to generic error
  }
  return new ApiError('internal', response.statusText || 'Request failed', {
    status: response.status,
  })
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options
  const isFormData = body instanceof FormData

  const response = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: isFormData
      ? headers
      : {
          'Content-Type': 'application/json',
          ...headers,
        },
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    throw await parseErrorBody(response)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
}
