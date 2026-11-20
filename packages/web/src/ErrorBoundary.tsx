import { Component, type ReactNode } from "react";

/**
 * Catches a render error so one broken part shows a message instead of
 * blanking the whole app. React has no hook for this; it needs a class.
 * Keyed by its parent on what it shows, so moving elsewhere clears it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error("[KiroChrome] a part of the page failed to render", error);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error" role="alert">
        <div className="error-head">
          <span className="code">INTERNAL</span>
          <span>This part of the page failed to show: {error.message}</span>
        </div>
        <p className="remediation">
          Your conversations are safe on the server. Try again, or open something else from the left.
        </p>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
