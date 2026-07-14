import { Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { SideNav } from './SideNav'
import { TopBar } from './TopBar'
import { StatusFooter } from './StatusFooter'

export function AppLayout() {
  const location = useLocation()
  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <SideNav />
        <main className="flex flex-1 flex-col overflow-hidden">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <StatusFooter />
    </div>
  )
}
