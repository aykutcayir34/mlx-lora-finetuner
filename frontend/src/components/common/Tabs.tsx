import type { ReactNode } from 'react'

export interface TabItem {
  id: string
  label: string
}

interface TabsProps {
  tabs: TabItem[]
  activeId: string
  onChange: (id: string) => void
  children?: ReactNode
  className?: string
}

export function Tabs({ tabs, activeId, onChange, children, className = '' }: TabsProps) {
  return (
    <div className={className}>
      <div role="tablist" className="flex gap-1 border-b border-border">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-muted hover:text-text'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {children && <div className="pt-4">{children}</div>}
    </div>
  )
}
