import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import { apiClient, ApiError } from './client'

describe('apiClient error handling', () => {
  it('parses the contract error body into an ApiError with matching code', async () => {
    server.use(
      http.get('/api/v1/models', () =>
        HttpResponse.json(
          {
            error: {
              code: 'not_implemented',
              message: 'This route is not implemented yet',
              detail: { route: '/models' },
            },
          },
          { status: 501 },
        ),
      ),
    )

    await expect(apiClient.get('/models')).rejects.toMatchObject({
      code: 'not_implemented',
      message: 'This route is not implemented yet',
      detail: { route: '/models' },
    })
  })

  it('throws an instance of ApiError', async () => {
    server.use(
      http.get('/api/v1/models', () =>
        HttpResponse.json(
          { error: { code: 'internal', message: 'boom', detail: {} } },
          { status: 501 },
        ),
      ),
    )

    try {
      await apiClient.get('/models')
      expect.unreachable('expected apiClient.get to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
    }
  })
})
