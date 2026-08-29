import { useState } from 'react';
import { translateUi } from '../../i18n';
import type { CanvasGridSettings } from '../../state/preferences';
import { AngleDial, PintaIcon } from '../primitives';
import { DialogActions, DialogResetButton, DialogStepper } from '../dialogControls';

export interface ApplicationError {
  title: string;
  message: string;
  details: string;
}

export function InformationDialog({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <div
      className="dialog-backdrop native-alert-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="pinta-dialog native-alert-dialog information-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="information-dialog-title"
        aria-describedby="information-dialog-message"
      >
        <div className="close-document-content">
          <h2 id="information-dialog-title">{translateUi(title)}</h2>
          <p id="information-dialog-message">{translateUi(message)}</p>
        </div>
        <footer className="native-dialog-actions compact-dialog-actions">
          <span className="native-dialog-actions-spacer" />
          <button type="button" className="native-dialog-button suggested" autoFocus onClick={onClose}>
            {translateUi('OK')}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function ErrorReportDialog({
  error,
  onClose,
  onReportBug,
}: {
  error: ApplicationError;
  onClose: () => void;
  onReportBug: () => void;
}) {
  return (
    <div
      className="dialog-backdrop native-alert-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="pinta-dialog native-alert-dialog error-report-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-report-title"
        aria-describedby="error-report-message"
      >
        <div className="error-report-content">
          <h2 id="error-report-title">{translateUi(error.title)}</h2>
          <p id="error-report-message">{translateUi(error.message)}</p>
          <details>
            <summary>{translateUi('Details')}</summary>
            <pre data-visual-error-details>{error.details}</pre>
          </details>
        </div>
        <footer className="native-dialog-actions compact-dialog-actions">
          <button type="button" className="native-dialog-button suggested" onClick={onReportBug}>
            {translateUi('Report Bug...')}
          </button>
          <span className="native-dialog-actions-spacer" />
          <button type="button" className="native-dialog-button" autoFocus onClick={onClose}>
            {translateUi('OK')}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function EffectProgressDialog({
  effectName,
  progress,
  onCancel,
}: {
  effectName: string;
  progress: number;
  onCancel: () => void;
}) {
  return (
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation">
      <div
        className="pinta-dialog effect-progress-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="effect-progress-title"
        aria-describedby="effect-progress-name"
      >
        <h2 id="effect-progress-title">{translateUi('Rendering Effect')}</h2>
        <div className="effect-progress-content">
          <span id="effect-progress-name">{translateUi(effectName)}</span>
          <progress aria-label={translateUi('Rendering progress')} value={progress} max={1} />
          <small>{Math.round(progress * 100)}%</small>
        </div>
        <footer className="native-dialog-actions compact-dialog-actions">
          <span className="native-dialog-actions-spacer" />
          <button type="button" className="native-dialog-button" autoFocus onClick={onCancel}>
            {translateUi('Cancel')}
          </button>
        </footer>
      </div>
    </div>
  );
}

export interface PrintPreview {
  dataUrl: string;
  fileName: string;
  width: number;
  height: number;
  settings: PrintSettings;
}

export interface PrintSettings {
  orientation: 'portrait' | 'landscape';
  scaleMode: 'fit' | 'actual' | 'custom';
  scale: number;
  margin: number;
  center: boolean;
}

export function PrintDialog({
  preview,
  onCancel,
  onPrint,
  onSettingsChange,
}: {
  preview: PrintPreview;
  onCancel: () => void;
  onPrint: () => void;
  onSettingsChange: (settings: PrintSettings) => void;
}) {
  const update = (settings: Partial<PrintSettings>) => onSettingsChange({ ...preview.settings, ...settings });
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="pinta-dialog print-dialog" role="dialog" aria-modal="true" aria-labelledby="print-title">
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" onClick={onCancel}>
            Cancel
          </button>
          <strong id="print-title">Print Image</strong>
          <button type="button" className="dialog-text-button suggested" onClick={onPrint}>
            Print
          </button>
        </header>
        <div className="dialog-content print-dialog-content">
          <div className="print-preview checkerboard">
            <img src={preview.dataUrl} alt={`Print preview of ${preview.fileName}`} />
          </div>
          <div className="print-summary">
            <strong>{preview.fileName}</strong>
            <span>
              {preview.width} × {preview.height} {translateUi('pixels')} · {translateUi('one page')}
            </span>
          </div>
          <fieldset className="print-settings-group">
            <legend>{translateUi('Page setup')}</legend>
            <label>
              <span>{translateUi('Orientation')}</span>
              <select
                aria-label={translateUi('Print orientation')}
                value={preview.settings.orientation}
                onChange={(event) => update({ orientation: event.target.value as PrintSettings['orientation'] })}
              >
                <option value="portrait">{translateUi('Portrait')}</option>
                <option value="landscape">{translateUi('Landscape')}</option>
              </select>
            </label>
            <label>
              <span>{translateUi('Scaling')}</span>
              <select
                aria-label={translateUi('Print scaling')}
                value={preview.settings.scaleMode}
                onChange={(event) => update({ scaleMode: event.target.value as PrintSettings['scaleMode'] })}
              >
                <option value="fit">{translateUi('Scale to fit one page')}</option>
                <option value="actual">{translateUi('Actual size (96 PPI)')}</option>
                <option value="custom">{translateUi('Custom scale')}</option>
              </select>
            </label>
            {preview.settings.scaleMode === 'custom' && (
              <label>
                <span>{translateUi('Scale')}</span>
                <span className="print-number-field">
                  <input
                    type="number"
                    min="10"
                    max="500"
                    value={preview.settings.scale}
                    onChange={(event) =>
                      update({ scale: Math.max(10, Math.min(500, Number(event.target.value) || 10)) })
                    }
                    aria-label={translateUi('Custom print scale')}
                  />
                  <i>%</i>
                </span>
              </label>
            )}
            <label>
              <span>{translateUi('Margins')}</span>
              <span className="print-number-field">
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={preview.settings.margin}
                  onChange={(event) => update({ margin: Math.max(0, Math.min(50, Number(event.target.value) || 0)) })}
                  aria-label={translateUi('Print margins')}
                />
                <i>mm</i>
              </span>
            </label>
            <label className="print-center-row">
              <input
                type="checkbox"
                checked={preview.settings.center}
                onChange={(event) => update({ center: event.target.checked })}
              />
              <span>{translateUi('Center image on page')}</span>
            </label>
          </fieldset>
          <p className="dialog-hint">
            {translateUi(
              'Paper size, printer options, and destination remain available in the browser’s print window.',
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export function OffsetSelectionDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (offset: number) => void;
}) {
  const [offset, setOffset] = useState(0);
  return (
    <div
      className="dialog-backdrop native-dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="pinta-dialog offset-selection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offset-selection-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(offset);
        }}
      >
        <h2 className="visually-hidden" id="offset-selection-title">
          Offset Selection
        </h2>
        <div className="dialog-content offset-selection-content">
          <label className="native-effect-range">
            <strong>Offset</strong>
            <span>
              <input
                type="range"
                min="-100"
                max="100"
                value={offset}
                onChange={(event) => setOffset(Number(event.target.value))}
                aria-label={`Selection offset ${offset} pixels`}
              />
              <DialogStepper
                autoFocus
                label="Selection offset"
                min={-100}
                max={100}
                value={offset}
                onChange={setOffset}
              />
              <DialogResetButton label="Reset offset" onClick={() => setOffset(0)} />
            </span>
          </label>
        </div>
        <DialogActions onCancel={onCancel} />
      </form>
    </div>
  );
}

export function ScreenshotDialog({
  busy,
  error,
  onCancel,
  onCapture,
}: {
  busy: boolean;
  error: string;
  onCancel: () => void;
  onCapture: (delay: number) => void;
}) {
  const [delay, setDelay] = useState(0);
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="pinta-dialog screenshot-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="screenshot-title"
        onSubmit={(event) => {
          event.preventDefault();
          onCapture(delay);
        }}
      >
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <strong id="screenshot-title">New Screenshot</strong>
          <button type="submit" className="dialog-text-button suggested" disabled={busy}>
            {busy ? 'Waiting…' : 'Capture'}
          </button>
        </header>
        <div className="dialog-content screenshot-content">
          <span className="screenshot-icon">
            <PintaIcon file="view-fullscreen-symbolic.svg" size={30} standard />
          </span>
          <div className="screenshot-copy">
            <strong>Capture a screen, window, or browser tab</strong>
            <p>
              The browser will ask which surface you want to share. Pinta captures one frame and immediately stops
              sharing.
            </p>
          </div>
          <label className="layer-property-field screenshot-delay-field">
            <span>Delay</span>
            <select
              value={delay}
              disabled={busy}
              onChange={(event) => setDelay(Number(event.target.value))}
              aria-label="Screenshot delay"
            >
              <option value={0}>No delay</option>
              <option value={3}>3 seconds</option>
              <option value={5}>5 seconds</option>
            </select>
          </label>
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}

export function CanvasGridDialog({
  settings,
  onCancel,
  onSubmit,
}: {
  settings: CanvasGridSettings;
  onCancel: () => void;
  onSubmit: (settings: CanvasGridSettings) => void;
}) {
  const [value, setValue] = useState(settings);
  const number = (key: keyof CanvasGridSettings, next: number, min: number, max: number) => {
    setValue((current) => ({ ...current, [key]: Math.max(min, Math.min(max, Math.round(next))) }));
  };
  return (
    <div
      className="dialog-backdrop native-dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="pinta-dialog canvas-grid-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-grid-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <h2 className="visually-hidden" id="canvas-grid-title">
          Canvas Grid Settings
        </h2>
        <div className="dialog-content canvas-grid-content">
          <section className="native-grid-section">
            <label className="native-check-row">
              <input
                type="checkbox"
                checked={value.showGrid}
                onChange={(event) => setValue((current) => ({ ...current, showGrid: event.target.checked }))}
              />
              <span>Show Grid</span>
            </label>
            <label>
              <span>Width:</span>
              <DialogStepper
                label="Grid cell width"
                min={1}
                max={10000}
                disabled={!value.showGrid}
                value={value.cellWidth}
                onChange={(next) => number('cellWidth', next, 1, 10000)}
              />
              <i>pixels</i>
            </label>
            <label>
              <span>Height:</span>
              <DialogStepper
                label="Grid cell height"
                min={1}
                max={10000}
                disabled={!value.showGrid}
                value={value.cellHeight}
                onChange={(next) => number('cellHeight', next, 1, 10000)}
              />
              <i>pixels</i>
            </label>
          </section>
          <section className="native-grid-section native-axon-grid-section">
            <label className="native-check-row">
              <input
                type="checkbox"
                checked={value.showAxonometricGrid}
                onChange={(event) => setValue((current) => ({ ...current, showAxonometricGrid: event.target.checked }))}
              />
              <span>Show Axonometric Grid</span>
            </label>
            <label>
              <span>Width:</span>
              <DialogStepper
                label="Axonometric grid width"
                min={1}
                max={10000}
                disabled={!value.showAxonometricGrid}
                value={value.axonometricWidth}
                onChange={(next) => number('axonometricWidth', next, 1, 10000)}
              />
              <i>pixels</i>
            </label>
            <div className="native-grid-angle">
              <AngleDial
                value={value.axonometricAngle}
                min={1}
                max={89}
                disabled={!value.showAxonometricGrid}
                onChange={(next) => number('axonometricAngle', next, 1, 89)}
              />
              <DialogStepper
                label="Axonometric grid angle"
                min={1}
                max={89}
                disabled={!value.showAxonometricGrid}
                value={value.axonometricAngle}
                onChange={(next) => number('axonometricAngle', next, 1, 89)}
              />
              <DialogResetButton
                label="Reset grid angle"
                disabled={!value.showAxonometricGrid}
                onClick={() => number('axonometricAngle', 30, 1, 89)}
              />
            </div>
          </section>
        </div>
        <DialogActions onCancel={onCancel} />
      </form>
    </div>
  );
}
