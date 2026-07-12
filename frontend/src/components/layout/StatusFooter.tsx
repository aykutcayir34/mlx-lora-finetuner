// Placeholder for the active job / memory status bar. Not wired to any data
// source yet — that lands with the training/job features in a later wave.
export function StatusFooter() {
  return (
    <footer className="flex h-9 items-center justify-between border-t border-border bg-surface px-4 text-xs text-text-muted">
      <span>No active job</span>
      <span>Memory: —</span>
    </footer>
  )
}
