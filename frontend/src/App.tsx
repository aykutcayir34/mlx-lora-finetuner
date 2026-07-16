import { QueryClientProvider } from '@tanstack/react-query'
import { Route, BrowserRouter, Routes } from 'react-router-dom'
import { createQueryClient } from './api/queryClient'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { ModelsPage } from './pages/ModelsPage'
import { DatasetsPage } from './pages/DatasetsPage'
import { TrainPage } from './pages/TrainPage'
import { ChatPage } from './pages/ChatPage'
import { ArenaPage } from './pages/ArenaPage'
import { ExportPage } from './pages/ExportPage'
import { RecipesPage } from './pages/RecipesPage'
import { HistoryPage } from './pages/HistoryPage'

const queryClient = createQueryClient()

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/datasets" element={<DatasetsPage />} />
        <Route path="/train" element={<TrainPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/arena" element={<ArenaPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/history" element={<HistoryPage />} />
      </Route>
    </Routes>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <AppRoutes />
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
