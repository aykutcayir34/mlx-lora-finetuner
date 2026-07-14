import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button } from './Button'

interface ErrorBoundaryProps {
  children: ReactNode
  /** When this value changes (e.g. on navigation), a captured error is cleared. */
  resetKey?: unknown
}

interface ErrorBoundaryState {
  error: Error | null
  prevResetKey: unknown
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, prevResetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (props.resetKey !== state.prevResetKey) {
      return { error: null, prevResetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    const { error } = this.state
    if (error === null) {
      return this.props.children
    }

    return (
      <div
        role="alert"
        className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center"
      >
        <h2 className="text-sm font-semibold text-text">Something went wrong</h2>
        <p className="max-w-md break-words font-mono text-sm text-danger">
          {error.message || String(error)}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={this.handleReset}>
            Try again
          </Button>
          <Button variant="primary" size="sm" onClick={this.handleReload}>
            Reload
          </Button>
        </div>
      </div>
    )
  }
}
