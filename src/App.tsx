import {
  AlertTriangle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Crop,
  Eye,
  EyeOff,
  FilePlus2,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Grid3X3,
  Image as ImageIcon,
  Italic,
  LoaderCircle,
  Maximize2,
  Menu,
  Merge,
  Minus,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Printer,
  Redo2,
  RotateCw,
  Save,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Underline,
  Undo2,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { usePaintEditor } from './editor/usePaintEditor';
import { paletteFileName, parsePalette, serializePalette, type PaletteFormat } from './editor/palette';
import { TOOL_BY_ID, TOOLS } from './editor/tools';
import type { CanvasAnchor, SelectionMode, ShapeDashStyle, ShapeFillStyle, TextAlignment, TextStyle, TextVariant } from './editor/usePaintEditor';
import { BLEND_MODES, type BlendMode, type ExportFormat, type PaintLayer } from './editor/types';
import {
  EFFECT_BY_ID,
  EFFECT_DEFINITIONS,
  defaultEffectParameters,
  type EffectDefinition,
  type EffectId,
  type EffectParameters,
} from './effects/types';
import {
  curvePointsFromParameters,
  curveSvgPath,
  setCurvePoints,
  type CurveChannel,
  type CurvePoint,
} from './effects/curves';
import { usePreferences, type CanvasGridSettings, type RulerMetric } from './state/preferences';

type MenuName = 'pinta' | 'file' | 'edit' | 'view' | 'image' | 'adjustments' | 'effects' | 'addins' | 'window' | 'help' | 'main' | null;
type DialogName = 'new' | 'resize-image' | 'resize-canvas' | null;

const EFFECT_MENU_CATEGORIES = [
  ['artistic', 'Artistic'],
  ['blur', 'Blurs'],
  ['color', 'Color'],
  ['distort', 'Distort'],
  ['noise', 'Noise'],
  ['object', 'Object'],
  ['photo', 'Photo'],
  ['render', 'Render'],
  ['stylize', 'Stylize'],
] as const;

const ADJUSTMENT_SHORTCUTS: Partial<Record<EffectId, string>> = {
  curves: '⌘⇧M',
  invert: '⌘⇧I',
  levels: '⌘L',
};

interface IconButtonProps {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}

function IconButton({ label, children, onClick, disabled, active, className = '' }: IconButtonProps) {
  return (
    <button
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      {children}
    </button>
  );
}

function NativeToolIcon({ file, size = 22 }: { file: string; size?: number }) {
  return <img className="native-tool-icon" src={`/actions/${file}`} width={size} height={size} alt="" draggable={false} />;
}

interface MenuItemProps {
  icon?: ReactNode;
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

function MenuItem({ icon, label, shortcut, checked, disabled, onClick }: MenuItemProps) {
  return (
    <button
      className="menu-item"
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked === undefined ? undefined : checked}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu-check">{checked ? <Check size={14} /> : icon}</span>
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

function Popover({ children, align = 'left', className = '' }: { children: ReactNode; align?: 'left' | 'right'; className?: string }) {
  return <div className={`popover popover-${align} ${className}`} role="menu">{children}</div>;
}

function TopLevelMenu({
  name,
  label,
  active,
  onToggle,
  onEnter,
  children,
  appMenu = false,
}: {
  name: Exclude<MenuName, null | 'main'>;
  label: string;
  active: boolean;
  onToggle: (name: Exclude<MenuName, null | 'main'>) => void;
  onEnter: (name: Exclude<MenuName, null | 'main'>) => void;
  children: ReactNode;
  appMenu?: boolean;
}) {
  return (
    <div className={`macos-menu-anchor ${active ? 'active' : ''}`} onPointerEnter={() => onEnter(name)}>
      <button
        className={`macos-menu-button ${appMenu ? 'application-menu-button' : ''}`}
        data-menu-name={name}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={active}
        onClick={() => onToggle(name)}
      >
        {appMenu && <img src="/apps/com.github.PintaProject.Pinta.svg" alt="" />}
        <span>{label}</span>
      </button>
      {active && <Popover className="macos-menu-popover">{children}</Popover>}
    </div>
  );
}

interface ImageSizeDialogProps {
  mode: Exclude<DialogName, null>;
  currentWidth: number;
  currentHeight: number;
  secondaryColor: string;
  onCancel: () => void;
  onSubmit: (width: number, height: number, anchor: CanvasAnchor, background: 'white' | 'secondary' | 'transparent') => void;
}

const ANCHORS: CanvasAnchor[] = [
  'north-west', 'north', 'north-east',
  'west', 'center', 'east',
  'south-west', 'south', 'south-east',
];

const SELECTION_MODE_OPTIONS: Array<{ value: SelectionMode; label: string }> = [
  { value: 'replace', label: 'Replace' },
  { value: 'union', label: 'Union (+)' },
  { value: 'exclude', label: 'Exclude (−)' },
  { value: 'xor', label: 'Xor' },
  { value: 'intersect', label: 'Intersect' },
];

function ImageSizeDialog({ mode, currentWidth, currentHeight, secondaryColor, onCancel, onSubmit }: ImageSizeDialogProps) {
  const initialWidth = mode === 'new' ? 960 : currentWidth;
  const initialHeight = mode === 'new' ? 600 : currentHeight;
  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);
  const [preserveAspect, setPreserveAspect] = useState(mode === 'resize-image');
  const [anchor, setAnchor] = useState<CanvasAnchor>('center');
  const [preset, setPreset] = useState('Custom');
  const [background, setBackground] = useState<'white' | 'secondary' | 'transparent'>('white');
  const ratio = initialWidth / initialHeight;
  const title = mode === 'new' ? 'New Image' : mode === 'resize-image' ? 'Resize Image' : 'Resize Canvas';

  const updateWidth = (value: number) => {
    const safe = Math.max(1, Math.min(16384, value || 1));
    setWidth(safe);
    if (mode === 'new') setPreset('Custom');
    if (preserveAspect && mode === 'resize-image') setHeight(Math.max(1, Math.round(safe / ratio)));
  };

  const updateHeight = (value: number) => {
    const safe = Math.max(1, Math.min(16384, value || 1));
    setHeight(safe);
    if (mode === 'new') setPreset('Custom');
    if (preserveAspect && mode === 'resize-image') setWidth(Math.max(1, Math.round(safe * ratio)));
  };

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog" role="dialog" aria-modal="true" aria-labelledby="image-size-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(width, height, anchor, background);
      }}>
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" onClick={onCancel}>Cancel</button>
          <strong id="image-size-title">{title}</strong>
          <button type="submit" className="dialog-text-button suggested">{mode === 'new' ? 'Create' : 'Resize'}</button>
        </header>
        <div className="dialog-content">
          <div className="dialog-preview checkerboard">
            <div className={background === 'transparent' ? 'transparent-preview' : ''} style={{ aspectRatio: `${width} / ${height}`, backgroundColor: background === 'secondary' ? secondaryColor : undefined }}>
              <span>{width} × {height}</span>
            </div>
          </div>
          {mode === 'new' && (
            <label className="dialog-select-label">
              <span>Preset</span>
              <select value={preset} onChange={(event) => {
                const value = event.target.value;
                setPreset(value);
                if (value !== 'Custom') {
                  const [presetWidth, presetHeight] = value.split(' × ').map(Number);
                  setWidth(presetWidth);
                  setHeight(presetHeight);
                }
              }}>
                <option>Custom</option>
                <option>640 × 480</option>
                <option>800 × 600</option>
                <option>1024 × 768</option>
                <option>1600 × 1200</option>
              </select>
            </label>
          )}
          <div className="dialog-fields">
            <label>
              <span>Width</span>
              <span className="dialog-input-wrap"><input aria-label="Width" type="number" min="1" max="16384" value={width} onChange={(event) => updateWidth(Number(event.target.value))} /><i>px</i></span>
            </label>
            <label>
              <span>Height</span>
              <span className="dialog-input-wrap"><input aria-label="Height" type="number" min="1" max="16384" value={height} onChange={(event) => updateHeight(Number(event.target.value))} /><i>px</i></span>
            </label>
          </div>
          {mode === 'resize-image' && (
            <label className="dialog-checkbox"><input type="checkbox" checked={preserveAspect} onChange={(event) => setPreserveAspect(event.target.checked)} /> Maintain aspect ratio</label>
          )}
          {mode === 'new' && (
            <>
              <div className="new-image-options">
                <span>Orientation</span>
                <div className="segmented-control">
                  <button type="button" className={height > width ? 'active' : ''} onClick={() => {
                    if (width > height) {
                      setWidth(height);
                      setHeight(width);
                      setPreset('Custom');
                    }
                  }}><NativeToolIcon file="image-orientation-portrait-symbolic.svg" size={16} /> Portrait</button>
                  <button type="button" className={width >= height ? 'active' : ''} onClick={() => {
                    if (height > width) {
                      setWidth(height);
                      setHeight(width);
                      setPreset('Custom');
                    }
                  }}><NativeToolIcon file="image-orientation-landscape-symbolic.svg" size={16} /> Landscape</button>
                </div>
              </div>
              <fieldset className="background-options">
                <legend>Background</legend>
                <label><input type="radio" name="background" checked={background === 'white'} onChange={() => setBackground('white')} /><i style={{ background: '#ffffff' }} /> White</label>
                <label><input type="radio" name="background" checked={background === 'secondary'} onChange={() => setBackground('secondary')} /><i style={{ background: secondaryColor }} /> Background Color</label>
                <label><input type="radio" name="background" checked={background === 'transparent'} onChange={() => setBackground('transparent')} /><i className="checkerboard" /> Transparent</label>
              </fieldset>
            </>
          )}
          {mode === 'resize-canvas' && (
            <div className="anchor-picker">
              <span>Anchor</span>
              <div>
                {ANCHORS.map((item) => (
                  <button key={item} type="button" aria-label={`${item} anchor`} className={anchor === item ? 'active' : ''} onClick={() => setAnchor(item)}><i /></button>
                ))}
              </div>
            </div>
          )}
          <p className="dialog-hint">Maximum canvas size: 16,384 × 16,384 pixels</p>
        </div>
      </form>
    </div>
  );
}

interface EffectDialogProps {
  effect: EffectDefinition;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (parameters: EffectParameters) => Promise<void>;
}

const CURVE_CHANNEL_COLORS: Record<CurveChannel, string> = {
  luminosity: '#e8edf4',
  red: '#ef5350',
  green: '#4fd46b',
  blue: '#4d86ff',
};

interface CurvesEditorProps {
  parameters: EffectParameters;
  disabled: boolean;
  onChange: (parameters: EffectParameters) => void;
}

type LevelChannel = 'red' | 'green' | 'blue';
type LevelControlKey = 'inputLow' | 'inputHigh' | 'gamma' | 'outputLow' | 'outputHigh';

const LEVEL_CONTROLS: Array<{ key: LevelControlKey; label: string; min: number; max: number; step: number }> = [
  { key: 'inputLow', label: 'Input low', min: 0, max: 254, step: 1 },
  { key: 'inputHigh', label: 'Input high', min: 1, max: 255, step: 1 },
  { key: 'gamma', label: 'Gamma', min: 0.1, max: 10, step: 0.1 },
  { key: 'outputLow', label: 'Output low', min: 0, max: 254, step: 1 },
  { key: 'outputHigh', label: 'Output high', min: 1, max: 255, step: 1 },
];

function levelParameterKey(channel: LevelChannel, control: LevelControlKey) {
  return `levels_${channel}_${control}`;
}

function LevelsEditor({ parameters, disabled, onChange }: CurvesEditorProps) {
  const [activeChannels, setActiveChannels] = useState<Record<LevelChannel, boolean>>({ red: true, green: true, blue: true });
  const selectedChannels = (['red', 'green', 'blue'] as LevelChannel[]).filter((channel) => activeChannels[channel]);
  const displayedValue = (control: LevelControlKey) => {
    if (!selectedChannels.length) return control === 'gamma' ? 1 : control.endsWith('High') ? 255 : 0;
    const average = selectedChannels.reduce((total, channel) => total + parameters[levelParameterKey(channel, control)], 0) / selectedChannels.length;
    return control === 'gamma' ? Number(average.toFixed(1)) : Math.round(average);
  };
  const updateControl = (control: LevelControlKey, rawValue: number) => {
    const definition = LEVEL_CONTROLS.find((candidate) => candidate.key === control)!;
    const nextValue = Math.max(definition.min, Math.min(definition.max, rawValue));
    const next = { ...parameters };
    for (const channel of selectedChannels) {
      next[levelParameterKey(channel, control)] = nextValue;
      if (control === 'inputLow') next[levelParameterKey(channel, 'inputHigh')] = Math.max(nextValue + 1, next[levelParameterKey(channel, 'inputHigh')]);
      if (control === 'inputHigh') next[levelParameterKey(channel, 'inputLow')] = Math.min(nextValue - 1, next[levelParameterKey(channel, 'inputLow')]);
      if (control === 'outputLow') next[levelParameterKey(channel, 'outputHigh')] = Math.max(nextValue + 1, next[levelParameterKey(channel, 'outputHigh')]);
      if (control === 'outputHigh') next[levelParameterKey(channel, 'outputLow')] = Math.min(nextValue - 1, next[levelParameterKey(channel, 'outputLow')]);
    }
    onChange(next);
  };
  const reset = () => {
    const next = { ...parameters };
    for (const channel of selectedChannels.length ? selectedChannels : (['red', 'green', 'blue'] as LevelChannel[])) {
      next[levelParameterKey(channel, 'inputLow')] = 0;
      next[levelParameterKey(channel, 'inputHigh')] = 255;
      next[levelParameterKey(channel, 'gamma')] = 1;
      next[levelParameterKey(channel, 'outputLow')] = 0;
      next[levelParameterKey(channel, 'outputHigh')] = 255;
    }
    onChange(next);
  };
  const inputLow = displayedValue('inputLow');
  const inputHigh = displayedValue('inputHigh');
  const outputLow = displayedValue('outputLow');
  const outputHigh = displayedValue('outputHigh');
  const gamma = displayedValue('gamma');

  return (
    <div className="levels-editor">
      <div className="levels-channel-bar">
        {(['red', 'green', 'blue'] as const).map((channel) => (
          <label key={channel} className={`curve-channel-toggle channel-${channel}`}>
            <input type="checkbox" checked={activeChannels[channel]} disabled={disabled} onChange={(event) => setActiveChannels((current) => ({ ...current, [channel]: event.target.checked }))} />
            {channel[0].toUpperCase() + channel.slice(1)}
          </label>
        ))}
        <button type="button" className="dialog-text-button" disabled={disabled} onClick={reset}>Reset</button>
      </div>
      <div className="levels-gradient-group" aria-hidden="true">
        <span>Input</span>
        <div className="levels-gradient">
          <i className="levels-marker low" style={{ left: `${inputLow / 2.55}%` }} />
          <i className="levels-marker gamma" style={{ left: `${inputLow / 2.55 + (inputHigh - inputLow) / 2.55 * Math.pow(0.5, 1 / gamma)}%` }} />
          <i className="levels-marker high" style={{ left: `${inputHigh / 2.55}%` }} />
        </div>
        <span>Output</span>
        <div className="levels-gradient output">
          <i className="levels-marker low" style={{ left: `${outputLow / 2.55}%` }} />
          <i className="levels-marker high" style={{ left: `${outputHigh / 2.55}%` }} />
        </div>
      </div>
      <div className="effect-parameter-list levels-parameter-list">
        {LEVEL_CONTROLS.map((control) => (
          <label className="effect-parameter" key={control.key}>
            <span>{control.label}</span>
            <input type="range" min={control.min} max={control.max} step={control.step} value={displayedValue(control.key)} disabled={disabled || !selectedChannels.length} onChange={(event) => updateControl(control.key, Number(event.target.value))} />
            <span className="effect-parameter-value">
              <input aria-label={`${control.label} value`} type="number" min={control.min} max={control.max} step={control.step} value={displayedValue(control.key)} disabled={disabled || !selectedChannels.length} onChange={(event) => updateControl(control.key, Number(event.target.value))} />
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function CurvesEditor({ parameters, disabled, onChange }: CurvesEditorProps) {
  const parametersRef = useRef(parameters);
  parametersRef.current = parameters;
  const [activeRgbChannels, setActiveRgbChannels] = useState<Record<'red' | 'green' | 'blue', boolean>>({ red: true, green: true, blue: true });
  const [pointerPosition, setPointerPosition] = useState<CurvePoint>({ x: 255, y: 255 });
  const [selectedPoint, setSelectedPoint] = useState<{ channels: CurveChannel[]; x: number } | null>(null);
  const dragRef = useRef<{ channels: CurveChannel[]; x: number } | null>(null);
  const luminosityMode = parameters.curveMode === 0;
  const visibleChannels: CurveChannel[] = luminosityMode ? ['luminosity'] : ['red', 'green', 'blue'];
  const editableChannels = luminosityMode
    ? (['luminosity'] as CurveChannel[])
    : (['red', 'green', 'blue'] as CurveChannel[]).filter((channel) => activeRgbChannels[channel as 'red' | 'green' | 'blue']);

  const publish = (next: EffectParameters) => {
    parametersRef.current = next;
    onChange(next);
  };

  const coordinates = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(255, Math.round((event.clientX - bounds.left) * 255 / bounds.width))),
      y: Math.max(0, Math.min(255, Math.round(255 - (event.clientY - bounds.top) * 255 / bounds.height))),
    };
  };

  const updateDraggedPoint = (position: CurvePoint) => {
    const drag = dragRef.current;
    if (!drag) return;
    let next = parametersRef.current;
    let nextX = position.x;
    if (drag.x === 0 || drag.x === 255) nextX = drag.x;
    for (const channel of drag.channels) {
      const points = curvePointsFromParameters(next, channel).filter((point) => point.x !== drag.x && point.x !== nextX);
      points.push({ x: nextX, y: position.y });
      next = setCurvePoints(next, channel, points);
    }
    dragRef.current = { ...drag, x: nextX };
    setSelectedPoint({ channels: drag.channels, x: nextX });
    publish(next);
  };

  const removeSelectedPoint = () => {
    if (!selectedPoint || selectedPoint.x === 0 || selectedPoint.x === 255) return false;
    let next = parametersRef.current;
    for (const channel of selectedPoint.channels) {
      next = setCurvePoints(next, channel, curvePointsFromParameters(next, channel).filter((point) => point.x !== selectedPoint.x));
    }
    setSelectedPoint(null);
    publish(next);
    return true;
  };

  const resetVisibleCurves = () => {
    let next = parametersRef.current;
    for (const channel of editableChannels.length ? editableChannels : visibleChannels) {
      next = setCurvePoints(next, channel, [{ x: 0, y: 0 }, { x: 255, y: 255 }]);
    }
    publish(next);
  };

  return (
    <div className="curves-editor">
      <div className="curves-toolbar">
        <label>
          <span>Transfer Map</span>
          <select value={luminosityMode ? 'luminosity' : 'rgb'} disabled={disabled} onChange={(event) => publish({ ...parametersRef.current, curveMode: event.target.value === 'luminosity' ? 0 : 1 })} aria-label="Transfer map">
            <option value="rgb">RGB</option>
            <option value="luminosity">Luminosity</option>
          </select>
        </label>
        <output aria-label="Curve pointer position">({pointerPosition.x}, {pointerPosition.y})</output>
      </div>
      <svg
        className="curves-graph"
        viewBox="0 0 256 256"
        role="application"
        aria-label="Curve transfer graph"
        tabIndex={0}
        onContextMenu={(event) => event.preventDefault()}
        onPointerMove={(event) => {
          const position = coordinates(event);
          setPointerPosition(position);
          if (dragRef.current) updateDraggedPoint(position);
        }}
        onPointerDown={(event) => {
          if (disabled || !editableChannels.length) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          const position = coordinates(event);
          setPointerPosition(position);
          const hitRadius = 8;
          const referencePoints = curvePointsFromParameters(parametersRef.current, editableChannels[0]);
          const nearest = referencePoints.reduce<CurvePoint | null>((match, point) => {
            const distance = Math.hypot(point.x - position.x, point.y - position.y);
            if (distance > hitRadius) return match;
            return !match || distance < Math.hypot(match.x - position.x, match.y - position.y) ? point : match;
          }, null);
          if (event.button === 2) {
            if (!nearest || nearest.x === 0 || nearest.x === 255) return;
            let next = parametersRef.current;
            for (const channel of editableChannels) {
              next = setCurvePoints(next, channel, curvePointsFromParameters(next, channel).filter((point) => point.x !== nearest.x));
            }
            setSelectedPoint(null);
            publish(next);
            return;
          }
          const point = nearest ?? position;
          let next = parametersRef.current;
          for (const channel of editableChannels) {
            const points = curvePointsFromParameters(next, channel).filter((candidate) => candidate.x !== point.x);
            points.push(point);
            next = setCurvePoints(next, channel, points);
          }
          publish(next);
          dragRef.current = { channels: editableChannels, x: point.x };
          setSelectedPoint({ channels: editableChannels, x: point.x });
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          dragRef.current = null;
        }}
        onPointerCancel={() => { dragRef.current = null; }}
        onKeyDown={(event) => {
          if (disabled || !selectedPoint) return;
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            removeSelectedPoint();
            return;
          }
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const reference = curvePointsFromParameters(parametersRef.current, selectedPoint.channels[0]).find((point) => point.x === selectedPoint.x);
          if (!reference) return;
          const amount = event.shiftKey ? 10 : 1;
          dragRef.current = selectedPoint;
          updateDraggedPoint({
            x: reference.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0),
            y: reference.y + (event.key === 'ArrowDown' ? -amount : event.key === 'ArrowUp' ? amount : 0),
          });
          dragRef.current = null;
        }}
      >
        <rect width="255" height="255" className="curves-graph-background" />
        {[64, 128, 192].map((coordinate) => <path key={`grid-${coordinate}`} className="curves-grid-line" d={`M${coordinate} 0V255M0 ${coordinate}H255`} />)}
        <path className="curves-reference-line" d="M0 255L255 0" />
        {visibleChannels.map((channel) => {
          const active = channel === 'luminosity' || activeRgbChannels[channel as 'red' | 'green' | 'blue'];
          const points = curvePointsFromParameters(parameters, channel);
          return (
            <g key={channel} opacity={active ? 1 : 0.28}>
              <path className="curves-channel-line" stroke={CURVE_CHANNEL_COLORS[channel]} d={curveSvgPath(points)} />
              {active && points.map((point) => <circle key={`${channel}-${point.x}`} className={`curves-control-point ${selectedPoint?.x === point.x && selectedPoint.channels.includes(channel) ? 'selected' : ''}`} fill={CURVE_CHANNEL_COLORS[channel]} cx={point.x} cy={255 - point.y} r="4" />)}
            </g>
          );
        })}
      </svg>
      <div className="curves-footer">
        {!luminosityMode && (['red', 'green', 'blue'] as const).map((channel) => (
          <label key={channel} className={`curve-channel-toggle channel-${channel}`}>
            <input type="checkbox" checked={activeRgbChannels[channel]} disabled={disabled} onChange={(event) => setActiveRgbChannels((current) => ({ ...current, [channel]: event.target.checked }))} />
            {channel[0].toUpperCase() + channel.slice(1)}
          </label>
        ))}
        <button type="button" className="dialog-text-button" disabled={disabled} onClick={resetVisibleCurves}>Reset</button>
      </div>
      <p className="dialog-hint">Drag to add or move control points. Right-click an interior point to remove it.</p>
    </div>
  );
}

function AlignmentEditor({ parameters, disabled, onChange }: CurvesEditorProps) {
  const positions = [
    { label: 'Top Left', icon: 'image-resize-canvas-nw-symbolic.svg' },
    { label: 'Top Center', icon: 'image-resize-canvas-up-symbolic.svg' },
    { label: 'Top Right', icon: 'image-resize-canvas-ne-symbolic.svg' },
    { label: 'Center Left', icon: 'image-resize-canvas-left-symbolic.svg' },
    { label: 'Center', icon: 'image-resize-canvas-base-symbolic.svg' },
    { label: 'Center Right', icon: 'image-resize-canvas-right-symbolic.svg' },
    { label: 'Bottom Left', icon: 'image-resize-canvas-sw-symbolic.svg' },
    { label: 'Bottom Center', icon: 'image-resize-canvas-down-symbolic.svg' },
    { label: 'Bottom Right', icon: 'image-resize-canvas-se-symbolic.svg' },
  ];
  const selected = parameters.position ?? 4;
  return (
    <div className="alignment-editor" role="group" aria-label="Object alignment">
      {positions.map((position, index) => (
        <button
          key={position.label}
          type="button"
          title={position.label}
          aria-label={position.label}
          aria-pressed={selected === index}
          disabled={disabled}
          onClick={() => onChange({ ...parameters, position: index })}
        >
          <NativeToolIcon file={position.icon} size={22} />
        </button>
      ))}
    </div>
  );
}

function EffectDialog({ effect, busy, onCancel, onSubmit }: EffectDialogProps) {
  const [parameters, setParameters] = useState<EffectParameters>(() => defaultEffectParameters(effect));

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (!busy && event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog effect-dialog" role="dialog" aria-modal="true" aria-labelledby="effect-dialog-title" aria-busy={busy} onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(parameters);
      }}>
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" onClick={onCancel} disabled={busy}>Cancel</button>
          <strong id="effect-dialog-title">{effect.name}</strong>
          <button type="submit" className="dialog-text-button suggested" disabled={busy}>
            {busy ? <><LoaderCircle className="spin" size={15} /> Applying</> : 'Apply'}
          </button>
        </header>
        <div className="dialog-content">
          <div className="effect-dialog-intro">
            <span className="effect-dialog-icon"><NativeToolIcon file={effect.icon} size={28} /></span>
            <p>{effect.description}</p>
          </div>
          {effect.dialog === 'curves' ? (
            <CurvesEditor parameters={parameters} disabled={busy} onChange={setParameters} />
          ) : effect.dialog === 'levels' ? (
            <LevelsEditor parameters={parameters} disabled={busy} onChange={setParameters} />
          ) : effect.dialog === 'alignment' ? (
            <AlignmentEditor parameters={parameters} disabled={busy} onChange={setParameters} />
          ) : (
            <div className="effect-parameter-list">
              {effect.parameters.filter((parameter) => !parameter.visibleWhen || parameters[parameter.visibleWhen.key] === parameter.visibleWhen.equals).map((parameter) => parameter.kind === 'boolean' ? (
                <label className="effect-boolean-parameter" key={parameter.key}>
                  <input
                    type="checkbox"
                    checked={parameters[parameter.key] !== 0}
                    disabled={busy}
                    onChange={(event) => setParameters((current) => ({ ...current, [parameter.key]: event.target.checked ? 1 : 0 }))}
                  />
                  <span>{parameter.label}</span>
                </label>
              ) : parameter.kind === 'select' ? (
                <label className="effect-select-parameter" key={parameter.key}>
                  <span>{parameter.label}</span>
                  <select
                    value={parameters[parameter.key]}
                    disabled={busy}
                    onChange={(event) => setParameters((current) => ({ ...current, [parameter.key]: Number(event.target.value) }))}
                  >
                    {parameter.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              ) : parameter.kind === 'color' ? (
                <label className="effect-color-parameter" key={parameter.key}>
                  <span>{parameter.label}</span>
                  <input
                    type="color"
                    value={`#${Math.round(parameters[parameter.key]).toString(16).padStart(6, '0')}`}
                    disabled={busy}
                    onChange={(event) => setParameters((current) => ({ ...current, [parameter.key]: Number.parseInt(event.target.value.slice(1), 16) }))}
                  />
                </label>
              ) : (
                <label className="effect-parameter" key={parameter.key}>
                  <span>{parameter.label}</span>
                  <input
                    type="range"
                    min={parameter.min}
                    max={parameter.max}
                    step={parameter.step}
                    value={parameters[parameter.key]}
                    disabled={busy}
                    onChange={(event) => setParameters((current) => ({ ...current, [parameter.key]: Number(event.target.value) }))}
                  />
                  <span className="effect-parameter-value">
                    <input
                      aria-label={`${parameter.label} value`}
                      type="number"
                      min={parameter.min}
                      max={parameter.max}
                      step={parameter.step}
                      value={parameters[parameter.key]}
                      disabled={busy}
                      onChange={(event) => {
                        const next = Math.max(parameter.min, Math.min(parameter.max, Number(event.target.value)));
                        setParameters((current) => ({ ...current, [parameter.key]: next }));
                      }}
                    />
                    <i>{parameter.unit ?? ''}</i>
                  </span>
                </label>
              )
              )}
            </div>
          )}
          <p className="dialog-hint">The active layer is processed off the UI thread. If a selection is active, the result is limited to it.</p>
        </div>
      </form>
    </div>
  );
}

interface CloseDocumentDialogProps {
  fileName: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

function CloseDocumentDialog({ fileName, onCancel, onDiscard, onSave }: CloseDocumentDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div className="pinta-dialog close-document-dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-document-title" aria-describedby="close-document-description">
        <div className="close-document-content">
          <span className="close-document-icon"><AlertTriangle size={27} /></span>
          <div>
            <h2 id="close-document-title">Save changes to image “{fileName}” before closing?</h2>
            <p id="close-document-description">If you don’t save, all changes will be permanently lost.</p>
          </div>
        </div>
        <footer className="close-document-actions">
          <button type="button" className="dialog-text-button" onClick={onCancel}>Cancel</button>
          <span />
          <button type="button" className="dialog-text-button destructive" onClick={onDiscard}>Discard</button>
          <button type="button" className="dialog-text-button suggested" onClick={onSave}>Save</button>
        </footer>
      </div>
    </div>
  );
}

function CloseAllDialog({ documentCount, dirtyCount, onCancel, onDiscard, onSave }: {
  documentCount: number;
  dirtyCount: number;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (!saving && event.target === event.currentTarget) onCancel();
    }}>
      <div className="pinta-dialog close-document-dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-all-title" aria-describedby="close-all-description">
        <div className="close-document-content">
          <span className="close-document-icon"><AlertTriangle size={27} /></span>
          <div>
            <h2 id="close-all-title">Close all {documentCount} images?</h2>
            <p id="close-all-description">{dirtyCount} {dirtyCount === 1 ? 'image has' : 'images have'} unsaved changes.</p>
          </div>
        </div>
        <footer className="close-document-actions">
          <button type="button" className="dialog-text-button" disabled={saving} onClick={onCancel}>Cancel</button>
          <span />
          <button type="button" className="dialog-text-button destructive" disabled={saving} onClick={onDiscard}>Discard All</button>
          <button type="button" className="dialog-text-button suggested" disabled={saving} onClick={() => {
            setSaving(true);
            void onSave().finally(() => setSaving(false));
          }}>{saving ? 'Saving…' : 'Save All & Close'}</button>
        </footer>
      </div>
    </div>
  );
}

interface LayerPropertiesDialogProps {
  layer: PaintLayer;
  onCancel: () => void;
  onSubmit: (properties: { name: string; visible: boolean; opacity: number; blendMode: BlendMode }) => void;
}

function LayerPropertiesDialog({ layer, onCancel, onSubmit }: LayerPropertiesDialogProps) {
  const [name, setName] = useState(layer.name);
  const [visible, setVisible] = useState(layer.visible);
  const [opacity, setOpacity] = useState(Math.round(layer.opacity * 100));
  const [blendMode, setBlendMode] = useState<BlendMode>(layer.blendMode);
  const valid = name.trim().length > 0;

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog layer-properties-dialog" role="dialog" aria-modal="true" aria-labelledby="layer-properties-title" onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSubmit({ name, visible, opacity: opacity / 100, blendMode });
      }}>
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" onClick={onCancel}>Cancel</button>
          <strong id="layer-properties-title">Layer Properties</strong>
          <button type="submit" className="dialog-text-button suggested" disabled={!valid}>OK</button>
        </header>
        <div className="dialog-content layer-properties-content">
          <label className="layer-property-field">
            <span>Name</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label="Layer name" />
          </label>
          <label className="dialog-checkbox layer-visible-field">
            <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />
            <span>Visible</span>
          </label>
          <label className="layer-property-field">
            <span>Blend Mode</span>
            <select value={blendMode} onChange={(event) => setBlendMode(event.target.value as BlendMode)} aria-label="Blend mode">
              {BLEND_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
            </select>
          </label>
          <label className="layer-opacity-field">
            <span>Opacity</span>
            <span className="layer-opacity-value">
              <input type="number" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Math.max(0, Math.min(100, Number(event.target.value))))} aria-label="Opacity value" />
              <i>%</i>
            </span>
            <input type="range" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} aria-label={`Opacity ${opacity}%`} />
          </label>
        </div>
      </form>
    </div>
  );
}

function RotateZoomLayerDialog({ layer, onCancel, onSubmit }: { layer: PaintLayer; onCancel: () => void; onSubmit: (angle: number, panHorizontal: number, panVertical: number, zoom: number) => void }) {
  const [angle, setAngle] = useState(0);
  const [panHorizontal, setPanHorizontal] = useState(0);
  const [panVertical, setPanVertical] = useState(0);
  const [zoom, setZoom] = useState(100);
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog rotate-zoom-dialog" role="dialog" aria-modal="true" aria-labelledby="rotate-zoom-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(angle, panHorizontal, panVertical, zoom / 100);
      }}>
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" onClick={onCancel}>Cancel</button>
          <strong id="rotate-zoom-title">Rotate / Zoom Layer</strong>
          <button type="submit" className="dialog-text-button suggested">OK</button>
        </header>
        <div className="dialog-content rotate-zoom-content">
          <div className="rotate-zoom-preview checkerboard">
            <img
              src={layer.canvas.toDataURL()}
              alt="Layer transform preview"
              style={{ transform: `translate(${panHorizontal * 50}%, ${panVertical * 50}%) rotate(${-angle}deg) scale(${zoom / 100})` }}
            />
          </div>
          <label className="layer-opacity-field">
            <span>Angle</span>
            <span className="layer-opacity-value"><input type="number" min="-360" max="360" value={angle} onChange={(event) => setAngle(Math.max(-360, Math.min(360, Number(event.target.value))))} aria-label="Layer rotation angle" /><i>°</i></span>
            <input type="range" min="-180" max="180" value={angle} onChange={(event) => setAngle(Number(event.target.value))} aria-label={`Angle ${angle} degrees`} />
          </label>
          <label className="layer-opacity-field">
            <span>Pan X</span>
            <span className="layer-opacity-value"><input type="number" min="-100" max="100" value={Math.round(panHorizontal * 100)} onChange={(event) => setPanHorizontal(Math.max(-1, Math.min(1, Number(event.target.value) / 100)))} aria-label="Layer horizontal pan" /><i>%</i></span>
            <input type="range" min="-100" max="100" value={Math.round(panHorizontal * 100)} onChange={(event) => setPanHorizontal(Number(event.target.value) / 100)} aria-label={`Horizontal pan ${Math.round(panHorizontal * 100)}%`} />
          </label>
          <label className="layer-opacity-field">
            <span>Pan Y</span>
            <span className="layer-opacity-value"><input type="number" min="-100" max="100" value={Math.round(panVertical * 100)} onChange={(event) => setPanVertical(Math.max(-1, Math.min(1, Number(event.target.value) / 100)))} aria-label="Layer vertical pan" /><i>%</i></span>
            <input type="range" min="-100" max="100" value={Math.round(panVertical * 100)} onChange={(event) => setPanVertical(Number(event.target.value) / 100)} aria-label={`Vertical pan ${Math.round(panVertical * 100)}%`} />
          </label>
          <label className="layer-opacity-field">
            <span>Zoom</span>
            <span className="layer-opacity-value"><input type="number" min="1" max="1600" value={zoom} onChange={(event) => setZoom(Math.max(1, Math.min(1600, Number(event.target.value))))} aria-label="Layer zoom value" /><i>%</i></span>
            <input type="range" min="1" max="400" value={Math.min(400, zoom)} onChange={(event) => setZoom(Number(event.target.value))} aria-label={`Zoom ${zoom}%`} />
          </label>
        </div>
      </form>
    </div>
  );
}

interface SaveAsDialogProps {
  fileName: string;
  onCancel: () => void;
  onSubmit: (options: { fileName: string; format: ExportFormat; quality: number }) => Promise<boolean>;
}

function initialExportFormat(fileName: string): ExportFormat {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
  if (extension === 'webp') return 'webp';
  if (extension === 'ora') return 'ora';
  if (extension === 'ppm') return 'ppm';
  if (extension === 'tga') return 'tga';
  return 'png';
}

function SaveAsDialog({ fileName, onCancel, onSubmit }: SaveAsDialogProps) {
  const [name, setName] = useState(fileName.replace(/\.[^.]+$/, '') || 'pinta-image');
  const [format, setFormat] = useState<ExportFormat>(() => initialExportFormat(fileName));
  const [quality, setQuality] = useState(92);
  const [saving, setSaving] = useState(false);
  const valid = name.trim().length > 0;

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (!saving && event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog save-as-dialog" role="dialog" aria-modal="true" aria-labelledby="save-as-title" onSubmit={async (event) => {
        event.preventDefault();
        if (!valid || saving) return;
        setSaving(true);
        const saved = await onSubmit({ fileName: name, format, quality: quality / 100 });
        setSaving(false);
        if (saved) onCancel();
      }}>
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" onClick={onCancel} disabled={saving}>Cancel</button>
          <strong id="save-as-title">Save Image As</strong>
          <button type="submit" className="dialog-text-button suggested" disabled={!valid || saving}>
            {saving ? <><LoaderCircle className="spin" size={15} /> Saving</> : 'Save'}
          </button>
        </header>
        <div className="dialog-content save-as-content">
          <label className="layer-property-field">
            <span>Name</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label="File name" />
          </label>
          <label className="layer-property-field">
            <span>Format</span>
            <select value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)} aria-label="File format">
              <option value="png">PNG image (.png)</option>
              <option value="jpeg">JPEG image (.jpg)</option>
              <option value="webp">WebP image (.webp)</option>
              <option value="ora">OpenRaster image (.ora)</option>
              <option value="ppm">Portable Pixmap image (.ppm)</option>
              <option value="tga">Targa image (.tga)</option>
            </select>
          </label>
          {(format === 'jpeg' || format === 'webp') && (
            <label className="layer-opacity-field">
              <span>Quality</span>
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
                : 'Transparency and the composited layer result are preserved.'}
          </p>
        </div>
      </form>
    </div>
  );
}

function PaletteResizeDialog({ currentSize, onCancel, onSubmit }: { currentSize: number; onCancel: () => void; onSubmit: (size: number) => void }) {
  const [size, setSize] = useState(currentSize);
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog" role="dialog" aria-modal="true" aria-labelledby="palette-resize-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(size);
      }}>
        <header className="dialog-header">
          <button className="dialog-text-button" type="button" onClick={onCancel}>Cancel</button>
          <strong id="palette-resize-title">Resize Palette</strong>
          <button className="dialog-text-button suggested" type="submit">Resize</button>
        </header>
        <div className="dialog-content">
          <label className="dialog-select-label">
            <span>New palette size:</span>
            <span className="dialog-input-wrap">
              <input autoFocus type="number" min={1} max={96} value={size} onChange={(event) => setSize(Math.max(1, Math.min(96, Number(event.target.value))))} aria-label="New palette size" />
              <i>colors</i>
            </span>
          </label>
          <p className="dialog-hint">Pinta palettes can contain between 1 and 96 colors. New entries are initialized to white.</p>
        </div>
      </form>
    </div>
  );
}

function PaletteSaveDialog({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (format: PaletteFormat, fileName: string) => void }) {
  const [format, setFormat] = useState<PaletteFormat>('paint-dot-net');
  const [fileName, setFileName] = useState('pinta-palette');
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog" role="dialog" aria-modal="true" aria-labelledby="palette-save-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(format, fileName);
      }}>
        <header className="dialog-header">
          <button className="dialog-text-button" type="button" onClick={onCancel}>Cancel</button>
          <strong id="palette-save-title">Save Palette File</strong>
          <button className="dialog-text-button suggested" type="submit">Save</button>
        </header>
        <div className="dialog-content">
          <label className="dialog-select-label">
            <span>Name</span>
            <span className="dialog-input-wrap"><input autoFocus value={fileName} onChange={(event) => setFileName(event.target.value)} aria-label="Palette file name" /></span>
          </label>
          <label className="dialog-select-label">
            <span>Format</span>
            <select value={format} onChange={(event) => setFormat(event.target.value as PaletteFormat)} aria-label="Palette format">
              <option value="paint-dot-net">Paint.NET palette (.txt)</option>
              <option value="gimp">GIMP palette (.gpl)</option>
              <option value="paint-shop-pro">PaintShop Pro palette (.pal)</option>
            </select>
          </label>
          <p className="dialog-hint">The browser will download a palette compatible with Pinta and the selected application.</p>
        </div>
      </form>
    </div>
  );
}

function PaletteColorDialog({ color, onCancel, onSubmit }: { color: string; onCancel: () => void; onSubmit: (color: string) => void }) {
  const [value, setValue] = useState(color);
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog palette-color-dialog" role="dialog" aria-modal="true" aria-labelledby="palette-color-title" onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSubmit(value.toLowerCase());
      }}>
        <header className="dialog-header">
          <button className="dialog-text-button" type="button" onClick={onCancel}>Cancel</button>
          <strong id="palette-color-title">Edit Palette Color</strong>
          <button className="dialog-text-button suggested" type="submit" disabled={!valid}>Save</button>
        </header>
        <div className="dialog-content palette-color-content">
          <input className="palette-color-picker" type="color" value={valid ? value : '#000000'} onChange={(event) => setValue(event.target.value)} aria-label="Choose palette color" />
          <label className="layer-property-field">
            <span>Hex color</span>
            <input autoFocus value={value} maxLength={7} spellCheck={false} onChange={(event) => setValue(event.target.value)} aria-label="Palette hex color" />
          </label>
          <div className="palette-color-preview" style={{ background: valid ? value : 'transparent' }} aria-label={`Color preview ${valid ? value : 'invalid'}`} />
        </div>
      </form>
    </div>
  );
}

interface PrintPreview {
  dataUrl: string;
  fileName: string;
  width: number;
  height: number;
}

function PrintDialog({ preview, onCancel, onPrint }: { preview: PrintPreview; onCancel: () => void; onPrint: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div className="pinta-dialog print-dialog" role="dialog" aria-modal="true" aria-labelledby="print-title">
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" onClick={onCancel}>Cancel</button>
          <strong id="print-title">Print Image</strong>
          <button type="button" className="dialog-text-button suggested" onClick={onPrint}>Print</button>
        </header>
        <div className="dialog-content print-dialog-content">
          <div className="print-preview checkerboard">
            <img src={preview.dataUrl} alt={`Print preview of ${preview.fileName}`} />
          </div>
          <div className="print-summary">
            <strong>{preview.fileName}</strong>
            <span>{preview.width} × {preview.height} pixels · one page · scale to fit</span>
          </div>
          <p className="dialog-hint">Paper size, orientation, margins, and destination can be chosen in the browser’s print window.</p>
        </div>
      </div>
    </div>
  );
}

function OffsetSelectionDialog({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (offset: number) => void }) {
  const [offset, setOffset] = useState(0);
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog offset-selection-dialog" role="dialog" aria-modal="true" aria-labelledby="offset-selection-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(offset);
      }}>
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" onClick={onCancel}>Cancel</button>
          <strong id="offset-selection-title">Offset Selection</strong>
          <button type="submit" className="dialog-text-button suggested" disabled={offset === 0}>OK</button>
        </header>
        <div className="dialog-content offset-selection-content">
          <label className="layer-opacity-field">
            <span>Offset</span>
            <span className="layer-opacity-value">
              <input autoFocus type="number" min="-100" max="100" value={offset} onChange={(event) => setOffset(Math.max(-100, Math.min(100, Number(event.target.value))))} aria-label="Selection offset" />
              <i>px</i>
            </span>
            <input type="range" min="-100" max="100" value={offset} onChange={(event) => setOffset(Number(event.target.value))} aria-label={`Selection offset ${offset} pixels`} />
          </label>
          <p className="dialog-hint">Positive values expand the selection; negative values contract it.</p>
        </div>
      </form>
    </div>
  );
}

function ScreenshotDialog({ busy, error, onCancel, onCapture }: { busy: boolean; error: string; onCancel: () => void; onCapture: (delay: number) => void }) {
  const [delay, setDelay] = useState(0);
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (!busy && event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog screenshot-dialog" role="dialog" aria-modal="true" aria-labelledby="screenshot-title" onSubmit={(event) => {
        event.preventDefault();
        onCapture(delay);
      }}>
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" disabled={busy} onClick={onCancel}>Cancel</button>
          <strong id="screenshot-title">New Screenshot</strong>
          <button type="submit" className="dialog-text-button suggested" disabled={busy}>{busy ? 'Waiting…' : 'Capture'}</button>
        </header>
        <div className="dialog-content screenshot-content">
          <span className="screenshot-icon"><Camera size={30} /></span>
          <div className="screenshot-copy">
            <strong>Capture a screen, window, or browser tab</strong>
            <p>The browser will ask which surface you want to share. Pinta captures one frame and immediately stops sharing.</p>
          </div>
          <label className="layer-property-field screenshot-delay-field">
            <span>Delay</span>
            <select value={delay} disabled={busy} onChange={(event) => setDelay(Number(event.target.value))} aria-label="Screenshot delay">
              <option value={0}>No delay</option>
              <option value={3}>3 seconds</option>
              <option value={5}>5 seconds</option>
            </select>
          </label>
          {error && <p className="dialog-error" role="alert">{error}</p>}
        </div>
      </form>
    </div>
  );
}

function CanvasGridDialog({ settings, onCancel, onSubmit }: { settings: CanvasGridSettings; onCancel: () => void; onSubmit: (settings: CanvasGridSettings) => void }) {
  const [value, setValue] = useState(settings);
  const number = (key: keyof CanvasGridSettings, next: number, min: number, max: number) => {
    setValue((current) => ({ ...current, [key]: Math.max(min, Math.min(max, Math.round(next))) }));
  };
  const previewStyle = {
    '--grid-preview-width': `${Math.max(3, value.cellWidth)}px`,
    '--grid-preview-height': `${Math.max(3, value.cellHeight)}px`,
    '--axon-preview-width': `${Math.max(3, value.axonometricWidth)}px`,
    '--axon-preview-angle': `${value.axonometricAngle}deg`,
  } as CSSProperties;
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog canvas-grid-dialog" role="dialog" aria-modal="true" aria-labelledby="canvas-grid-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}>
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" onClick={onCancel}>Cancel</button>
          <strong id="canvas-grid-title">Canvas Grid Settings</strong>
          <button type="submit" className="dialog-text-button suggested">OK</button>
        </header>
        <div className="dialog-content canvas-grid-content">
          <div className={`canvas-grid-preview ${value.showGrid ? 'show-grid' : ''} ${value.showAxonometricGrid ? 'show-axonometric' : ''}`} style={previewStyle} />
          <fieldset className="canvas-grid-section">
            <label className="dialog-checkbox"><input type="checkbox" checked={value.showGrid} onChange={(event) => setValue((current) => ({ ...current, showGrid: event.target.checked }))} /><span>Show Grid</span></label>
            <label className="layer-property-field"><span>Width</span><input type="number" min="1" max="10000" disabled={!value.showGrid} value={value.cellWidth} onChange={(event) => number('cellWidth', Number(event.target.value), 1, 10000)} aria-label="Grid cell width" /></label>
            <label className="layer-property-field"><span>Height</span><input type="number" min="1" max="10000" disabled={!value.showGrid} value={value.cellHeight} onChange={(event) => number('cellHeight', Number(event.target.value), 1, 10000)} aria-label="Grid cell height" /></label>
          </fieldset>
          <fieldset className="canvas-grid-section">
            <label className="dialog-checkbox"><input type="checkbox" checked={value.showAxonometricGrid} onChange={(event) => setValue((current) => ({ ...current, showAxonometricGrid: event.target.checked }))} /><span>Show Axonometric Grid</span></label>
            <label className="layer-property-field"><span>Width</span><input type="number" min="1" max="10000" disabled={!value.showAxonometricGrid} value={value.axonometricWidth} onChange={(event) => number('axonometricWidth', Number(event.target.value), 1, 10000)} aria-label="Axonometric grid width" /></label>
            <label className="layer-property-field"><span>Angle</span><input type="number" min="1" max="89" disabled={!value.showAxonometricGrid} value={value.axonometricAngle} onChange={(event) => number('axonometricAngle', Number(event.target.value), 1, 89)} aria-label="Axonometric grid angle" /></label>
          </fieldset>
        </div>
      </form>
    </div>
  );
}

function rulerStep(unitPixels: number, zoom: number) {
  const minimumUnits = 56 / Math.max(0.001, unitPixels * zoom);
  const magnitude = 10 ** Math.floor(Math.log10(minimumUnits));
  for (const factor of [1, 2, 5, 10]) {
    const step = factor * magnitude;
    if (step >= minimumUnits) return step;
  }
  return 10 * magnitude;
}

function CanvasRuler({ orientation, metric, imageSize, zoom, viewportSize, scroll }: {
  orientation: 'horizontal' | 'vertical';
  metric: RulerMetric;
  imageSize: number;
  zoom: number;
  viewportSize: number;
  scroll: number;
}) {
  const unitPixels = metric === 'pixels' ? 1 : metric === 'inches' ? 96 : 96 / 2.54;
  const step = rulerStep(unitPixels, zoom);
  const majorPixels = step * unitPixels * zoom;
  const minorPixels = Math.max(3, majorPixels / 10);
  const canvasPixels = imageSize * zoom;
  const offset = Math.max(26, (viewportSize - canvasPixels) / 2) - scroll;
  const first = Math.max(0, Math.floor((-offset) / majorPixels) * step);
  const last = Math.min(imageSize / unitPixels, Math.ceil((viewportSize - offset) / majorPixels) * step + step);
  const ticks: Array<{ value: number; position: number }> = [];
  for (let value = first, count = 0; value <= last + step / 100 && count < 160; value += step, count += 1) {
    ticks.push({ value, position: offset + value * unitPixels * zoom });
  }
  const style = {
    '--ruler-offset': `${offset}px`,
    '--ruler-minor': `${minorPixels}px`,
  } as CSSProperties;
  const digits = step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 0;
  return (
    <div className={`canvas-ruler canvas-ruler-${orientation}`} style={style} aria-hidden="true">
      {ticks.map((tick) => (
        <span
          key={`${orientation}-${tick.value}`}
          className="ruler-major-tick"
          style={orientation === 'horizontal' ? { left: tick.position } : { top: tick.position }}
        >
          {metric === 'pixels' ? Math.round(tick.value) : tick.value.toFixed(digits)}
        </span>
      ))}
    </div>
  );
}

const SHORTCUT_SECTIONS: ReadonlyArray<{ title: string; entries: ReadonlyArray<[string, string]> }> = [
  { title: 'File', entries: [['New', 'Ctrl+N'], ['Open', 'Ctrl+O'], ['Save', 'Ctrl+S'], ['Save As', 'Ctrl+Shift+S'], ['Print', 'Ctrl+P'], ['Close', 'Ctrl+W'], ['Save All', 'Ctrl+Alt+A'], ['Close All', 'Ctrl+Shift+W']] },
  { title: 'Edit', entries: [['Undo', 'Ctrl+Z'], ['Redo', 'Ctrl+Shift+Z'], ['Cut', 'Ctrl+X'], ['Copy', 'Ctrl+C'], ['Copy Merged', 'Ctrl+Shift+C'], ['Paste', 'Ctrl+V'], ['Paste Into New Layer', 'Ctrl+Shift+V'], ['Paste Into New Image', 'Shift+V'], ['Select All', 'Ctrl+A'], ['Deselect All', 'Ctrl+Shift+A'], ['Erase Selection', 'Delete'], ['Fill Selection', 'Backspace'], ['Invert Selection', 'Ctrl+I'], ['Offset Selection', 'Ctrl+Shift+O']] },
  { title: 'View', entries: [['Zoom In', '+'], ['Zoom Out', '−'], ['Best Fit', 'Ctrl+B'], ['Normal Size', 'Ctrl+0'], ['Fullscreen', 'F11'], ['Tool Windows', 'F12']] },
  { title: 'Image', entries: [['Crop to Selection', 'Ctrl+Shift+X'], ['Auto Crop', 'Ctrl+Alt+X'], ['Resize Image', 'Ctrl+R'], ['Resize Canvas', 'Ctrl+Shift+R'], ['Rotate Clockwise', 'Ctrl+H'], ['Rotate Counter-Clockwise', 'Ctrl+G'], ['Rotate 180°', 'Ctrl+J'], ['Flatten', 'Ctrl+Shift+F']] },
  { title: 'Layers', entries: [['Add New Layer', 'Ctrl+Shift+N'], ['Delete Layer', 'Ctrl+Shift+Delete'], ['Duplicate Layer', 'Ctrl+Shift+D'], ['Merge Layer Down', 'Ctrl+M'], ['Flip Horizontal', 'Ctrl+F'], ['Flip Vertical', 'Shift+F'], ['Layer Properties', 'F4']] },
  { title: 'Adjustments', entries: [['Curves', 'Ctrl+Shift+M'], ['Invert Colors', 'Ctrl+Shift+I'], ['Levels', 'Ctrl+L']] },
];

function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="pinta-dialog shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <header className="dialog-header">
          <span />
          <strong id="shortcuts-title">Keyboard Shortcuts</strong>
          <button type="button" className="dialog-text-button suggested" onClick={onClose}>Done</button>
        </header>
        <div className="dialog-content shortcuts-content">
          <section className="shortcut-section">
            <h3>Tools</h3>
            <div className="shortcut-list">
              {TOOLS.filter((tool) => tool.shortcut).map((tool) => <div className="shortcut-row" key={tool.id}><span>{tool.name}</span><kbd>{tool.shortcut!.toUpperCase()}</kbd></div>)}
            </div>
          </section>
          {SHORTCUT_SECTIONS.map((section) => (
            <section className="shortcut-section" key={section.title}>
              <h3>{section.title}</h3>
              <div className="shortcut-list">
                {section.entries.map(([label, shortcut]) => <div className="shortcut-row" key={label}><span>{label}</span><kbd>{shortcut}</kbd></div>)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="pinta-dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <header className="dialog-header">
          <span />
          <strong id="about-title">About Pinta</strong>
          <button type="button" className="dialog-text-button suggested" onClick={onClose}>Close</button>
        </header>
        <div className="dialog-content about-content">
          <img src="/apps/com.github.PintaProject.Pinta.svg" alt="Pinta" />
          <h2>Pinta</h2>
          <p className="about-version">Pinta Online 0.1.0 · based on Pinta 3.2</p>
          <p>Easily create and edit images, now in the browser.</p>
          <div className="about-links">
            <a href="https://www.pinta-project.com" target="_blank" rel="noreferrer">Website</a>
            <a href="https://github.com/PintaProject/Pinta" target="_blank" rel="noreferrer">Source Code</a>
            <a href="https://github.com/PintaProject/Pinta/issues" target="_blank" rel="noreferrer">Report an Issue</a>
          </div>
          <p className="dialog-hint">Copyright © 2010–2026 by Pinta contributors. Released under the MIT X11 License.</p>
        </div>
      </div>
    </div>
  );
}

function App() {
  const editor = usePaintEditor();
  const currentTool = TOOL_BY_ID[editor.tool];
  const {
    theme,
    showSidebar,
    showToolbox,
    showToolbar,
    showPalette,
    showDocumentTabs,
    canvasGrid,
    showRulers,
    rulerMetric,
    setTheme,
    setShowSidebar,
    setShowToolbox,
    setShowToolbar,
    setShowPalette,
    setShowDocumentTabs,
    setCanvasGrid,
    setShowRulers,
    setRulerMetric,
  } = usePreferences();
  const [openMenu, setOpenMenu] = useState<MenuName>(null);
  const [menuSurface, setMenuSurface] = useState<'top' | 'header' | null>(null);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toast, setToast] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [effectDialog, setEffectDialog] = useState<EffectId | null>(null);
  const [layerPropertiesId, setLayerPropertiesId] = useState<string | null>(null);
  const [rotateZoomLayerId, setRotateZoomLayerId] = useState<string | null>(null);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [paletteDialog, setPaletteDialog] = useState<'save' | 'resize' | null>(null);
  const [editingPaletteIndex, setEditingPaletteIndex] = useState<number | null>(null);
  const [closingDocumentId, setClosingDocumentId] = useState<string | null>(null);
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const [printPreview, setPrintPreview] = useState<PrintPreview | null>(null);
  const [showOffsetSelection, setShowOffsetSelection] = useState(false);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [screenshotError, setScreenshotError] = useState('');
  const [showCanvasGridDialog, setShowCanvasGridDialog] = useState(false);
  const [viewportMetrics, setViewportMetrics] = useState({ width: 0, height: 0, scrollLeft: 0, scrollTop: 0 });
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const layerFileInputRef = useRef<HTMLInputElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const textDragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  }, []);

  const handlePaletteFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      const parsed = parsePalette(await file.text(), file.name);
      editor.replacePalette(parsed.colors);
      notify(`Loaded ${parsed.colors.length} palette colors`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to load palette');
    }
  }, [editor, notify]);

  const handleLayerFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      await editor.importLayerFromFile(file);
      notify(`Imported ${file.name} as a layer`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to import that layer');
    }
  }, [editor, notify]);

  const savePalette = useCallback((format: PaletteFormat, requestedName: string) => {
    const name = paletteFileName(requestedName, format);
    const output = serializePalette(editor.palette, format, requestedName.trim() || 'Pinta Online Palette');
    const url = URL.createObjectURL(new Blob([output], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setPaletteDialog(null);
    notify(`Saved ${name}`);
  }, [editor.palette, notify]);

  const openPrintDialog = useCallback(() => {
    setOpenMenu(null);
    setPrintPreview({
      dataUrl: editor.createCompositeDataUrl(),
      fileName: editor.fileName,
      width: editor.width,
      height: editor.height,
    });
  }, [editor]);

  const captureScreenshot = useCallback(async (delay: number) => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenshotError('Screen capture is not supported by this browser.');
      return;
    }
    setScreenshotBusy(true);
    setScreenshotError('');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('The selected screen could not be read.'));
      });
      await video.play();
      if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay * 1000));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!video.videoWidth || !video.videoHeight) throw new Error('The selected screen did not provide an image.');
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      editor.newDocumentFromCanvas(canvas, 'New Screenshot');
      setShowScreenshot(false);
      notify(`Captured ${canvas.width} × ${canvas.height} screenshot`);
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Screen capture was canceled or not allowed.'
        : error instanceof Error ? error.message : 'The screenshot could not be captured.';
      setScreenshotError(message);
    } finally {
      for (const track of stream?.getTracks() ?? []) track.stop();
      setScreenshotBusy(false);
    }
  }, [editor, notify]);

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  const zoomToWindow = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const availableWidth = Math.max(1, viewport.clientWidth - 52);
    const availableHeight = Math.max(1, viewport.clientHeight - 52);
    editor.setZoom(Math.min(availableWidth / editor.width, availableHeight / editor.height));
  }, [editor]);

  const zoomToSelection = useCallback(() => {
    const viewport = viewportRef.current;
    const bounds = editor.selectionBounds;
    if (!viewport || !bounds) return;
    const availableWidth = Math.max(1, viewport.clientWidth - 52);
    const availableHeight = Math.max(1, viewport.clientHeight - 52);
    const nextZoom = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
    editor.setZoom(nextZoom);
    requestAnimationFrame(() => {
      const canvas = viewport.querySelector<HTMLElement>('.canvas-stack');
      if (!canvas) return;
      const viewportRect = viewport.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const centerX = canvasRect.left + (bounds.x + bounds.width / 2) * Math.min(4, Math.max(0.1, nextZoom));
      const centerY = canvasRect.top + (bounds.y + bounds.height / 2) * Math.min(4, Math.max(0.1, nextZoom));
      viewport.scrollLeft += centerX - viewportRect.left - viewport.clientWidth / 2;
      viewport.scrollTop += centerY - viewportRect.top - viewport.clientHeight / 2;
    });
  }, [editor]);

  const requestCloseAll = useCallback(() => {
    setOpenMenu(null);
    if (editor.documents.some((document) => document.dirty)) setShowCloseAllConfirm(true);
    else editor.closeAllDocuments();
  }, [editor]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => setViewportMetrics({
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [showDocumentTabs, showRulers, showSidebar, showToolbox]);

  useEffect(() => {
    document.title = `${editor.fileName}${editor.dirty ? '*' : ''} — Pinta`;
  }, [editor.dirty, editor.fileName]);

  useEffect(() => {
    document.querySelector('.document-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [editor.activeDocumentId]);

  useEffect(() => {
    const closeMenus = () => {
      setOpenMenu(null);
      setMenuSurface(null);
      setLayerMenuOpen(false);
    };
    window.addEventListener('blur', closeMenus);
    return () => window.removeEventListener('blur', closeMenus);
  }, []);

  useEffect(() => {
    const closeMenusOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.macos-menu-bar, .header-cluster-end, .layer-menu-anchor')) return;
      setOpenMenu(null);
      setMenuSurface(null);
      setLayerMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeMenusOutside);
    return () => window.removeEventListener('pointerdown', closeMenusOutside);
  }, []);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== 'Escape' && target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (closingDocumentId) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setClosingDocumentId(null);
        }
        return;
      }
      if (showCloseAllConfirm) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setShowCloseAllConfirm(false);
        }
        return;
      }
      if (printPreview) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setPrintPreview(null);
        }
        return;
      }
      if (showOffsetSelection) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setShowOffsetSelection(false);
        }
        return;
      }
      if (showScreenshot) {
        if (event.key === 'Escape' && !screenshotBusy) {
          event.preventDefault();
          setShowScreenshot(false);
          setScreenshotError('');
        }
        return;
      }
      if (layerPropertiesId) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setLayerPropertiesId(null);
        }
        return;
      }
      if (rotateZoomLayerId) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setRotateZoomLayerId(null);
        }
        return;
      }
      if (paletteDialog || editingPaletteIndex !== null) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setPaletteDialog(null);
          setEditingPaletteIndex(null);
        }
        return;
      }
      if (showSaveAs) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setShowSaveAs(false);
        }
        return;
      }
      if (showCanvasGridDialog) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setShowCanvasGridDialog(false);
        }
        return;
      }
      if (showKeyboardShortcuts || showAbout) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setShowKeyboardShortcuts(false);
          setShowAbout(false);
        }
        return;
      }
      if (event.key === 'Escape' && openMenu) {
        event.preventDefault();
        setOpenMenu(null);
        setMenuSurface(null);
        return;
      }
      const command = event.metaKey || event.ctrlKey;
      if (event.key === 'F1') {
        event.preventDefault();
        window.open('https://pinta-project.com/user-guide', '_blank', 'noopener,noreferrer');
      } else if (command && event.key === ',') {
        event.preventDefault();
        setShowKeyboardShortcuts(true);
      } else if (event.key === 'F11') {
        event.preventDefault();
        void toggleFullscreen();
      } else if (event.key === 'F12') {
        event.preventDefault();
        const next = !(showToolbox || showSidebar);
        setShowToolbox(next);
        setShowSidebar(next);
      } else if ((event.key === '+' || event.key === '=') && !event.altKey) {
        event.preventDefault();
        editor.setZoom(editor.zoom * 1.25);
      } else if (event.key === '-' && !event.altKey) {
        event.preventDefault();
        editor.setZoom(editor.zoom * 0.8);
      } else if (command && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        zoomToWindow();
      } else if (command && event.key === '0') {
        event.preventDefault();
        editor.setZoom(1);
      } else if (command && event.key === 'Tab') {
        event.preventDefault();
        const activeIndex = editor.documents.findIndex((document) => document.id === editor.activeDocumentId);
        const offset = event.shiftKey ? -1 : 1;
        const nextIndex = (activeIndex + offset + editor.documents.length) % editor.documents.length;
        editor.switchDocument(editor.documents[nextIndex].id);
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        editor.addLayer();
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        editor.duplicateLayer();
      } else if (command && event.shiftKey && event.key === 'Delete') {
        event.preventDefault();
        editor.deleteLayer();
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        setOpenMenu(null);
        setEffectDialog('curves');
      } else if (command && !event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        editor.mergeLayerDown();
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        editor.flattenImage();
      } else if (command && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        editor.flipLayer('horizontal');
      } else if (!command && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        editor.flipLayer('vertical');
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        requestCloseAll();
      } else if (command && !event.shiftKey && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        const active = editor.documents.find((document) => document.id === editor.activeDocumentId);
        if (active?.dirty) setClosingDocumentId(active.id);
        else if (active) editor.closeDocument(active.id);
      } else if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? editor.redo() : editor.undo();
      } else if (command && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        editor.redo();
      } else if (command && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        setShowSaveAs(true);
      } else if (command && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void editor.saveImage();
      } else if (command && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        openPrintDialog();
      } else if (command && !event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        fileInputRef.current?.click();
      } else if (command && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setDialog('new');
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        setDialog('resize-canvas');
      } else if (command && !event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        setDialog('resize-image');
      } else if (command && !event.shiftKey && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        editor.rotateImage('clockwise');
      } else if (command && !event.shiftKey && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        editor.rotateImage('counter-clockwise');
      } else if (command && !event.shiftKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        editor.rotateImage('180');
      } else if (command && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        setOpenMenu(null);
        setEffectDialog('levels');
      } else if (event.key === 'F4') {
        event.preventDefault();
        setLayerPropertiesId(editor.activeLayerId);
      } else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        if (!editor.autoCropImage()) notify('The image already fits its visible content');
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        editor.cropToSelection();
      } else if (command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        if (editor.cutSelection()) notify('Cut selection');
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        if (editor.copyMerged()) notify('Copied merged image');
      } else if (command && !event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        if (editor.copySelection()) notify('Copied selection');
      } else if (command && event.altKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        if (editor.pasteIntoNewImage()) notify('Pasted into a new image');
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        if (editor.pasteIntoNewLayer()) notify('Pasted into a new layer');
      } else if (command && !event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        if (editor.paste()) notify('Pasted into the current layer');
      } else if (!command && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        if (editor.pasteIntoNewImage()) notify('Pasted into a new image');
      } else if (event.ctrlKey && event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        void editor.saveAllImages().then((count) => notify(count ? `Saved ${count} ${count === 1 ? 'image' : 'images'}` : 'All images are already saved'));
      } else if (command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        editor.selectAll();
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        void editor.applyEffect('invert').catch(() => notify('Invert Colors could not be applied.'));
      } else if (command && !event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        editor.invertSelection();
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        if (editor.hasSelection) setShowOffsetSelection(true);
      } else if ((command && event.shiftKey && event.key.toLowerCase() === 'a') || (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'd')) {
        event.preventDefault();
        editor.deselect();
      } else if (editor.lineDraft && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        editor.nudgeLinePoint(
          event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0,
          event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0,
        );
      } else if (editor.shapeDraft && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        editor.nudgeShapePoint(
          event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0,
          event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0,
        );
      } else if (event.key === 'Enter' && editor.lineDraft) {
        event.preventDefault();
        editor.commitLine();
      } else if (event.key === 'Enter' && editor.shapeDraft) {
        event.preventDefault();
        editor.commitShape();
      } else if (event.key === 'Escape') {
        if (editor.lineDraft) editor.cancelLine();
        else if (editor.shapeDraft) editor.cancelShape();
        else editor.deselect();
      } else if (event.key === 'Delete') {
        event.preventDefault();
        if (editor.lineDraft) {
          if (!editor.deleteLinePoint()) editor.cancelLine();
        } else if (editor.shapeDraft) {
          editor.cancelShape();
        } else if (editor.hasSelection) editor.clearActiveLayer();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        if (editor.hasSelection) editor.fillSelection();
      } else if (!command && event.key.toLowerCase() === 'x') {
        editor.swapColors();
      } else if (!command) {
        const shortcut: Record<string, typeof editor.tool> = {
          b: 'paintbrush', p: 'pencil', e: 'eraser', f: 'paint-bucket', g: 'gradient',
          k: 'color-picker', t: 'text', z: 'zoom', h: 'pan', r: 'recolor', l: 'clone-stamp', o: 'line',
        };
        const nextTool = shortcut[event.key.toLowerCase()];
        if (nextTool) editor.setTool(nextTool);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closingDocumentId, editingPaletteIndex, editor, layerPropertiesId, notify, openMenu, openPrintDialog, paletteDialog, printPreview, requestCloseAll, rotateZoomLayerId, screenshotBusy, showAbout, showCanvasGridDialog, showCloseAllConfirm, showKeyboardShortcuts, showOffsetSelection, showSaveAs, showScreenshot, showSidebar, showToolbox, toggleFullscreen, zoomToWindow]);

  const handleFiles = useCallback(async (files: Iterable<File> | ArrayLike<File>) => {
    const queued = Array.from(files);
    if (!queued.length) return;
    const failures: string[] = [];
    let opened = 0;
    for (const file of queued) {
      try {
        await editor.openFile(file);
        opened += 1;
      } catch {
        failures.push(file.name);
      }
    }
    if (!failures.length) notify(opened === 1 ? `Opened ${queued[0].name}` : `Opened ${opened} images`);
    else if (opened) notify(`Opened ${opened} images; could not open ${failures.join(', ')}`);
    else notify(`Could not open ${failures.join(', ')}`);
  }, [editor, notify]);

  useEffect(() => {
    const launchQueue = (window as Window & {
      launchQueue?: { setConsumer: (consumer: (parameters: { files: FileSystemFileHandle[] }) => void) => void };
    }).launchQueue;
    if (!launchQueue) return;
    launchQueue.setConsumer((parameters) => {
      void Promise.all(parameters.files.map((handle) => handle.getFile())).then(handleFiles);
    });
  }, [handleFiles]);

  const closeAnd = useCallback((action: () => void) => {
    setOpenMenu(null);
    setMenuSurface(null);
    action();
  }, []);

  const openDialog = useCallback((name: Exclude<DialogName, null>) => {
    setOpenMenu(null);
    setMenuSurface(null);
    setDialog(name);
  }, []);

  const runEffect = useCallback(async (effect: EffectId, parameters: EffectParameters = {}) => {
    try {
      const applied = await editor.applyEffect(effect, parameters);
      if (applied) notify(`${EFFECT_BY_ID[effect].name} applied`);
      return applied;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The effect could not be applied.');
      return false;
    }
  }, [editor, notify]);

  const chooseEffect = useCallback((effect: EffectId) => {
    setOpenMenu(null);
    setMenuSurface(null);
    const definition = EFFECT_BY_ID[effect];
    if (definition.parameters.length || definition.dialog) setEffectDialog(effect);
    else void runEffect(effect);
  }, [runEffect]);

  const requestCloseDocument = useCallback((id: string) => {
    const document = editor.documents.find((candidate) => candidate.id === id);
    if (!document) return;
    setOpenMenu(null);
    if (id !== editor.activeDocumentId && !editor.switchDocument(id)) return;
    if (document.dirty) setClosingDocumentId(id);
    else editor.closeDocument(id);
  }, [editor]);

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (editor.tool === 'pan' && viewportRef.current) {
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = {
        x: event.clientX,
        y: event.clientY,
        left: viewportRef.current.scrollLeft,
        top: viewportRef.current.scrollTop,
      };
      return;
    }
    editor.onPointerDown(event);
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current && viewportRef.current) {
      viewportRef.current.scrollLeft = panRef.current.left - (event.clientX - panRef.current.x);
      viewportRef.current.scrollTop = panRef.current.top - (event.clientY - panRef.current.y);
      return;
    }
    editor.onPointerMove(event);
  };

  const handleCanvasPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    editor.onPointerUp(event);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    editor.setZoom(editor.zoom * (event.deltaY > 0 ? 0.9 : 1.1));
  };

  const iconSize = 17;
  const canUndo = editor.historyIndex > 0;
  const canRedo = editor.historyIndex < editor.history.length - 1;
  const activeLayerIndex = editor.layers.findIndex((layer) => layer.id === editor.activeLayerId);
  const canvasStyle = {
    width: `${editor.width * editor.zoom}px`,
    height: `${editor.height * editor.zoom}px`,
    '--canvas-grid-width': `${Math.max(1, canvasGrid.cellWidth * editor.zoom)}px`,
    '--canvas-grid-height': `${Math.max(1, canvasGrid.cellHeight * editor.zoom)}px`,
    '--canvas-axon-width': `${Math.max(1, canvasGrid.axonometricWidth * editor.zoom)}px`,
    '--canvas-axon-angle': `${canvasGrid.axonometricAngle}deg`,
  } as CSSProperties;
  const textEditorWidth = editor.textEditor
    ? Math.max(150, Math.min(420, editor.width - editor.textEditor.x - 4) * editor.zoom)
    : 0;
  const textEditorLeft = editor.textEditor
    ? Math.max(0, editor.textEditor.x * editor.zoom - (editor.textAlignment === 'center' ? textEditorWidth / 2 : editor.textAlignment === 'right' ? textEditorWidth : 0))
    : 0;
  const closingDocument = editor.documents.find((document) => document.id === closingDocumentId);

  const renderMenuContent = (name: Exclude<MenuName, null | 'main'>) => {
    switch (name) {
      case 'pinta':
        return (
          <>
            <MenuItem label="About Pinta" onClick={() => closeAnd(() => setShowAbout(true))} />
            <MenuItem label="Keyboard Shortcuts…" shortcut="⌘," onClick={() => closeAnd(() => setShowKeyboardShortcuts(true))} />
            <div className="menu-divider" />
            <MenuItem label="Pinta Website" onClick={() => closeAnd(() => window.open('https://www.pinta-project.com', '_blank', 'noopener,noreferrer'))} />
          </>
        );
      case 'file':
        return (
          <>
            <MenuItem icon={<FilePlus2 size={15} />} label="New" shortcut="⌘N" onClick={() => openDialog('new')} />
            <MenuItem icon={<Camera size={15} />} label="New Screenshot…" onClick={() => closeAnd(() => {
              setScreenshotError('');
              setShowScreenshot(true);
            })} />
            <MenuItem icon={<FolderOpen size={15} />} label="Open…" shortcut="⌘O" onClick={() => closeAnd(() => fileInputRef.current?.click())} />
            <div className="menu-divider" />
            <MenuItem icon={<Save size={15} />} label="Save" shortcut="⌘S" onClick={() => closeAnd(() => { void editor.saveImage(); })} />
            <MenuItem icon={<Save size={15} />} label="Save As…" shortcut="⇧⌘S" onClick={() => closeAnd(() => setShowSaveAs(true))} />
            <MenuItem icon={<Printer size={15} />} label="Print…" shortcut="⌘P" onClick={openPrintDialog} />
            <div className="menu-divider" />
            <MenuItem icon={<X size={15} />} label="Close" shortcut="⌘W" onClick={() => requestCloseDocument(editor.activeDocumentId)} />
          </>
        );
      case 'edit':
        return (
          <>
            <MenuItem icon={<Undo2 size={15} />} label="Undo" shortcut="⌘Z" disabled={!canUndo} onClick={() => closeAnd(editor.undo)} />
            <MenuItem icon={<Redo2 size={15} />} label="Redo" shortcut="⇧⌘Z" disabled={!canRedo} onClick={() => closeAnd(editor.redo)} />
            <div className="menu-divider" />
            <MenuItem icon={<Scissors size={15} />} label="Cut" shortcut="⌘X" onClick={() => closeAnd(() => editor.cutSelection())} />
            <MenuItem icon={<Copy size={15} />} label="Copy" shortcut="⌘C" onClick={() => closeAnd(() => editor.copySelection())} />
            <MenuItem icon={<Copy size={15} />} label="Copy Merged" shortcut="⇧⌘C" onClick={() => closeAnd(() => editor.copyMerged())} />
            <MenuItem icon={<ClipboardPaste size={15} />} label="Paste" shortcut="⌘V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.paste())} />
            <MenuItem icon={<ClipboardPaste size={15} />} label="Paste Into New Layer" shortcut="⇧⌘V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.pasteIntoNewLayer())} />
            <MenuItem icon={<ClipboardPaste size={15} />} label="Paste Into New Image" shortcut="⌥⌘V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.pasteIntoNewImage())} />
            <div className="menu-divider" />
            <MenuItem label="Select All" shortcut="⌘A" onClick={() => closeAnd(editor.selectAll)} />
            <MenuItem label="Deselect All" shortcut="⇧⌘A" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.deselect)} />
            <MenuItem icon={<NativeToolIcon file="edit-selection-erase-symbolic.svg" size={16} />} label="Erase Selection" shortcut="⌫" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.clearActiveLayer)} />
            <MenuItem icon={<NativeToolIcon file="edit-selection-fill-symbolic.svg" size={16} />} label="Fill Selection" shortcut="⌥⌫" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.fillSelection)} />
            <MenuItem icon={<NativeToolIcon file="edit-selection-invert-symbolic.svg" size={16} />} label="Invert Selection" shortcut="⌘I" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.invertSelection)} />
            <MenuItem icon={<NativeToolIcon file="edit-selection-offset-symbolic.svg" size={16} />} label="Offset Selection…" shortcut="⇧⌘O" disabled={!editor.hasSelection} onClick={() => closeAnd(() => setShowOffsetSelection(true))} />
            <div className="menu-divider" />
            <div className="menu-caption">Palette</div>
            <MenuItem icon={<FolderOpen size={15} />} label="Open…" onClick={() => closeAnd(() => paletteInputRef.current?.click())} />
            <MenuItem icon={<Save size={15} />} label="Save As…" onClick={() => closeAnd(() => setPaletteDialog('save'))} />
            <MenuItem icon={<RotateCw size={15} />} label="Reset to Default" onClick={() => closeAnd(() => {
              editor.resetPalette();
              notify('Palette reset to Pinta defaults');
            })} />
            <MenuItem label="Set Number of Colors…" onClick={() => closeAnd(() => setPaletteDialog('resize'))} />
          </>
        );
      case 'view':
        return (
          <>
            <MenuItem icon={<ZoomIn size={15} />} label="Zoom In" shortcut="+" onClick={() => closeAnd(() => editor.setZoom(editor.zoom * 1.25))} />
            <MenuItem label="Zoom Out" shortcut="−" onClick={() => closeAnd(() => editor.setZoom(editor.zoom * 0.8))} />
            <MenuItem label="Normal Size" shortcut="⌘0" onClick={() => closeAnd(() => editor.setZoom(1))} />
            <MenuItem icon={<Maximize2 size={15} />} label="Best Fit" shortcut="⌘B" onClick={() => closeAnd(zoomToWindow)} />
            <MenuItem label="Zoom to Selection" disabled={!editor.hasSelection} onClick={() => closeAnd(zoomToSelection)} />
            <MenuItem icon={<Maximize2 size={15} />} label="Fullscreen" shortcut="F11" checked={isFullscreen} onClick={() => closeAnd(() => void toggleFullscreen())} />
            <div className="menu-divider" />
            <MenuItem icon={<Grid3X3 size={15} />} label="Canvas Grid…" onClick={() => closeAnd(() => setShowCanvasGridDialog(true))} />
            <div className="menu-caption">Ruler Units</div>
            <MenuItem checked={rulerMetric === 'pixels'} label="Pixels" onClick={() => closeAnd(() => setRulerMetric('pixels'))} />
            <MenuItem checked={rulerMetric === 'inches'} label="Inches" onClick={() => closeAnd(() => setRulerMetric('inches'))} />
            <MenuItem checked={rulerMetric === 'centimeters'} label="Centimeters" onClick={() => closeAnd(() => setRulerMetric('centimeters'))} />
            <div className="menu-divider" />
            <div className="menu-caption">Show / Hide</div>
            <MenuItem checked label="Menu Bar" disabled />
            <MenuItem checked={showToolbar} label="Tool Bar" onClick={() => closeAnd(() => setShowToolbar((value) => !value))} />
            <MenuItem checked={showRulers} label="Rulers" onClick={() => closeAnd(() => setShowRulers((value) => !value))} />
            <MenuItem checked={showToolbox} label="Tool Box" onClick={() => closeAnd(() => setShowToolbox((value) => !value))} />
            <MenuItem checked={showSidebar} label="Tool Windows" shortcut="F12" onClick={() => closeAnd(() => setShowSidebar((value) => !value))} />
            <MenuItem checked={showPalette} label="Status Bar" onClick={() => closeAnd(() => setShowPalette((value) => !value))} />
            <MenuItem checked={showDocumentTabs} label="Image Tabs" onClick={() => closeAnd(() => setShowDocumentTabs((value) => !value))} />
            <div className="menu-divider" />
            <div className="menu-caption">Color Scheme</div>
            <MenuItem checked={theme === 'light'} label="Light" onClick={() => closeAnd(() => setTheme('light'))} />
            <MenuItem checked={theme === 'dark'} label="Dark" onClick={() => closeAnd(() => setTheme('dark'))} />
          </>
        );
      case 'image':
        return (
          <>
            <MenuItem icon={<Crop size={15} />} label="Crop to Selection" shortcut="⇧⌘X" disabled={!editor.hasSelection} onClick={() => closeAnd(() => editor.cropToSelection())} />
            <MenuItem icon={<Crop size={15} />} label="Auto Crop" shortcut="⌥⌘X" onClick={() => closeAnd(() => {
              if (!editor.autoCropImage()) notify('The image already fits its visible content');
            })} />
            <MenuItem label="Resize Image…" shortcut="⌘R" onClick={() => openDialog('resize-image')} />
            <MenuItem label="Resize Canvas…" shortcut="⇧⌘R" onClick={() => openDialog('resize-canvas')} />
            <div className="menu-divider" />
            <MenuItem icon={<FlipHorizontal2 size={15} />} label="Flip Horizontal" onClick={() => closeAnd(() => editor.flipImage('horizontal'))} />
            <MenuItem icon={<FlipVertical2 size={15} />} label="Flip Vertical" onClick={() => closeAnd(() => editor.flipImage('vertical'))} />
            <div className="menu-divider" />
            <MenuItem icon={<RotateCw size={15} />} label="Rotate 90° Clockwise" shortcut="⌘H" onClick={() => closeAnd(() => editor.rotateImage('clockwise'))} />
            <MenuItem label="Rotate 90° Counter-Clockwise" shortcut="⌘G" onClick={() => closeAnd(() => editor.rotateImage('counter-clockwise'))} />
            <MenuItem label="Rotate 180°" shortcut="⌘J" onClick={() => closeAnd(() => editor.rotateImage('180'))} />
            <div className="menu-divider" />
            <MenuItem icon={<NativeToolIcon file="image-flatten-symbolic.svg" size={16} />} label="Flatten" shortcut="⇧⌘F" disabled={editor.layers.length < 2} onClick={() => closeAnd(editor.flattenImage)} />
          </>
        );
      case 'adjustments':
        return EFFECT_DEFINITIONS.filter((effect) => effect.category === 'adjustment').map((effect) => (
          <MenuItem
            key={effect.id}
            icon={<NativeToolIcon file={effect.icon} size={16} />}
            label={`${effect.name}${effect.parameters.length || effect.dialog ? '…' : ''}`}
            shortcut={ADJUSTMENT_SHORTCUTS[effect.id]}
            onClick={() => chooseEffect(effect.id)}
          />
        ));
      case 'effects':
        return EFFECT_MENU_CATEGORIES.map(([category, label]) => (
          <div className="effect-menu-group" key={category}>
            <div className="menu-caption">{label}</div>
            {EFFECT_DEFINITIONS.filter((effect) => effect.category === category).map((effect) => (
              <MenuItem
                key={effect.id}
                icon={<NativeToolIcon file={effect.icon} size={16} />}
                label={`${effect.name}${effect.parameters.length || effect.dialog ? '…' : ''}`}
                onClick={() => chooseEffect(effect.id)}
              />
            ))}
          </div>
        ));
      case 'addins':
        return (
          <>
            <MenuItem label="Add-in Manager…" onClick={() => closeAnd(() => notify('Native Pinta add-ins are not available in the browser edition'))} />
            <div className="menu-note">Native add-ins require the desktop application.</div>
          </>
        );
      case 'window':
        return (
          <>
            <MenuItem icon={<Save size={15} />} label="Save All" shortcut="⌥⌘A" disabled={!editor.documents.some((document) => document.dirty)} onClick={() => closeAnd(() => {
              void editor.saveAllImages().then((count) => notify(`Saved ${count} ${count === 1 ? 'image' : 'images'}`));
            })} />
            <MenuItem icon={<X size={15} />} label="Close All" shortcut="⇧⌘W" onClick={requestCloseAll} />
            <div className="menu-divider" />
            {editor.documents.map((document, index) => (
              <MenuItem
                key={document.id}
                checked={document.id === editor.activeDocumentId}
                label={`${document.fileName}${document.dirty ? '*' : ''}`}
                shortcut={index < 9 ? `⌥${index + 1}` : undefined}
                onClick={() => closeAnd(() => editor.switchDocument(document.id))}
              />
            ))}
          </>
        );
      case 'help':
        return (
          <>
            <MenuItem label="Pinta Help" shortcut="F1" onClick={() => closeAnd(() => window.open('https://pinta-project.com/user-guide', '_blank', 'noopener,noreferrer'))} />
            <MenuItem label="Keyboard Shortcuts…" shortcut="⌘," onClick={() => closeAnd(() => setShowKeyboardShortcuts(true))} />
            <div className="menu-divider" />
            <MenuItem label="Pinta Website" onClick={() => closeAnd(() => window.open('https://www.pinta-project.com', '_blank', 'noopener,noreferrer'))} />
            <MenuItem label="File a Bug" onClick={() => closeAnd(() => window.open('https://github.com/PintaProject/Pinta/issues', '_blank', 'noopener,noreferrer'))} />
            <MenuItem label="Translate This Application" onClick={() => closeAnd(() => window.open('https://hosted.weblate.org/engage/pinta/', '_blank', 'noopener,noreferrer'))} />
          </>
        );
    }
  };

  const toggleTopLevelMenu = (name: Exclude<MenuName, null | 'main'>) => {
    if (menuSurface === 'top' && openMenu === name) {
      setOpenMenu(null);
      setMenuSurface(null);
      return;
    }
    setMenuSurface('top');
    setOpenMenu(name);
  };

  const enterTopLevelMenu = (name: Exclude<MenuName, null | 'main'>) => {
    if (menuSurface === 'top' && openMenu) setOpenMenu(name);
  };

  const toggleHeaderMenu = (name: Exclude<MenuName, null | 'main'> | 'main') => {
    if (menuSurface === 'header' && openMenu === name) {
      setOpenMenu(null);
      setMenuSurface(null);
      return;
    }
    setMenuSurface('header');
    setOpenMenu(name);
  };

  return (
    <div
      className={`app-shell theme-${theme} ${showToolbar ? '' : 'toolbar-hidden'}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpenMenu(null);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDraggingFile(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDraggingFile(false);
        void handleFiles(event.dataTransfer.files);
      }}
      data-workspace-ready={editor.workspaceReady ? 'true' : 'false'}
      data-workspace-save-state={editor.workspaceSaveState}
      data-active-document={editor.fileName}
      data-document-count={editor.documents.length}
      data-has-selection={editor.hasSelection ? 'true' : 'false'}
    >
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept=".ora,.ppm,.tga,image/openraster,image/x-portable-pixmap,image/x-tga,image/png,image/jpeg,image/webp,image/gif,image/bmp"
        onChange={(event) => {
          if (event.target.files) void handleFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={paletteInputRef}
        className="visually-hidden"
        type="file"
        accept=".txt,.gpl,.pal,text/plain"
        onChange={(event) => {
          void handlePaletteFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <input
        ref={layerFileInputRef}
        className="visually-hidden"
        type="file"
        accept=".ora,.ppm,.tga,image/openraster,image/x-portable-pixmap,image/x-tga,image/png,image/jpeg,image/webp,image/gif,image/bmp"
        onChange={(event) => {
          void handleLayerFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      <nav
        className="macos-menu-bar"
        aria-label="Application menu"
        role="menubar"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setOpenMenu(null);
            return;
          }
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.macos-menu-button')];
          const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
          const offset = event.key === 'ArrowRight' ? 1 : -1;
          const next = buttons[(current + offset + buttons.length) % buttons.length];
          next.focus();
          setMenuSurface('top');
          setOpenMenu(next.dataset.menuName as Exclude<MenuName, null | 'main'>);
        }}
      >
        <TopLevelMenu name="pinta" label="Pinta" appMenu active={menuSurface === 'top' && openMenu === 'pinta'} onToggle={toggleTopLevelMenu} onEnter={enterTopLevelMenu}>{renderMenuContent('pinta')}</TopLevelMenu>
        <TopLevelMenu name="file" label="File" active={menuSurface === 'top' && openMenu === 'file'} onToggle={toggleTopLevelMenu} onEnter={enterTopLevelMenu}>{renderMenuContent('file')}</TopLevelMenu>
        <TopLevelMenu name="edit" label="Edit" active={menuSurface === 'top' && openMenu === 'edit'} onToggle={toggleTopLevelMenu} onEnter={enterTopLevelMenu}>{renderMenuContent('edit')}</TopLevelMenu>
        <TopLevelMenu name="view" label="View" active={menuSurface === 'top' && openMenu === 'view'} onToggle={toggleTopLevelMenu} onEnter={enterTopLevelMenu}>{renderMenuContent('view')}</TopLevelMenu>
        <TopLevelMenu name="image" label="Image" active={menuSurface === 'top' && openMenu === 'image'} onToggle={toggleTopLevelMenu} onEnter={enterTopLevelMenu}>{renderMenuContent('image')}</TopLevelMenu>
        <TopLevelMenu name="adjustments" label="Adjustments" active={menuSurface === 'top' && openMenu === 'adjustments'} onToggle={toggleTopLevelMenu} onEnter={enterTopLevelMenu}>{renderMenuContent('adjustments')}</TopLevelMenu>
        <TopLevelMenu name="effects" label="Effects" active={menuSurface === 'top' && openMenu === 'effects'} onToggle={toggleTopLevelMenu} onEnter={enterTopLevelMenu}>{renderMenuContent('effects')}</TopLevelMenu>
        <TopLevelMenu name="addins" label="Add-ins" active={menuSurface === 'top' && openMenu === 'addins'} onToggle={toggleTopLevelMenu} onEnter={enterTopLevelMenu}>{renderMenuContent('addins')}</TopLevelMenu>
        <TopLevelMenu name="window" label="Window" active={menuSurface === 'top' && openMenu === 'window'} onToggle={toggleTopLevelMenu} onEnter={enterTopLevelMenu}>{renderMenuContent('window')}</TopLevelMenu>
        <TopLevelMenu name="help" label="Help" active={menuSurface === 'top' && openMenu === 'help'} onToggle={toggleTopLevelMenu} onEnter={enterTopLevelMenu}>{renderMenuContent('help')}</TopLevelMenu>
        <span className="macos-menu-document" title={editor.fileName}>{editor.fileName}{editor.dirty ? '*' : ''}</span>
      </nav>

      {showToolbar && <header className="header-bar" onClick={() => {
        setOpenMenu(null);
        setMenuSurface(null);
      }}>
        <div className="header-cluster">
          <IconButton label="New Image (Ctrl+N)" onClick={() => openDialog('new')}><FilePlus2 size={iconSize} /></IconButton>
          <IconButton label="Open Image (Ctrl+O)" onClick={() => fileInputRef.current?.click()}><FolderOpen size={iconSize} /></IconButton>
          <IconButton label="Save Image (Ctrl+S)" onClick={() => void editor.saveImage()}><Save size={iconSize} /></IconButton>
          <span className="toolbar-separator" />
          <IconButton label="Undo (Ctrl+Z)" onClick={editor.undo} disabled={!canUndo}><Undo2 size={iconSize} /></IconButton>
          <IconButton label="Redo (Ctrl+Y)" onClick={editor.redo} disabled={!canRedo}><Redo2 size={iconSize} /></IconButton>
          <span className="toolbar-separator" />
          <IconButton label="Cut (Ctrl+X)" onClick={() => {
            if (editor.cutSelection()) notify('Cut selection');
          }}><Scissors size={iconSize} /></IconButton>
          <IconButton label="Copy (Ctrl+C)" onClick={() => {
            if (editor.copySelection()) notify('Copied selection');
          }}><Copy size={iconSize} /></IconButton>
          <IconButton label="Paste (Ctrl+V)" disabled={!editor.hasClipboard} onClick={() => {
            if (editor.paste()) notify('Pasted into the current layer');
          }}><ClipboardPaste size={iconSize} /></IconButton>
          <IconButton label="Crop to Selection" disabled={!editor.hasSelection} onClick={() => editor.cropToSelection()}><Crop size={iconSize} /></IconButton>
          <IconButton label="Deselect (Esc)" disabled={!editor.hasSelection} onClick={editor.deselect}><X size={iconSize} /></IconButton>
        </div>

        <div className="window-title">
          <span>{editor.fileName}{editor.dirty ? '*' : ''}</span>
          <span className="window-app-name">Pinta</span>
        </div>

        <div className="header-cluster header-cluster-end" onClick={(event) => event.stopPropagation()}>
          <div className="menu-anchor">
            <IconButton label="View" active={menuSurface === 'header' && openMenu === 'view'} onClick={() => toggleHeaderMenu('view')}><PanelRightOpen size={iconSize} /></IconButton>
            {menuSurface === 'header' && openMenu === 'view' && (
              <Popover align="right" className="view-menu-popover">{renderMenuContent('view')}</Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Image" active={menuSurface === 'header' && openMenu === 'image'} onClick={() => toggleHeaderMenu('image')}><ImageIcon size={iconSize} /></IconButton>
            {menuSurface === 'header' && openMenu === 'image' && (
              <Popover align="right">{renderMenuContent('image')}</Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Adjustments" active={menuSurface === 'header' && openMenu === 'adjustments'} onClick={() => toggleHeaderMenu('adjustments')}><SlidersHorizontal size={iconSize} /></IconButton>
            {menuSurface === 'header' && openMenu === 'adjustments' && (
              <Popover align="right" className="effect-menu-popover">{renderMenuContent('adjustments')}</Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Effects" active={menuSurface === 'header' && openMenu === 'effects'} onClick={() => toggleHeaderMenu('effects')}><Sparkles size={iconSize} /></IconButton>
            {menuSurface === 'header' && openMenu === 'effects' && (
              <Popover align="right" className="effect-menu-popover">{renderMenuContent('effects')}</Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Main Menu" active={menuSurface === 'header' && openMenu === 'main'} onClick={() => toggleHeaderMenu('main')}><Menu size={iconSize} /></IconButton>
            {menuSurface === 'header' && openMenu === 'main' && (
              <Popover align="right" className="main-menu-popover">
                <MenuItem icon={<FilePlus2 size={15} />} label="New" shortcut="Ctrl+N" onClick={() => openDialog('new')} />
                <MenuItem icon={<Camera size={15} />} label="New Screenshot…" onClick={() => closeAnd(() => {
                  setScreenshotError('');
                  setShowScreenshot(true);
                })} />
                <MenuItem icon={<FolderOpen size={15} />} label="Open…" shortcut="Ctrl+O" onClick={() => closeAnd(() => fileInputRef.current?.click())} />
                <MenuItem icon={<Save size={15} />} label="Save" shortcut="Ctrl+S" onClick={() => closeAnd(() => { void editor.saveImage(); })} />
                <MenuItem icon={<Save size={15} />} label="Save As…" shortcut="Ctrl+Shift+S" onClick={() => closeAnd(() => setShowSaveAs(true))} />
                <MenuItem icon={<Printer size={15} />} label="Print…" shortcut="Ctrl+P" onClick={openPrintDialog} />
                <MenuItem icon={<X size={15} />} label="Close" shortcut="Ctrl+W" onClick={() => requestCloseDocument(editor.activeDocumentId)} />
                <MenuItem icon={<Save size={15} />} label="Save All" shortcut="Ctrl+Alt+A" disabled={!editor.documents.some((document) => document.dirty)} onClick={() => closeAnd(() => {
                  void editor.saveAllImages().then((count) => notify(`Saved ${count} ${count === 1 ? 'image' : 'images'}`));
                })} />
                <MenuItem icon={<X size={15} />} label="Close All" shortcut="Ctrl+Shift+W" onClick={requestCloseAll} />
                <div className="menu-divider" />
                <MenuItem icon={<Undo2 size={15} />} label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => closeAnd(editor.undo)} />
                <MenuItem icon={<Redo2 size={15} />} label="Redo" shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={() => closeAnd(editor.redo)} />
                <div className="menu-divider" />
                <MenuItem icon={<Scissors size={15} />} label="Cut" shortcut="Ctrl+X" onClick={() => closeAnd(() => editor.cutSelection())} />
                <MenuItem icon={<Copy size={15} />} label="Copy" shortcut="Ctrl+C" onClick={() => closeAnd(() => editor.copySelection())} />
                <MenuItem icon={<Copy size={15} />} label="Copy Merged" shortcut="Ctrl+Shift+C" onClick={() => closeAnd(() => editor.copyMerged())} />
                <MenuItem icon={<ClipboardPaste size={15} />} label="Paste" shortcut="Ctrl+V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.paste())} />
                <MenuItem icon={<ClipboardPaste size={15} />} label="Paste Into New Layer" shortcut="Ctrl+Shift+V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.pasteIntoNewLayer())} />
                <MenuItem icon={<ClipboardPaste size={15} />} label="Paste Into New Image" shortcut="Shift+V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.pasteIntoNewImage())} />
                <div className="menu-divider" />
                <MenuItem label="Select All" shortcut="Ctrl+A" onClick={() => closeAnd(editor.selectAll)} />
                <MenuItem label="Deselect All" shortcut="Ctrl+Shift+A" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.deselect)} />
                <div className="menu-divider" />
                <MenuItem icon={<NativeToolIcon file="edit-selection-erase-symbolic.svg" size={16} />} label="Erase Selection" shortcut="Delete" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.clearActiveLayer)} />
                <MenuItem icon={<NativeToolIcon file="edit-selection-fill-symbolic.svg" size={16} />} label="Fill Selection" shortcut="Backspace" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.fillSelection)} />
                <MenuItem icon={<NativeToolIcon file="edit-selection-invert-symbolic.svg" size={16} />} label="Invert Selection" shortcut="Ctrl+I" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.invertSelection)} />
                <MenuItem icon={<NativeToolIcon file="edit-selection-offset-symbolic.svg" size={16} />} label="Offset Selection…" shortcut="Ctrl+Shift+O" disabled={!editor.hasSelection} onClick={() => closeAnd(() => setShowOffsetSelection(true))} />
                <div className="menu-divider" />
                <div className="menu-caption">Palette</div>
                <MenuItem icon={<FolderOpen size={15} />} label="Open Palette…" onClick={() => closeAnd(() => paletteInputRef.current?.click())} />
                <MenuItem icon={<Save size={15} />} label="Save Palette As…" onClick={() => closeAnd(() => setPaletteDialog('save'))} />
                <MenuItem icon={<RotateCw size={15} />} label="Reset Palette to Default" onClick={() => closeAnd(() => {
                  editor.resetPalette();
                  notify('Palette reset to Pinta defaults');
                })} />
                <MenuItem label="Set Number of Colors…" onClick={() => closeAnd(() => setPaletteDialog('resize'))} />
                <div className="menu-divider" />
                <div className="menu-caption">Help</div>
                <MenuItem label="Contents" shortcut="F1" onClick={() => closeAnd(() => window.open('https://pinta-project.com/user-guide', '_blank', 'noopener,noreferrer'))} />
                <MenuItem label="Keyboard Shortcuts" shortcut="Ctrl+," onClick={() => closeAnd(() => setShowKeyboardShortcuts(true))} />
                <MenuItem label="Pinta Website" onClick={() => closeAnd(() => window.open('https://www.pinta-project.com', '_blank', 'noopener,noreferrer'))} />
                <MenuItem label="File a Bug" onClick={() => closeAnd(() => window.open('https://github.com/PintaProject/Pinta/issues', '_blank', 'noopener,noreferrer'))} />
                <MenuItem label="Translate This Application" onClick={() => closeAnd(() => window.open('https://hosted.weblate.org/engage/pinta/', '_blank', 'noopener,noreferrer'))} />
                <div className="menu-divider" />
                <MenuItem label="About" onClick={() => closeAnd(() => setShowAbout(true))} />
              </Popover>
            )}
          </div>
          <span className="toolbar-separator" />
          <IconButton label={showSidebar ? 'Hide sidebar' : 'Show sidebar'} onClick={() => setShowSidebar((value) => !value)}>
            {showSidebar ? <PanelRightClose size={iconSize} /> : <PanelRightOpen size={iconSize} />}
          </IconButton>
          <IconButton label="Fullscreen" onClick={() => void toggleFullscreen()}><Maximize2 size={iconSize} /></IconButton>
        </div>
      </header>}

      <div className="tool-options-bar">
        <span className="tool-label">Tool:</span>
        <NativeToolIcon file={currentTool.icon} size={19} />
        <strong>{currentTool.name}</strong>
        <span className="toolbar-separator tall" />
        {['paintbrush', 'pencil', 'eraser', 'freeform', 'recolor', 'clone-stamp', 'line', 'rectangle', 'rounded-rectangle', 'ellipse'].includes(editor.tool) ? (
          <>
            <span className="option-label">Width</span>
            <button className="stepper-button" type="button" onClick={() => editor.setBrushSize(Math.max(1, editor.brushSize - 1))}><Minus size={13} /></button>
            <input
              className="number-input"
              type="number"
              min={1}
              max={100}
              value={editor.brushSize}
              onChange={(event) => editor.setBrushSize(Math.max(1, Math.min(100, Number(event.target.value))))}
            />
            <button className="stepper-button" type="button" onClick={() => editor.setBrushSize(Math.min(100, editor.brushSize + 1))}><Plus size={13} /></button>
            <span className="option-unit">px</span>
            <span className="option-preview" style={{ '--brush-size': `${Math.min(18, editor.brushSize)}px` } as CSSProperties}><i /></span>
            {['line', 'rectangle', 'rounded-rectangle', 'ellipse', 'freeform'].includes(editor.tool) && (
              <>
                <span className="toolbar-separator tall" />
                {editor.tool !== 'freeform' && (
                  <>
                    <span className="option-label">Shape</span>
                    <select className="select-control shape-option-select" value={editor.tool} onChange={(event) => editor.setTool(event.target.value as typeof editor.tool)} aria-label="Shape type">
                      <option value="line">Line / Curve</option>
                      <option value="rectangle">Rectangle</option>
                      <option value="rounded-rectangle">Rounded Rectangle</option>
                      <option value="ellipse">Ellipse</option>
                    </select>
                  </>
                )}
                {editor.tool !== 'line' && (
                  <>
                    <span className="option-label">Fill Style</span>
                    <select className="select-control shape-option-select" value={editor.shapeFillStyle} onChange={(event) => editor.setShapeFillStyle(event.target.value as ShapeFillStyle)} aria-label="Fill style">
                      <option value="outline">Outline Shape</option>
                      <option value="fill">Fill Shape</option>
                      <option value="fill-outline">Fill and Outline Shape</option>
                    </select>
                  </>
                )}
                <span className="option-label">Dash</span>
                <select className="select-control dash-option-select" value={editor.shapeDashStyle} onChange={(event) => editor.setShapeDashStyle(event.target.value as ShapeDashStyle)} aria-label="Dash style">
                  <option value="solid">Solid</option>
                  <option value="dash">Dash</option>
                  <option value="dot">Dot</option>
                  <option value="dash-dot">Dash Dot</option>
                </select>
                <span className="option-label">Antialiasing</span>
                <select className="select-control antialias-option-select" value={editor.shapeAntialiasing ? 'on' : 'off'} onChange={(event) => editor.setShapeAntialiasing(event.target.value === 'on')} aria-label="Antialiasing">
                  <option value="on">Enabled</option>
                  <option value="off">Disabled</option>
                </select>
                {editor.tool === 'line' && (
                  <>
                    <span className="toolbar-separator tall" />
                    <span className="option-label">Arrow</span>
                    <button className={`text-format-button ${editor.lineArrowStart ? 'active' : ''}`} type="button" aria-label="Start arrow" title="Start arrow" onClick={() => editor.setLineArrowStart(!editor.lineArrowStart)}>⇤</button>
                    <button className={`text-format-button ${editor.lineArrowEnd ? 'active' : ''}`} type="button" aria-label="End arrow" title="End arrow" onClick={() => editor.setLineArrowEnd(!editor.lineArrowEnd)}>⇥</button>
                    {(editor.lineArrowStart || editor.lineArrowEnd) && (
                      <input className="text-number-input compact" type="number" min="5" max="200" value={editor.lineArrowSize} onChange={(event) => editor.setLineArrowSize(Math.max(5, Math.min(200, Number(event.target.value))))} aria-label="Arrow size" title="Arrow size" />
                    )}
                    {editor.lineDraft && (
                      <>
                        <span className="line-edit-hint">
                          Drag handles · right-drag tension {Math.round((editor.lineDraft.tensions[editor.lineDraft.selectedPoint] ?? 0) * 100)}% · click line to add a point
                        </span>
                        <button className="text-format-button text-commit-button" type="button" aria-label="Commit line" title="Commit line (Enter)" onClick={editor.commitLine}><Check size={15} /></button>
                        <button className="text-format-button" type="button" aria-label="Cancel line" title="Cancel line (Esc)" onClick={editor.cancelLine}><X size={15} /></button>
                      </>
                    )}
                  </>
                )}
                {editor.shapeDraft && (
                  <>
                    <span className="line-edit-hint">Drag corner handles · Shift constrains proportions</span>
                    <button className="text-format-button text-commit-button" type="button" aria-label="Commit shape" title="Commit shape (Enter)" onClick={editor.commitShape}><Check size={15} /></button>
                    <button className="text-format-button" type="button" aria-label="Cancel shape" title="Cancel shape (Esc)" onClick={editor.cancelShape}><X size={15} /></button>
                  </>
                )}
              </>
            )}
            {editor.tool === 'recolor' && (
              <>
                <span className="toolbar-separator tall" />
                <span className="option-label">Tolerance</span>
                <input className="tool-option-slider" type="range" min="0" max="100" value={editor.recolorTolerance} onChange={(event) => editor.setRecolorTolerance(Number(event.target.value))} aria-label="Recolor tolerance" />
                <span className="option-value">{editor.recolorTolerance}%</span>
              </>
            )}
            {editor.tool === 'clone-stamp' && (
              <>
                <span className="toolbar-separator tall" />
                <span className="clone-source-status">{editor.cloneSource ? `Origin: ${Math.round(editor.cloneSource.x)}, ${Math.round(editor.cloneSource.y)}` : 'Ctrl + click to set origin'}</span>
              </>
            )}
          </>
        ) : editor.tool === 'text' ? (
          <>
            <span className="option-label">Font</span>
            <select className="text-option-select font-family-select" value={editor.textFontFamily} onChange={(event) => editor.setTextFontFamily(event.target.value)} aria-label="Font family">
              {['Sans', 'Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS'].map((font) => <option key={font}>{font}</option>)}
            </select>
            <span className="toolbar-separator tall" />
            <select className="text-option-select" value={editor.textVariant} onChange={(event) => editor.setTextVariant(event.target.value as TextVariant)} aria-label="Font variant">
              <option value="normal">Normal</option>
              <option value="small-caps">Small Caps</option>
              <option value="all-small-caps">All Small Caps</option>
              <option value="title-caps">Title Caps</option>
            </select>
            <input className="text-number-input" type="number" min="1" max="2000" value={editor.textFontSize} onChange={(event) => editor.setTextFontSize(Math.max(1, Math.min(2000, Number(event.target.value))))} aria-label="Font size" title="Font size" />
            <select className="text-option-select text-weight-select" value={editor.textFontWeight} onChange={(event) => editor.setTextFontWeight(Number(event.target.value))} aria-label="Font weight">
              <option value="300">Light 300</option>
              <option value="400">Normal 400</option>
              <option value="500">Medium 500</option>
              <option value="600">Semibold 600</option>
              <option value="700">Bold 700</option>
              <option value="900">Heavy 900</option>
            </select>
            <button className={`text-format-button ${editor.textItalic ? 'active' : ''}`} type="button" aria-label="Italic" title="Italic (Ctrl+I)" onClick={() => editor.setTextItalic(!editor.textItalic)}><Italic size={15} /></button>
            <button className={`text-format-button ${editor.textUnderline ? 'active' : ''}`} type="button" aria-label="Underline" title="Underline (Ctrl+U)" onClick={() => editor.setTextUnderline(!editor.textUnderline)}><Underline size={15} /></button>
            <span className="toolbar-separator tall" />
            {([
              ['left', AlignLeft, 'Left align'],
              ['center', AlignCenter, 'Center align'],
              ['right', AlignRight, 'Right align'],
            ] as const).map(([alignment, AlignmentIcon, label]) => (
              <button key={alignment} className={`text-format-button ${editor.textAlignment === alignment ? 'active' : ''}`} type="button" aria-label={label} title={label} onClick={() => editor.setTextAlignment(alignment as TextAlignment)}><AlignmentIcon size={15} /></button>
            ))}
            <span className="toolbar-separator tall" />
            <span className="option-label">Text style</span>
            <select className="text-option-select" value={editor.textStyle} onChange={(event) => editor.setTextStyle(event.target.value as TextStyle)} aria-label="Text style">
              <option value="fill">Normal</option>
              <option value="fill-outline">Normal and Outline</option>
              <option value="outline">Outline</option>
              <option value="background">Fill Background</option>
            </select>
            {(editor.textStyle === 'fill-outline' || editor.textStyle === 'outline') && (
              <>
                <span className="option-label">Outline</span>
                <input className="text-number-input compact" type="number" min="1" max="100" value={editor.textOutlineWidth} onChange={(event) => editor.setTextOutlineWidth(Math.max(1, Math.min(100, Number(event.target.value))))} aria-label="Outline width" />
                <select className="text-option-select" value={editor.textLineJoin} onChange={(event) => editor.setTextLineJoin(event.target.value as CanvasLineJoin)} aria-label="Outline join">
                  <option value="miter">Miter Join</option>
                  <option value="round">Round Join</option>
                  <option value="bevel">Bevel Join</option>
                </select>
              </>
            )}
            {editor.textEditor && (
              <>
                <span className="toolbar-separator tall" />
                <button className="text-format-button text-commit-button" type="button" aria-label="Commit text" title="Commit text (Ctrl+Enter)" onClick={editor.commitText}><Check size={15} /></button>
                <button className="text-format-button" type="button" aria-label="Cancel text" title="Cancel text (Esc)" onClick={editor.cancelText}><X size={15} /></button>
              </>
            )}
          </>
        ) : editor.tool === 'magic-wand' ? (
          <>
            <span className="option-label">Tolerance</span>
            <input className="tool-option-slider" type="range" min="0" max="100" value={editor.magicWandTolerance} onChange={(event) => editor.setMagicWandTolerance(Number(event.target.value))} aria-label="Magic wand tolerance" />
            <span className="option-value">{editor.magicWandTolerance}%</span>
            <span className="toolbar-separator tall" />
            <span className="option-label">Selection mode</span>
            <select
              className="select-control selection-mode-select"
              value={editor.selectionMode}
              title="Ctrl/Command + left click: Union · right click: Exclude · Ctrl/Command + right click: Xor · Alt/Option + left click: Intersect"
              onChange={(event) => editor.setSelectionMode(event.target.value as SelectionMode)}
              aria-label="Selection mode"
            >
              {SELECTION_MODE_OPTIONS.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
            </select>
          </>
        ) : ['rectangle-select', 'ellipse-select', 'lasso-select'].includes(editor.tool) ? (
          <>
            <span className="option-label">Selection mode</span>
            <select
              className="select-control selection-mode-select"
              value={editor.selectionMode}
              title="Ctrl/Command + left click: Union · right click: Exclude · Ctrl/Command + right click: Xor · Alt/Option + left click: Intersect"
              onChange={(event) => editor.setSelectionMode(event.target.value as SelectionMode)}
              aria-label="Selection mode"
            >
              {SELECTION_MODE_OPTIONS.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
            </select>
          </>
        ) : editor.tool === 'gradient' ? (
          <>
            <span className="option-label">Gradient</span>
            <button className="select-control" type="button">Linear <ChevronDown size={13} /></button>
          </>
        ) : (
          <span className="muted-option">{currentTool.status}</span>
        )}
      </div>

      <div className={`editor-body ${showSidebar ? 'with-sidebar' : ''}`} onClick={() => setOpenMenu(null)}>
        {showToolbox && (
          <aside className="toolbox" aria-label="Tools">
            {TOOLS.map((item) => (
              <button
                key={item.id}
                className={`tool-button ${editor.tool === item.id ? 'active' : ''}`}
                type="button"
                title={`${item.name}${item.shortcut ? `\nShortcut key: ${item.shortcut}` : ''}\n${item.status}`}
                aria-label={item.name}
                onClick={() => editor.setTool(item.id)}
              >
                <NativeToolIcon file={item.icon} size={22} />
              </button>
            ))}
          </aside>
        )}

        <div className="canvas-area">
          {showDocumentTabs && (
            <nav className="document-tabs" role="tablist" aria-label="Open images">
              <div className="document-tabs-scroll">
                {editor.documents.map((document) => (
                  <div className={`document-tab ${document.id === editor.activeDocumentId ? 'active' : ''}`} key={document.id}>
                    <button
                      type="button"
                      className="document-tab-activate"
                      role="tab"
                      aria-selected={document.id === editor.activeDocumentId}
                      title={`${document.fileName} · ${document.width} × ${document.height}`}
                      onClick={() => editor.switchDocument(document.id)}
                    >
                      <ImageIcon size={13} />
                      <span>{document.fileName}{document.dirty ? '*' : ''}</span>
                    </button>
                    <button
                      type="button"
                      className="document-tab-close"
                      aria-label={`Close ${document.fileName}`}
                      title={`Close ${document.fileName}`}
                      onClick={() => requestCloseDocument(document.id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </nav>
          )}

          <div className={`canvas-viewport-shell ${showRulers ? 'with-rulers' : ''}`}>
            {showRulers && (
              <>
                <span className="ruler-corner" aria-hidden="true" />
                <CanvasRuler orientation="horizontal" metric={rulerMetric} imageSize={editor.width} zoom={editor.zoom} viewportSize={viewportMetrics.width} scroll={viewportMetrics.scrollLeft} />
                <CanvasRuler orientation="vertical" metric={rulerMetric} imageSize={editor.height} zoom={editor.zoom} viewportSize={viewportMetrics.height} scroll={viewportMetrics.scrollTop} />
              </>
            )}
            <main
              ref={viewportRef}
              className="canvas-viewport"
              onWheel={handleWheel}
              onScroll={(event) => setViewportMetrics((current) => ({
                ...current,
                scrollLeft: event.currentTarget.scrollLeft,
                scrollTop: event.currentTarget.scrollTop,
              }))}
            >
            <div className="canvas-centering-frame">
              <div
                className={`canvas-stack tool-${editor.tool}`}
                style={canvasStyle}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
                onContextMenu={(event) => event.preventDefault()}
              >
                <canvas ref={editor.displayCanvasRef} width={editor.width} height={editor.height} />
                <canvas ref={editor.previewCanvasRef} width={editor.width} height={editor.height} className="preview-canvas" />
                {canvasGrid.showGrid && <div className="canvas-grid-overlay orthogonal-grid" aria-hidden="true" />}
                {canvasGrid.showAxonometricGrid && <div className="canvas-grid-overlay axonometric-grid" aria-hidden="true" />}
                {editor.textEditor && (
                  <div
                    className={`text-editor-overlay ${editor.textEditor.y * editor.zoom < 32 ? 'near-top' : ''}`}
                    style={{
                      left: `${textEditorLeft}px`,
                      top: `${Math.max(0, editor.textEditor.y * editor.zoom)}px`,
                      width: `${textEditorWidth}px`,
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <div className="text-editor-actions">
                      <button
                        type="button"
                        className="text-drag-handle"
                        aria-label="Move text"
                        title="Drag to move text"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          textDragRef.current = {
                            x: event.clientX,
                            y: event.clientY,
                            originX: editor.textEditor!.x,
                            originY: editor.textEditor!.y,
                          };
                        }}
                        onPointerMove={(event) => {
                          const drag = textDragRef.current;
                          if (!drag) return;
                          editor.moveText(
                            drag.originX + (event.clientX - drag.x) / editor.zoom,
                            drag.originY + (event.clientY - drag.y) / editor.zoom,
                          );
                        }}
                        onPointerUp={() => { textDragRef.current = null; }}
                        onPointerCancel={() => { textDragRef.current = null; }}
                      >⠿</button>
                      <span>Editing text</span>
                      <button type="button" aria-label="Commit text" title="Commit text" onClick={editor.commitText}><Check size={13} /></button>
                      <button type="button" aria-label="Cancel text" title="Cancel text" onClick={editor.cancelText}><X size={13} /></button>
                    </div>
                    <textarea
                      autoFocus
                      wrap="off"
                      className={`canvas-text-editor text-style-${editor.textStyle}`}
                      aria-label="Text editor"
                      value={editor.textEditor.value}
                      spellCheck
                      placeholder="Type text…"
                      onChange={(event) => editor.updateText(event.target.value)}
                      onPointerDown={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          editor.cancelText();
                        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          editor.commitText();
                        } else if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          if (event.shiftKey) setShowSaveAs(true);
                          else void editor.saveImage();
                        } else if (event.key.toLowerCase() === 'b' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          editor.setTextFontWeight(editor.textFontWeight >= 700 ? 400 : 700);
                        } else if (event.key.toLowerCase() === 'i' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          editor.setTextItalic(!editor.textItalic);
                        } else if (event.key.toLowerCase() === 'u' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          editor.setTextUnderline(!editor.textUnderline);
                        }
                      }}
                      style={{
                        minHeight: `${Math.max(82, editor.textFontSize * editor.zoom * 2.7)}px`,
                        fontFamily: editor.textFontFamily,
                        fontSize: `${editor.textFontSize * editor.zoom}px`,
                        fontWeight: editor.textFontWeight,
                        fontStyle: editor.textItalic ? 'italic' : 'normal',
                        fontVariantCaps: editor.textVariant === 'small-caps' ? 'small-caps' : 'normal',
                        textTransform: editor.textVariant === 'all-small-caps' ? 'uppercase' : editor.textVariant === 'title-caps' ? 'capitalize' : 'none',
                        textDecoration: editor.textUnderline ? 'underline' : 'none',
                        textAlign: editor.textAlignment,
                        color: editor.textStyle === 'outline' ? 'transparent' : editor.primary,
                        backgroundColor: editor.textStyle === 'background' ? editor.secondary : undefined,
                        WebkitTextStroke: editor.textStyle === 'fill-outline'
                          ? `${Math.max(1, editor.textOutlineWidth * editor.zoom)}px ${editor.secondary}`
                          : editor.textStyle === 'outline'
                            ? `${Math.max(1, editor.textOutlineWidth * editor.zoom)}px ${editor.primary}`
                            : undefined,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
            </main>
          </div>
        </div>

        {showSidebar && (
          <aside className="dock-sidebar">
            <section className="dock-panel layers-panel">
              <header className="dock-header">
                <span>Layers</span>
                <div className="menu-anchor layer-menu-anchor" onClick={(event) => event.stopPropagation()}>
                  <button className="dock-menu-button" type="button" aria-label="Layer menu" aria-expanded={layerMenuOpen} onClick={() => setLayerMenuOpen((value) => !value)}><MoreHorizontal size={15} /></button>
                  {layerMenuOpen && (
                    <Popover align="right" className="layer-menu-popover">
                      <MenuItem icon={<NativeToolIcon file="layer-import-symbolic.svg" size={16} />} label="Import from File…" onClick={() => { setLayerMenuOpen(false); layerFileInputRef.current?.click(); }} />
                      <div className="menu-divider" />
                      <MenuItem icon={<FlipHorizontal2 size={15} />} label="Flip Horizontal" shortcut="Ctrl+F" onClick={() => { setLayerMenuOpen(false); editor.flipLayer('horizontal'); }} />
                      <MenuItem icon={<FlipVertical2 size={15} />} label="Flip Vertical" shortcut="Shift+F" onClick={() => { setLayerMenuOpen(false); editor.flipLayer('vertical'); }} />
                      <MenuItem icon={<NativeToolIcon file="layers-rotate-zoom-symbolic.svg" size={16} />} label="Rotate / Zoom Layer…" onClick={() => { setLayerMenuOpen(false); setRotateZoomLayerId(editor.activeLayerId); }} />
                      <div className="menu-divider" />
                      <MenuItem icon={<Menu size={15} />} label="Layer Properties…" shortcut="F4" onClick={() => { setLayerMenuOpen(false); setLayerPropertiesId(editor.activeLayerId); }} />
                    </Popover>
                  )}
                </div>
              </header>
              <div className="layer-list">
                {[...editor.layers].reverse().map((layer) => (
                  <div
                    className={`layer-row ${editor.activeLayerId === layer.id ? 'active' : ''}`}
                    key={layer.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => editor.setActiveLayerId(layer.id)}
                    onDoubleClick={() => {
                      setLayerPropertiesId(layer.id);
                    }}
                    title={`${layer.name} · ${BLEND_MODES.find((mode) => mode.id === layer.blendMode)?.label ?? 'Normal'} · ${Math.round(layer.opacity * 100)}%`}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') editor.setActiveLayerId(layer.id);
                    }}
                  >
                    <button
                      type="button"
                      className="layer-eye"
                      aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
                      onClick={(event) => {
                        event.stopPropagation();
                        editor.toggleLayer(layer.id);
                      }}
                    >
                      {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <span className="layer-thumbnail checkerboard">
                      <img src={layer.canvas.toDataURL()} alt="" />
                    </span>
                    <span className="layer-name">{layer.name}</span>
                    {editor.activeLayerId === layer.id && <Check className="layer-check" size={15} />}
                  </div>
                ))}
              </div>
              <footer className="dock-toolbar">
                <IconButton label="Add New Layer" onClick={editor.addLayer}><Plus size={15} /></IconButton>
                <IconButton label="Delete Layer" disabled={editor.layers.length === 1} onClick={editor.deleteLayer}><Trash2 size={15} /></IconButton>
                <IconButton label="Duplicate Layer" onClick={editor.duplicateLayer}><CopyPlus size={15} /></IconButton>
                <IconButton label="Merge Layer Down" disabled={activeLayerIndex <= 0} onClick={editor.mergeLayerDown}><Merge size={15} /></IconButton>
                <IconButton label="Move Layer Up" disabled={activeLayerIndex >= editor.layers.length - 1} onClick={() => editor.moveLayer(1)}><ArrowUp size={15} /></IconButton>
                <IconButton label="Move Layer Down" disabled={activeLayerIndex <= 0} onClick={() => editor.moveLayer(-1)}><ArrowDown size={15} /></IconButton>
                <IconButton label="Layer Properties (F4)" onClick={() => setLayerPropertiesId(editor.activeLayerId)}><Menu size={15} /></IconButton>
              </footer>
            </section>

            <section className="dock-panel history-panel">
              <header className="dock-header"><span>History</span><MoreHorizontal size={15} /></header>
              <div className="history-list">
                {editor.history.map((entry, index) => (
                  <button
                    key={`${index}-${entry.label}`}
                    type="button"
                    className={`history-row ${index === editor.historyIndex ? 'active' : ''} ${index > editor.historyIndex ? 'future' : ''}`}
                    onClick={() => editor.goToHistory(index)}
                  >
                    {index === 0 ? <FilePlus2 size={14} /> : <NativeToolIcon file={index === 1 ? currentTool.icon : 'ui-historylist-symbolic.svg'} size={14} />}
                    <span>{entry.label}</span>
                  </button>
                ))}
              </div>
              <footer className="dock-toolbar history-toolbar">
                <IconButton label="Undo" onClick={editor.undo} disabled={!canUndo}><Undo2 size={15} /></IconButton>
                <IconButton label="Redo" onClick={editor.redo} disabled={!canRedo}><Redo2 size={15} /></IconButton>
              </footer>
            </section>
          </aside>
        )}
      </div>

      {showPalette && (
        <footer className="status-bar">
          <div className="color-wells" title="Primary and secondary colors. Press X to swap.">
            <button className="color-well secondary" style={{ background: editor.secondary }} onClick={() => editor.setSecondary(editor.primary)} aria-label="Secondary color" />
            <button className="color-well primary" style={{ background: editor.primary }} onClick={editor.swapColors} aria-label="Primary color" />
            <button className="swap-colors" type="button" onClick={editor.swapColors} aria-label="Swap colors">↗</button>
          </div>
          <div className="palette" aria-label="Color palette">
            {editor.palette.map((color, index) => (
              <button
                key={`${color}-${index}`}
                className="swatch"
                style={{ background: color }}
                title={`${color} · click for primary, right-click for secondary, double-click to edit`}
                aria-label={`Set color ${color}`}
                onClick={() => editor.setPrimary(color)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  editor.setSecondary(color);
                }}
                onDoubleClick={() => {
                  setEditingPaletteIndex(index);
                }}
              />
            ))}
          </div>
          <div className="status-spacer" />
          <div className="status-readout"><span className="cursor-glyph">↖</span>{Math.round(editor.pointer.x)}, {Math.round(editor.pointer.y)}</div>
          <div className="status-readout"><span className="dimension-glyph" />{editor.width}, {editor.height}</div>
          <div className="zoom-control">
            <IconButton label="Zoom out" onClick={() => editor.setZoom(editor.zoom - 0.1)}><Minus size={14} /></IconButton>
            <input
              type="range"
              min="10"
              max="400"
              step="5"
              value={Math.round(editor.zoom * 100)}
              onChange={(event) => editor.setZoom(Number(event.target.value) / 100)}
              aria-label="Zoom"
            />
            <button className="zoom-value" type="button" onClick={() => editor.setZoom(1)}>{Math.round(editor.zoom * 100)}%</button>
            <IconButton label="Zoom in" onClick={() => editor.setZoom(editor.zoom + 0.1)}><Plus size={14} /></IconButton>
          </div>
        </footer>
      )}

      {isDraggingFile && (
        <div className="drop-overlay">
          <div><FolderOpen size={34} /><strong>Open images in Pinta</strong><span>Drop one or more OpenRaster, PNG, JPEG, WebP, GIF, BMP, PPM, or TGA images</span></div>
        </div>
      )}
      {dialog && (
        <ImageSizeDialog
          key={dialog}
          mode={dialog}
          currentWidth={editor.width}
          currentHeight={editor.height}
          secondaryColor={editor.secondary}
          onCancel={() => setDialog(null)}
          onSubmit={(nextWidth, nextHeight, anchor, background) => {
            if (dialog === 'new') editor.newDocument(nextWidth, nextHeight, background);
            else if (dialog === 'resize-image') editor.resizeImage(nextWidth, nextHeight);
            else editor.resizeCanvas(nextWidth, nextHeight, anchor);
            setDialog(null);
          }}
        />
      )}
      {effectDialog && (
        <EffectDialog
          key={effectDialog}
          effect={EFFECT_BY_ID[effectDialog]}
          busy={editor.effectBusy}
          onCancel={() => setEffectDialog(null)}
          onSubmit={async (parameters) => {
            if (await runEffect(effectDialog, parameters)) setEffectDialog(null);
          }}
        />
      )}
      {closingDocument && (
        <CloseDocumentDialog
          fileName={closingDocument.fileName}
          onCancel={() => setClosingDocumentId(null)}
          onDiscard={() => {
            editor.closeDocument(closingDocument.id);
            setClosingDocumentId(null);
          }}
          onSave={async () => {
            if (await editor.saveImage()) {
              editor.closeDocument(closingDocument.id);
              setClosingDocumentId(null);
            }
          }}
        />
      )}
      {showCloseAllConfirm && (
        <CloseAllDialog
          documentCount={editor.documents.length}
          dirtyCount={editor.documents.filter((document) => document.dirty).length}
          onCancel={() => setShowCloseAllConfirm(false)}
          onDiscard={() => {
            editor.closeAllDocuments();
            setShowCloseAllConfirm(false);
          }}
          onSave={async () => {
            await editor.saveAllImages();
            editor.closeAllDocuments();
            setShowCloseAllConfirm(false);
          }}
        />
      )}
      {showSaveAs && (
        <SaveAsDialog
          fileName={editor.fileName}
          onCancel={() => setShowSaveAs(false)}
          onSubmit={editor.saveImage}
        />
      )}
      {printPreview && (
        <PrintDialog
          preview={printPreview}
          onCancel={() => setPrintPreview(null)}
          onPrint={() => window.print()}
        />
      )}
      {showOffsetSelection && (
        <OffsetSelectionDialog
          onCancel={() => setShowOffsetSelection(false)}
          onSubmit={(offset) => {
            editor.offsetSelection(offset);
            setShowOffsetSelection(false);
          }}
        />
      )}
      {showScreenshot && (
        <ScreenshotDialog
          busy={screenshotBusy}
          error={screenshotError}
          onCancel={() => {
            setShowScreenshot(false);
            setScreenshotError('');
          }}
          onCapture={(delay) => void captureScreenshot(delay)}
        />
      )}
      {showCanvasGridDialog && (
        <CanvasGridDialog
          settings={canvasGrid}
          onCancel={() => setShowCanvasGridDialog(false)}
          onSubmit={(settings) => {
            setCanvasGrid(settings);
            setShowCanvasGridDialog(false);
          }}
        />
      )}
      {showKeyboardShortcuts && <KeyboardShortcutsDialog onClose={() => setShowKeyboardShortcuts(false)} />}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {paletteDialog === 'resize' && (
        <PaletteResizeDialog
          currentSize={editor.palette.length}
          onCancel={() => setPaletteDialog(null)}
          onSubmit={(size) => {
            editor.resizePalette(size);
            setPaletteDialog(null);
            notify(`Palette resized to ${Math.max(1, Math.min(96, Math.round(size)))} colors`);
          }}
        />
      )}
      {paletteDialog === 'save' && <PaletteSaveDialog onCancel={() => setPaletteDialog(null)} onSubmit={savePalette} />}
      {editingPaletteIndex !== null && editor.palette[editingPaletteIndex] && (
        <PaletteColorDialog
          key={editingPaletteIndex}
          color={editor.palette[editingPaletteIndex]}
          onCancel={() => setEditingPaletteIndex(null)}
          onSubmit={(color) => {
            editor.setPaletteColor(editingPaletteIndex, color);
            setEditingPaletteIndex(null);
            notify(`Palette color changed to ${color}`);
          }}
        />
      )}
      {layerPropertiesId && (() => {
        const layer = editor.layers.find((candidate) => candidate.id === layerPropertiesId);
        return layer ? (
          <LayerPropertiesDialog
            key={layer.id}
            layer={layer}
            onCancel={() => setLayerPropertiesId(null)}
            onSubmit={(properties) => {
              editor.updateLayerProperties(layer.id, properties);
              setLayerPropertiesId(null);
            }}
          />
        ) : null;
      })()}
      {rotateZoomLayerId && (() => {
        const layer = editor.layers.find((candidate) => candidate.id === rotateZoomLayerId);
        return layer ? (
          <RotateZoomLayerDialog
            key={layer.id}
            layer={layer}
            onCancel={() => setRotateZoomLayerId(null)}
            onSubmit={(angle, panHorizontal, panVertical, zoom) => {
              editor.rotateZoomLayer(angle, panHorizontal, panVertical, zoom);
              setRotateZoomLayerId(null);
            }}
          />
        ) : null;
      })()}
      {editor.effectBusy && !effectDialog && (
        <div className="effect-busy-overlay" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={18} /> Processing effect…
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
      {isFullscreen && <button className="fullscreen-exit" type="button" onClick={() => void toggleFullscreen()}>Exit fullscreen</button>}
      {printPreview && (
        <div className="print-surface" aria-hidden="true">
          <img src={printPreview.dataUrl} alt="" />
        </div>
      )}
    </div>
  );
}

export default App;
