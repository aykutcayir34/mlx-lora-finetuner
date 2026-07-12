import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, BrowserRouter, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { ModelsPage } from './pages/ModelsPage'
import { DatasetsPage } from './pages/DatasetsPage'
import { TrainPage } from './pages/TrainPage'
import { ChatPage } from './pages/ChatPage'
import { ExportPage } from './pages/ExportPage'

const queryClient = new QueryClient()

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/datasets" element={<DatasetsPage />} />
        <Route path="/train" element={<TrainPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/export" element={<ExportPage />} />
      </Route>
    </Routes>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
