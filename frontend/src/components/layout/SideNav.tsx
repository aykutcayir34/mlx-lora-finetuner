import { NavLink, useLocation } from 'react-router-dom'
import { ROUTES } from '../../routes'
import {
  ArenaIcon,
  ChatIcon,
  DashboardIcon,
  DatasetsIcon,
  ExportIcon,
  HistoryIcon,
  ModelsIcon,
  RecipesIcon,
  TrainIcon,
} from './icons'

const ICONS: Record<string, (props: { className?: string }) => JSX.Element> = {
  '/': DashboardIcon,
  '/models': ModelsIcon,
  '/datasets': DatasetsIcon,
  '/train': TrainIcon,
  '/chat': ChatIcon,
  '/arena': ArenaIcon,
  '/export': ExportIcon,
  '/recipes': RecipesIcon,
  '/history': HistoryIcon,
}

export function SideNav() {
  // useLocation drives the aria-current bookkeeping; NavLink still owns the
  // per-link active class so the two stay in sync automatically.
  const location = useLocation()

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-16 flex-col items-center gap-2 border-r border-border bg-surface py-4"
    >
      {ROUTES.map((route) => {
        const Icon = ICONS[route.path]
        const isActive = location.pathname === route.path
        return (
          <NavLink
            key={route.path}
            to={route.path}
            end={route.path === '/'}
            aria-current={isActive ? 'page' : undefined}
            title={route.label}
            className={({ isActive: navActive }) =>
              `flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
                navActive
                  ? 'active bg-accent/15 text-accent'
                  : 'text-text-muted hover:bg-surface-raised hover:text-text'
              }`
            }
          >
            <Icon />
            <span className="sr-only">{route.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
