import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches uncaught render errors so a single broken screen (or the whole shell)
 *  shows a recoverable fallback instead of a blank window. React has no hook
 *  form for this, so it must be a class component. Styled with the existing
 *  monochrome chrome classes — no new CSS. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Local desktop app — surface to the devtools console for diagnosis.
    console.error("Render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="tpanel" style={{ margin: 16, padding: 16 }}>
        <div className="empty" style={{ paddingBottom: 8 }}>
          Something broke rendering this screen.
        </div>
        <div className="drawer-actions">
          <button type="button" className="btn pri" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
