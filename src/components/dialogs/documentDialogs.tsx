import { useEffect, useMemo, useRef, useState } from 'react';
import { translateUi } from '../../i18n';
import type { ExportFormat } from '../../editor/types';
import { BusySpinner, PintaIcon } from '../primitives';
import { DialogActions, DialogStepper } from '../dialogControls';

export interface CloseDocumentDialogProps {
  fileName: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

export function CloseDocumentDialog({ fileName, onCancel, onDiscard, onSave }: CloseDocumentDialogProps) {
  const title = translateUi('Save changes to image "{0}" before closing?').replace('{0}', fileName);
  return (
    <div className="dialog-backdrop native-alert-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div className="pinta-dialog close-document-dialog native-alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-document-title" aria-describedby="close-document-description">
        <div className="close-document-content">
          <h2 id="close-document-title">{title}</h2>
          <p id="close-document-description">{translateUi("If you don't save, all changes will be permanently lost.")}</p>
        </div>
        <footer className="close-document-actions">
          <button type="button" className="native-alert-button suggested" autoFocus onClick={onSave}>{translateUi('Save')}</button>
          <button type="button" className="native-alert-button destructive" onClick={onDiscard}>{translateUi('Discard')}</button>
          <button type="button" className="native-alert-button" onClick={onCancel}>{translateUi('Cancel')}</button>
        </footer>
      </div>
    </div>
  );
}

export function PasteExpandDialog({ onCancel, onPreserve, onExpand }: { onCancel: () => void; onPreserve: () => void; onExpand: () => void }) {
  return (
    <div className="dialog-backdrop native-alert-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div className="pinta-dialog native-alert-dialog paste-expand-dialog" role="alertdialog" aria-modal="true" aria-labelledby="paste-expand-title" aria-describedby="paste-expand-description">
        <div className="close-document-content">
          <h2 id="paste-expand-title">{translateUi('Image larger than canvas')}</h2>
          <p id="paste-expand-description">{translateUi('The image being pasted is larger than the canvas. What would you like to do to the canvas size?')}</p>
        </div>
        <footer className="close-document-actions">
          <button type="button" className="native-alert-button suggested" autoFocus onClick={onExpand}>{translateUi('Expand')}</button>
          <button type="button" className="native-alert-button" onClick={onPreserve}>{translateUi('Preserve')}</button>
          <button type="button" className="native-alert-button" onClick={onCancel}>{translateUi('Cancel')}</button>
        </footer>
      </div>
    </div>
  );
}

export interface SaveAsDialogProps {
  fileName: string;
  layerCount: number;
  onCancel: () => void;
  onSaved?: () => void;
  onSubmit: (options: { fileName: string; format: ExportFormat; quality: number; flatten: boolean }) => Promise<boolean>;
}

export function initialExportFormat(fileName: string): ExportFormat {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
  if (extension === 'webp') return 'webp';
  if (extension === 'bmp') return 'bmp';
  if (extension === 'tif' || extension === 'tiff') return 'tiff';
  if (extension === 'ora') return 'ora';
  if (extension === 'ppm') return 'ppm';
  if (extension === 'tga') return 'tga';
  return 'png';
}

export function FlattenConfirmDialog({ onCancel, onFlatten }: { onCancel: () => void; onFlatten: () => void }) {
  return (
    <div className="dialog-backdrop native-alert-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div className="pinta-dialog native-alert-dialog flatten-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="flatten-confirm-title" aria-describedby="flatten-confirm-description">
        <div className="close-document-content">
          <h2 id="flatten-confirm-title">{translateUi('This format does not support layers. Flatten image?')}</h2>
          <p id="flatten-confirm-description">{translateUi('Flattening the image will merge all layers into a single layer.')}</p>
        </div>
        <footer className="native-dialog-actions compact-dialog-actions"><span className="native-dialog-actions-spacer" /><button type="button" className="native-dialog-button" onClick={onCancel}>{translateUi('Cancel')}</button><button type="button" className="native-dialog-button suggested" autoFocus onClick={onFlatten}>{translateUi('Flatten')}</button></footer>
      </div>
    </div>
  );
}

export function JpegQualityDialog({ initialQuality, onCancel, onSubmit }: { initialQuality: number; onCancel: () => void; onSubmit: (quality: number) => void }) {
  const [quality, setQuality] = useState(initialQuality);
  return (
    <div className="dialog-backdrop native-dialog-backdrop jpeg-quality-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog jpeg-quality-dialog" role="dialog" aria-modal="true" aria-labelledby="jpeg-quality-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(quality);
      }}>
        <h2 className="visually-hidden" id="jpeg-quality-title">{translateUi('JPEG Quality')}</h2>
        <div className="dialog-content jpeg-quality-content">
          <label>
            <span>{translateUi('Quality:')}</span>
            <input type="range" min="1" max="100" step="1" value={quality} onChange={(event) => setQuality(Number(event.target.value))} aria-label={translateUi('JPEG quality')} />
            <output>{quality}</output>
          </label>
        </div>
        <DialogActions onCancel={onCancel} />
      </form>
    </div>
  );
}

export function SaveAsDialog({ fileName, layerCount, onCancel, onSaved = onCancel, onSubmit }: SaveAsDialogProps) {
  const [name, setName] = useState(fileName.replace(/\.[^.]+$/, '') || 'pinta-image');
  const [format, setFormat] = useState<ExportFormat>(() => initialExportFormat(fileName));
  const [quality, setQuality] = useState(92);
  const [saving, setSaving] = useState(false);
  const [confirmFlatten, setConfirmFlatten] = useState(false);
  const [showJpegQuality, setShowJpegQuality] = useState(false);
  const [jpegFlatten, setJpegFlatten] = useState(false);
  const valid = name.trim().length > 0;
  const save = async (flatten = false, selectedQuality = quality) => {
    if (!valid || saving) return;
    setSaving(true);
    const saved = await onSubmit({ fileName: name, format, quality: selectedQuality / 100, flatten });
    setSaving(false);
    if (saved) onSaved();
  };
  const continueSave = (flatten: boolean) => {
    if (format === 'jpeg') {
      setJpegFlatten(flatten);
      setShowJpegQuality(true);
    } else {
      void save(flatten);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (!saving && event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog save-as-dialog" role="dialog" aria-modal="true" aria-labelledby="save-as-title" onSubmit={(event) => {
        event.preventDefault();
        if (layerCount > 1 && format !== 'ora') {
          setConfirmFlatten(true);
          return;
        }
        continueSave(false);
      }}>
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" onClick={onCancel} disabled={saving}>{translateUi('Cancel')}</button>
          <strong id="save-as-title">{translateUi('Save Image As')}</strong>
          <button type="submit" className="dialog-text-button suggested" disabled={!valid || saving}>
            {saving ? <><BusySpinner /> {translateUi('Saving')}</> : translateUi('Save')}
          </button>
        </header>
        <div className="dialog-content save-as-content">
          <label className="layer-property-field">
            <span>{translateUi('Name')}</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label={translateUi('File name')} />
          </label>
          <label className="layer-property-field">
            <span>{translateUi('Format')}</span>
            <select value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)} aria-label={translateUi('File format')}>
              <option value="png">PNG image (.png)</option>
              <option value="jpeg">JPEG image (.jpg)</option>
              <option value="webp">WebP image (.webp)</option>
              <option value="bmp">Bitmap image (.bmp)</option>
              <option value="tiff">TIFF image (.tif)</option>
              <option value="ora">OpenRaster image (.ora)</option>
              <option value="ppm">Portable Pixmap image (.ppm)</option>
              <option value="tga">Targa image (.tga)</option>
            </select>
          </label>
          {format === 'webp' && (
            <label className="layer-opacity-field">
              <span>{translateUi('Quality')}</span>
              <span className="layer-opacity-value">
                <input type="number" min="1" max="100" value={quality} onChange={(event) => setQuality(Math.max(1, Math.min(100, Number(event.target.value))))} aria-label="Quality value" />
                <i>%</i>
              </span>
              <input type="range" min="1" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} aria-label={`Quality ${quality}%`} />
            </label>
          )}
          <p className="dialog-hint save-format-hint">
            {format === 'jpeg'
              ? 'JPEG does not support transparency; transparent pixels are exported on white.'
              : format === 'ora'
                ? 'OpenRaster preserves layers, names, visibility, opacity, blend modes, and the merged preview.'
                : format === 'ppm'
                  ? 'Portable Pixmap uses Pinta-compatible P3 RGB text encoding and does not preserve transparency.'
                  : format === 'tga'
                    ? 'Targa uses Pinta-compatible uncompressed 32-bit BGRA encoding and preserves transparency.'
                    : format === 'bmp'
                      ? 'Bitmap uses a Pinta-compatible 32-bit V4 encoding with an explicit alpha channel.'
                    : format === 'tiff'
                      ? 'TIFF uses an interoperable uncompressed RGBA page with an explicit alpha channel.'
                : 'Transparency and the composited layer result are preserved.'}
          </p>
        </div>
      </form>
      {confirmFlatten && <FlattenConfirmDialog onCancel={() => setConfirmFlatten(false)} onFlatten={() => { setConfirmFlatten(false); continueSave(true); }} />}
      {showJpegQuality && (
        <JpegQualityDialog
          initialQuality={quality}
          onCancel={() => setShowJpegQuality(false)}
          onSubmit={(selectedQuality) => {
            setQuality(selectedQuality);
            setShowJpegQuality(false);
            void save(jpegFlatten, selectedQuality);
          }}
        />
      )}
    </div>
  );
}
