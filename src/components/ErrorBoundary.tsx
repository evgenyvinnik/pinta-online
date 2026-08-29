import { Component, type ErrorInfo, type ReactNode } from 'react';
import { downloadWorkspaceCopy, requestRestoreSkip } from '../editor/workspaceRecovery';
import { noteRepeat, reportError } from '../errorReporting';
import { translateUi } from '../i18n';

export type ErrorRegion = 'application' | 'canvas' | 'dock' | 'dialog';

interface ErrorBoundaryProps {
  region: ErrorRegion;
  children: ReactNode;
  /** Lets a containing region dismiss the failure, for example by closing a broken dialog. */
  onDismiss?: () => void;
  onError?: (error: Error, region: ErrorRegion) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  recovery: string;
  recovering: boolean;
}

const REGION_TITLES: Record<ErrorRegion, string> = {
  application: 'Pinta Online could not continue',
  canvas: 'The drawing area stopped responding',
  dock: 'The tool windows stopped responding',
  dialog: 'This dialog stopped responding',
};

const REGION_MESSAGES: Record<ErrorRegion, string> = {
  application: 'An unexpected error interrupted the editor. Your saved work is still stored in this browser.',
  canvas: 'The rest of the editor is still usable. Reload to bring the drawing area back.',
  dock: 'The rest of the editor is still usable. Reload to bring the Layers and History windows back.',
  dialog: 'Close the dialog to keep working. Your image has not been changed.',
};

/**
 * Without a boundary a single render-time throw unmounts the whole tree and leaves an empty
 * page, because the error dialog it would otherwise open is itself part of the tree that just
 * died. This owns its own state for that reason, and never routes through the editor.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, recovery: '', recovering: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, 'render');
    // React rethrows so the window handler sees this too; recording it here stops the same
    // failure from also opening the generic error dialog behind the boundary.
    noteRepeat(error.message);
    this.props.onError?.(error, this.props.region);
    console.error(`Pinta Online ${this.props.region} error`, error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  private reloadWithoutRestoring = () => {
    requestRestoreSkip();
    window.location.reload();
  };

  private downloadCopy = async () => {
    this.setState({ recovering: true, recovery: '' });
    try {
      const { documents, layers, archives } = await downloadWorkspaceCopy();
      const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
      // Naming the format matters here: an .ora reopens as the layered document it was, while
      // the PNG fallback does not, and the person reading this is deciding what to do next.
      const format = archives === documents
        ? `as ${plural(archives, 'OpenRaster file')}`
        : archives === 0
          ? 'as layer images'
          : `as ${plural(archives, 'OpenRaster file')} and layer images`;
      this.setState({
        recovering: false,
        recovery: `Saved ${plural(layers, 'layer')} from ${plural(documents, 'image')} ${format}.`,
      });
    } catch (error) {
      this.setState({
        recovering: false,
        recovery: error instanceof Error ? error.message : 'The saved work could not be read.',
      });
    }
  };

  private dismiss = () => {
    this.setState({ error: null, recovery: '', recovering: false });
    this.props.onDismiss?.();
  };

  render() {
    const { error, recovery, recovering } = this.state;
    const { region, children, onDismiss } = this.props;
    if (!error) return children;

    const isApplication = region === 'application';

    return (
      <div className={`error-boundary error-boundary-${region}`} role="alert">
        <div className="error-boundary-panel">
          <h2>{translateUi(REGION_TITLES[region])}</h2>
          <p>{translateUi(REGION_MESSAGES[region])}</p>

          <details>
            <summary>{translateUi('Details')}</summary>
            <pre>{error.message || String(error)}</pre>
          </details>

          {isApplication && (
            <p className="error-boundary-hint">
              {translateUi('If reloading brings the error straight back, the saved workspace is likely the cause. Start without it, or download a copy of your layers first.')}
            </p>
          )}

          <div className="error-boundary-actions">
            <button type="button" className="native-dialog-button suggested" onClick={this.reload}>
              {translateUi('Reload')}
            </button>
            {isApplication && (
              <>
                <button type="button" className="native-dialog-button" onClick={this.reloadWithoutRestoring}>
                  {translateUi('Reload without restoring')}
                </button>
                <button type="button" className="native-dialog-button" disabled={recovering} onClick={() => void this.downloadCopy()}>
                  {recovering ? translateUi('Saving…') : translateUi('Download a copy')}
                </button>
              </>
            )}
            {onDismiss && (
              <button type="button" className="native-dialog-button" onClick={this.dismiss}>
                {translateUi('Close')}
              </button>
            )}
          </div>

          {recovery && <p className="error-boundary-recovery" role="status">{recovery}</p>}
        </div>
      </div>
    );
  }
}
