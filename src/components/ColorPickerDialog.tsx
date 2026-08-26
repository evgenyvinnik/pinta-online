import {
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { translateUi } from '../i18n';

export interface ColorPickerResult {
  primary: string;
  secondary?: string;
}

interface ColorPickerDialogProps {
  title?: string;
  primary: string;
  secondary?: string;
  initialTarget?: 'primary' | 'secondary';
  recentColors?: string[];
  palette?: string[];
  onCancel: () => void;
  onChange?: (colors: ColorPickerResult) => void;
  onSubmit: (colors: ColorPickerResult) => void;
}

interface RgbaColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

interface HsvColor {
  hue: number;
  saturation: number;
  value: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const byte = (value: number) => clamp(Math.round(value), 0, 255);
const byteHex = (value: number) => byte(value).toString(16).padStart(2, '0');

export function parseHexColor(value: string): RgbaColor | null {
  const hex = value.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
    alpha: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255,
  };
}

export function formatHexColor(color: RgbaColor) {
  const rgb = `#${byteHex(color.red)}${byteHex(color.green)}${byteHex(color.blue)}`;
  return byte(color.alpha) === 255 ? rgb : `${rgb}${byteHex(color.alpha)}`;
}

function rgbToHsv({ red, green, blue }: RgbaColor): HsvColor {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * (((b - r) / delta) + 2);
    else hue = 60 * (((r - g) / delta) + 4);
  }
  return {
    hue: (hue + 360) % 360,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

function hsvToRgb({ hue, saturation, value }: HsvColor, alpha = 255): RgbaColor {
  const h = ((hue % 360) + 360) % 360;
  const saturationValue = clamp(saturation, 0, 1);
  const valueValue = clamp(value, 0, 1);
  const chroma = valueValue * saturationValue;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = valueValue - chroma;
  const [r, g, b] = h < 60 ? [chroma, x, 0]
    : h < 120 ? [x, chroma, 0]
      : h < 180 ? [0, chroma, x]
        : h < 240 ? [0, x, chroma]
          : h < 300 ? [x, 0, chroma]
            : [chroma, 0, x];
  return { red: (r + match) * 255, green: (g + match) * 255, blue: (b + match) * 255, alpha };
}

function rgbaCss(color: RgbaColor, alpha = color.alpha / 255) {
  return `rgba(${byte(color.red)}, ${byte(color.green)}, ${byte(color.blue)}, ${clamp(alpha, 0, 1)})`;
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3 3 7l4 4V8h9a2 2 0 0 1 2 2v1h2v-1a4 4 0 0 0-4-4H7V3Zm10 10v3H8a2 2 0 0 1-2-2v-1H4v1a4 4 0 0 0 4 4h9v3l4-4-4-4Z" />
    </svg>
  );
}

function ColorSlider({ label, value, max, gradient, onChange }: {
  label: string;
  value: number;
  max: number;
  gradient: string;
  onChange: (value: number) => void;
}) {
  const rounded = Math.round(value);
  return (
    <label className="color-component-row" dir="ltr">
      <span>{translateUi(label)}</span>
      <input
        className="color-component-slider"
        type="range"
        min={0}
        max={max}
        value={rounded}
        style={{ '--color-gradient': gradient } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={translateUi(label)}
      />
      <input
        className="color-component-number"
        type="number"
        min={0}
        max={max}
        value={rounded}
        onChange={(event) => onChange(clamp(Number(event.target.value), 0, max))}
        aria-label={`${translateUi(label)} ${translateUi('Value')}`}
      />
    </label>
  );
}

export function ColorPickerDialog({
  title = 'Choose Palette Color',
  primary,
  secondary,
  initialTarget = 'primary',
  recentColors = [],
  palette = [],
  onCancel,
  onChange,
  onSubmit,
}: ColorPickerDialogProps) {
  const normalizedPrimary = formatHexColor(parseHexColor(primary) ?? { red: 0, green: 0, blue: 0, alpha: 255 });
  const normalizedSecondary = secondary === undefined
    ? undefined
    : formatHexColor(parseHexColor(secondary) ?? { red: 255, green: 255, blue: 255, alpha: 255 });
  const [primaryValue, setPrimaryValue] = useState(normalizedPrimary);
  const [secondaryValue, setSecondaryValue] = useState(normalizedSecondary);
  const [target, setTarget] = useState<'primary' | 'secondary'>(secondaryValue === undefined ? 'primary' : initialTarget);
  const [surface, setSurface] = useState<'hue-saturation' | 'saturation-value'>('hue-saturation');
  const [showValue, setShowValue] = useState(true);
  const [smallMode, setSmallMode] = useState(false);
  const [hexDraft, setHexDraft] = useState(target === 'primary' ? normalizedPrimary : normalizedSecondary ?? normalizedPrimary);

  const currentHex = target === 'secondary' && secondaryValue !== undefined ? secondaryValue : primaryValue;
  const current = parseHexColor(currentHex) ?? { red: 0, green: 0, blue: 0, alpha: 255 };
  const hsv = rgbToHsv(current);

  const selectTarget = (nextTarget: 'primary' | 'secondary') => {
    const value = nextTarget === 'secondary' ? secondaryValue : primaryValue;
    if (value === undefined) return;
    setTarget(nextTarget);
    setHexDraft(value);
  };

  const updateCurrent = (next: RgbaColor) => {
    const value = formatHexColor(next);
    if (target === 'secondary' && secondaryValue !== undefined) {
      setSecondaryValue(value);
      onChange?.({ primary: primaryValue, secondary: value });
    } else {
      setPrimaryValue(value);
      onChange?.({ primary: value, secondary: secondaryValue });
    }
    setHexDraft(value);
  };

  const updateHsv = (next: Partial<HsvColor>) => {
    updateCurrent(hsvToRgb({ ...hsv, ...next }, current.alpha));
  };

  const applyHexDraft = (value: string) => {
    setHexDraft(value);
    const parsed = parseHexColor(value);
    if (parsed) updateCurrent(parsed);
  };

  const updateFromSurface = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (surface === 'saturation-value') {
      updateHsv({
        saturation: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
        value: 1 - clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
      });
      return;
    }
    const radius = Math.min(bounds.width, bounds.height) / 2;
    const dx = event.clientX - (bounds.left + bounds.width / 2);
    const dy = event.clientY - (bounds.top + bounds.height / 2);
    updateHsv({
      hue: ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360,
      saturation: clamp(Math.hypot(dx, dy) / radius, 0, 1),
    });
  };

  const onSurfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromSurface(event);
  };

  const onSurfaceKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const amount = event.shiftKey ? 0.1 : 0.01;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (surface === 'saturation-value') {
      updateHsv({
        saturation: clamp(hsv.saturation + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0), 0, 1),
        value: clamp(hsv.value + (event.key === 'ArrowDown' ? -amount : event.key === 'ArrowUp' ? amount : 0), 0, 1),
      });
    } else {
      updateHsv({
        hue: hsv.hue + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0),
        saturation: clamp(hsv.saturation + (event.key === 'ArrowDown' ? -amount : event.key === 'ArrowUp' ? amount : 0), 0, 1),
      });
    }
  };

  const surfaceMarker = surface === 'saturation-value'
    ? { left: `${hsv.saturation * 100}%`, top: `${(1 - hsv.value) * 100}%` }
    : {
      left: `${50 + Math.cos(hsv.hue * Math.PI / 180) * hsv.saturation * 50}%`,
      top: `${50 + Math.sin(hsv.hue * Math.PI / 180) * hsv.saturation * 50}%`,
    };

  const gradients = useMemo(() => {
    const opaque = { ...current, alpha: 255 };
    const transparent = { ...current, alpha: 0 };
    return {
      hue: 'linear-gradient(90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
      saturation: `linear-gradient(90deg, ${rgbaCss(hsvToRgb({ ...hsv, saturation: 0 }, current.alpha))}, ${rgbaCss(hsvToRgb({ ...hsv, saturation: 1 }, current.alpha))})`,
      value: `linear-gradient(90deg, ${rgbaCss(hsvToRgb({ ...hsv, value: 0 }, current.alpha))}, ${rgbaCss(hsvToRgb({ ...hsv, value: 1 }, current.alpha))})`,
      red: `linear-gradient(90deg, ${rgbaCss({ ...current, red: 0 })}, ${rgbaCss({ ...current, red: 255 })})`,
      green: `linear-gradient(90deg, ${rgbaCss({ ...current, green: 0 })}, ${rgbaCss({ ...current, green: 255 })})`,
      blue: `linear-gradient(90deg, ${rgbaCss({ ...current, blue: 0 })}, ${rgbaCss({ ...current, blue: 255 })})`,
      alpha: `linear-gradient(90deg, ${rgbaCss(transparent)}, ${rgbaCss(opaque)})`,
    };
  }, [current.alpha, current.blue, current.green, current.red, hsv.hue, hsv.saturation, hsv.value]);

  const swapColors = () => {
    if (secondaryValue === undefined) return;
    setPrimaryValue(secondaryValue);
    setSecondaryValue(primaryValue);
    onChange?.({ primary: secondaryValue, secondary: primaryValue });
    const next = target === 'primary' ? secondaryValue : primaryValue;
    setHexDraft(next);
  };

  const reset = () => {
    setPrimaryValue(normalizedPrimary);
    setSecondaryValue(normalizedSecondary);
    onChange?.({ primary: normalizedPrimary, secondary: normalizedSecondary });
    setHexDraft(target === 'primary' ? normalizedPrimary : normalizedSecondary ?? normalizedPrimary);
  };

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className={`pinta-dialog color-picker-dialog ${smallMode ? 'small-mode' : ''}`} role="dialog" aria-modal="true" aria-labelledby="color-picker-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ primary: primaryValue, secondary: secondaryValue });
      }}>
        <header className="dialog-header color-picker-header">
          <span className="color-picker-header-start">
            <button className="dialog-text-button" type="button" onClick={reset}>{translateUi('Reset')}</button>
            <button className="dialog-icon-button color-picker-collapse" type="button" onClick={() => setSmallMode((current) => !current)} aria-label={translateUi(smallMode ? 'Expand color picker' : 'Collapse color picker')} title={translateUi(smallMode ? 'Expand color picker' : 'Collapse color picker')}>
              <img className="pinta-icon" src={`/standard-icons/window-${smallMode ? 'maximize' : 'minimize'}-symbolic.svg`} width="16" height="16" alt="" />
            </button>
          </span>
          <strong id="color-picker-title">{translateUi(title)}</strong>
          <span className="color-picker-header-actions">
            <button className="dialog-text-button" type="button" onClick={onCancel}>{translateUi('Cancel')}</button>
            <button className="dialog-text-button suggested" type="submit">{translateUi('OK')}</button>
          </span>
        </header>

        <div className="dialog-content color-picker-content">
          <aside className="color-picker-targets" aria-label={translateUi('Color')}>
            <button
              type="button"
              className={`color-picker-target ${target === 'primary' ? 'active' : ''}`}
              onClick={() => selectTarget('primary')}
              aria-label={translateUi('Click to select primary color.')}
            >
              <span className="color-picker-target-preview checkerboard" style={{ '--target-color': primaryValue } as CSSProperties} />
              <span>{translateUi(secondaryValue === undefined ? 'Color' : 'Primary')}</span>
            </button>
            {secondaryValue !== undefined && (
              <>
                <button className="color-picker-swap" type="button" onClick={swapColors} aria-label={`${translateUi('Click to switch between primary and secondary color.')} ${translateUi('Shortcut key')}: X`}>
                  <SwapIcon />
                </button>
                <button
                  type="button"
                  className={`color-picker-target ${target === 'secondary' ? 'active' : ''}`}
                  onClick={() => selectTarget('secondary')}
                  aria-label={translateUi('Click to select secondary color.')}
                >
                  <span className="color-picker-target-preview checkerboard" style={{ '--target-color': secondaryValue } as CSSProperties} />
                  <span>{translateUi('Secondary')}</span>
                </button>
              </>
            )}
          </aside>

          <section className="color-picker-surface-column">
            <div className="color-picker-surface-tabs" role="group" aria-label={translateUi('Color')}>
              <button type="button" className={surface === 'hue-saturation' ? 'active' : ''} onClick={() => setSurface('hue-saturation')}>{translateUi('Hue & Sat')}</button>
              <button type="button" className={surface === 'saturation-value' ? 'active' : ''} onClick={() => setSurface('saturation-value')}>{translateUi('Sat & Value')}</button>
            </div>
            <div
              className={`color-picker-surface ${surface}`}
              style={{
                '--picker-hue': `${hsv.hue}deg`,
                '--picker-value-overlay': showValue ? String(1 - hsv.value) : '0',
              } as CSSProperties}
              role="slider"
              tabIndex={0}
              aria-label={surface === 'hue-saturation' ? translateUi('Hue & Sat') : translateUi('Sat & Value')}
              aria-valuetext={`${translateUi('Hue')} ${Math.round(hsv.hue)}, ${translateUi('Saturation')} ${Math.round(hsv.saturation * 100)}, ${translateUi('Value')} ${Math.round(hsv.value * 100)}`}
              onPointerDown={onSurfacePointerDown}
              onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromSurface(event); }}
              onKeyDown={onSurfaceKeyDown}
            >
              <span className="color-picker-surface-marker" style={surfaceMarker} />
            </div>
            {surface === 'hue-saturation' && (
              <label className="color-picker-show-value">
                <input type="checkbox" checked={showValue} onChange={(event) => setShowValue(event.target.checked)} />
                <span>{translateUi('Show Value')}</span>
              </label>
            )}
          </section>

          <section className="color-picker-components">
            <label className="color-picker-hex-row">
              <span>{translateUi('Hex')}</span>
              <input
                value={hexDraft}
                maxLength={9}
                spellCheck={false}
                className={parseHexColor(hexDraft) ? '' : 'invalid'}
                onChange={(event) => applyHexDraft(event.target.value)}
                aria-label={translateUi('Hex')}
              />
            </label>
            <ColorSlider label="Hue" value={hsv.hue} max={360} gradient={gradients.hue} onChange={(value) => updateHsv({ hue: value })} />
            <ColorSlider label="Saturation" value={hsv.saturation * 100} max={100} gradient={gradients.saturation} onChange={(value) => updateHsv({ saturation: value / 100 })} />
            <ColorSlider label="Value" value={hsv.value * 100} max={100} gradient={gradients.value} onChange={(value) => updateHsv({ value: value / 100 })} />
            <div className="color-picker-separator" />
            <ColorSlider label="Red" value={current.red} max={255} gradient={gradients.red} onChange={(value) => updateCurrent({ ...current, red: value })} />
            <ColorSlider label="Green" value={current.green} max={255} gradient={gradients.green} onChange={(value) => updateCurrent({ ...current, green: value })} />
            <ColorSlider label="Blue" value={current.blue} max={255} gradient={gradients.blue} onChange={(value) => updateCurrent({ ...current, blue: value })} />
            <div className="color-picker-separator" />
            <ColorSlider label="Alpha" value={current.alpha} max={255} gradient={gradients.alpha} onChange={(value) => updateCurrent({ ...current, alpha: value })} />
          </section>

          {(recentColors.length > 0 || palette.length > 0) && !smallMode && (
            <section className="color-picker-palette" aria-label={translateUi('Palette')}>
              {recentColors.length > 0 && <><strong>{translateUi('Recently Used')}</strong>
              <div>
                {recentColors.map((color, index) => (
                  <button
                    key={`recent-${color}-${index}`}
                    type="button"
                    className="color-picker-palette-swatch checkerboard"
                    style={{ '--target-color': color } as CSSProperties}
                    onClick={() => {
                      const parsed = parseHexColor(color);
                      if (parsed) updateCurrent(parsed);
                    }}
                    aria-label={`${translateUi('Color')}: ${color}`}
                    title={color}
                  />
                ))}
              </div></>}
              {palette.length > 0 && <><strong>{translateUi('Palette')}</strong>
                <div>
                  {palette.map((color, index) => (
                    <button
                      key={`palette-${color}-${index}`}
                      type="button"
                      className="color-picker-palette-swatch checkerboard"
                      style={{ '--target-color': color } as CSSProperties}
                      onClick={() => {
                        const parsed = parseHexColor(color);
                        if (parsed) updateCurrent(parsed);
                      }}
                      aria-label={`${translateUi('Color')}: ${color}`}
                      title={color}
                    />
                  ))}
                </div></>}
            </section>
          )}
        </div>
      </form>
    </div>
  );
}
