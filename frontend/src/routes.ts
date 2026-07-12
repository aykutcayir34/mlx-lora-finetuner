export interface RouteDef {
  path: string
  label: string
}

// Single source of truth for the 6 top-level routes, shared by the router
// setup (App.tsx) and the side nav icon rail.
export const ROUTES: RouteDef[] = [
  { path: '/', label: 'Dashboard' },
  { path: '/models', label: 'Models' },
  { path: '/datasets', label: 'Datasets' },
  { path: '/train', label: 'Train' },
  { path: '/chat', label: 'Chat' },
  { path: '/export', label: 'Export' },
]
