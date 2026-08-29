import { useState } from 'react';
import { type PaletteFormat } from '../../editor/palette';
import { DialogActions, DialogStepper } from '../dialogControls';

export function PaletteResizeDialog({
  currentSize,
  onCancel,
  onSubmit,
}: {
  currentSize: number;
  onCancel: () => void;
  onSubmit: (size: number) => void;
}) {
  const [size, setSize] = useState(currentSize);
  return (
    <div
      className="dialog-backdrop native-dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="pinta-dialog native-palette-resize-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="palette-resize-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(size);
        }}
      >
        <h2 className="visually-hidden" id="palette-resize-title">
          Resize Palette
        </h2>
        <div className="native-palette-resize-content">
          <label>
            <span>New palette size:</span>
            <DialogStepper autoFocus label="New palette size" min={1} max={96} value={size} onChange={setSize} />
          </label>
        </div>
        <DialogActions onCancel={onCancel} />
      </form>
    </div>
  );
}

export function PaletteSaveDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (format: PaletteFormat, fileName: string) => void;
}) {
  const [format, setFormat] = useState<PaletteFormat>('paint-dot-net');
  const [fileName, setFileName] = useState('pinta-palette');
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="pinta-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="palette-save-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(format, fileName);
        }}
      >
        <header className="dialog-header">
          <button className="dialog-text-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <strong id="palette-save-title">Save Palette File</strong>
          <button className="dialog-text-button suggested" type="submit">
            Save
          </button>
        </header>
        <div className="dialog-content">
          <label className="dialog-select-label">
            <span>Name</span>
            <span className="dialog-input-wrap">
              <input
                autoFocus
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                aria-label="Palette file name"
              />
            </span>
          </label>
          <label className="dialog-select-label">
            <span>Format</span>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as PaletteFormat)}
              aria-label="Palette format"
            >
              <option value="paint-dot-net">Paint.NET palette (.txt)</option>
              <option value="gimp">GIMP palette (.gpl)</option>
              <option value="paint-shop-pro">PaintShop Pro palette (.pal)</option>
            </select>
          </label>
          <p className="dialog-hint">
            The browser will download a palette compatible with Pinta and the selected application.
          </p>
        </div>
      </form>
    </div>
  );
}
