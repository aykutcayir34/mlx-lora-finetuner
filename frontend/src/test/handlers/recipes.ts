import { http, HttpResponse } from 'msw'
import type { RecipeJobInfo } from '../../api/types'

// Reusable fixtures + handler factories for the Recipes page tests.
// Register the handlers you need per-test with `server.use(...)`; the
// global handlers.ts / server.ts remain untouched.

export const completedTextJob: RecipeJobInfo = {
  recipe_job_id: 'rj_pdf1',
  status: 'completed',
  rows_emitted: 3,
  preview_rows: [{ text: 'chunk one' }, { text: 'chunk two' }],
  dataset_id: 'ds_from_recipe',
  error: null,
}

export const failedJob: RecipeJobInfo = {
  recipe_job_id: 'rj_bad1',
  status: 'failed',
  rows_emitted: 0,
  preview_rows: [],
  dataset_id: null,
  error: 'could not parse document',
}

export function convertRecipeHandler(jobId = 'rj_pdf1', name = 'my-recipe') {
  return http.post('/api/v1/recipes/convert', () =>
    HttpResponse.json({ recipe_job_id: jobId, name }, { status: 202 }),
  )
}

export function convertRecipeErrorHandler(message = 'unsupported file type') {
  return http.post('/api/v1/recipes/convert', () =>
    HttpResponse.json({ error: { code: 'validation_error', message, detail: {} } }, { status: 422 }),
  )
}

export function recipeJobHandler(job: RecipeJobInfo = completedTextJob) {
  return http.get('/api/v1/recipes/jobs/:jobId', () => HttpResponse.json(job))
}
