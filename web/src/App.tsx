import {
  AlertTriangle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
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
  Image as ImageIcon,
  Italic,
  LoaderCircle,
  Maximize2,
  Menu,
  Merge,
  Minus,
  Moon,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Sun,
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

type MenuName = 'file' | 'edit' | 'view' | 'image' | 'adjustments' | 'effects' | 'main' | null;
type DialogName = 'new' | 'resize-image' | 'resize-canvas' | null;

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
    <button className="menu-item" type="button" disabled={disabled} onClick={onClick}>
      <span className="menu-check">{checked ? <Check size={14} /> : icon}</span>
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

function Popover({ children, align = 'left', className = '' }: { children: ReactNode; align?: 'left' | 'right'; className?: string }) {
  return <div className={`popover popover-${align} ${className}`}>{children}</div>;
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

function App() {
  const editor = usePaintEditor();
  const currentTool = TOOL_BY_ID[editor.tool];
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [openMenu, setOpenMenu] = useState<MenuName>(null);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showToolbox, setShowToolbox] = useState(true);
  const [showPalette, setShowPalette] = useState(true);
  const [showDocumentTabs, setShowDocumentTabs] = useState(true);
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

  useEffect(() => {
    document.title = `${editor.fileName}${editor.dirty ? '*' : ''} — Pinta`;
  }, [editor.dirty, editor.fileName]);

  useEffect(() => {
    document.querySelector('.document-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [editor.activeDocumentId]);

  useEffect(() => {
    const closeMenus = () => {
      setOpenMenu(null);
      setLayerMenuOpen(false);
    };
    window.addEventListener('blur', closeMenus);
    return () => window.removeEventListener('blur', closeMenus);
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
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key === 'Tab') {
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
      } else if (command && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        editor.flipLayer('horizontal');
      } else if (!command && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        editor.flipLayer('vertical');
      } else if (command && event.key.toLowerCase() === 'w') {
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
      } else if (command && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        fileInputRef.current?.click();
      } else if (command && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setDialog('new');
      } else if (command && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        setOpenMenu(null);
        setEffectDialog('levels');
      } else if (event.key === 'F4') {
        event.preventDefault();
        setLayerPropertiesId(editor.activeLayerId);
      } else if (command && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        if (editor.cutSelection()) notify('Cut selection');
      } else if (command && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        if (editor.copySelection()) notify('Copied selection');
      } else if (command && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        if (editor.paste()) notify('Pasted into a new layer');
      } else if (command && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        editor.selectAll();
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        void editor.applyEffect('invert').catch(() => notify('Invert Colors could not be applied.'));
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
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (editor.lineDraft) {
          if (!editor.deleteLinePoint()) editor.cancelLine();
        } else if (editor.shapeDraft) {
          editor.cancelShape();
        } else editor.clearActiveLayer();
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
  }, [closingDocumentId, editingPaletteIndex, editor, layerPropertiesId, notify, paletteDialog, rotateZoomLayerId, showSaveAs]);

  const handleFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      await editor.openFile(file);
      notify(`Opened ${file.name}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open that image.');
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

  const closeAnd = useCallback((action: () => void) => {
    setOpenMenu(null);
    action();
  }, []);

  const openDialog = useCallback((name: Exclude<DialogName, null>) => {
    setOpenMenu(null);
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
  } satisfies CSSProperties;
  const textEditorWidth = editor.textEditor
    ? Math.max(150, Math.min(420, editor.width - editor.textEditor.x - 4) * editor.zoom)
    : 0;
  const textEditorLeft = editor.textEditor
    ? Math.max(0, editor.textEditor.x * editor.zoom - (editor.textAlignment === 'center' ? textEditorWidth / 2 : editor.textAlignment === 'right' ? textEditorWidth : 0))
    : 0;
  const closingDocument = editor.documents.find((document) => document.id === closingDocumentId);

  return (
    <div
      className={`app-shell theme-${theme}`}
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
        void handleFile(event.dataTransfer.files[0]);
      }}
    >
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept=".ora,.ppm,.tga,image/openraster,image/x-portable-pixmap,image/x-tga,image/png,image/jpeg,image/webp,image/gif,image/bmp"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
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

      <header className="header-bar" onClick={() => setOpenMenu(null)}>
        <div className="header-cluster">
          <IconButton label="New Image (Ctrl+N)" onClick={() => openDialog('new')}><FilePlus2 size={iconSize} /></IconButton>
          <IconButton label="Open Image (Ctrl+O)" onClick={() => fileInputRef.current?.click()}><FolderOpen size={iconSize} /></IconButton>
          <IconButton label="Save Image (Ctrl+S)" onClick={() => void editor.saveImage()}><Save size={iconSize} /></IconButton>
          <span className="toolbar-separator" />
          <IconButton label="Undo (Ctrl+Z)" onClick={editor.undo} disabled={!canUndo}><Undo2 size={iconSize} /></IconButton>
          <IconButton label="Redo (Ctrl+Y)" onClick={editor.redo} disabled={!canRedo}><Redo2 size={iconSize} /></IconButton>
          <span className="toolbar-separator" />
          <IconButton label="Cut (Ctrl+X)" disabled={!editor.hasSelection} onClick={() => {
            if (editor.cutSelection()) notify('Cut selection');
          }}><Scissors size={iconSize} /></IconButton>
          <IconButton label="Copy (Ctrl+C)" disabled={!editor.hasSelection} onClick={() => {
            if (editor.copySelection()) notify('Copied selection');
          }}><Copy size={iconSize} /></IconButton>
          <IconButton label="Paste (Ctrl+V)" disabled={!editor.hasClipboard} onClick={() => {
            if (editor.paste()) notify('Pasted into a new layer');
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
            <IconButton label="View" active={openMenu === 'view'} onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}><PanelRightOpen size={iconSize} /></IconButton>
            {openMenu === 'view' && (
              <Popover align="right">
                <MenuItem checked={showToolbox} label="Toolbox" onClick={() => setShowToolbox((value) => !value)} />
                <MenuItem checked={showSidebar} label="Layers and History" onClick={() => setShowSidebar((value) => !value)} />
                <MenuItem checked={showPalette} label="Status Bar" onClick={() => setShowPalette((value) => !value)} />
                <MenuItem checked={showDocumentTabs} label="Image Tabs" onClick={() => setShowDocumentTabs((value) => !value)} />
                <div className="menu-divider" />
                <MenuItem icon={<ZoomIn size={15} />} label="Zoom to Window" shortcut="Ctrl+B" onClick={() => closeAnd(() => editor.setZoom(0.8))} />
                <MenuItem label="Actual Size" shortcut="Ctrl+Shift+A" onClick={() => closeAnd(() => editor.setZoom(1))} />
                <div className="menu-divider" />
                <MenuItem icon={theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} label={theme === 'dark' ? 'Light Theme' : 'Dark Theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
              </Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Image" active={openMenu === 'image'} onClick={() => setOpenMenu(openMenu === 'image' ? null : 'image')}><ImageIcon size={iconSize} /></IconButton>
            {openMenu === 'image' && (
              <Popover align="right">
                <MenuItem icon={<Crop size={15} />} label="Crop to Selection" disabled={!editor.hasSelection} onClick={() => closeAnd(() => editor.cropToSelection())} />
                <MenuItem label="Resize Image…" onClick={() => openDialog('resize-image')} />
                <MenuItem label="Resize Canvas…" onClick={() => openDialog('resize-canvas')} />
                <MenuItem icon={<NativeToolIcon file="image-flatten-symbolic.svg" size={16} />} label="Flatten" disabled={editor.layers.length < 2} onClick={() => closeAnd(editor.flattenImage)} />
                <div className="menu-divider" />
                <MenuItem icon={<FlipHorizontal2 size={15} />} label="Flip Horizontal" onClick={() => closeAnd(() => editor.flipImage('horizontal'))} />
                <MenuItem icon={<FlipVertical2 size={15} />} label="Flip Vertical" onClick={() => closeAnd(() => editor.flipImage('vertical'))} />
                <MenuItem icon={<RotateCw size={15} />} label="Rotate 90° Clockwise" onClick={() => closeAnd(() => editor.rotateImage('clockwise'))} />
                <MenuItem label="Rotate 90° Counter-Clockwise" onClick={() => closeAnd(() => editor.rotateImage('counter-clockwise'))} />
                <MenuItem label="Rotate 180°" onClick={() => closeAnd(() => editor.rotateImage('180'))} />
              </Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Adjustments" active={openMenu === 'adjustments'} onClick={() => setOpenMenu(openMenu === 'adjustments' ? null : 'adjustments')}><SlidersHorizontal size={iconSize} /></IconButton>
            {openMenu === 'adjustments' && (
              <Popover align="right" className="effect-menu-popover">
                <MenuItem icon={<NativeToolIcon file="adjustments-autolevel-symbolic.svg" size={16} />} label="Auto Level" onClick={() => chooseEffect('auto-level')} />
                <MenuItem icon={<NativeToolIcon file="adjustments-blackandwhite-symbolic.svg" size={16} />} label="Black and White" onClick={() => chooseEffect('black-white')} />
                <MenuItem icon={<NativeToolIcon file="adjustments-brightnesscontrast-symbolic.svg" size={16} />} label="Brightness / Contrast…" onClick={() => chooseEffect('brightness-contrast')} />
                <MenuItem icon={<NativeToolIcon file="adjustments-curves-symbolic.svg" size={16} />} label="Curves…" shortcut="Ctrl+Shift+M" onClick={() => chooseEffect('curves')} />
                <MenuItem icon={<NativeToolIcon file="adjustments-huesaturation-symbolic.svg" size={16} />} label="Hue / Saturation…" onClick={() => chooseEffect('hue-saturation')} />
                <MenuItem icon={<NativeToolIcon file="adjustments-invertcolors-symbolic.svg" size={16} />} label="Invert Colors" shortcut="Ctrl+Shift+I" onClick={() => chooseEffect('invert')} />
                <MenuItem icon={<NativeToolIcon file="adjustments-levels-symbolic.svg" size={16} />} label="Levels…" shortcut="Ctrl+L" onClick={() => chooseEffect('levels')} />
                <MenuItem icon={<NativeToolIcon file="adjustments-posterize-symbolic.svg" size={16} />} label="Posterize…" onClick={() => chooseEffect('posterize')} />
                <MenuItem icon={<NativeToolIcon file="adjustments-sepia-symbolic.svg" size={16} />} label="Sepia" onClick={() => chooseEffect('sepia')} />
              </Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Effects" active={openMenu === 'effects'} onClick={() => setOpenMenu(openMenu === 'effects' ? null : 'effects')}><Sparkles size={iconSize} /></IconButton>
            {openMenu === 'effects' && (
              <Popover align="right" className="effect-menu-popover">
                <div className="menu-caption">Artistic</div>
                <MenuItem icon={<NativeToolIcon file="effects-artistic-inksketch-symbolic.svg" size={16} />} label="Ink Sketch…" onClick={() => chooseEffect('ink-sketch')} />
                <MenuItem icon={<NativeToolIcon file="effects-artistic-oilpainting-symbolic.svg" size={16} />} label="Oil Painting…" onClick={() => chooseEffect('oil-painting')} />
                <MenuItem icon={<NativeToolIcon file="effects-artistic-pencilsketch-symbolic.svg" size={16} />} label="Pencil Sketch…" onClick={() => chooseEffect('pencil-sketch')} />
                <div className="menu-caption">Blurs</div>
                <MenuItem icon={<NativeToolIcon file="effects-blurs-fragment-symbolic.svg" size={16} />} label="Fragment…" onClick={() => chooseEffect('fragment')} />
                <MenuItem icon={<NativeToolIcon file="effects-blurs-gaussianblur-symbolic.svg" size={16} />} label="Gaussian Blur…" onClick={() => chooseEffect('gaussian-blur')} />
                <MenuItem icon={<NativeToolIcon file="effects-blurs-motionblur-symbolic.svg" size={16} />} label="Motion Blur…" onClick={() => chooseEffect('motion-blur')} />
                <MenuItem icon={<NativeToolIcon file="effects-blurs-radialblur-symbolic.svg" size={16} />} label="Radial Blur…" onClick={() => chooseEffect('radial-blur')} />
                <MenuItem icon={<NativeToolIcon file="effects-blurs-unfocus-symbolic.svg" size={16} />} label="Unfocus…" onClick={() => chooseEffect('unfocus')} />
                <MenuItem icon={<NativeToolIcon file="effects-blurs-zoomblur-symbolic.svg" size={16} />} label="Zoom Blur…" onClick={() => chooseEffect('zoom-blur')} />
                <div className="menu-caption">Color</div>
                <MenuItem icon={<NativeToolIcon file="effects-color-dithering-symbolic.svg" size={16} />} label="Dithering…" onClick={() => chooseEffect('dithering')} />
                <div className="menu-caption">Distort</div>
                <MenuItem icon={<NativeToolIcon file="effects-distort-bulge-symbolic.svg" size={16} />} label="Bulge…" onClick={() => chooseEffect('bulge')} />
                <MenuItem icon={<NativeToolIcon file="effects-distort-dents-symbolic.svg" size={16} />} label="Dents…" onClick={() => chooseEffect('dents')} />
                <MenuItem icon={<NativeToolIcon file="effects-distort-frostedglass-symbolic.svg" size={16} />} label="Frosted Glass…" onClick={() => chooseEffect('frosted-glass')} />
                <MenuItem icon={<NativeToolIcon file="effects-distort-pixelate-symbolic.svg" size={16} />} label="Pixelate…" onClick={() => chooseEffect('pixelate')} />
                <MenuItem icon={<NativeToolIcon file="effects-distort-polarinversion-symbolic.svg" size={16} />} label="Polar Inversion…" onClick={() => chooseEffect('polar-inversion')} />
                <MenuItem icon={<NativeToolIcon file="effects-distort-tile-symbolic.svg" size={16} />} label="Tile Reflection…" onClick={() => chooseEffect('tile-reflection')} />
                <MenuItem icon={<NativeToolIcon file="effects-distort-twist-symbolic.svg" size={16} />} label="Twist…" onClick={() => chooseEffect('twist')} />
                <div className="menu-caption">Noise</div>
                <MenuItem icon={<NativeToolIcon file="effects-noise-addnoise-symbolic.svg" size={16} />} label="Add Noise…" onClick={() => chooseEffect('add-noise')} />
                <MenuItem icon={<NativeToolIcon file="effects-noise-median-symbolic.svg" size={16} />} label="Median…" onClick={() => chooseEffect('median')} />
                <MenuItem icon={<NativeToolIcon file="effects-noise-reducenoise-symbolic.svg" size={16} />} label="Reduce Noise…" onClick={() => chooseEffect('reduce-noise')} />
                <div className="menu-caption">Object</div>
                <MenuItem icon={<NativeToolIcon file="tool-move-symbolic.svg" size={16} />} label="Align Object…" onClick={() => chooseEffect('align-object')} />
                <MenuItem icon={<NativeToolIcon file="effects-object-featherobject-symbolic.svg" size={16} />} label="Feather Object…" onClick={() => chooseEffect('feather-object')} />
                <MenuItem icon={<NativeToolIcon file="effects-stylize-outline-symbolic.svg" size={16} />} label="Outline Object…" onClick={() => chooseEffect('outline-object')} />
                <div className="menu-caption">Photo</div>
                <MenuItem icon={<NativeToolIcon file="effects-photo-glow-symbolic.svg" size={16} />} label="Glow…" onClick={() => chooseEffect('glow')} />
                <MenuItem icon={<NativeToolIcon file="effects-photo-redeyeremove-symbolic.svg" size={16} />} label="Red Eye Removal…" onClick={() => chooseEffect('red-eye-removal')} />
                <MenuItem icon={<NativeToolIcon file="effects-photo-sharpen-symbolic.svg" size={16} />} label="Sharpen…" onClick={() => chooseEffect('sharpen')} />
                <MenuItem icon={<NativeToolIcon file="effects-photo-softenportrait-symbolic.svg" size={16} />} label="Soften Portrait…" onClick={() => chooseEffect('soften-portrait')} />
                <MenuItem icon={<NativeToolIcon file="effects-photo-vignette-symbolic.svg" size={16} />} label="Vignette…" onClick={() => chooseEffect('vignette')} />
                <div className="menu-caption">Render</div>
                <MenuItem icon={<NativeToolIcon file="effects-render-cells-symbolic.svg" size={16} />} label="Cells…" onClick={() => chooseEffect('cells')} />
                <MenuItem icon={<NativeToolIcon file="effects-render-clouds-symbolic.svg" size={16} />} label="Clouds…" onClick={() => chooseEffect('clouds')} />
                <MenuItem icon={<NativeToolIcon file="effects-render-juliafractal-symbolic.svg" size={16} />} label="Julia Fractal…" onClick={() => chooseEffect('julia-fractal')} />
                <MenuItem icon={<NativeToolIcon file="effects-render-mandelbrotfractal-symbolic.svg" size={16} />} label="Mandelbrot Fractal…" onClick={() => chooseEffect('mandelbrot-fractal')} />
                <MenuItem icon={<NativeToolIcon file="effects-default-symbolic.svg" size={16} />} label="Voronoi Diagram…" onClick={() => chooseEffect('voronoi-diagram')} />
                <div className="menu-caption">Stylize</div>
                <MenuItem icon={<NativeToolIcon file="effects-stylize-edgedetect-symbolic.svg" size={16} />} label="Edge Detect…" onClick={() => chooseEffect('edge-detect')} />
                <MenuItem icon={<NativeToolIcon file="effects-stylize-emboss-symbolic.svg" size={16} />} label="Emboss…" onClick={() => chooseEffect('emboss')} />
                <MenuItem icon={<NativeToolIcon file="effects-stylize-outline-symbolic.svg" size={16} />} label="Outline Edge…" onClick={() => chooseEffect('outline-edge')} />
                <MenuItem icon={<NativeToolIcon file="effects-stylize-relief-symbolic.svg" size={16} />} label="Relief…" onClick={() => chooseEffect('relief')} />
              </Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Main Menu" active={openMenu === 'main'} onClick={() => setOpenMenu(openMenu === 'main' ? null : 'main')}><Menu size={iconSize} /></IconButton>
            {openMenu === 'main' && (
              <Popover align="right" className="main-menu-popover">
                <MenuItem icon={<FilePlus2 size={15} />} label="New" shortcut="Ctrl+N" onClick={() => openDialog('new')} />
                <MenuItem icon={<FolderOpen size={15} />} label="Open…" shortcut="Ctrl+O" onClick={() => closeAnd(() => fileInputRef.current?.click())} />
                <MenuItem icon={<Save size={15} />} label="Save" shortcut="Ctrl+S" onClick={() => closeAnd(() => { void editor.saveImage(); })} />
                <MenuItem icon={<Save size={15} />} label="Save As…" shortcut="Ctrl+Shift+S" onClick={() => closeAnd(() => setShowSaveAs(true))} />
                <MenuItem icon={<X size={15} />} label="Close" shortcut="Ctrl+W" onClick={() => requestCloseDocument(editor.activeDocumentId)} />
                <div className="menu-divider" />
                <MenuItem icon={<Scissors size={15} />} label="Cut" shortcut="Ctrl+X" disabled={!editor.hasSelection} onClick={() => closeAnd(() => editor.cutSelection())} />
                <MenuItem icon={<Copy size={15} />} label="Copy" shortcut="Ctrl+C" disabled={!editor.hasSelection} onClick={() => closeAnd(() => editor.copySelection())} />
                <MenuItem icon={<ClipboardPaste size={15} />} label="Paste" shortcut="Ctrl+V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.paste())} />
                <MenuItem label="Select All" shortcut="Ctrl+A" onClick={() => closeAnd(editor.selectAll)} />
                <MenuItem label="Deselect" shortcut="Esc" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.deselect)} />
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
                <MenuItem label="Keyboard Shortcuts" onClick={() => notify('Use B, P, E, F, G, K, T, Z, H and X.')} />
                <MenuItem label="About Pinta Online" onClick={() => notify('Pinta Online · React Canvas preview')} />
              </Popover>
            )}
          </div>
          <span className="toolbar-separator" />
          <IconButton label={showSidebar ? 'Hide sidebar' : 'Show sidebar'} onClick={() => setShowSidebar((value) => !value)}>
            {showSidebar ? <PanelRightClose size={iconSize} /> : <PanelRightOpen size={iconSize} />}
          </IconButton>
          <IconButton label="Fullscreen" onClick={() => void toggleFullscreen()}><Maximize2 size={iconSize} /></IconButton>
        </div>
      </header>

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

          <main
            ref={viewportRef}
            className="canvas-viewport"
            onWheel={handleWheel}
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
          <div><FolderOpen size={34} /><strong>Open image in Pinta</strong><span>Drop an OpenRaster, PNG, JPEG, WebP, GIF, BMP, PPM, or TGA image</span></div>
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
      {showSaveAs && (
        <SaveAsDialog
          fileName={editor.fileName}
          onCancel={() => setShowSaveAs(false)}
          onSubmit={editor.saveImage}
        />
      )}
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
    </div>
  );
}

export default App;
