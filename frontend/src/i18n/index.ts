import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Namespace JSON files are statically imported so the bundle stays fully
// self-contained (no fetch backend needed for two small languages).
import enCommon from './locales/en/common.json'
import trCommon from './locales/tr/common.json'
import enLayout from './locales/en/layout.json'
import trLayout from './locales/tr/layout.json'
import enDashboard from './locales/en/dashboard.json'
import trDashboard from './locales/tr/dashboard.json'
import enModels from './locales/en/models.json'
import trModels from './locales/tr/models.json'
import enDatasets from './locales/en/datasets.json'
import trDatasets from './locales/tr/datasets.json'
import enTrain from './locales/en/train.json'
import trTrain from './locales/tr/train.json'
import enChat from './locales/en/chat.json'
import trChat from './locales/tr/chat.json'
import enArena from './locales/en/arena.json'
import trArena from './locales/tr/arena.json'
import enExport from './locales/en/export.json'
import trExport from './locales/tr/export.json'
import enHistory from './locales/en/history.json'
import trHistory from './locales/tr/history.json'
import enRecipes from './locales/en/recipes.json'
import trRecipes from './locales/tr/recipes.json'

export const LANGUAGE_STORAGE_KEY = 'mlxlf-language'
export const SUPPORTED_LANGUAGES = ['en', 'tr'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

function detectInitialLanguage(): SupportedLanguage {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored === 'en' || stored === 'tr') return stored
  } catch {
    // localStorage unavailable (e.g. some test environments) — fall through.
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('tr')
    ? 'tr'
    : 'en'
}

export function setLanguage(lang: SupportedLanguage): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
  } catch {
    // Persisting is best-effort; the in-memory switch still applies.
  }
  void i18n.changeLanguage(lang)
}

void i18n.use(initReactI18next).init({
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: [
    'common',
    'layout',
    'dashboard',
    'models',
    'datasets',
    'train',
    'chat',
    'arena',
    'export',
    'history',
    'recipes',
  ],
  resources: {
    en: {
      common: enCommon,
      layout: enLayout,
      dashboard: enDashboard,
      models: enModels,
      datasets: enDatasets,
      train: enTrain,
      chat: enChat,
      arena: enArena,
      export: enExport,
      history: enHistory,
      recipes: enRecipes,
    },
    tr: {
      common: trCommon,
      layout: trLayout,
      dashboard: trDashboard,
      models: trModels,
      datasets: trDatasets,
      train: trTrain,
      chat: trChat,
      arena: trArena,
      export: trExport,
      history: trHistory,
      recipes: trRecipes,
    },
  },
  interpolation: {
    // React already escapes rendered strings.
    escapeValue: false,
  },
  returnNull: false,
})

export default i18n
