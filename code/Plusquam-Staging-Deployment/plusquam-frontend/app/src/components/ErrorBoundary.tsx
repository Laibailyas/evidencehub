import { Component, type ReactNode } from 'react';

/**
 * Catches render errors anywhere below it and shows a recoverable message
 * instead of a blank white page. Resets when the route (key) changes.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[plusquam] render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-6 py-20">
          <h2 className="text-lg font-bold text-ink mb-2">Something went wrong</h2>
          <p className="text-sm text-ink-muted max-w-md mb-6">
            This view failed to load. You can try again or go back to the dashboard.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 rounded-pill text-sm font-semibold bg-primary hover:bg-primary-hover text-white transition-colors"
            >
              Try again
            </button>
            <a
              href="/"
              className="px-4 py-2 rounded-pill text-sm font-semibold bg-surface ring-1 ring-ink/10 text-ink-soft hover:text-ink transition-colors"
            >
              Dashboard
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
