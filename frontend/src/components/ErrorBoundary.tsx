import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode; title?: string; onReset?: () => void; resetKey?: unknown }
interface State { error: Error | null }

/** Contains a render error to one part of the page (a drawer, the map) instead of blanking the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("render error:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // a new selection gets a fresh chance to render
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="state" role="alert">
        <h3>{this.props.title ?? "This part of the page could not be shown"}</h3>
        <p className="error-text">{this.state.error.message}</p>
        <button type="button" className="btn" onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>
          {this.props.onReset ? "Close" : "Try again"}
        </button>
      </div>
    );
  }
}
