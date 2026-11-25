import { Component, Fragment, type ReactNode } from "react";
import { logError } from "@/lib/diagnostics";

type Props = { onBack: () => void; children: ReactNode };
type State = { failed: boolean; attempt: number };

/**
 * If a reader crashes while drawing, show a way out instead of a blank
 * screen: try the book again, or go back to the library. The error is noted
 * in the on-device problem log.
 */
export class ReaderErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    logError(`Reader: ${error.message}`, error.stack);
  }

  override render() {
    if (!this.state.failed)
      return (
        <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
      );
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background px-8 text-center">
        <h1 className="font-display text-2xl text-ivory">
          This book hit a problem
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your place and notes are safe. Try opening it again — if it keeps
          happening, share a problem report from Settings › Privacy.
        </p>
        <div className="flex gap-2">
          <button
            className="btn btn-gold"
            onClick={() =>
              this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))
            }
          >
            Try again
          </button>
          <button className="btn btn-outline" onClick={this.props.onBack}>
            Back to library
          </button>
        </div>
      </div>
    );
  }
}
