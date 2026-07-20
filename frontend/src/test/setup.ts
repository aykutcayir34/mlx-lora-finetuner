import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
// Initialize i18n once for the whole suite; jsdom's navigator.language is
// en-US, so tests always run against the English strings.
import '../i18n'
import { server } from './server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
