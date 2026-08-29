import { useState } from 'react';
import { translateUi } from '../../i18n';
import type { CanvasAnchor } from '../../editor/usePaintEditor';
import { PintaIcon } from '../primitives';
import { DialogActions, DialogResetButton, DialogStepper } from '../dialogControls';

export type DialogName = 'new' | 'resize-image' | 'resize-canvas' | null;

export interface ImageSizeDialogProps {
  mode: Exclude<DialogName, null>;
  currentWidth: number;
  currentHeight: number;
  secondaryColor: string;
  onCancel: () => void;
  onSubmit: (width: number, height: number, anchor: CanvasAnchor, background: 'white' | 'secondary' | 'transparent', resampling: string) => void;
}

const ANCHORS: CanvasAnchor[] = [
  'north-west', 'north', 'north-east',
  'west', 'center', 'east',
  'south-west', 'south', 'south-east',
];

export interface StoredResizeSettings {
  width: number;
  height: number;
  percentage: number;
  preserveAspect: boolean;
  sizeMode: 'percentage' | 'absolute';
  anchor: CanvasAnchor;
  resampling: string;
}

function loadResizeSettings(mode: 'resize-image' | 'resize-canvas', width: number, height: number): StoredResizeSettings {
  const fallback: StoredResizeSettings = {
    width,
    height,
    percentage: 100,
    preserveAspect: true,
    sizeMode: 'percentage',
    anchor: 'center',
    resampling: 'bilinear',
  };
  try {
    const stored = JSON.parse(localStorage.getItem(`pinta-online-${mode}-settings`) ?? 'null') as Partial<StoredResizeSettings> | null;
    if (!stored) return fallback;
    return {
      width: Number.isFinite(stored.width) ? Math.max(1, Math.min(16384, Math.round(stored.width!))) : width,
      height: Number.isFinite(stored.height) ? Math.max(1, Math.min(16384, Math.round(stored.height!))) : height,
      percentage: Number.isFinite(stored.percentage) ? Math.max(1, Math.min(10000, Math.round(stored.percentage!))) : 100,
      preserveAspect: stored.preserveAspect ?? true,
      sizeMode: stored.sizeMode === 'absolute' ? 'absolute' : 'percentage',
      anchor: ANCHORS.includes(stored.anchor as CanvasAnchor) ? stored.anchor as CanvasAnchor : 'center',
      resampling: ['nearest', 'bilinear'].includes(stored.resampling ?? '') ? stored.resampling! : 'bilinear',
    };
  } catch {
    return fallback;
  }
}

export function ImageSizeDialog({ mode, currentWidth, currentHeight, secondaryColor, onCancel, onSubmit }: ImageSizeDialogProps) {
  const initialWidth = mode === 'new' ? 800 : currentWidth;
  const initialHeight = mode === 'new' ? 600 : currentHeight;
  const stored = mode === 'new' ? null : loadResizeSettings(mode, initialWidth, initialHeight);
  const [width, setWidth] = useState(stored?.width ?? initialWidth);
  const [height, setHeight] = useState(stored?.height ?? initialHeight);
  const [preserveAspect, setPreserveAspect] = useState(stored?.preserveAspect ?? true);
  const [anchor, setAnchor] = useState<CanvasAnchor>(stored?.anchor ?? 'center');
  const [preset, setPreset] = useState(mode === 'new' ? '800 x 600' : 'Custom');
  const [background, setBackground] = useState<'white' | 'secondary' | 'transparent'>('white');
  const [sizeMode, setSizeMode] = useState<'percentage' | 'absolute'>(stored?.sizeMode ?? 'percentage');
  const [percentage, setPercentage] = useState(stored?.percentage ?? 100);
  const [resampling, setResampling] = useState(stored?.resampling ?? 'nearest');
  const ratio = initialWidth / initialHeight;
  const title = mode === 'new' ? 'New Image' : mode === 'resize-image' ? 'Resize Image' : 'Resize Canvas';

  const updateWidth = (value: number) => {
    const safe = Math.max(1, Math.min(16384, value || 1));
    setWidth(safe);
    if (mode === 'new') setPreset('Custom');
    if (preserveAspect && mode !== 'new') setHeight(Math.max(1, Math.round(safe / ratio)));
  };

  const updateHeight = (value: number) => {
    const safe = Math.max(1, Math.min(16384, value || 1));
    setHeight(safe);
    if (mode === 'new') setPreset('Custom');
    if (preserveAspect && mode !== 'new') setWidth(Math.max(1, Math.round(safe * ratio)));
  };

  const updatePercentage = (value: number) => {
    const safe = Math.max(1, Math.min(10000, Math.round(value || 1)));
    setPercentage(safe);
    setWidth(Math.max(1, Math.round(initialWidth * safe / 100)));
    setHeight(Math.max(1, Math.round(initialHeight * safe / 100)));
  };

  if (mode === 'new') {
    const previewBackground = background === 'secondary' ? secondaryColor : '#ffffff';
    return (
      <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}>
        <form className="pinta-dialog native-new-image-dialog" role="dialog" aria-modal="true" aria-labelledby="image-size-title" onSubmit={(event) => {
          event.preventDefault();
          onSubmit(width, height, anchor, background, resampling);
        }}>
          <h2 className="visually-hidden" id="image-size-title">{translateUi('New Image')}</h2>
          <div className="native-new-image-content">
            <section className="native-new-image-options" aria-label={translateUi('Image options')}>
              <label className="native-dialog-row native-preset-row">
                <span>{translateUi('Preset:')}</span>
                <select aria-label={translateUi('Preset')} value={preset} onChange={(event) => {
                  const value = event.target.value;
                  setPreset(value);
                  if (value !== 'Custom') {
                    const [presetWidth, presetHeight] = value.split(/\s+[x×]\s+/).map(Number);
                    setWidth(presetWidth);
                    setHeight(presetHeight);
                  }
                }}>
                  <option value="Custom">{translateUi('Custom')}</option>
                  <option>640 x 480</option>
                  <option>800 x 600</option>
                  <option>1024 x 768</option>
                  <option>1600 x 1200</option>
                </select>
              </label>
              <label className="native-dialog-row native-dimension-row">
                <span>{translateUi('Width:')}</span>
                <input aria-label={translateUi('Width')} type="number" min="1" max="16384" value={width} autoFocus onChange={(event) => updateWidth(Number(event.target.value))} />
                <i>{translateUi('pixels')}</i>
              </label>
              <label className="native-dialog-row native-dimension-row">
                <span>{translateUi('Height:')}</span>
                <input aria-label={translateUi('Height')} type="number" min="1" max="16384" value={height} onChange={(event) => updateHeight(Number(event.target.value))} />
                <i>{translateUi('pixels')}</i>
              </label>
              <fieldset className="native-choice-group native-orientation-group">
                <legend>{translateUi('Orientation:')}</legend>
                <label>
                  <PintaIcon file="image-orientation-portrait-symbolic.svg" size={16} />
                  <input type="radio" name="orientation" checked={height > width} onChange={() => {
                    if (width > height) {
                      setWidth(height);
                      setHeight(width);
                      setPreset('Custom');
                    }
                  }} />
                  <span>{translateUi('Portrait')}</span>
                </label>
                <label>
                  <PintaIcon file="image-orientation-landscape-symbolic.svg" size={16} />
                  <input type="radio" name="orientation" checked={width >= height} onChange={() => {
                    if (height > width) {
                      setWidth(height);
                      setHeight(width);
                      setPreset('Custom');
                    }
                  }} />
                  <span>{translateUi('Landscape')}</span>
                </label>
              </fieldset>
              <fieldset className="native-choice-group native-background-group">
                <legend>{translateUi('Background:')}</legend>
                <label><i className="native-color-swatch" style={{ background: '#ffffff' }} /><input type="radio" name="background" checked={background === 'white'} onChange={() => setBackground('white')} /><span>{translateUi('White')}</span></label>
                {secondaryColor.toLowerCase() !== '#ffffff' && (
                  <label><i className="native-color-swatch" style={{ background: secondaryColor }} /><input type="radio" name="background" checked={background === 'secondary'} onChange={() => setBackground('secondary')} /><span>{translateUi('Background Color')}</span></label>
                )}
                <label><i className="native-color-swatch checkerboard" /><input type="radio" name="background" checked={background === 'transparent'} onChange={() => setBackground('transparent')} /><span>{translateUi('Transparent')}</span></label>
              </fieldset>
            </section>
            <section className="native-new-image-preview-wrap" aria-label={translateUi('Preview')}>
              <span>{translateUi('Preview')}</span>
              <div className={`native-new-image-preview ${background === 'transparent' ? 'checkerboard' : ''}`} style={{ aspectRatio: `${width} / ${height}`, backgroundColor: background === 'transparent' ? undefined : previewBackground }} />
            </section>
          </div>
          <footer className="native-dialog-actions">
            <button type="button" className="native-dialog-button" onClick={onCancel}>{translateUi('Cancel')}</button>
            <button type="submit" className="native-dialog-button suggested">{translateUi('OK')}</button>
          </footer>
        </form>
      </div>
    );
  }

  const anchorIcons: Record<CanvasAnchor, string> = {
    'north-west': 'image-resize-canvas-nw-symbolic.svg',
    north: 'image-resize-canvas-up-symbolic.svg',
    'north-east': 'image-resize-canvas-ne-symbolic.svg',
    west: 'image-resize-canvas-left-symbolic.svg',
    center: 'image-resize-canvas-base-symbolic.svg',
    east: 'image-resize-canvas-right-symbolic.svg',
    'south-west': 'image-resize-canvas-sw-symbolic.svg',
    south: 'image-resize-canvas-down-symbolic.svg',
    'south-east': 'image-resize-canvas-se-symbolic.svg',
  };

  return (
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className={`pinta-dialog native-resize-dialog ${mode === 'resize-canvas' ? 'native-resize-canvas-dialog' : ''}`} role="dialog" aria-modal="true" aria-labelledby="image-size-title" onSubmit={(event) => {
        event.preventDefault();
        localStorage.setItem(`pinta-online-${mode}-settings`, JSON.stringify({ width, height, percentage, preserveAspect, sizeMode, anchor, resampling } satisfies StoredResizeSettings));
        onSubmit(width, height, anchor, background, resampling);
      }}>
        <h2 className="visually-hidden" id="image-size-title">{translateUi(title)}</h2>
        <div className="native-resize-content">
          <label className="native-radio-row percentage-row">
            <input type="radio" name="size-mode" checked={sizeMode === 'percentage'} onChange={() => setSizeMode('percentage')} />
            <span>{translateUi('By percentage:')}</span>
            <DialogStepper label="Percentage" min={1} max={10000} value={percentage} onChange={updatePercentage} disabled={sizeMode !== 'percentage'} />
            <i>%</i>
          </label>
          <label className="native-radio-row absolute-row">
            <input type="radio" name="size-mode" checked={sizeMode === 'absolute'} onChange={() => setSizeMode('absolute')} />
            <span>{translateUi('By absolute size:')}</span>
          </label>
          <div className="native-size-grid">
            <span>{translateUi('Width:')}</span>
            <DialogStepper label="Width" min={1} max={16384} value={width} onChange={updateWidth} disabled={sizeMode !== 'absolute'} />
            <i>{translateUi('pixels')}</i>
            <DialogResetButton label="Reset to image size" disabled={sizeMode !== 'absolute'} onClick={() => {
              setWidth(initialWidth);
              setHeight(initialHeight);
              setPercentage(100);
            }} />
            <span>{translateUi('Height:')}</span>
            <DialogStepper label="Height" min={1} max={16384} value={height} onChange={updateHeight} disabled={sizeMode !== 'absolute'} />
            <i>{translateUi('pixels')}</i>
          </div>
          <label className="native-check-row"><input type="checkbox" checked={preserveAspect} disabled={sizeMode !== 'absolute'} onChange={(event) => setPreserveAspect(event.target.checked)} /><span>{translateUi('Maintain aspect ratio')}</span></label>
          {mode === 'resize-image' && (
            <label className="native-resampling-row">
              <span>{translateUi('Resampling:')}</span>
              <select value={resampling} onChange={(event) => setResampling(event.target.value)} aria-label={translateUi('Resampling')}>
                <option value="nearest">{translateUi('Nearest Neighbor')}</option>
                <option value="bilinear">{translateUi('Bilinear')}</option>
              </select>
            </label>
          )}
          {mode === 'resize-canvas' && (
            <div className="native-anchor-section">
              <span>{translateUi('Anchor:')}</span>
              <div className="native-anchor-picker">
                {ANCHORS.map((item) => (
                  <button key={item} type="button" aria-label={`${translateUi(item)} ${translateUi('anchor')}`} aria-pressed={anchor === item} onClick={() => setAnchor(item)}>
                    <PintaIcon file={anchorIcons[item]} size={20} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogActions onCancel={onCancel} />
      </form>
    </div>
  );
}
