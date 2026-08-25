import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { usePaintEditor } from './editor/usePaintEditor';
import { paletteFileName, parsePalette, serializePalette, type PaletteFormat } from './editor/palette';
import {
  documentIndexShortcut,
  focusedEditorOwnsShortcut,
  isEditableTarget,
  nextToolForShortcut,
  resolvePintaShortcut,
} from './editor/shortcuts';
import { TOOL_BY_ID, TOOLS } from './editor/tools';
import type { CanvasAnchor, SelectionMode, ShapeDashStyle, ShapeFillStyle, TextAlignment, TextStyle, TextVariant } from './editor/usePaintEditor';
import { BLEND_MODES, type BlendMode, type ExportFormat, type PaintLayer, type ToolId } from './editor/types';
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
import { aboutPathForLocale, changeLocale, currentLocale, SUPPORTED_LOCALES, translateDocumentName, translateUi, type LocaleCode } from './i18n';
import { ADDIN_DEFINITIONS, isAddinEnabled, type AddinId } from './addins/registry';
import { ColorPickerDialog } from './components/ColorPickerDialog';

type MenuName = 'pinta' | 'file' | 'edit' | 'view' | 'image' | 'adjustments' | 'effects' | 'addins' | 'window' | 'help' | 'main' | null;
type DialogName = 'new' | 'resize-image' | 'resize-canvas' | null;

const WEB_REPOSITORY_URL = 'https://github.com/evgenyvinnik/pinta-online';
const WEB_BUG_REPORT_URL = `${WEB_REPOSITORY_URL}/issues/new?template=bug.md`;
const USER_GUIDE_URL = '/user-guide/';

const TOOL_CURSORS: Partial<Record<ToolId, string>> = {
  'rectangle-select': "url('/cursors/Cursor.RectangleSelect.png') 9 18, crosshair",
  'ellipse-select': "url('/cursors/Cursor.EllipseSelect.png') 9 18, crosshair",
  'lasso-select': "url('/cursors/Cursor.LassoSelect.png') 9 18, crosshair",
  'magic-wand': "url('/cursors/Cursor.MagicWand.png') 21 10, crosshair",
  paintbrush: "url('/cursors/Cursor.Paintbrush.png') 8 24, crosshair",
  'block-brush': "url('/cursors/Cursor.Paintbrush.png') 8 24, crosshair",
  pencil: "url('/cursors/Cursor.Pencil.png') 7 24, crosshair",
  eraser: "url('/cursors/Cursor.Eraser.png') 8 22, crosshair",
  'paint-bucket': "url('/cursors/Cursor.PaintBucket.png') 21 21, crosshair",
  gradient: "url('/cursors/Cursor.Gradient.png') 9 18, crosshair",
  'color-picker': "url('/cursors/Cursor.ColorPicker.png') 7 27, crosshair",
  line: "url('/cursors/Cursor.Line.png') 9 18, crosshair",
  rectangle: "url('/cursors/Cursor.Rectangle.png') 9 18, crosshair",
  'rounded-rectangle': "url('/cursors/Cursor.RoundedRectangle.png') 9 18, crosshair",
  ellipse: "url('/cursors/Cursor.Ellipse.png') 9 18, crosshair",
  freeform: "url('/cursors/Cursor.FreeformShape.png') 9 18, crosshair",
  'clone-stamp': "url('/cursors/Cursor.CloneStamp.png') 16 26, crosshair",
  recolor: "url('/cursors/Cursor.Recolor.png') 9 18, crosshair",
};

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
  const translatedLabel = translateUi(label);
  return (
    <button
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      aria-label={translatedLabel}
      title={translatedLabel}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      {children}
    </button>
  );
}

function PintaIcon({ file, size = 22, standard = false, className = '' }: { file: string; size?: number; standard?: boolean; className?: string }) {
  return <img className={`pinta-icon ${className}`} src={`/${standard ? 'standard-icons' : 'actions'}/${file}`} width={size} height={size} alt="" draggable={false} />;
}

function BusySpinner({ size = 15 }: { size?: number }) {
  return <span className="busy-spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

function SwapColorsIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.2 10.7c0-5.6-2.1-7.9-7.8-7.9" />
      <path d="m8 1-2.7 1.8L8 4.7" />
      <path d="M2.8 5.3c0 5.6 2.1 7.9 7.8 7.9" />
      <path d="m8 15 2.7-1.8L8 11.3" />
    </svg>
  );
}

function ResetColorsIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2" width="7" height="7" />
      <rect className="filled" x="7" y="7" width="7" height="7" />
    </svg>
  );
}

function ToolbarStepper({ label, value, min, max, onChange, className = '' }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; className?: string }) {
  const update = (next: number) => onChange(Math.max(min, Math.min(max, Math.round(next))));
  const translatedLabel = translateUi(label);
  return (
    <span className={`native-toolbar-stepper ${className}`}>
      <input aria-label={translatedLabel} type="number" min={min} max={max} value={value} onChange={(event) => update(Number(event.target.value))} />
      <button type="button" aria-label={`${translateUi('Decrease')} ${translatedLabel}`} onClick={() => update(value - 1)}><PintaIcon file="value-decrease-symbolic.svg" size={13} standard /></button>
      <button type="button" aria-label={`${translateUi('Increase')} ${translatedLabel}`} onClick={() => update(value + 1)}><PintaIcon file="value-increase-symbolic.svg" size={13} standard /></button>
    </span>
  );
}

function DialogStepper({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  autoFocus = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (value: number) => void;
}) {
  const update = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return (
    <span className="native-dialog-stepper" dir="ltr">
      <input
        aria-label={label}
        autoFocus={autoFocus}
        disabled={disabled}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => update(Number(event.target.value))}
      />
      <button type="button" disabled={disabled || value <= min} aria-label={`${translateUi('Decrease')} ${translateUi(label)}`} onClick={() => update(value - step)}><PintaIcon file="value-decrease-symbolic.svg" size={12} standard /></button>
      <button type="button" disabled={disabled || value >= max} aria-label={`${translateUi('Increase')} ${translateUi(label)}`} onClick={() => update(value + step)}><PintaIcon file="value-increase-symbolic.svg" size={12} standard /></button>
    </span>
  );
}

function DialogResetButton({ label, disabled = false, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button className="native-reset-button" type="button" disabled={disabled} aria-label={label} title={label} onClick={onClick}>
      <PintaIcon file="edit-undo-symbolic.svg" size={16} standard />
    </button>
  );
}

function DialogActions({
  onCancel,
  submitLabel = 'OK',
  disabled = false,
  children,
}: {
  onCancel: () => void;
  submitLabel?: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <footer className="native-dialog-actions compact-dialog-actions">
      {children}
      <span className="native-dialog-actions-spacer" />
      <button type="button" className="native-dialog-button" disabled={disabled} onClick={onCancel}>{translateUi('Cancel')}</button>
      <button type="submit" className="native-dialog-button suggested" disabled={disabled}>{translateUi(submitLabel)}</button>
    </footer>
  );
}

function AngleDial({ value, min = -180, max = 180, disabled = false, onChange }: { value: number; min?: number; max?: number; disabled?: boolean; onChange?: (value: number) => void }) {
  const updateFromPointer = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!onChange || disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    let next = Math.atan2(event.clientY - bounds.top - bounds.height / 2, event.clientX - bounds.left - bounds.width / 2) * 180 / Math.PI + 90;
    if (min < 0 && next > 180) next -= 360;
    if (min >= 0 && next < 0) next += 360;
    onChange(Math.max(min, Math.min(max, Math.round(next))));
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!onChange || disabled || !['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    onChange(Math.max(min, Math.min(max, value + (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1))));
  };
  return <span className="native-angle-dial" style={{ '--dial-angle': `${value - 90}deg` } as CSSProperties} role="slider" aria-label="Angle dial" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-disabled={disabled} tabIndex={onChange && !disabled ? 0 : -1} onKeyDown={onKeyDown} onPointerDown={(event) => { if (onChange && !disabled) event.currentTarget.setPointerCapture(event.pointerId); updateFromPointer(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event); }}><i /></span>;
}

function PointPad({ x, y, minX, maxX, minY, maxY, disabled = false, onChange }: { x: number; y: number; minX: number; maxX: number; minY: number; maxY: number; disabled?: boolean; onChange?: (x: number, y: number) => void }) {
  const left = (x - minX) / Math.max(1e-9, maxX - minX) * 100;
  const top = (y - minY) / Math.max(1e-9, maxY - minY) * 100;
  const updateFromPointer = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!onChange || disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextX = minX + Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * (maxX - minX);
    const nextY = minY + Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) * (maxY - minY);
    onChange(Number(nextX.toFixed(2)), Number(nextY.toFixed(2)));
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!onChange || disabled || !['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const stepX = (maxX - minX) / 100;
    const stepY = (maxY - minY) / 100;
    onChange(
      Math.max(minX, Math.min(maxX, x + (event.key === 'ArrowRight' ? stepX : event.key === 'ArrowLeft' ? -stepX : 0))),
      Math.max(minY, Math.min(maxY, y + (event.key === 'ArrowDown' ? stepY : event.key === 'ArrowUp' ? -stepY : 0))),
    );
  };
  return <span className="native-point-pad" role="application" aria-label={`Point picker, X ${x}, Y ${y}`} aria-disabled={disabled} tabIndex={onChange && !disabled ? 0 : -1} onKeyDown={onKeyDown} onPointerDown={(event) => { if (onChange && !disabled) event.currentTarget.setPointerCapture(event.pointerId); updateFromPointer(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event); }}><i style={{ left: `${left}%`, top: `${top}%` }} /></span>;
}

interface ToolbarIconOption {
  value: string;
  label: string;
  icon: string;
}

function ToolbarIconSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly ToolbarIconOption[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const selected = options.find((option) => option.value === value) ?? options[0];
  const translatedLabel = translateUi(label);
  return (
    <div className={`native-toolbar-icon-select ${open ? 'open' : ''}`} title={`${translatedLabel}: ${translateUi(selected.label)}`} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>
      <button type="button" aria-label={`${translateUi('Choose')} ${translateUi(selected.label)}`} aria-haspopup="listbox" aria-expanded={open} onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        setPopoverPosition({ top: bounds.bottom + 6, left: Math.max(8, Math.min(bounds.left, window.innerWidth - 288)) });
        setOpen((current) => !current);
      }}>
        <PintaIcon file={selected.icon} size={18} />
        <span className="native-select-chevron" aria-hidden="true">⌄</span>
      </button>
      <select aria-label={translatedLabel} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{translateUi(option.label)}</option>)}
      </select>
      {open && (
        <div className="native-toolbar-option-popover" role="listbox" aria-label={`${translatedLabel} choices`} style={popoverPosition}>
          {options.map((option) => (
            <button key={option.value} type="button" role="option" aria-selected={option.value === value} onClick={() => { onChange(option.value); setOpen(false); }}>
              <span className="native-toolbar-option-check">{option.value === value && <span className="native-checkmark" />}</span>
              <PintaIcon file={option.icon} size={18} />
              <span>{translateUi(option.label)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ANTIALIAS_OPTIONS = [
  { value: 'on', label: 'Antialiasing On', icon: 'tool-antialiasing-enabled-symbolic.svg' },
  { value: 'off', label: 'Antialiasing Off', icon: 'tool-antialiasing-disabled-symbolic.svg' },
] as const;

const BLENDING_OPTIONS = [
  { value: 'normal', label: 'Normal Blending', icon: 'tool-blending-normal-symbolic.svg' },
  { value: 'overwrite', label: 'Overwrite', icon: 'tool-blending-overwrite-symbolic.svg' },
] as const;

const FILL_STYLE_OPTIONS = [
  { value: 'outline', label: 'Outline Shape', icon: 'tool-fillstyle-outline-symbolic.svg' },
  { value: 'fill', label: 'Fill Shape', icon: 'tool-fillstyle-fill-symbolic.svg' },
  { value: 'fill-outline', label: 'Fill and Outline Shape', icon: 'tool-fillstyle-outlinefill-symbolic.svg' },
] as const;

function NativeToolOptions({ editor, currentTool, blockBrushEnabled }: { editor: ReturnType<typeof usePaintEditor>; currentTool: (typeof TOOLS)[number]; blockBrushEnabled: boolean }) {
  const antialias = <ToolbarIconSelect label="Antialiasing" value={editor.shapeAntialiasing ? 'on' : 'off'} options={ANTIALIAS_OPTIONS} onChange={(value) => editor.setShapeAntialiasing(value === 'on')} />;
  const selectionMode = (
    <select className="native-toolbar-select selection-mode-select" value={editor.selectionMode} onChange={(event) => editor.setSelectionMode(event.target.value as SelectionMode)} aria-label="Selection mode" title="Temporary modes: Ctrl/Command adds, right drag excludes, Ctrl/Command + right drag toggles, Alt/Option intersects">
      {SELECTION_MODE_OPTIONS.map((mode) => <option key={mode.value} value={mode.value} title={mode.hint}>{mode.label}</option>)}
    </select>
  );
  const fillStyle = <ToolbarIconSelect label="Fill style" value={editor.shapeFillStyle} options={FILL_STYLE_OPTIONS} onChange={(value) => editor.setShapeFillStyle(value as ShapeFillStyle)} />;
  const dash = (
    <><input className="native-toolbar-select dash-option-select" list="pinta-dash-patterns" value={editor.shapeDashStyle} onChange={(event) => editor.setShapeDashStyle(event.target.value as ShapeDashStyle)} aria-label="Dash pattern" /><datalist id="pinta-dash-patterns">{['-', ' -', ' --', ' ---', '  -', '   -', ' - --', ' - - --------', ' - - ---- - ----'].map((pattern) => <option key={pattern} value={pattern} />)}</datalist></>
  );
  const blend = <ToolbarIconSelect label="Blending" value={editor.alphaBlendingMode} options={BLENDING_OPTIONS} onChange={(value) => editor.setAlphaBlendingMode(value as typeof editor.alphaBlendingMode)} />;
  const shapeTool = ['line', 'rectangle', 'rounded-rectangle', 'ellipse'].includes(editor.tool);

  return (
    <div className="tool-options-bar">
      <span className="tool-label">{translateUi('Tool:')}</span>
      <PintaIcon file={currentTool.icon} size={19} />

      {['paintbrush', 'block-brush', 'eraser', 'recolor', 'clone-stamp'].includes(editor.tool) && <>
        <span className="option-label">{translateUi('Brush width:')}</span>
        <ToolbarStepper label="Brush width" value={editor.brushSize} min={1} max={100000} onChange={editor.setBrushSize} />
        {editor.tool === 'paintbrush' && <>
          <span className="option-label">{translateUi('Type:')}</span>
          <select className="native-toolbar-select" aria-label={translateUi('Paintbrush type')} value={editor.paintBrushType} onChange={(event) => editor.setPaintBrushType(event.target.value as typeof editor.paintBrushType)}>
            <option value="normal">{translateUi('Normal')}</option>{blockBrushEnabled && <option value="block">{translateUi('Block')}</option>}<option value="circles">{translateUi('Circles')}</option><option value="grid">{translateUi('Grid')}</option><option value="slash">{translateUi('Slash')}</option><option value="splatter">{translateUi('Splatter')}</option><option value="squares">{translateUi('Squares')}</option>
          </select>
          {editor.paintBrushType === 'slash' && <><span className="option-label">Angle:</span><ToolbarStepper label="Slash angle" value={editor.slashBrushAngle} min={0} max={180} onChange={editor.setSlashBrushAngle} /></>}
          {editor.paintBrushType === 'splatter' && <><span className="option-label">Minimum Size:</span><ToolbarStepper label="Splatter minimum size" value={editor.splatterMinimumSize} min={1} max={10000} onChange={editor.setSplatterMinimumSize} /><span className="option-label">Maximum Size:</span><ToolbarStepper label="Splatter maximum size" value={editor.splatterMaximumSize} min={1} max={10000} onChange={editor.setSplatterMaximumSize} /></>}
        </>}
        {editor.tool === 'eraser' && <>
          <span className="option-label">Type:</span>
          <select className="native-toolbar-select" aria-label="Eraser type" value={editor.eraserType} onChange={(event) => editor.setEraserType(event.target.value as typeof editor.eraserType)}><option value="normal">Normal</option><option value="smooth">Smooth</option></select>
        </>}
        {editor.tool === 'recolor' && <>
          <span className="option-label">Tolerance:</span><output className="native-toolbar-value">{editor.recolorTolerance}</output>
          <input className="tool-option-slider compact" type="range" min="0" max="100" value={editor.recolorTolerance} onChange={(event) => editor.setRecolorTolerance(Number(event.target.value))} aria-label="Recolor tolerance" />
        </>}
        {antialias}
      </>}

      {editor.tool === 'pencil' && blend}

      {['paint-bucket', 'magic-wand'].includes(editor.tool) && <>
        <span className="option-label">Flood Mode:</span>
        <ToolbarIconSelect label="Flood Mode" value={editor.floodMode} options={[
          { value: 'contiguous', label: 'Contiguous', icon: 'tool-freeformshape-symbolic.svg' },
          { value: 'global', label: 'Global', icon: 'help-website-symbolic.svg' },
        ]} onChange={(value) => editor.setFloodMode(value as typeof editor.floodMode)} />
        <span className="option-label">Tolerance:</span>
        <input className="tool-option-slider compact" type="range" min="0" max="100" value={editor.tool === 'magic-wand' ? editor.magicWandTolerance : editor.paintBucketTolerance} onChange={(event) => editor.tool === 'magic-wand' ? editor.setMagicWandTolerance(Number(event.target.value)) : editor.setPaintBucketTolerance(Number(event.target.value))} aria-label="Tolerance" />
        {editor.tool === 'magic-wand' && <><span className="option-label">Selection Mode:</span>{selectionMode}</>}
      </>}

      {['rectangle-select', 'ellipse-select', 'lasso-select'].includes(editor.tool) && <>
        <span className="option-label">Selection Mode:</span>{selectionMode}
        {editor.tool === 'lasso-select' ? <>
          <span className="option-label">Lasso Mode:</span>
          <ToolbarIconSelect label="Lasso Mode" value={editor.lassoMode} options={[
            { value: 'freeform', label: 'Freeform', icon: 'tool-select-lasso-freeform-symbolic.svg' },
            { value: 'polygon', label: 'Polygon', icon: 'tool-select-lasso-polygon-symbolic.svg' },
          ]} onChange={(value) => editor.setLassoMode(value as typeof editor.lassoMode)} />
        </> : <ToolbarIconSelect label="Auto-scroll" value={editor.selectionAutoScroll ? 'on' : 'off'} options={[
          { value: 'on', label: 'Auto-scroll Enabled', icon: 'tool-move-selection-symbolic.svg' },
          { value: 'off', label: 'Auto-scroll Disabled', icon: 'tool-select-rectangle-symbolic.svg' },
        ]} onChange={(value) => editor.setSelectionAutoScroll(value === 'on')} />}
      </>}

      {shapeTool && <>
        <span className="option-label">Shape Type:</span>
        <ToolbarIconSelect label="Shape type" value={editor.tool} options={[
          { value: 'line', label: 'Line / Curve', icon: 'tool-linecurve-symbolic.svg' },
          { value: 'rectangle', label: 'Rectangle', icon: 'tool-rectangle-symbolic.svg' },
          { value: 'rounded-rectangle', label: 'Rounded Rectangle', icon: 'tool-roundedrectangle-symbolic.svg' },
          { value: 'ellipse', label: 'Ellipse', icon: 'tool-ellipse-symbolic.svg' },
        ]} onChange={(value) => editor.setTool(value as typeof editor.tool)} />
        {editor.tool === 'rounded-rectangle' && <><span className="option-label">Radius:</span><ToolbarStepper label="Radius" value={editor.roundedRectangleRadius} min={0} max={100000} onChange={editor.setRoundedRectangleRadius} /></>}
        <span className="option-label">Fill Style:</span>{fillStyle}
        {editor.shapeFillStyle !== 'fill' && <><span className="option-label">Outline width:</span><ToolbarStepper label="Outline width" value={editor.brushSize} min={1} max={100000} onChange={editor.setBrushSize} /><span className="option-label">Dash:</span>{dash}</>}
        {editor.tool === 'line' && <><span className="option-label">Arrow:</span><label className="native-toolbar-check"><input aria-label="Start arrow" type="checkbox" checked={editor.lineArrowStart} onChange={(event) => editor.setLineArrowStart(event.target.checked)} />1</label><label className="native-toolbar-check"><input aria-label="End arrow" type="checkbox" checked={editor.lineArrowEnd} onChange={(event) => editor.setLineArrowEnd(event.target.checked)} />2</label>{(editor.lineArrowStart || editor.lineArrowEnd) && <><span className="option-label">Size:</span><ToolbarStepper label="Arrow size" value={editor.lineArrowSize} min={1} max={100} onChange={editor.setLineArrowSize} /><span className="option-label">Angle:</span><ToolbarStepper label="Arrow angle" value={editor.lineArrowAngle} min={-89} max={89} onChange={editor.setLineArrowAngle} /><span className="option-label">Length:</span><ToolbarStepper label="Arrow length" value={editor.lineArrowLength} min={-100} max={100} onChange={editor.setLineArrowLength} /></>}</>}
        {antialias}
      </>}

      {editor.tool === 'freeform' && <>
        <span className="option-label">Fill Style:</span>{fillStyle}
        {editor.shapeFillStyle !== 'fill' && <><span className="option-label">Brush width:</span><ToolbarStepper label="Brush width" value={editor.brushSize} min={1} max={100000} onChange={editor.setBrushSize} /><span className="option-label">Dash:</span>{dash}</>}
        {antialias}
      </>}

      {editor.tool === 'gradient' && <>
        <span className="option-label">Gradient:</span>
        <ToolbarIconSelect label="Gradient" value={editor.gradientType} options={[
          { value: 'linear', label: 'Linear Gradient', icon: 'tool-gradient-linear-symbolic.svg' },
          { value: 'reflected', label: 'Linear Reflected Gradient', icon: 'tool-gradient-linear-reflected-symbolic.svg' },
          { value: 'diamond', label: 'Linear Diamond Gradient', icon: 'tool-gradient-diamond-symbolic.svg' },
          { value: 'radial', label: 'Radial Gradient', icon: 'tool-gradient-radial-symbolic.svg' },
          { value: 'conical', label: 'Conical Gradient', icon: 'tool-gradient-conical-symbolic.svg' },
        ]} onChange={(value) => editor.setGradientType(value as typeof editor.gradientType)} />
        <span className="option-label">Mode:</span>
        <ToolbarIconSelect label="Gradient mode" value={editor.gradientColorMode} options={[
          { value: 'color', label: 'Color Mode', icon: 'tool-gradient-colormode-color-symbolic.svg' },
          { value: 'transparency', label: 'Transparency Mode', icon: 'tool-gradient-colormode-transparency-symbolic.svg' },
        ]} onChange={(value) => editor.setGradientColorMode(value as typeof editor.gradientColorMode)} />
        {blend}
      </>}

      {editor.tool === 'color-picker' && <>
        <span className="option-label">Sampling:</span>
        <select className="native-toolbar-select" aria-label="Sampling size" value={editor.colorPickerSampleSize} onChange={(event) => editor.setColorPickerSampleSize(Number(event.target.value))}><option value="1">Single Pixel</option><option value="3">3 x 3 Region</option><option value="5">5 x 5 Region</option><option value="7">7 x 7 Region</option><option value="9">9 x 9 Region</option></select>
        <ToolbarIconSelect label="Sample source" value={editor.colorPickerSampleType} options={[
          { value: 'layer', label: 'Layer', icon: 'layer-merge-down-symbolic.svg' },
          { value: 'image', label: 'Image', icon: 'image-resize-canvas-base-symbolic.svg' },
        ]} onChange={(value) => editor.setColorPickerSampleType(value as typeof editor.colorPickerSampleType)} />
        <span className="option-label">After select:</span>
        <select className="native-toolbar-select after-select-control" aria-label="After select" value={editor.colorPickerAfterSelect} onChange={(event) => editor.setColorPickerAfterSelect(event.target.value as typeof editor.colorPickerAfterSelect)}><option value="none">Do not switch tool</option><option value="previous">Switch to previous tool</option><option value="pencil">Switch to Pencil tool</option></select>
      </>}

      {editor.tool === 'text' && <>
        <span className="option-label">Font:</span>
        <input className="native-toolbar-select font-family-select" list="pinta-font-families" value={editor.textFontFamily} onChange={(event) => editor.setTextFontFamily(event.target.value)} aria-label="Font family" /><datalist id="pinta-font-families">{['Adwaita Sans', 'Arial', 'Arial Black', 'Avenir Next', 'Baskerville', 'Brush Script MT', 'Charter', 'Courier New', 'Futura', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Impact', 'Menlo', 'Monaco', 'Noto Sans', 'Palatino', 'Sans', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'].map((font) => <option key={font} value={font} />)}</datalist>
        <ToolbarIconSelect label="Font variant" value={editor.textVariant} options={[
          { value: 'normal', label: 'Normal', icon: 'text-variant-normal-symbolic.svg' },
          { value: 'small-caps', label: 'Small Caps', icon: 'text-variant-small-caps-symbolic.svg' },
          { value: 'all-small-caps', label: 'All Small Caps', icon: 'text-variant-all-small-caps-symbolic.svg' },
          { value: 'petite-caps', label: 'Petite Caps', icon: 'text-variant-petite-caps-symbolic.svg' },
          { value: 'all-petite-caps', label: 'All Petite Caps', icon: 'text-variant-all-petite-caps-symbolic.svg' },
          { value: 'unicase', label: 'Unicase', icon: 'text-variant-unicase-symbolic.svg' },
          { value: 'title-caps', label: 'Title Caps', icon: 'text-variant-title-caps-symbolic.svg' },
        ]} onChange={(value) => editor.setTextVariant(value as TextVariant)} />
        <ToolbarStepper className="font-size-stepper" label="Font size" value={editor.textFontSize} min={1} max={2000} onChange={editor.setTextFontSize} />
        <ToolbarIconSelect label="Font weight" value={String(editor.textFontWeight)} options={[
          { value: '100', label: 'Thin 100', icon: 'text-extra-light-symbolic.svg' },
          { value: '200', label: 'Ultralight 200', icon: 'text-extra-light-symbolic.svg' },
          { value: '300', label: 'Light 300', icon: 'text-light-symbolic.svg' },
          { value: '350', label: 'Semilight 350', icon: 'text-light-symbolic.svg' },
          { value: '380', label: 'Book 380', icon: 'text-normal-symbolic.svg' },
          { value: '400', label: 'Normal 400', icon: 'text-normal-symbolic.svg' },
          { value: '500', label: 'Medium 500', icon: 'text-normal-symbolic.svg' },
          { value: '600', label: 'Semibold 600', icon: 'text-bold-symbolic.svg' },
          { value: '700', label: 'Bold 700', icon: 'text-bold-symbolic.svg' },
          { value: '800', label: 'Ultrabold 800', icon: 'text-extra-bold-symbolic.svg' },
          { value: '900', label: 'Heavy 900', icon: 'text-extra-bold-symbolic.svg' },
          { value: '1000', label: 'Ultraheavy 1000', icon: 'text-extra-bold-symbolic.svg' },
        ]} onChange={(value) => editor.setTextFontWeight(Number(value))} />
        <button className={`text-format-button ${editor.textItalic ? 'active' : ''}`} type="button" aria-label="Italic" onClick={() => editor.setTextItalic(!editor.textItalic)}><PintaIcon file="format-text-italic-symbolic.svg" size={15} standard /></button>
        <button className={`text-format-button ${editor.textUnderline ? 'active' : ''}`} type="button" aria-label="Underline" onClick={() => editor.setTextUnderline(!editor.textUnderline)}><PintaIcon file="format-text-underline-symbolic.svg" size={15} standard /></button>
        {([['left', 'format-justify-left-symbolic.svg', 'Left align'], ['center', 'format-justify-center-symbolic.svg', 'Center align'], ['right', 'format-justify-right-symbolic.svg', 'Right align']] as const).map(([alignment, icon, label]) => <button key={alignment} className={`text-format-button ${editor.textAlignment === alignment ? 'active' : ''}`} type="button" aria-label={label} onClick={() => editor.setTextAlignment(alignment as TextAlignment)}><PintaIcon file={icon} size={15} standard /></button>)}
        <span className="option-label">Text Style:</span>
        <ToolbarIconSelect label="Text style" value={editor.textStyle} options={[
          { value: 'fill', label: 'Normal', icon: 'tool-fillstyle-fill-symbolic.svg' },
          { value: 'fill-outline', label: 'Normal and Outline', icon: 'tool-fillstyle-outlinefill-symbolic.svg' },
          { value: 'outline', label: 'Outline', icon: 'tool-fillstyle-outline-symbolic.svg' },
          { value: 'background', label: 'Fill Background', icon: 'tool-fillstyle-background-symbolic.svg' },
        ]} onChange={(value) => editor.setTextStyle(value as TextStyle)} />
        {(editor.textStyle === 'fill-outline' || editor.textStyle === 'outline') && <><span className="option-label">Outline width:</span><ToolbarStepper label="Text outline width" value={editor.textOutlineWidth} min={1} max={100000} onChange={editor.setTextOutlineWidth} /><span className="option-label">Join:</span><select className="native-toolbar-select" value={editor.textLineJoin} onChange={(event) => editor.setTextLineJoin(event.target.value as CanvasLineJoin)} aria-label="Text outline join"><option value="miter">Miter Join</option><option value="round">Round Join</option><option value="bevel">Bevel Join</option></select></>}
        {antialias}
      </>}
    </div>
  );
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
  const translatedLabel = translateUi(label);
  return (
    <button
      className="menu-item"
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked === undefined ? undefined : checked}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu-check">{checked ? <span className="native-checkmark" aria-hidden="true" /> : icon}</span>
      <span>{translatedLabel}</span>
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
  const translatedLabel = translateUi(label);
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
        <span>{translatedLabel}</span>
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
  onSubmit: (width: number, height: number, anchor: CanvasAnchor, background: 'white' | 'secondary' | 'transparent', resampling: string) => void;
}

const ANCHORS: CanvasAnchor[] = [
  'north-west', 'north', 'north-east',
  'west', 'center', 'east',
  'south-west', 'south', 'south-east',
];

const SELECTION_MODE_OPTIONS: Array<{ value: SelectionMode; label: string; hint: string }> = [
  { value: 'replace', label: 'Replace', hint: 'Left drag' },
  { value: 'union', label: 'Union (+)', hint: 'Control or Command + left drag' },
  { value: 'exclude', label: 'Exclude (−)', hint: 'Right drag' },
  { value: 'xor', label: 'Xor', hint: 'Control or Command + right drag' },
  { value: 'intersect', label: 'Intersect', hint: 'Alt or Option + left drag' },
];

function ImageSizeDialog({ mode, currentWidth, currentHeight, secondaryColor, onCancel, onSubmit }: ImageSizeDialogProps) {
  const initialWidth = mode === 'new' ? 800 : currentWidth;
  const initialHeight = mode === 'new' ? 600 : currentHeight;
  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);
  const [preserveAspect, setPreserveAspect] = useState(mode === 'resize-image');
  const [anchor, setAnchor] = useState<CanvasAnchor>('center');
  const [preset, setPreset] = useState(mode === 'new' ? '800 x 600' : 'Custom');
  const [background, setBackground] = useState<'white' | 'secondary' | 'transparent'>('white');
  const [sizeMode, setSizeMode] = useState<'percentage' | 'absolute'>('percentage');
  const [percentage, setPercentage] = useState(100);
  const [resampling, setResampling] = useState('bilinear');
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
          <h2 className="visually-hidden" id="image-size-title">New Image</h2>
          <div className="native-new-image-content">
            <section className="native-new-image-options" aria-label="Image options">
              <label className="native-dialog-row native-preset-row">
                <span>Preset:</span>
                <select aria-label="Preset" value={preset} onChange={(event) => {
                  const value = event.target.value;
                  setPreset(value);
                  if (value !== 'Custom') {
                    const [presetWidth, presetHeight] = value.split(/\s+[x×]\s+/).map(Number);
                    setWidth(presetWidth);
                    setHeight(presetHeight);
                  }
                }}>
                  <option>Custom</option>
                  <option>640 x 480</option>
                  <option>800 x 600</option>
                  <option>1024 x 768</option>
                  <option>1600 x 1200</option>
                </select>
              </label>
              <label className="native-dialog-row native-dimension-row">
                <span>Width:</span>
                <input aria-label="Width" type="number" min="1" max="16384" value={width} autoFocus onChange={(event) => updateWidth(Number(event.target.value))} />
                <i>pixels</i>
              </label>
              <label className="native-dialog-row native-dimension-row">
                <span>Height:</span>
                <input aria-label="Height" type="number" min="1" max="16384" value={height} onChange={(event) => updateHeight(Number(event.target.value))} />
                <i>pixels</i>
              </label>
              <fieldset className="native-choice-group native-orientation-group">
                <legend>Orientation:</legend>
                <label>
                  <PintaIcon file="image-orientation-portrait-symbolic.svg" size={16} />
                  <input type="radio" name="orientation" checked={height > width} onChange={() => {
                    if (width > height) {
                      setWidth(height);
                      setHeight(width);
                      setPreset('Custom');
                    }
                  }} />
                  <span>Portrait</span>
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
                  <span>Landscape</span>
                </label>
              </fieldset>
              <fieldset className="native-choice-group native-background-group">
                <legend>Background:</legend>
                <label><i className="native-color-swatch" style={{ background: '#ffffff' }} /><input type="radio" name="background" checked={background === 'white'} onChange={() => setBackground('white')} /><span>White</span></label>
                {secondaryColor.toLowerCase() !== '#ffffff' && (
                  <label><i className="native-color-swatch" style={{ background: secondaryColor }} /><input type="radio" name="background" checked={background === 'secondary'} onChange={() => setBackground('secondary')} /><span>Background Color</span></label>
                )}
                <label><i className="native-color-swatch checkerboard" /><input type="radio" name="background" checked={background === 'transparent'} onChange={() => setBackground('transparent')} /><span>Transparent</span></label>
              </fieldset>
            </section>
            <section className="native-new-image-preview-wrap" aria-label="Preview">
              <span>Preview</span>
              <div className={`native-new-image-preview ${background === 'transparent' ? 'checkerboard' : ''}`} style={{ aspectRatio: `${width} / ${height}`, backgroundColor: background === 'transparent' ? undefined : previewBackground }} />
            </section>
          </div>
          <footer className="native-dialog-actions">
            <button type="button" className="native-dialog-button" onClick={onCancel}>Cancel</button>
            <button type="submit" className="native-dialog-button suggested">OK</button>
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
        onSubmit(width, height, anchor, background, resampling);
      }}>
        <h2 className="visually-hidden" id="image-size-title">{title}</h2>
        <div className="native-resize-content">
          <label className="native-radio-row percentage-row">
            <input type="radio" name="size-mode" checked={sizeMode === 'percentage'} onChange={() => setSizeMode('percentage')} />
            <span>By percentage:</span>
            <DialogStepper label="Percentage" min={1} max={10000} value={percentage} onChange={updatePercentage} disabled={sizeMode !== 'percentage'} />
            <i>%</i>
          </label>
          <label className="native-radio-row absolute-row">
            <input type="radio" name="size-mode" checked={sizeMode === 'absolute'} onChange={() => setSizeMode('absolute')} />
            <span>By absolute size:</span>
          </label>
          <div className="native-size-grid">
            <span>Width:</span>
            <DialogStepper label="Width" min={1} max={16384} value={width} onChange={updateWidth} disabled={sizeMode !== 'absolute'} />
            <i>pixels</i>
            <DialogResetButton label="Reset to image size" disabled={sizeMode !== 'absolute'} onClick={() => {
              setWidth(initialWidth);
              setHeight(initialHeight);
              setPercentage(100);
            }} />
            <span>Height:</span>
            <DialogStepper label="Height" min={1} max={16384} value={height} onChange={updateHeight} disabled={sizeMode !== 'absolute'} />
            <i>pixels</i>
          </div>
          <label className="native-check-row"><input type="checkbox" checked={preserveAspect} disabled={sizeMode !== 'absolute'} onChange={(event) => setPreserveAspect(event.target.checked)} /><span>Maintain aspect ratio</span></label>
          {mode === 'resize-image' && (
            <label className="native-resampling-row">
              <span>Resampling:</span>
              <select value={resampling} onChange={(event) => setResampling(event.target.value)} aria-label="Resampling">
                <option value="nearest">Nearest Neighbor</option>
                <option value="bilinear">Bilinear</option>
                <option value="bicubic">Bicubic</option>
              </select>
            </label>
          )}
          {mode === 'resize-canvas' && (
            <div className="native-anchor-section">
              <span>Anchor:</span>
              <div className="native-anchor-picker">
                {ANCHORS.map((item) => (
                  <button key={item} type="button" aria-label={`${item} anchor`} aria-pressed={anchor === item} onClick={() => setAnchor(item)}>
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

interface EffectDialogProps {
  effect: EffectDefinition;
  busy: boolean;
  onCancel: () => void;
  onPreview: (parameters: EffectParameters) => Promise<boolean>;
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

interface LevelsEditorProps extends CurvesEditorProps {
  activeChannels: Record<LevelChannel, boolean>;
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

function LevelsEditor({ parameters, disabled, onChange, activeChannels }: LevelsEditorProps) {
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
  const inputLow = displayedValue('inputLow');
  const inputHigh = displayedValue('inputHigh');
  const outputLow = displayedValue('outputLow');
  const outputHigh = displayedValue('outputHigh');
  const gamma = displayedValue('gamma');

  return (
    <div className="levels-editor">
      <div className="levels-native-grid">
        <section className="levels-histogram-block">
          <strong>Input Histogram</strong>
          <div className="levels-histogram" aria-hidden="true" />
        </section>
        <section className="levels-control-column levels-input-controls">
          <strong>Input</strong>
          <DialogStepper label="Input high value" min={1} max={255} value={inputHigh} disabled={disabled || !selectedChannels.length} onChange={(value) => updateControl('inputHigh', value)} />
          <span className="levels-color-panel light" aria-hidden="true" />
          <span className="levels-control-spacer" />
          <span className="levels-color-panel dark" aria-hidden="true" />
          <DialogStepper label="Input low value" min={0} max={254} value={inputLow} disabled={disabled || !selectedChannels.length} onChange={(value) => updateControl('inputLow', value)} />
        </section>
        <section className="levels-gradient-column input" aria-label="Input range">
          <strong aria-hidden="true">&nbsp;</strong>
          <div className="levels-gradient vertical">
            <i className="levels-marker low" style={{ bottom: `${inputLow / 2.55}%` }} />
            <i className="levels-marker gamma" style={{ bottom: `${inputLow / 2.55 + (inputHigh - inputLow) / 2.55 * Math.pow(0.5, 1 / gamma)}%` }} />
            <i className="levels-marker high" style={{ bottom: `${inputHigh / 2.55}%` }} />
          </div>
        </section>
        <section className="levels-gradient-column output" aria-label="Output range">
          <strong>Output</strong>
          <div className="levels-gradient vertical output">
            <i className="levels-marker low" style={{ bottom: `${outputLow / 2.55}%` }} />
            <i className="levels-marker high" style={{ bottom: `${outputHigh / 2.55}%` }} />
          </div>
        </section>
        <section className="levels-control-column levels-output-controls">
          <strong aria-hidden="true">&nbsp;</strong>
          <DialogStepper label="Output high value" min={2} max={255} value={outputHigh} disabled={disabled || !selectedChannels.length} onChange={(value) => updateControl('outputHigh', value)} />
          <span className="levels-color-panel light" aria-hidden="true" />
          <DialogStepper label="Gamma value" min={0.1} max={10} step={0.1} value={gamma} disabled={disabled || !selectedChannels.length} onChange={(value) => updateControl('gamma', value)} />
          <span className="levels-color-panel light" aria-hidden="true" />
          <span className="levels-color-panel dark" aria-hidden="true" />
          <DialogStepper label="Output low value" min={0} max={252} value={outputLow} disabled={disabled || !selectedChannels.length} onChange={(value) => updateControl('outputLow', value)} />
        </section>
        <section className="levels-histogram-block">
          <strong>Output Histogram</strong>
          <div className="levels-histogram" aria-hidden="true" />
        </section>
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
          <PintaIcon file={position.icon} size={22} />
        </button>
      ))}
    </div>
  );
}

function EffectDialog({ effect, busy, onCancel, onPreview, onSubmit }: EffectDialogProps) {
  const defaults = useMemo(() => defaultEffectParameters(effect), [effect]);
  const [parameters, setParameters] = useState<EffectParameters>(() => defaults);
  const [posterizeLinked, setPosterizeLinked] = useState(true);
  const [colorParameterKey, setColorParameterKey] = useState<string | null>(null);
  const [levelChannels, setLevelChannels] = useState<Record<LevelChannel, boolean>>({ red: true, green: true, blue: true });
  const visibleParameters = effect.parameters.filter((parameter) => !parameter.visibleWhen || parameters[parameter.visibleWhen.key] === parameter.visibleWhen.equals);

  const resetLevels = () => {
    setParameters((current) => {
      const next = { ...current };
      const selected = (['red', 'green', 'blue'] as LevelChannel[]).filter((channel) => levelChannels[channel]);
      for (const channel of selected.length ? selected : (['red', 'green', 'blue'] as LevelChannel[])) {
        next[levelParameterKey(channel, 'inputLow')] = 0;
        next[levelParameterKey(channel, 'inputHigh')] = 255;
        next[levelParameterKey(channel, 'gamma')] = 1;
        next[levelParameterKey(channel, 'outputLow')] = 0;
        next[levelParameterKey(channel, 'outputHigh')] = 255;
      }
      return next;
    });
  };

  useEffect(() => {
    if (busy) return;
    const timer = window.setTimeout(() => { void onPreview(parameters); }, 100);
    return () => window.clearTimeout(timer);
  }, [busy, onPreview, parameters]);

  const updateParameter = (key: string, value: number) => {
    setParameters((current) => {
      if (effect.id === 'posterize' && posterizeLinked && ['red', 'green', 'blue'].includes(key)) {
        return { ...current, red: value, green: value, blue: value };
      }
      return { ...current, [key]: value };
    });
  };

  const simpleControls: ReactNode[] = [];
  for (let index = 0; index < visibleParameters.length; index += 1) {
    const parameter = visibleParameters[index];
    const following = visibleParameters[index + 1];
    const pointPrefix = parameter.key.endsWith('X') ? parameter.key.slice(0, -1) : null;
    if (pointPrefix !== null && following?.key === `${pointPrefix}Y`) {
      const pointTitle = pointPrefix === 'offset'
        ? (effect.id === 'vignette' || effect.id === 'hexagon-pixelate' ? 'Offset' : 'Center Offset')
        : `${pointPrefix[0].toUpperCase()}${pointPrefix.slice(1)} shift`;
      simpleControls.push(
        <div className="native-effect-point" key={`${parameter.key}-${following.key}`}>
          <strong>{translateUi(pointTitle)}</strong>
          <div>
            <PointPad x={parameters[parameter.key]} y={parameters[following.key]} minX={parameter.min} maxX={parameter.max} minY={following.min} maxY={following.max} disabled={busy} onChange={(x, y) => setParameters((current) => ({ ...current, [parameter.key]: x, [following.key]: y }))} />
            <span className="native-effect-point-fields">
              <label><span>X:</span><DialogStepper label="Offset X" min={parameter.min} max={parameter.max} step={parameter.step} value={parameters[parameter.key]} disabled={busy} onChange={(value) => updateParameter(parameter.key, value)} /><DialogResetButton label="Reset Offset X" disabled={busy} onClick={() => updateParameter(parameter.key, parameter.defaultValue)} /></label>
              <label><span>Y:</span><DialogStepper label="Offset Y" min={following.min} max={following.max} step={following.step} value={parameters[following.key]} disabled={busy} onChange={(value) => updateParameter(following.key, value)} /><DialogResetButton label="Reset Offset Y" disabled={busy} onClick={() => updateParameter(following.key, following.defaultValue)} /></label>
            </span>
          </div>
        </div>,
      );
      index += 1;
      continue;
    }
    if (/seed/i.test(parameter.key) || /seed/i.test(parameter.label)) {
      simpleControls.push(
        <div className="native-effect-seed" key={parameter.key}>
          <strong>{translateUi(parameter.label)}</strong>
          <div>
            <button type="button" className="native-dialog-button" disabled={busy} onClick={() => updateParameter(parameter.key, Math.floor(Math.random() * Math.max(1, parameter.max - parameter.min + 1)) + parameter.min)}>{translateUi('Reseed')}</button>
            <DialogStepper label={parameter.label} min={parameter.min} max={parameter.max} step={parameter.step} value={parameters[parameter.key]} disabled={busy} onChange={(value) => updateParameter(parameter.key, value)} />
          </div>
        </div>,
      );
      continue;
    }
    if ((parameter.key === 'angle' || parameter.key === 'rotation') && parameter.kind !== 'select') {
      simpleControls.push(
        <div className="native-effect-angle" key={parameter.key}>
          <strong>{translateUi(parameter.label)}</strong>
          <div>
            <AngleDial value={parameters[parameter.key]} min={parameter.min} max={parameter.max} disabled={busy} onChange={(value) => updateParameter(parameter.key, value)} />
            <DialogStepper label={parameter.label} min={parameter.min} max={parameter.max} step={parameter.step} value={parameters[parameter.key]} disabled={busy} onChange={(value) => updateParameter(parameter.key, value)} />
            <DialogResetButton label={`${translateUi('Reset')} ${translateUi(parameter.label)}`} disabled={busy} onClick={() => updateParameter(parameter.key, parameter.defaultValue)} />
          </div>
        </div>,
      );
      continue;
    }
    if (parameter.kind === 'boolean') {
      simpleControls.push(
        <label className="native-effect-boolean" key={parameter.key}>
          <input type="checkbox" checked={parameters[parameter.key] !== 0} disabled={busy} onChange={(event) => updateParameter(parameter.key, event.target.checked ? 1 : 0)} />
          <span>{translateUi(parameter.label)}</span>
        </label>,
      );
      continue;
    }
    if (parameter.kind === 'select') {
      simpleControls.push(
        <label className="native-effect-select" key={parameter.key}>
          <strong>{translateUi(parameter.label)}</strong>
          <select value={parameters[parameter.key]} disabled={busy} onChange={(event) => updateParameter(parameter.key, Number(event.target.value))}>
            {parameter.options?.map((option) => <option key={option.value} value={option.value}>{translateUi(option.label)}</option>)}
          </select>
        </label>,
      );
      continue;
    }
    if (parameter.kind === 'color') {
      const color = `#${Math.round(parameters[parameter.key]).toString(16).padStart(6, '0')}`;
      simpleControls.push(
        <div className="native-effect-color" key={parameter.key}>
          <strong>{translateUi(parameter.label)}</strong>
          <button type="button" className="native-effect-color-well" style={{ backgroundColor: color }} disabled={busy} aria-label={`${translateUi('Choose')} ${translateUi(parameter.label)}`} onClick={() => setColorParameterKey(parameter.key)}><span>{color.toUpperCase()}</span></button>
        </div>,
      );
      continue;
    }
    simpleControls.push(
      <label className="native-effect-range" key={parameter.key}>
        <strong>{translateUi(parameter.label)}</strong>
        <span>
          <input type="range" min={parameter.min} max={parameter.max} step={parameter.step} value={parameters[parameter.key]} disabled={busy} onChange={(event) => updateParameter(parameter.key, Number(event.target.value))} />
          <DialogStepper label={parameter.label} min={parameter.min} max={parameter.max} step={parameter.step} value={parameters[parameter.key]} disabled={busy} onChange={(value) => updateParameter(parameter.key, value)} />
          <DialogResetButton label={`${translateUi('Reset')} ${translateUi(parameter.label)}`} disabled={busy} onClick={() => updateParameter(parameter.key, parameter.defaultValue)} />
        </span>
      </label>,
    );
  }

  return (
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (!busy && event.target === event.currentTarget) onCancel();
    }}>
      <form className={`pinta-dialog effect-dialog native-effect-dialog native-effect-dialog-${effect.dialog ?? 'simple'} native-effect-${effect.id}`} role="dialog" aria-modal="true" aria-labelledby="effect-dialog-title" aria-busy={busy} onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(parameters);
      }}>
        <h2 className="visually-hidden" id="effect-dialog-title">{translateUi(effect.name)}</h2>
        <div className="native-effect-content">
          {effect.dialog === 'curves' ? (
            <CurvesEditor parameters={parameters} disabled={busy} onChange={setParameters} />
          ) : effect.dialog === 'levels' ? (
            <LevelsEditor parameters={parameters} disabled={busy} onChange={setParameters} activeChannels={levelChannels} />
          ) : effect.dialog === 'alignment' ? (
            <AlignmentEditor parameters={parameters} disabled={busy} onChange={setParameters} />
          ) : (
            <div className="native-effect-parameter-list">
              {simpleControls}
              {effect.id === 'posterize' && (
                <label className="native-effect-boolean posterize-linked"><input type="checkbox" checked={posterizeLinked} disabled={busy} onChange={(event) => setPosterizeLinked(event.target.checked)} /><span>{translateUi('Linked')}</span></label>
              )}
            </div>
          )}
        </div>
        <DialogActions onCancel={onCancel} disabled={busy} submitLabel={busy ? 'Applying…' : 'OK'}>
          {effect.dialog === 'levels' && (
            <div className="levels-native-footer-controls">
              <button type="button" className="native-dialog-button" disabled={busy} onClick={resetLevels}>Auto</button>
              <button type="button" className="native-dialog-button" disabled={busy} onClick={resetLevels}>Reset</button>
              {(['red', 'green', 'blue'] as const).map((channel) => (
                <label key={channel} className={`curve-channel-toggle channel-${channel}`}>
                  <input type="checkbox" checked={levelChannels[channel]} disabled={busy} onChange={(event) => setLevelChannels((current) => ({ ...current, [channel]: event.target.checked }))} />
                  {channel[0].toUpperCase() + channel.slice(1)}
                </label>
              ))}
            </div>
          )}
        </DialogActions>
      </form>
      {colorParameterKey && (
        <ColorPickerDialog
          title="Choose Color"
          primary={`#${Math.round(parameters[colorParameterKey]).toString(16).padStart(6, '0')}`}
          onCancel={() => setColorParameterKey(null)}
          onSubmit={(colors) => {
            updateParameter(colorParameterKey, Number.parseInt(colors.primary.slice(1, 7), 16));
            setColorParameterKey(null);
          }}
        />
      )}
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
    <div className="dialog-backdrop native-alert-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div className="pinta-dialog close-document-dialog native-alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-document-title" aria-describedby="close-document-description">
        <div className="close-document-content">
          <h2 id="close-document-title">Save changes to image “{fileName}” before closing?</h2>
          <p id="close-document-description">If you don’t save, all changes will be permanently lost.</p>
        </div>
        <footer className="close-document-actions">
          <button type="button" className="native-alert-button suggested" autoFocus onClick={onSave}>Save</button>
          <button type="button" className="native-alert-button destructive" onClick={onDiscard}>Discard</button>
          <button type="button" className="native-alert-button" onClick={onCancel}>Cancel</button>
        </footer>
      </div>
    </div>
  );
}

function PasteExpandDialog({ onCancel, onPreserve, onExpand }: { onCancel: () => void; onPreserve: () => void; onExpand: () => void }) {
  return (
    <div className="dialog-backdrop native-alert-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div className="pinta-dialog native-alert-dialog paste-expand-dialog" role="alertdialog" aria-modal="true" aria-labelledby="paste-expand-title" aria-describedby="paste-expand-description">
        <div className="close-document-content">
          <h2 id="paste-expand-title">Image larger than canvas</h2>
          <p id="paste-expand-description">The image being pasted is larger than the canvas. Expand the canvas to fit the pasted image?</p>
        </div>
        <footer className="close-document-actions">
          <button type="button" className="native-alert-button suggested" autoFocus onClick={onExpand}>Expand</button>
          <button type="button" className="native-alert-button" onClick={onPreserve}>Preserve</button>
          <button type="button" className="native-alert-button" onClick={onCancel}>Cancel</button>
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
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog layer-properties-dialog" role="dialog" aria-modal="true" aria-labelledby="layer-properties-title" onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSubmit({ name, visible, opacity: opacity / 100, blendMode });
      }}>
        <h2 className="visually-hidden" id="layer-properties-title">Layer Properties</h2>
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
        <DialogActions onCancel={onCancel} disabled={!valid} />
      </form>
    </div>
  );
}

function RotateZoomLayerDialog({ onCancel, onSubmit }: { layer: PaintLayer; onCancel: () => void; onSubmit: (angle: number, panHorizontal: number, panVertical: number, zoom: number) => void }) {
  const [angle, setAngle] = useState(0);
  const [panHorizontal, setPanHorizontal] = useState(0);
  const [panVertical, setPanVertical] = useState(0);
  const [zoom, setZoom] = useState(1);
  return (
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog rotate-zoom-dialog" role="dialog" aria-modal="true" aria-labelledby="rotate-zoom-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(angle, panHorizontal, panVertical, zoom);
      }}>
        <h2 className="visually-hidden" id="rotate-zoom-title">Rotate / Zoom Layer</h2>
        <div className="dialog-content rotate-zoom-content">
          <div className="native-transform-control">
            <strong>Angle</strong>
            <div><AngleDial value={angle} min={-360} max={360} onChange={setAngle} /><DialogStepper label="Layer rotation angle" min={-360} max={360} value={angle} onChange={setAngle} /><DialogResetButton label="Reset angle" onClick={() => setAngle(0)} /></div>
          </div>
          <div className="native-transform-control native-transform-pan">
            <strong>Pan</strong>
            <div><PointPad x={panHorizontal} y={panVertical} minX={-1} maxX={1} minY={-1} maxY={1} onChange={(x, y) => { setPanHorizontal(x); setPanVertical(y); }} /><span className="native-effect-point-fields"><label><span>X:</span><DialogStepper label="Layer horizontal pan" min={-1} max={1} step={0.01} value={panHorizontal} onChange={setPanHorizontal} /><DialogResetButton label="Reset horizontal pan" onClick={() => setPanHorizontal(0)} /></label><label><span>Y:</span><DialogStepper label="Layer vertical pan" min={-1} max={1} step={0.01} value={panVertical} onChange={setPanVertical} /><DialogResetButton label="Reset vertical pan" onClick={() => setPanVertical(0)} /></label></span></div>
          </div>
          <label className="native-effect-range native-transform-zoom"><strong>Zoom</strong><span><input type="range" min="0" max="16" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><DialogStepper label="Layer zoom value" min={0} max={16} step={0.01} value={zoom} onChange={setZoom} /><DialogResetButton label="Reset zoom" onClick={() => setZoom(1)} /></span></label>
        </div>
        <DialogActions onCancel={onCancel} />
      </form>
    </div>
  );
}

interface SaveAsDialogProps {
  fileName: string;
  layerCount: number;
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

function FlattenConfirmDialog({ onCancel, onFlatten }: { onCancel: () => void; onFlatten: () => void }) {
  return (
    <div className="dialog-backdrop native-alert-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div className="pinta-dialog native-alert-dialog flatten-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="flatten-confirm-title" aria-describedby="flatten-confirm-description">
        <div className="close-document-content">
          <h2 id="flatten-confirm-title">This format does not support layers. Flatten image?</h2>
          <p id="flatten-confirm-description">Flattening the image will merge all layers into a single layer.</p>
        </div>
        <footer className="native-dialog-actions compact-dialog-actions"><span className="native-dialog-actions-spacer" /><button type="button" className="native-dialog-button" onClick={onCancel}>Cancel</button><button type="button" className="native-dialog-button suggested" autoFocus onClick={onFlatten}>Flatten</button></footer>
      </div>
    </div>
  );
}

function SaveAsDialog({ fileName, layerCount, onCancel, onSubmit }: SaveAsDialogProps) {
  const [name, setName] = useState(fileName.replace(/\.[^.]+$/, '') || 'pinta-image');
  const [format, setFormat] = useState<ExportFormat>(() => initialExportFormat(fileName));
  const [quality, setQuality] = useState(92);
  const [saving, setSaving] = useState(false);
  const [confirmFlatten, setConfirmFlatten] = useState(false);
  const valid = name.trim().length > 0;
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const saved = await onSubmit({ fileName: name, format, quality: quality / 100 });
    setSaving(false);
    if (saved) onCancel();
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
        void save();
      }}>
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" onClick={onCancel} disabled={saving}>Cancel</button>
          <strong id="save-as-title">Save Image As</strong>
          <button type="submit" className="dialog-text-button suggested" disabled={!valid || saving}>
            {saving ? <><BusySpinner /> Saving</> : 'Save'}
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
      {confirmFlatten && <FlattenConfirmDialog onCancel={() => setConfirmFlatten(false)} onFlatten={() => { setConfirmFlatten(false); void save(); }} />}
    </div>
  );
}

function PaletteResizeDialog({ currentSize, onCancel, onSubmit }: { currentSize: number; onCancel: () => void; onSubmit: (size: number) => void }) {
  const [size, setSize] = useState(currentSize);
  return (
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog native-palette-resize-dialog" role="dialog" aria-modal="true" aria-labelledby="palette-resize-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(size);
      }}>
        <h2 className="visually-hidden" id="palette-resize-title">Resize Palette</h2>
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
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog offset-selection-dialog" role="dialog" aria-modal="true" aria-labelledby="offset-selection-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(offset);
      }}>
        <h2 className="visually-hidden" id="offset-selection-title">Offset Selection</h2>
        <div className="dialog-content offset-selection-content">
          <label className="native-effect-range"><strong>Offset</strong><span><input type="range" min="-100" max="100" value={offset} onChange={(event) => setOffset(Number(event.target.value))} aria-label={`Selection offset ${offset} pixels`} /><DialogStepper autoFocus label="Selection offset" min={-100} max={100} value={offset} onChange={setOffset} /><DialogResetButton label="Reset offset" onClick={() => setOffset(0)} /></span></label>
        </div>
        <DialogActions onCancel={onCancel} />
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
          <span className="screenshot-icon"><PintaIcon file="view-fullscreen-symbolic.svg" size={30} standard /></span>
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
  return (
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog canvas-grid-dialog" role="dialog" aria-modal="true" aria-labelledby="canvas-grid-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}>
        <h2 className="visually-hidden" id="canvas-grid-title">Canvas Grid Settings</h2>
        <div className="dialog-content canvas-grid-content">
          <section className="native-grid-section">
            <label className="native-check-row"><input type="checkbox" checked={value.showGrid} onChange={(event) => setValue((current) => ({ ...current, showGrid: event.target.checked }))} /><span>Show Grid</span></label>
            <label><span>Width:</span><DialogStepper label="Grid cell width" min={1} max={10000} disabled={!value.showGrid} value={value.cellWidth} onChange={(next) => number('cellWidth', next, 1, 10000)} /><i>pixels</i></label>
            <label><span>Height:</span><DialogStepper label="Grid cell height" min={1} max={10000} disabled={!value.showGrid} value={value.cellHeight} onChange={(next) => number('cellHeight', next, 1, 10000)} /><i>pixels</i></label>
          </section>
          <section className="native-grid-section native-axon-grid-section">
            <label className="native-check-row"><input type="checkbox" checked={value.showAxonometricGrid} onChange={(event) => setValue((current) => ({ ...current, showAxonometricGrid: event.target.checked }))} /><span>Show Axonometric Grid</span></label>
            <label><span>Width:</span><DialogStepper label="Axonometric grid width" min={1} max={10000} disabled={!value.showAxonometricGrid} value={value.axonometricWidth} onChange={(next) => number('axonometricWidth', next, 1, 10000)} /><i>pixels</i></label>
            <div className="native-grid-angle"><AngleDial value={value.axonometricAngle} min={1} max={89} disabled={!value.showAxonometricGrid} onChange={(next) => number('axonometricAngle', next, 1, 89)} /><DialogStepper label="Axonometric grid angle" min={1} max={89} disabled={!value.showAxonometricGrid} value={value.axonometricAngle} onChange={(next) => number('axonometricAngle', next, 1, 89)} /><DialogResetButton label="Reset grid angle" disabled={!value.showAxonometricGrid} onClick={() => number('axonometricAngle', 30, 1, 89)} /></div>
          </section>
        </div>
        <DialogActions onCancel={onCancel} />
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
  { title: 'Application', entries: [['Keyboard Shortcuts', 'Ctrl+,'], ['Quit / Close All', 'Ctrl+Q'], ['Pinta Help', 'F1']] },
  { title: 'File', entries: [['New', 'Ctrl+N'], ['Open', 'Ctrl+O'], ['Save', 'Ctrl+S'], ['Save As', 'Ctrl+Shift+S'], ['Print', 'Ctrl+P'], ['Close', 'Ctrl+W'], ['Save All', 'Ctrl+Alt+A'], ['Close All', 'Ctrl+Shift+W']] },
  { title: 'Edit', entries: [['Undo', 'Ctrl+Z'], ['Redo', 'Ctrl+Shift+Z / Ctrl+Y'], ['Cut', 'Ctrl+X'], ['Copy', 'Ctrl+C'], ['Copy Merged', 'Ctrl+Shift+C'], ['Paste', 'Ctrl+V'], ['Paste Into New Layer', 'Ctrl+Shift+V'], ['Paste Into New Image', 'Shift+V / Ctrl+Alt+V'], ['Select All', 'Ctrl+A'], ['Deselect All', 'Ctrl+Shift+A / Ctrl+D'], ['Erase Selection', 'Delete'], ['Fill Selection', 'Backspace'], ['Invert Selection', 'Ctrl+I'], ['Offset Selection', 'Ctrl+Shift+O']] },
  { title: 'View', entries: [['Zoom In', '+ / Ctrl++'], ['Zoom Out', '− / Ctrl+−'], ['Best Fit', 'Ctrl+B'], ['Normal Size', 'Ctrl+0'], ['Fullscreen', 'F11'], ['Tool Windows', 'F12']] },
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
          <strong id="shortcuts-title">{translateUi('Keyboard Shortcuts')}</strong>
          <button type="button" className="dialog-text-button suggested" onClick={onClose}>{translateUi('Done')}</button>
        </header>
        <div className="dialog-content shortcuts-content">
          <section className="shortcut-section">
            <h3>{translateUi('Tools')}</h3>
            <div className="shortcut-list">
              {TOOLS.filter((tool) => tool.shortcut).map((tool) => <div className="shortcut-row" key={tool.id}><span>{translateUi(tool.name)}</span><kbd>{tool.shortcut!.toUpperCase()}</kbd></div>)}
            </div>
          </section>
          {SHORTCUT_SECTIONS.map((section) => (
            <section className="shortcut-section" key={section.title}>
              <h3>{translateUi(section.title)}</h3>
              <div className="shortcut-list">
                {section.entries.map(([label, shortcut]) => <div className="shortcut-row" key={label}><span>{translateUi(label)}</span><kbd>{shortcut}</kbd></div>)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function LanguageDialog({ onClose }: { onClose: () => void }) {
  const [selectedLocale, setSelectedLocale] = useState<LocaleCode>(currentLocale());

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="pinta-dialog language-dialog" role="dialog" aria-modal="true" aria-labelledby="language-title" onSubmit={(event) => {
        event.preventDefault();
        void changeLocale(selectedLocale).then(onClose);
      }}>
        <header className="dialog-header">
          <button type="button" className="dialog-text-button" onClick={onClose}>{translateUi('Cancel')}</button>
          <strong id="language-title">{translateUi('Choose language')}</strong>
          <button type="submit" className="dialog-text-button suggested">{translateUi('Apply')}</button>
        </header>
        <div className="dialog-content language-content">
          <fieldset>
            <legend>{translateUi('Interface language')}</legend>
            {SUPPORTED_LOCALES.map((locale) => (
              <label key={locale.code} dir={locale.direction}>
                <input
                  type="radio"
                  name="locale"
                  value={locale.code}
                  checked={selectedLocale === locale.code}
                  onChange={() => setSelectedLocale(locale.code)}
                />
                <span lang={locale.code}>{locale.name}</span>
                <small>{locale.code.toUpperCase()} · {locale.direction.toUpperCase()}</small>
              </label>
            ))}
          </fieldset>
          <p className="dialog-hint">{translateUi('Language changes apply immediately.')}</p>
        </div>
      </form>
    </div>
  );
}

interface AddinManagerDialogProps {
  enabledAddins: readonly AddinId[];
  onToggle: (addin: AddinId, enabled: boolean) => void;
  onSetAll: (enabled: boolean) => void;
  onClose: () => void;
}

function AddinManagerDialog({ enabledAddins, onToggle, onSetAll, onClose }: AddinManagerDialogProps) {
  const enabledCount = ADDIN_DEFINITIONS.filter((addin) => enabledAddins.includes(addin.id)).length;
  const [tab, setTab] = useState<'gallery' | 'installed' | 'updates'>('gallery');
  const [selectedId, setSelectedId] = useState<AddinId>(ADDIN_DEFINITIONS[0].id);
  const listedAddins = tab === 'updates' ? [] : tab === 'installed'
    ? ADDIN_DEFINITIONS.filter((addin) => enabledAddins.includes(addin.id))
    : ADDIN_DEFINITIONS;
  const selected = ADDIN_DEFINITIONS.find((addin) => addin.id === selectedId) ?? listedAddins[0];
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="pinta-dialog addin-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="addin-manager-title">
        <header className="addin-manager-header">
          <button type="button" className="icon-button" disabled aria-label="Install Extension Package"><PintaIcon file="document-open-symbolic.svg" size={17} standard /></button>
          <button type="button" className="icon-button" aria-label="Refresh add-ins"><PintaIcon file="view-refresh-symbolic.svg" size={17} standard /></button>
          <strong id="addin-manager-title">{translateUi('Add-in Manager')}</strong>
          <button type="button" className="dialog-text-button" onClick={onClose}>{translateUi('Done')}</button>
        </header>
        <nav className="addin-manager-tabs" aria-label="Add-in sections">
          {([['gallery', 'Gallery'], ['installed', 'Installed'], ['updates', 'Updates']] as const).map(([id, label]) => <button key={id} type="button" className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>{translateUi(label)}{id === 'installed' && <small>{enabledCount}</small>}</button>)}
        </nav>
        <div className="addin-manager-content">
          <div className="addin-manager-list-pane">
            <div className="addin-manager-actions"><button type="button" onClick={() => onSetAll(true)}>{translateUi('Enable all')}</button><button type="button" onClick={() => onSetAll(false)}>{translateUi('Disable all')}</button></div>
            <div className="addin-list" role="listbox" aria-label={translateUi('Add-ins')}>
              {listedAddins.map((addin) => <button key={addin.id} type="button" role="option" aria-selected={selected?.id === addin.id} onClick={() => setSelectedId(addin.id)}><strong>{translateUi(addin.name)}</strong><span>{translateUi(addin.description)}</span></button>)}
              {!listedAddins.length && <div className="addin-empty"><PintaIcon file="system-search-symbolic.svg" size={34} standard /><strong>{translateUi('No Items Found')}</strong></div>}
            </div>
          </div>
          {selected && <article className="addin-detail-pane"><span className="addin-manager-icon"><PintaIcon file="addins-manage.png" size={30} /></span><h2>{translateUi(selected.name)}</h2><span>v{selected.version} · {selected.author}</span><p>{translateUi(selected.description)}</p><div className="addin-capabilities">{selected.capabilities.map((capability) => <span key={capability}>{translateUi(capability)}</span>)}</div><footer><label><span>{enabledAddins.includes(selected.id) ? translateUi('Enabled') : translateUi('Disabled')}</span><span className="addin-switch"><input type="checkbox" checked={enabledAddins.includes(selected.id)} onChange={(event) => onToggle(selected.id, event.target.checked)} /><span aria-hidden="true" /></span></label><a href={selected.sourceUrl} target="_blank" rel="noreferrer">{translateUi('More Information')} ↗</a></footer><small>{translateUi(selected.license)} · {translateUi('Bundled with Pinta Online; no code is downloaded at runtime.')}</small></article>}
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
          <strong id="about-title">{translateUi('About Pinta')}</strong>
          <button type="button" className="dialog-text-button suggested" onClick={onClose}>{translateUi('Close')}</button>
        </header>
        <div className="dialog-content about-content">
          <img src="/apps/com.github.PintaProject.Pinta.svg" alt="Pinta" />
          <h2>Pinta</h2>
          <p className="about-version" data-visual-version>Pinta Online {__PINTA_ONLINE_VERSION__} · based on Pinta 3.2</p>
          <p>Easily create and edit images, now in the browser.</p>
          <p className="about-port-credit">{translateUi('Ported to the web by')} <a href={WEB_REPOSITORY_URL} target="_blank" rel="noreferrer">Evgeny Vinnik</a>.</p>
          <div className="about-links">
            <a href={aboutPathForLocale(currentLocale())}><span>{translateUi('Details')}</span><b>›</b></a>
            <a href={USER_GUIDE_URL}><span>{translateUi('Support Questions')}</span><b>›</b></a>
            <a href={WEB_BUG_REPORT_URL} target="_blank" rel="noreferrer"><span>{translateUi('Report an Issue')}</span><b>›</b></a>
            <a href="https://github.com/PintaProject/Pinta/graphs/contributors" target="_blank" rel="noreferrer"><span>{translateUi('Credits')}</span><b>›</b></a>
            <a href={`${WEB_REPOSITORY_URL}/blob/master/LICENSE`} target="_blank" rel="noreferrer"><span>{translateUi('Legal')}</span><b>›</b></a>
            <a href={WEB_REPOSITORY_URL} target="_blank" rel="noreferrer"><span>{translateUi('Source Code')}</span><b>›</b></a>
          </div>
          <p className="dialog-hint">Copyright © 2010–2026 by Pinta contributors. Released under the MIT X11 License.</p>
        </div>
      </div>
    </div>
  );
}

function App() {
  const { i18n } = useTranslation();
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
    enabledAddins,
    setTheme,
    setShowSidebar,
    setShowToolbox,
    setShowToolbar,
    setShowPalette,
    setShowDocumentTabs,
    setCanvasGrid,
    setShowRulers,
    setRulerMetric,
    setAddinEnabled,
    setAllAddinsEnabled,
  } = usePreferences();
  const visibleEffects = useMemo(() => EFFECT_DEFINITIONS.filter((effect) => isAddinEnabled(enabledAddins, effect.addinId)), [enabledAddins]);
  const visibleTools = useMemo(() => TOOLS.filter((tool) => isAddinEnabled(enabledAddins, tool.addinId)), [enabledAddins]);
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
  const [colorDialogTarget, setColorDialogTarget] = useState<'primary' | 'secondary' | null>(null);
  const [closingDocumentId, setClosingDocumentId] = useState<string | null>(null);
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const [closeAllQueue, setCloseAllQueue] = useState<string[]>([]);
  const [pendingPaste, setPendingPaste] = useState<'current' | 'new-layer' | null>(null);
  const [printPreview, setPrintPreview] = useState<PrintPreview | null>(null);
  const [showOffsetSelection, setShowOffsetSelection] = useState(false);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [screenshotError, setScreenshotError] = useState('');
  const [showCanvasGridDialog, setShowCanvasGridDialog] = useState(false);
  const [viewportMetrics, setViewportMetrics] = useState({ width: 0, height: 0, scrollLeft: 0, scrollTop: 0 });
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [showLanguage, setShowLanguage] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showAddinManager, setShowAddinManager] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const layerFileInputRef = useRef<HTMLInputElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const textDragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const zoomRef = useRef(editor.zoom);
  const renderedZoomRef = useRef(editor.zoom);
  const zoomAnchorRef = useRef<{ imageX: number; imageY: number; clientX: number; clientY: number } | null>(null);
  const gestureStartZoomRef = useRef<number | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  }, []);

  const performPaste = useCallback((target: 'current' | 'new-layer', expandCanvas = false) => {
    const pasted = target === 'current' ? editor.paste(expandCanvas) : editor.pasteIntoNewLayer(expandCanvas);
    if (pasted) notify(target === 'current' ? 'Pasted into the current layer' : 'Pasted into a new layer');
    return pasted;
  }, [editor, notify]);

  const requestPaste = useCallback((target: 'current' | 'new-layer' = 'current') => {
    if (!editor.hasClipboard) return false;
    if (editor.clipboardSize.width > editor.width || editor.clipboardSize.height > editor.height) {
      setOpenMenu(null);
      setPendingPaste(target);
      return true;
    }
    return performPaste(target);
  }, [editor.clipboardSize.height, editor.clipboardSize.width, editor.hasClipboard, editor.height, editor.width, performPaste]);

  useEffect(() => {
    const activeTool = TOOL_BY_ID[editor.tool];
    if (editor.tool === 'block-brush') {
      editor.setPaintBrushType(enabledAddins.includes('block-brush') ? 'block' : 'normal');
      editor.setTool('paintbrush');
      return;
    }
    if (!enabledAddins.includes('block-brush') && editor.paintBrushType === 'block') editor.setPaintBrushType('normal');
    if (activeTool.addinId && !enabledAddins.includes(activeTool.addinId)) editor.setTool('paintbrush');
  }, [editor.paintBrushType, editor.setPaintBrushType, editor.setTool, editor.tool, enabledAddins]);

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
    const dirtyDocuments = editor.documents.filter((document) => document.dirty);
    if (!dirtyDocuments.length) {
      editor.closeAllDocuments();
      return;
    }
    const queue = dirtyDocuments.map((document) => document.id);
    editor.switchDocument(queue[0]);
    setCloseAllQueue(queue);
    setShowCloseAllConfirm(true);
  }, [editor]);

  const completeCloseAllStep = useCallback((completedId: string) => {
    const remaining = closeAllQueue.filter((id) => id !== completedId);
    if (!remaining.length) {
      editor.closeAllDocuments();
      setCloseAllQueue([]);
      setShowCloseAllConfirm(false);
      return;
    }
    editor.closeDocument(completedId);
    editor.switchDocument(remaining[0]);
    setCloseAllQueue(remaining);
  }, [closeAllQueue, editor]);

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
    document.title = `${translateDocumentName(editor.fileName)}${editor.dirty ? '*' : ''} — Pinta Online Image Editor`;
  }, [editor.dirty, editor.fileName, i18n.resolvedLanguage]);

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
      if (event.defaultPrevented || focusedEditorOwnsShortcut(event)) return;

      const shortcut = resolvePintaShortcut(event);
      const documentIndex = documentIndexShortcut(event);
      const modalOpen = Boolean(
        closingDocumentId
        || showCloseAllConfirm
        || pendingPaste
        || printPreview
        || dialog
        || effectDialog
        || showOffsetSelection
        || showScreenshot
        || layerPropertiesId
        || rotateZoomLayerId
        || paletteDialog
        || editingPaletteIndex !== null
        || colorDialogTarget !== null
        || showSaveAs
        || showCanvasGridDialog
        || showKeyboardShortcuts
        || showAbout
        || showLanguage
        || showAddinManager,
      );

      if (modalOpen) {
        if (shortcut || documentIndex !== null) event.preventDefault();
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (closingDocumentId) setClosingDocumentId(null);
        else if (showCloseAllConfirm) {
          setCloseAllQueue([]);
          setShowCloseAllConfirm(false);
        }
        else if (pendingPaste) setPendingPaste(null);
        else if (printPreview) setPrintPreview(null);
        else if (dialog) setDialog(null);
        else if (effectDialog && !editor.effectBusy) {
          editor.clearEffectPreview();
          setEffectDialog(null);
        }
        else if (showOffsetSelection) setShowOffsetSelection(false);
        else if (showScreenshot && !screenshotBusy) {
          setShowScreenshot(false);
          setScreenshotError('');
        } else if (layerPropertiesId) setLayerPropertiesId(null);
        else if (rotateZoomLayerId) setRotateZoomLayerId(null);
        else if (paletteDialog || editingPaletteIndex !== null || colorDialogTarget !== null) {
          setPaletteDialog(null);
          setEditingPaletteIndex(null);
          setColorDialogTarget(null);
        } else if (showSaveAs) setShowSaveAs(false);
        else if (showCanvasGridDialog) setShowCanvasGridDialog(false);
        else if (showAddinManager) setShowAddinManager(false);
        else if (showLanguage) setShowLanguage(false);
        else {
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
      if (isEditableTarget(event.target) && !shortcut && documentIndex === null) return;

      if (documentIndex !== null) {
        event.preventDefault();
        const document = editor.documents[documentIndex];
        if (document) editor.switchDocument(document.id);
        return;
      }

      if (shortcut) {
        event.preventDefault();
        setOpenMenu(null);
        setMenuSurface(null);
        switch (shortcut) {
          case 'help': window.open(USER_GUIDE_URL, '_blank', 'noopener,noreferrer'); break;
          case 'keyboard-shortcuts': setShowKeyboardShortcuts(true); break;
          case 'quit': requestCloseAll(); break;
          case 'fullscreen': void toggleFullscreen(); break;
          case 'tool-windows': {
            const next = !(showToolbox || showSidebar);
            setShowToolbox(next);
            setShowSidebar(next);
            break;
          }
          case 'zoom-in': editor.setZoom(editor.zoom * 1.25); break;
          case 'zoom-out': editor.setZoom(editor.zoom * 0.8); break;
          case 'best-fit': zoomToWindow(); break;
          case 'actual-size': editor.setZoom(1); break;
          case 'previous-document':
          case 'next-document': {
            const activeIndex = editor.documents.findIndex((document) => document.id === editor.activeDocumentId);
            const offset = shortcut === 'previous-document' ? -1 : 1;
            const nextIndex = (activeIndex + offset + editor.documents.length) % editor.documents.length;
            editor.switchDocument(editor.documents[nextIndex].id);
            break;
          }
          case 'new-image': setDialog('new'); break;
          case 'open-image': fileInputRef.current?.click(); break;
          case 'close-image': {
            const active = editor.documents.find((document) => document.id === editor.activeDocumentId);
            if (active?.dirty) setClosingDocumentId(active.id);
            else if (active) editor.closeDocument(active.id);
            break;
          }
          case 'close-all': requestCloseAll(); break;
          case 'save-image': void editor.saveImage(); break;
          case 'save-as': setShowSaveAs(true); break;
          case 'save-all': void editor.saveAllImages().then((count) => notify(count ? `Saved ${count} ${count === 1 ? 'image' : 'images'}` : 'All images are already saved')); break;
          case 'print': openPrintDialog(); break;
          case 'undo': editor.undo(); break;
          case 'redo': editor.redo(); break;
          case 'cut': if (editor.cutSelection()) notify('Cut selection'); break;
          case 'copy': if (editor.copySelection()) notify('Copied selection'); break;
          case 'copy-merged': if (editor.copyMerged()) notify('Copied merged image'); break;
          case 'paste': requestPaste('current'); break;
          case 'paste-new-layer': requestPaste('new-layer'); break;
          case 'paste-new-image': if (editor.pasteIntoNewImage()) notify('Pasted into a new image'); break;
          case 'erase-selection':
            if (editor.lineDraft) {
              if (!editor.deleteLinePoint()) editor.cancelLine();
            } else if (editor.shapeDraft) editor.cancelShape();
            else if (editor.hasSelection) editor.clearActiveLayer();
            break;
          case 'fill-selection':
            if (editor.polygonLassoPointCount > 0) editor.removePolygonLassoPoint();
            else if (editor.hasSelection) editor.fillSelection();
            break;
          case 'invert-selection': editor.invertSelection(); break;
          case 'offset-selection': if (editor.hasSelection) setShowOffsetSelection(true); break;
          case 'select-all': editor.selectAll(); break;
          case 'deselect': editor.deselect(); break;
          case 'crop-selection': editor.cropToSelection(); break;
          case 'auto-crop': if (!editor.autoCropImage()) notify('The image already fits its visible content'); break;
          case 'resize-image': setDialog('resize-image'); break;
          case 'resize-canvas': setDialog('resize-canvas'); break;
          case 'rotate-clockwise': editor.rotateImage('clockwise'); break;
          case 'rotate-counter-clockwise': editor.rotateImage('counter-clockwise'); break;
          case 'rotate-180': editor.rotateImage('180'); break;
          case 'flatten-image': editor.flattenImage(); break;
          case 'add-layer': editor.addLayer(); break;
          case 'delete-layer': editor.deleteLayer(); break;
          case 'duplicate-layer': editor.duplicateLayer(); break;
          case 'merge-layer-down': editor.mergeLayerDown(); break;
          case 'flip-layer-horizontal': editor.flipLayer('horizontal'); break;
          case 'flip-layer-vertical': editor.flipLayer('vertical'); break;
          case 'layer-properties': setLayerPropertiesId(editor.activeLayerId); break;
          case 'curves': setEffectDialog('curves'); break;
          case 'invert-colors': void editor.applyEffect('invert').catch(() => notify('Invert Colors could not be applied.')); break;
          case 'levels': setEffectDialog('levels'); break;
        }
        return;
      }

      if (editor.lineDraft && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
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
      } else if (event.key === 'Enter' && editor.polygonLassoPointCount > 0) {
        event.preventDefault();
        editor.finishPolygonLasso();
      } else if (event.key === 'Enter' && editor.lineDraft) {
        event.preventDefault();
        editor.commitLine();
      } else if (event.key === 'Enter' && editor.shapeDraft) {
        event.preventDefault();
        editor.commitShape();
      } else if (event.key === 'Escape') {
        if (editor.polygonLassoPointCount > 0) editor.cancelPolygonLasso();
        else if (editor.lineDraft) editor.cancelLine();
        else if (editor.shapeDraft) editor.cancelShape();
        else editor.deselect();
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        editor.swapColors();
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        const nextTool = nextToolForShortcut(editor.tool, event.key);
        if (nextTool) {
          event.preventDefault();
          editor.setTool(nextTool);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [closingDocumentId, colorDialogTarget, dialog, editingPaletteIndex, editor, effectDialog, layerPropertiesId, notify, openMenu, openPrintDialog, paletteDialog, pendingPaste, printPreview, requestCloseAll, requestPaste, rotateZoomLayerId, screenshotBusy, showAbout, showAddinManager, showCanvasGridDialog, showCloseAllConfirm, showKeyboardShortcuts, showLanguage, showOffsetSelection, showSaveAs, showScreenshot, showSidebar, showToolbox, toggleFullscreen, zoomToWindow]);

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

  const zoomAtPoint = useCallback((requestedZoom: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    const canvas = viewport?.querySelector<HTMLElement>('.canvas-stack');
    if (!viewport || !canvas) return;
    const nextZoom = Math.min(4, Math.max(0.1, requestedZoom));
    if (Math.abs(nextZoom - zoomRef.current) < 0.0001) return;
    const canvasBounds = canvas.getBoundingClientRect();
    const renderedZoom = renderedZoomRef.current;
    zoomAnchorRef.current = {
      imageX: (clientX - canvasBounds.left) / renderedZoom,
      imageY: (clientY - canvasBounds.top) / renderedZoom,
      clientX,
      clientY,
    };
    zoomRef.current = nextZoom;
    editor.setZoom(nextZoom);
  }, [editor.setZoom]);

  useLayoutEffect(() => {
    renderedZoomRef.current = editor.zoom;
    zoomRef.current = editor.zoom;
    const anchor = zoomAnchorRef.current;
    const viewport = viewportRef.current;
    const canvas = viewport?.querySelector<HTMLElement>('.canvas-stack');
    if (!anchor || !viewport || !canvas) return;
    const canvasBounds = canvas.getBoundingClientRect();
    viewport.scrollLeft += canvasBounds.left + anchor.imageX * editor.zoom - anchor.clientX;
    viewport.scrollTop += canvasBounds.top + anchor.imageY * editor.zoom - anchor.clientY;
    zoomAnchorRef.current = null;
  }, [editor.zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? viewport.clientHeight
          : 1);
      zoomAtPoint(zoomRef.current * Math.exp(-delta * 0.0025), event.clientX, event.clientY);
    };
    const gesturePoint = (event: Event) => {
      const gesture = event as Event & { clientX?: number; clientY?: number };
      const bounds = viewport.getBoundingClientRect();
      return {
        x: gesture.clientX ?? bounds.left + bounds.width / 2,
        y: gesture.clientY ?? bounds.top + bounds.height / 2,
      };
    };
    const gestureStart = (event: Event) => {
      event.preventDefault();
      gestureStartZoomRef.current = zoomRef.current;
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale?: number };
      const point = gesturePoint(event);
      zoomAtPoint((gestureStartZoomRef.current ?? zoomRef.current) * Math.max(0.01, gesture.scale ?? 1), point.x, point.y);
    };
    const gestureEnd = (event: Event) => {
      event.preventDefault();
      gestureStartZoomRef.current = null;
    };

    viewport.addEventListener('wheel', wheel, { passive: false });
    viewport.addEventListener('gesturestart', gestureStart, { passive: false });
    viewport.addEventListener('gesturechange', gestureChange, { passive: false });
    viewport.addEventListener('gestureend', gestureEnd, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('gesturestart', gestureStart);
      viewport.removeEventListener('gesturechange', gestureChange);
      viewport.removeEventListener('gestureend', gestureEnd);
    };
  }, [zoomAtPoint]);

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
    if (
      viewportRef.current &&
      editor.selectionAutoScroll &&
      ['rectangle-select', 'ellipse-select', 'lasso-select'].includes(editor.tool) &&
      event.buttons !== 0
    ) {
      const viewport = viewportRef.current;
      const bounds = viewport.getBoundingClientRect();
      const edge = 18;
      const scrollX = event.clientX < bounds.left + edge ? -12 : event.clientX > bounds.right - edge ? 12 : 0;
      const scrollY = event.clientY < bounds.top + edge ? -12 : event.clientY > bounds.bottom - edge ? 12 : 0;
      if (scrollX || scrollY) viewport.scrollBy(scrollX, scrollY);
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
  const closeAllDocument = editor.documents.find((document) => document.id === closeAllQueue[0]);

  const renderMenuContent = (name: Exclude<MenuName, null | 'main'>) => {
    switch (name) {
      case 'pinta':
        return (
          <>
            <MenuItem icon={<PintaIcon file="help-about-symbolic.svg" size={15} standard />} label="About Pinta" onClick={() => closeAnd(() => setShowAbout(true))} />
            <MenuItem icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />} label="Keyboard Shortcuts…" shortcut="⌘," onClick={() => closeAnd(() => setShowKeyboardShortcuts(true))} />
            <MenuItem icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />} label="Language…" onClick={() => closeAnd(() => setShowLanguage(true))} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="help-website-symbolic.svg" size={15} />} label="Pinta Website" onClick={() => closeAnd(() => window.open('https://www.pinta-project.com', '_blank', 'noopener,noreferrer'))} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="window-close-symbolic.svg" size={15} standard />} label="Quit Pinta" shortcut="⌘Q" onClick={requestCloseAll} />
          </>
        );
      case 'file':
        return (
          <>
            <MenuItem icon={<PintaIcon file="document-new-symbolic.svg" size={15} standard />} label="New" shortcut="⌘N" onClick={() => openDialog('new')} />
            <MenuItem icon={<PintaIcon file="view-fullscreen-symbolic.svg" size={15} standard />} label="New Screenshot…" onClick={() => closeAnd(() => {
              setScreenshotError('');
              setShowScreenshot(true);
            })} />
            <MenuItem icon={<PintaIcon file="document-open-symbolic.svg" size={15} standard />} label="Open…" shortcut="⌘O" onClick={() => closeAnd(() => fileInputRef.current?.click())} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="document-save-symbolic.svg" size={15} standard />} label="Save" shortcut="⌘S" onClick={() => closeAnd(() => { void editor.saveImage(); })} />
            <MenuItem icon={<PintaIcon file="document-save-as-symbolic.svg" size={15} standard />} label="Save As…" shortcut="⇧⌘S" onClick={() => closeAnd(() => setShowSaveAs(true))} />
            <MenuItem icon={<PintaIcon file="document-print-symbolic.svg" size={15} standard />} label="Print…" shortcut="⌘P" onClick={openPrintDialog} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="window-close-symbolic.svg" size={15} standard />} label="Close" shortcut="⌘W" onClick={() => requestCloseDocument(editor.activeDocumentId)} />
          </>
        );
      case 'edit':
        return (
          <>
            <MenuItem icon={<PintaIcon file="edit-undo-symbolic.svg" size={15} standard />} label="Undo" shortcut="⌘Z" disabled={!canUndo} onClick={() => closeAnd(editor.undo)} />
            <MenuItem icon={<PintaIcon file="edit-redo-symbolic.svg" size={15} standard />} label="Redo" shortcut="⇧⌘Z" disabled={!canRedo} onClick={() => closeAnd(editor.redo)} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="edit-cut-symbolic.svg" size={15} standard />} label="Cut" shortcut="⌘X" onClick={() => closeAnd(() => editor.cutSelection())} />
            <MenuItem icon={<PintaIcon file="edit-copy-symbolic.svg" size={15} standard />} label="Copy" shortcut="⌘C" onClick={() => closeAnd(() => editor.copySelection())} />
            <MenuItem icon={<PintaIcon file="edit-copy-symbolic.svg" size={15} standard />} label="Copy Merged" shortcut="⇧⌘C" onClick={() => closeAnd(() => editor.copyMerged())} />
            <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste" shortcut="⌘V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => { requestPaste('current'); })} />
            <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste Into New Layer" shortcut="⇧⌘V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => { requestPaste('new-layer'); })} />
            <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste Into New Image" shortcut="⌥⌘V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.pasteIntoNewImage())} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="edit-select-all-symbolic.svg" size={15} standard />} label="Select All" shortcut="⌘A" onClick={() => closeAnd(editor.selectAll)} />
            <MenuItem icon={<PintaIcon file="ui-deselect-symbolic.svg" size={15} />} label="Deselect All" shortcut="⇧⌘A" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.deselect)} />
            <MenuItem icon={<PintaIcon file="edit-selection-erase-symbolic.svg" size={16} />} label="Erase Selection" shortcut="⌦" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.clearActiveLayer)} />
            <MenuItem icon={<PintaIcon file="edit-selection-fill-symbolic.svg" size={16} />} label="Fill Selection" shortcut="⌫" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.fillSelection)} />
            <MenuItem icon={<PintaIcon file="edit-selection-invert-symbolic.svg" size={16} />} label="Invert Selection" shortcut="⌘I" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.invertSelection)} />
            <MenuItem icon={<PintaIcon file="edit-selection-offset-symbolic.svg" size={16} />} label="Offset Selection…" shortcut="⇧⌘O" disabled={!editor.hasSelection} onClick={() => closeAnd(() => setShowOffsetSelection(true))} />
            <div className="menu-divider" />
            <div className="menu-caption">{translateUi('Palette')}</div>
            <MenuItem icon={<PintaIcon file="tool-palette-symbolic.svg" size={15} />} label="Add Primary Color" disabled={editor.palette.length >= 96} onClick={() => closeAnd(() => {
              if (editor.addPaletteColor(editor.primary)) notify(`Added ${editor.primary} to the palette`);
            })} />
            <MenuItem icon={<PintaIcon file="document-open-symbolic.svg" size={15} standard />} label="Open…" onClick={() => closeAnd(() => paletteInputRef.current?.click())} />
            <MenuItem icon={<PintaIcon file="document-save-as-symbolic.svg" size={15} standard />} label="Save As…" onClick={() => closeAnd(() => setPaletteDialog('save'))} />
            <MenuItem icon={<PintaIcon file="document-revert-symbolic.svg" size={15} standard />} label="Reset to Default" onClick={() => closeAnd(() => {
              editor.resetPalette();
              notify('Palette reset to Pinta defaults');
            })} />
            <MenuItem label="Set Number of Colors…" onClick={() => closeAnd(() => setPaletteDialog('resize'))} />
          </>
        );
      case 'view':
        return (
          <>
            <MenuItem icon={<PintaIcon file="value-increase-symbolic.svg" size={15} standard />} label="Zoom In" shortcut="+" onClick={() => closeAnd(() => editor.setZoom(editor.zoom * 1.25))} />
            <MenuItem icon={<PintaIcon file="value-decrease-symbolic.svg" size={15} standard />} label="Zoom Out" shortcut="−" onClick={() => closeAnd(() => editor.setZoom(editor.zoom * 0.8))} />
            <MenuItem icon={<PintaIcon file="zoom-original-symbolic.svg" size={15} standard />} label="Normal Size" shortcut="⌘0" onClick={() => closeAnd(() => editor.setZoom(1))} />
            <MenuItem icon={<PintaIcon file="zoom-fit-best-symbolic.svg" size={15} standard />} label="Best Fit" shortcut="⌘B" onClick={() => closeAnd(zoomToWindow)} />
            <MenuItem icon={<PintaIcon file="view-zoom-selection.png" size={15} />} label="Zoom to Selection" disabled={!editor.hasSelection} onClick={() => closeAnd(zoomToSelection)} />
            <MenuItem icon={<PintaIcon file="view-fullscreen-symbolic.svg" size={15} standard />} label="Fullscreen" shortcut="F11" checked={isFullscreen} onClick={() => closeAnd(() => void toggleFullscreen())} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="view-grid.png" size={15} />} label="Canvas Grid…" onClick={() => closeAnd(() => setShowCanvasGridDialog(true))} />
            <div className="menu-caption">{translateUi('Ruler Units')}</div>
            <MenuItem checked={rulerMetric === 'pixels'} label="Pixels" onClick={() => closeAnd(() => setRulerMetric('pixels'))} />
            <MenuItem checked={rulerMetric === 'inches'} label="Inches" onClick={() => closeAnd(() => setRulerMetric('inches'))} />
            <MenuItem checked={rulerMetric === 'centimeters'} label="Centimeters" onClick={() => closeAnd(() => setRulerMetric('centimeters'))} />
            <div className="menu-divider" />
            <div className="menu-caption">{translateUi('Show / Hide')}</div>
            <MenuItem checked label="Menu Bar" disabled />
            <MenuItem checked={showToolbar} label="Tool Bar" onClick={() => closeAnd(() => setShowToolbar((value) => !value))} />
            <MenuItem checked={showRulers} label="Rulers" onClick={() => closeAnd(() => setShowRulers((value) => !value))} />
            <MenuItem checked={showToolbox} label="Tool Box" onClick={() => closeAnd(() => setShowToolbox((value) => !value))} />
            <MenuItem checked={showSidebar} label="Tool Windows" shortcut="F12" onClick={() => closeAnd(() => setShowSidebar((value) => !value))} />
            <MenuItem checked={showPalette} label="Status Bar" onClick={() => closeAnd(() => setShowPalette((value) => !value))} />
            <MenuItem checked={showDocumentTabs} label="Image Tabs" onClick={() => closeAnd(() => setShowDocumentTabs((value) => !value))} />
            <div className="menu-divider" />
            <div className="menu-caption">{translateUi('Color Scheme')}</div>
            <MenuItem checked={theme === 'light'} label="Light" onClick={() => closeAnd(() => setTheme('light'))} />
            <MenuItem checked={theme === 'dark'} label="Dark" onClick={() => closeAnd(() => setTheme('dark'))} />
          </>
        );
      case 'image':
        return (
          <>
            <MenuItem icon={<PintaIcon file="ui-crop-to-selection-symbolic.svg" size={15} />} label="Crop to Selection" shortcut="⇧⌘X" disabled={!editor.hasSelection} onClick={() => closeAnd(() => editor.cropToSelection())} />
            <MenuItem icon={<PintaIcon file="ui-crop-to-selection-symbolic.svg" size={15} />} label="Auto Crop" shortcut="⌃⌥X" onClick={() => closeAnd(() => {
              if (!editor.autoCropImage()) notify('The image already fits its visible content');
            })} />
            <MenuItem icon={<PintaIcon file="image-resize-symbolic.svg" size={15} />} label="Resize Image…" shortcut="⌘R" onClick={() => openDialog('resize-image')} />
            <MenuItem icon={<PintaIcon file="image-resize-canvas-symbolic.svg" size={15} />} label="Resize Canvas…" shortcut="⇧⌘R" onClick={() => openDialog('resize-canvas')} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="image-flip-horizontal-symbolic.svg" size={15} />} label="Flip Horizontal" onClick={() => closeAnd(() => editor.flipImage('horizontal'))} />
            <MenuItem icon={<PintaIcon file="image-flip-vertical-symbolic.svg" size={15} />} label="Flip Vertical" onClick={() => closeAnd(() => editor.flipImage('vertical'))} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="image-rotate-90cw-symbolic.svg" size={15} />} label="Rotate 90° Clockwise" shortcut="⌘H" onClick={() => closeAnd(() => editor.rotateImage('clockwise'))} />
            <MenuItem icon={<PintaIcon file="image-rotate-90ccw-symbolic.svg" size={15} />} label="Rotate 90° Counter-Clockwise" shortcut="⌘G" onClick={() => closeAnd(() => editor.rotateImage('counter-clockwise'))} />
            <MenuItem icon={<PintaIcon file="image-rotate-180-symbolic.svg" size={15} />} label="Rotate 180°" shortcut="⌘J" onClick={() => closeAnd(() => editor.rotateImage('180'))} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="image-flatten-symbolic.svg" size={16} />} label="Flatten" shortcut="⇧⌘F" disabled={editor.layers.length < 2} onClick={() => closeAnd(editor.flattenImage)} />
          </>
        );
      case 'adjustments':
        return visibleEffects.filter((effect) => effect.category === 'adjustment').map((effect) => (
          <MenuItem
            key={effect.id}
            icon={<PintaIcon file={effect.icon} size={16} />}
            label={`${effect.name}${effect.parameters.length || effect.dialog ? '…' : ''}`}
            shortcut={ADJUSTMENT_SHORTCUTS[effect.id]}
            onClick={() => chooseEffect(effect.id)}
          />
        ));
      case 'effects':
        return EFFECT_MENU_CATEGORIES.map(([category, label]) => (
          <div className="effect-menu-group" key={category}>
            <div className="menu-caption">{translateUi(label)}</div>
            {visibleEffects.filter((effect) => effect.category === category).map((effect) => (
              <MenuItem
                key={effect.id}
                icon={<PintaIcon file={effect.icon} size={16} />}
                label={`${effect.name}${effect.parameters.length || effect.dialog ? '…' : ''}`}
                onClick={() => chooseEffect(effect.id)}
              />
            ))}
          </div>
        ));
      case 'addins':
        return (
          <>
            <MenuItem icon={<PintaIcon file="addins-manage.png" size={15} />} label="Add-in Manager…" onClick={() => closeAnd(() => setShowAddinManager(true))} />
            <div className="menu-divider" />
            <div className="menu-caption">{translateUi('Bundled web add-ins')}</div>
            {ADDIN_DEFINITIONS.map((addin) => (
              <MenuItem
                key={addin.id}
                checked={enabledAddins.includes(addin.id)}
                label={addin.name}
                onClick={() => closeAnd(() => setAddinEnabled(addin.id, !enabledAddins.includes(addin.id)))}
              />
            ))}
            <div className="menu-note">{translateUi('Enabled add-ins appear in the toolbox, Adjustments, or Effects menus.')}</div>
          </>
        );
      case 'window':
        return (
          <>
            <MenuItem icon={<PintaIcon file="document-save-symbolic.svg" size={15} standard />} label="Save All" shortcut="⌃⌥A" disabled={!editor.documents.some((document) => document.dirty)} onClick={() => closeAnd(() => {
              void editor.saveAllImages().then((count) => notify(`Saved ${count} ${count === 1 ? 'image' : 'images'}`));
            })} />
            <MenuItem icon={<PintaIcon file="window-close-symbolic.svg" size={15} standard />} label="Close All" shortcut="⇧⌘W" onClick={requestCloseAll} />
            <div className="menu-divider" />
            {editor.documents.map((document, index) => (
              <MenuItem
                key={document.id}
                checked={document.id === editor.activeDocumentId}
                label={`${translateDocumentName(document.fileName)}${document.dirty ? '*' : ''}`}
                shortcut={index < 9 ? `⌥${index + 1}` : undefined}
                onClick={() => closeAnd(() => editor.switchDocument(document.id))}
              />
            ))}
          </>
        );
      case 'help':
        return (
          <>
            <MenuItem icon={<PintaIcon file="help-browser-symbolic.svg" size={15} standard />} label="Pinta Help" shortcut="F1" onClick={() => closeAnd(() => window.open(USER_GUIDE_URL, '_blank', 'noopener,noreferrer'))} />
            <MenuItem icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />} label="Keyboard Shortcuts…" shortcut="⌘," onClick={() => closeAnd(() => setShowKeyboardShortcuts(true))} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="help-website-symbolic.svg" size={15} />} label="Pinta Website" onClick={() => closeAnd(() => window.open('https://www.pinta-project.com', '_blank', 'noopener,noreferrer'))} />
            <MenuItem icon={<PintaIcon file="help-bug.png" size={15} />} label="File a Bug" onClick={() => closeAnd(() => window.open(WEB_BUG_REPORT_URL, '_blank', 'noopener,noreferrer'))} />
            <MenuItem icon={<PintaIcon file="help-translate.png" size={15} />} label="Translate This Application" onClick={() => closeAnd(() => window.open('https://hosted.weblate.org/engage/pinta/', '_blank', 'noopener,noreferrer'))} />
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
      data-locale={i18n.resolvedLanguage ?? i18n.language}
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
      data-selection-bounds={editor.selectionBounds ? [editor.selectionBounds.x, editor.selectionBounds.y, editor.selectionBounds.width, editor.selectionBounds.height].join(',') : ''}
      data-selection-resizable={editor.selectionResizable ? 'true' : 'false'}
      data-zoom={editor.zoom.toFixed(4)}
    >
      <h1 className="visually-hidden">{translateUi('Pinta Online — free browser-based paint and image editor')}</h1>
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
        aria-label={translateUi('Application menu')}
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
        <span className="macos-menu-document" title={translateDocumentName(editor.fileName)}>{translateDocumentName(editor.fileName)}{editor.dirty ? '*' : ''}</span>
      </nav>

      {showToolbar && <header className="header-bar" onClick={() => {
        setOpenMenu(null);
        setMenuSurface(null);
      }}>
        <div className="header-cluster">
          <IconButton label="New Image (Ctrl+N)" onClick={() => openDialog('new')}><PintaIcon file="document-new-symbolic.svg" size={iconSize} standard /></IconButton>
          <IconButton label="Open Image (Ctrl+O)" onClick={() => fileInputRef.current?.click()}><PintaIcon file="document-open-symbolic.svg" size={iconSize} standard /></IconButton>
          <IconButton label="Save Image (Ctrl+S)" onClick={() => void editor.saveImage()}><PintaIcon file="document-save-symbolic.svg" size={iconSize} standard /></IconButton>
          <span className="toolbar-separator" />
          <IconButton label="Undo (Ctrl+Z)" onClick={editor.undo} disabled={!canUndo}><PintaIcon file="edit-undo-symbolic.svg" size={iconSize} standard /></IconButton>
          <IconButton label="Redo (Ctrl+Y)" onClick={editor.redo} disabled={!canRedo}><PintaIcon file="edit-redo-symbolic.svg" size={iconSize} standard /></IconButton>
          <span className="toolbar-separator" />
          <IconButton label="Cut (Ctrl+X)" onClick={() => {
            if (editor.cutSelection()) notify('Cut selection');
          }}><PintaIcon file="edit-cut-symbolic.svg" size={iconSize} standard /></IconButton>
          <IconButton label="Copy (Ctrl+C)" onClick={() => {
            if (editor.copySelection()) notify('Copied selection');
          }}><PintaIcon file="edit-copy-symbolic.svg" size={iconSize} standard /></IconButton>
          <IconButton label="Paste (Ctrl+V)" disabled={!editor.hasClipboard} onClick={() => {
            requestPaste('current');
          }}><PintaIcon file="edit-paste-symbolic.svg" size={iconSize} standard /></IconButton>
          <IconButton label="Crop to Selection" disabled={!editor.hasSelection} onClick={() => editor.cropToSelection()}><PintaIcon file="ui-crop-to-selection-symbolic.svg" size={iconSize} /></IconButton>
          <IconButton label="Deselect (Esc)" disabled={!editor.hasSelection} onClick={editor.deselect}><PintaIcon file="ui-deselect-symbolic.svg" size={iconSize} /></IconButton>
        </div>

        <div className="window-title">
          <span>{translateDocumentName(editor.fileName)}{editor.dirty ? '*' : ''}</span>
          <span className="window-app-name">Pinta</span>
        </div>

        <div className="header-cluster header-cluster-end" onClick={(event) => event.stopPropagation()}>
          <div className="menu-anchor">
            <IconButton label="View" active={menuSurface === 'header' && openMenu === 'view'} onClick={() => toggleHeaderMenu('view')}><PintaIcon file="view-reveal-symbolic.svg" size={iconSize} standard /></IconButton>
            {menuSurface === 'header' && openMenu === 'view' && (
              <Popover align="right" className="view-menu-popover">{renderMenuContent('view')}</Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Image" active={menuSurface === 'header' && openMenu === 'image'} onClick={() => toggleHeaderMenu('image')}><PintaIcon file="image-x-generic-symbolic.svg" size={iconSize} standard /></IconButton>
            {menuSurface === 'header' && openMenu === 'image' && (
              <Popover align="right">{renderMenuContent('image')}</Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Adjustments" active={menuSurface === 'header' && openMenu === 'adjustments'} onClick={() => toggleHeaderMenu('adjustments')}><PintaIcon file="adjustments-default-symbolic.svg" size={iconSize} /></IconButton>
            {menuSurface === 'header' && openMenu === 'adjustments' && (
              <Popover align="right" className="effect-menu-popover">{renderMenuContent('adjustments')}</Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Effects" active={menuSurface === 'header' && openMenu === 'effects'} onClick={() => toggleHeaderMenu('effects')}><PintaIcon file="effects-default-symbolic.svg" size={iconSize} /></IconButton>
            {menuSurface === 'header' && openMenu === 'effects' && (
              <Popover align="right" className="effect-menu-popover">{renderMenuContent('effects')}</Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Main Menu" active={menuSurface === 'header' && openMenu === 'main'} onClick={() => toggleHeaderMenu('main')}><PintaIcon file="open-menu-symbolic.svg" size={iconSize} standard /></IconButton>
            {menuSurface === 'header' && openMenu === 'main' && (
              <Popover align="right" className="main-menu-popover">
                <MenuItem icon={<PintaIcon file="document-new-symbolic.svg" size={15} standard />} label="New" shortcut="Ctrl+N" onClick={() => openDialog('new')} />
                <MenuItem icon={<PintaIcon file="view-fullscreen-symbolic.svg" size={15} standard />} label="New Screenshot…" onClick={() => closeAnd(() => {
                  setScreenshotError('');
                  setShowScreenshot(true);
                })} />
                <MenuItem icon={<PintaIcon file="document-open-symbolic.svg" size={15} standard />} label="Open…" shortcut="Ctrl+O" onClick={() => closeAnd(() => fileInputRef.current?.click())} />
                <MenuItem icon={<PintaIcon file="document-save-symbolic.svg" size={15} standard />} label="Save" shortcut="Ctrl+S" onClick={() => closeAnd(() => { void editor.saveImage(); })} />
                <MenuItem icon={<PintaIcon file="document-save-as-symbolic.svg" size={15} standard />} label="Save As…" shortcut="Ctrl+Shift+S" onClick={() => closeAnd(() => setShowSaveAs(true))} />
                <MenuItem icon={<PintaIcon file="document-print-symbolic.svg" size={15} standard />} label="Print…" shortcut="Ctrl+P" onClick={openPrintDialog} />
                <MenuItem icon={<PintaIcon file="window-close-symbolic.svg" size={15} standard />} label="Close" shortcut="Ctrl+W" onClick={() => requestCloseDocument(editor.activeDocumentId)} />
                <MenuItem icon={<PintaIcon file="document-save-symbolic.svg" size={15} standard />} label="Save All" shortcut="Ctrl+Alt+A" disabled={!editor.documents.some((document) => document.dirty)} onClick={() => closeAnd(() => {
                  void editor.saveAllImages().then((count) => notify(`Saved ${count} ${count === 1 ? 'image' : 'images'}`));
                })} />
                <MenuItem icon={<PintaIcon file="window-close-symbolic.svg" size={15} standard />} label="Close All" shortcut="Ctrl+Shift+W" onClick={requestCloseAll} />
                <div className="menu-divider" />
                <MenuItem icon={<PintaIcon file="edit-undo-symbolic.svg" size={15} standard />} label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => closeAnd(editor.undo)} />
                <MenuItem icon={<PintaIcon file="edit-redo-symbolic.svg" size={15} standard />} label="Redo" shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={() => closeAnd(editor.redo)} />
                <div className="menu-divider" />
                <MenuItem icon={<PintaIcon file="edit-cut-symbolic.svg" size={15} standard />} label="Cut" shortcut="Ctrl+X" onClick={() => closeAnd(() => editor.cutSelection())} />
                <MenuItem icon={<PintaIcon file="edit-copy-symbolic.svg" size={15} standard />} label="Copy" shortcut="Ctrl+C" onClick={() => closeAnd(() => editor.copySelection())} />
                <MenuItem icon={<PintaIcon file="edit-copy-symbolic.svg" size={15} standard />} label="Copy Merged" shortcut="Ctrl+Shift+C" onClick={() => closeAnd(() => editor.copyMerged())} />
                <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste" shortcut="Ctrl+V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => { requestPaste('current'); })} />
                <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste Into New Layer" shortcut="Ctrl+Shift+V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => { requestPaste('new-layer'); })} />
                <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste Into New Image" shortcut="Shift+V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.pasteIntoNewImage())} />
                <div className="menu-divider" />
                <MenuItem icon={<PintaIcon file="edit-select-all-symbolic.svg" size={15} standard />} label="Select All" shortcut="Ctrl+A" onClick={() => closeAnd(editor.selectAll)} />
                <MenuItem icon={<PintaIcon file="ui-deselect-symbolic.svg" size={15} />} label="Deselect All" shortcut="Ctrl+Shift+A" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.deselect)} />
                <div className="menu-divider" />
                <MenuItem icon={<PintaIcon file="edit-selection-erase-symbolic.svg" size={16} />} label="Erase Selection" shortcut="Delete" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.clearActiveLayer)} />
                <MenuItem icon={<PintaIcon file="edit-selection-fill-symbolic.svg" size={16} />} label="Fill Selection" shortcut="Backspace" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.fillSelection)} />
                <MenuItem icon={<PintaIcon file="edit-selection-invert-symbolic.svg" size={16} />} label="Invert Selection" shortcut="Ctrl+I" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.invertSelection)} />
                <MenuItem icon={<PintaIcon file="edit-selection-offset-symbolic.svg" size={16} />} label="Offset Selection…" shortcut="Ctrl+Shift+O" disabled={!editor.hasSelection} onClick={() => closeAnd(() => setShowOffsetSelection(true))} />
                <div className="menu-divider" />
                <div className="menu-caption">{translateUi('Palette')}</div>
                <MenuItem icon={<PintaIcon file="tool-palette-symbolic.svg" size={15} />} label="Add Primary Color" disabled={editor.palette.length >= 96} onClick={() => closeAnd(() => {
                  if (editor.addPaletteColor(editor.primary)) notify(`Added ${editor.primary} to the palette`);
                })} />
                <MenuItem icon={<PintaIcon file="document-open-symbolic.svg" size={15} standard />} label="Open Palette…" onClick={() => closeAnd(() => paletteInputRef.current?.click())} />
                <MenuItem icon={<PintaIcon file="document-save-as-symbolic.svg" size={15} standard />} label="Save Palette As…" onClick={() => closeAnd(() => setPaletteDialog('save'))} />
                <MenuItem icon={<PintaIcon file="document-revert-symbolic.svg" size={15} standard />} label="Reset Palette to Default" onClick={() => closeAnd(() => {
                  editor.resetPalette();
                  notify('Palette reset to Pinta defaults');
                })} />
                <MenuItem label="Set Number of Colors…" onClick={() => closeAnd(() => setPaletteDialog('resize'))} />
                <div className="menu-divider" />
                <div className="menu-caption">{translateUi('Help')}</div>
                <MenuItem icon={<PintaIcon file="help-browser-symbolic.svg" size={15} standard />} label="Contents" shortcut="F1" onClick={() => closeAnd(() => window.open(USER_GUIDE_URL, '_blank', 'noopener,noreferrer'))} />
                <MenuItem icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />} label="Keyboard Shortcuts" shortcut="Ctrl+," onClick={() => closeAnd(() => setShowKeyboardShortcuts(true))} />
                <MenuItem icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />} label="Language…" onClick={() => closeAnd(() => setShowLanguage(true))} />
                <MenuItem icon={<PintaIcon file="help-website-symbolic.svg" size={15} />} label="Pinta Website" onClick={() => closeAnd(() => window.open('https://www.pinta-project.com', '_blank', 'noopener,noreferrer'))} />
                <MenuItem icon={<PintaIcon file="help-bug.png" size={15} />} label="File a Bug" onClick={() => closeAnd(() => window.open(WEB_BUG_REPORT_URL, '_blank', 'noopener,noreferrer'))} />
                <MenuItem icon={<PintaIcon file="help-translate.png" size={15} />} label="Translate This Application" onClick={() => closeAnd(() => window.open('https://hosted.weblate.org/engage/pinta/', '_blank', 'noopener,noreferrer'))} />
                <div className="menu-divider" />
                <MenuItem icon={<PintaIcon file="help-about-symbolic.svg" size={15} standard />} label="About" onClick={() => closeAnd(() => setShowAbout(true))} />
              </Popover>
            )}
          </div>
          <span className="toolbar-separator" />
          <IconButton label={showSidebar ? 'Hide sidebar' : 'Show sidebar'} onClick={() => setShowSidebar((value) => !value)}>
            <PintaIcon file={showSidebar ? 'view-conceal-symbolic.svg' : 'view-reveal-symbolic.svg'} size={iconSize} standard />
          </IconButton>
          <IconButton label="Fullscreen" onClick={() => void toggleFullscreen()}><PintaIcon file="view-fullscreen-symbolic.svg" size={iconSize} standard /></IconButton>
        </div>
      </header>}

      <NativeToolOptions editor={editor} currentTool={currentTool} blockBrushEnabled={enabledAddins.includes('block-brush')} />

      <div className={`editor-body ${showSidebar ? 'with-sidebar' : ''}`} onClick={() => setOpenMenu(null)}>
        {showToolbox && (
          <aside className="toolbox" aria-label={translateUi('Tools')}>
            {visibleTools.map((item) => {
              const toolName = translateUi(item.name);
              return (
                <button
                  key={item.id}
                  className={`tool-button ${editor.tool === item.id ? 'active' : ''}`}
                  type="button"
                  title={`${toolName}${item.shortcut ? `\n${translateUi('Shortcut key')}: ${item.shortcut}` : ''}\n${translateUi(item.status)}`}
                  aria-label={toolName}
                  onClick={() => editor.setTool(item.id)}
                >
                  <PintaIcon file={item.icon} size={22} />
                </button>
              );
            })}
          </aside>
        )}

        <div className="canvas-area">
          {showDocumentTabs && editor.documents.length > 1 && (
            <nav className="document-tabs" role="tablist" aria-label="Open images">
              <div className="document-tabs-scroll">
                {editor.documents.map((document) => (
                  <div className={`document-tab ${document.id === editor.activeDocumentId ? 'active' : ''}`} key={document.id}>
                    <button
                      type="button"
                      className="document-tab-activate"
                      role="tab"
                      aria-selected={document.id === editor.activeDocumentId}
                      title={`${translateDocumentName(document.fileName)} · ${document.width} × ${document.height}`}
                      onClick={() => editor.switchDocument(document.id)}
                    >
                      <PintaIcon file="image-x-generic-symbolic.svg" size={13} standard />
                      <span>{translateDocumentName(document.fileName)}{document.dirty ? '*' : ''}</span>
                    </button>
                    <button
                      type="button"
                      className="document-tab-close"
                      aria-label={`Close ${document.fileName}`}
                      title={`Close ${document.fileName}`}
                      onClick={() => requestCloseDocument(document.id)}
                    >
                      <PintaIcon file="window-close-symbolic.svg" size={12} standard />
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
              onScroll={(event) => {
                const { scrollLeft, scrollTop } = event.currentTarget;
                setViewportMetrics((current) => ({ ...current, scrollLeft, scrollTop }));
              }}
            >
            <div className="canvas-centering-frame">
              <div
                className={`canvas-stack tool-${editor.tool}`}
                style={{ ...canvasStyle, cursor: editor.selectionCursor || TOOL_CURSORS[editor.tool] }}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
                onContextMenu={(event) => event.preventDefault()}
              >
                <canvas ref={editor.displayCanvasRef} width={editor.width} height={editor.height} />
                <canvas ref={editor.previewCanvasRef} width={editor.width} height={editor.height} className="preview-canvas" />
                <canvas ref={editor.selectionCanvasRef} width={editor.width} height={editor.height} className="selection-canvas" />
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
                      <button type="button" aria-label="Commit text" title="Commit text" onClick={editor.commitText}><span className="native-checkmark" aria-hidden="true" /></button>
                      <button type="button" aria-label="Cancel text" title="Cancel text" onClick={editor.cancelText}><PintaIcon file="window-close-symbolic.svg" size={13} standard /></button>
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
                        fontVariantCaps: editor.textVariant === 'small-caps' || editor.textVariant === 'petite-caps' ? 'small-caps' : 'normal',
                        textTransform: editor.textVariant === 'all-small-caps' || editor.textVariant === 'all-petite-caps'
                          ? 'uppercase'
                          : editor.textVariant === 'unicase'
                            ? 'lowercase'
                            : editor.textVariant === 'title-caps'
                              ? 'capitalize'
                              : 'none',
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
                <span>{translateUi('Layers')}</span>
                <div className="menu-anchor layer-menu-anchor" onClick={(event) => event.stopPropagation()}>
                  <button className="dock-menu-button" type="button" aria-label="Layer menu" aria-expanded={layerMenuOpen} onClick={() => setLayerMenuOpen((value) => !value)}><PintaIcon file="open-menu-symbolic.svg" size={15} standard /></button>
                  {layerMenuOpen && (
                    <Popover align="right" className="layer-menu-popover">
                      <MenuItem icon={<PintaIcon file="layer-import-symbolic.svg" size={16} />} label="Import from File…" onClick={() => { setLayerMenuOpen(false); layerFileInputRef.current?.click(); }} />
                      <div className="menu-divider" />
                      <MenuItem icon={<PintaIcon file="image-flip-horizontal-symbolic.svg" size={15} />} label="Flip Horizontal" shortcut="Ctrl+F" onClick={() => { setLayerMenuOpen(false); editor.flipLayer('horizontal'); }} />
                      <MenuItem icon={<PintaIcon file="image-flip-vertical-symbolic.svg" size={15} />} label="Flip Vertical" shortcut="Shift+F" onClick={() => { setLayerMenuOpen(false); editor.flipLayer('vertical'); }} />
                      <MenuItem icon={<PintaIcon file="layers-rotate-zoom-symbolic.svg" size={16} />} label="Rotate / Zoom Layer…" onClick={() => { setLayerMenuOpen(false); setRotateZoomLayerId(editor.activeLayerId); }} />
                      <div className="menu-divider" />
                      <MenuItem icon={<PintaIcon file="document-properties-symbolic.svg" size={15} standard />} label="Layer Properties…" shortcut="F4" onClick={() => { setLayerMenuOpen(false); setLayerPropertiesId(editor.activeLayerId); }} />
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
                    title={`${layer.name === 'Background' ? translateUi(layer.name) : layer.name} · ${translateUi(BLEND_MODES.find((mode) => mode.id === layer.blendMode)?.label ?? 'Normal')} · ${Math.round(layer.opacity * 100)}%`}
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
                      <PintaIcon file={layer.visible ? 'view-reveal-symbolic.svg' : 'view-conceal-symbolic.svg'} size={14} standard />
                    </button>
                    <span className="layer-thumbnail checkerboard">
                      <img src={layer.canvas.toDataURL()} alt="" />
                    </span>
                    <span className="layer-name">{layer.name === 'Background' ? translateUi(layer.name) : layer.name}</span>
                    {editor.activeLayerId === layer.id && <span className="layer-check native-checkmark" aria-hidden="true" />}
                  </div>
                ))}
              </div>
              <footer className="dock-toolbar">
                <IconButton label="Add New Layer" onClick={editor.addLayer}><PintaIcon file="layers-add-layer-symbolic.svg" size={15} /></IconButton>
                <IconButton label="Delete Layer" disabled={editor.layers.length === 1} onClick={editor.deleteLayer}><PintaIcon file="layers-remove-layer-symbolic.svg" size={15} /></IconButton>
                <IconButton label="Duplicate Layer" onClick={editor.duplicateLayer}><PintaIcon file="layers-duplicate-layer-symbolic.svg" size={15} /></IconButton>
                <IconButton label="Merge Layer Down" disabled={activeLayerIndex <= 0} onClick={editor.mergeLayerDown}><PintaIcon file="layers-merge-down-symbolic.svg" size={15} /></IconButton>
                <IconButton label="Move Layer Up" disabled={activeLayerIndex >= editor.layers.length - 1} onClick={() => editor.moveLayer(1)}><PintaIcon file="pan-up-symbolic.svg" size={15} standard /></IconButton>
                <IconButton label="Move Layer Down" disabled={activeLayerIndex <= 0} onClick={() => editor.moveLayer(-1)}><PintaIcon file="pan-down-symbolic.svg" size={15} standard /></IconButton>
                <IconButton label="Layer Properties (F4)" onClick={() => setLayerPropertiesId(editor.activeLayerId)}><PintaIcon file="document-properties-symbolic.svg" size={15} standard /></IconButton>
              </footer>
            </section>

            <section className="dock-panel history-panel">
              <header className="dock-header"><span>{translateUi('History')}</span><PintaIcon file="open-menu-symbolic.svg" size={15} standard /></header>
              <div className="history-list">
                {editor.history.map((entry, index) => (
                  <button
                    key={`${index}-${entry.label}`}
                    type="button"
                    className={`history-row ${index === editor.historyIndex ? 'active' : ''} ${index > editor.historyIndex ? 'future' : ''}`}
                    onClick={() => editor.goToHistory(index)}
                  >
                    {index === 0 ? <PintaIcon file="document-new-symbolic.svg" size={14} standard /> : <PintaIcon file={index === 1 ? currentTool.icon : 'ui-historylist-symbolic.svg'} size={14} />}
                    <span>{translateUi(entry.label)}</span>
                  </button>
                ))}
              </div>
              <footer className="dock-toolbar history-toolbar">
                <IconButton label="Undo" onClick={editor.undo} disabled={!canUndo}><PintaIcon file="edit-undo-symbolic.svg" size={15} standard /></IconButton>
                <IconButton label="Redo" onClick={editor.redo} disabled={!canRedo}><PintaIcon file="edit-redo-symbolic.svg" size={15} standard /></IconButton>
              </footer>
            </section>
          </aside>
        )}
      </div>

      {showPalette && (
        <footer className="status-bar">
          <div className="color-wells" title="Click either color to open the full color picker. Press X to swap.">
            <button className="color-well secondary checkerboard" style={{ '--well-color': editor.secondary } as CSSProperties} onClick={() => setColorDialogTarget('secondary')} aria-label={translateUi('Click to select secondary color.')} title={`${editor.secondary} · ${translateUi('Click to select secondary color.')}`} />
            <button className="color-well primary checkerboard" style={{ '--well-color': editor.primary } as CSSProperties} onClick={() => setColorDialogTarget('primary')} aria-label={translateUi('Click to select primary color.')} title={`${editor.primary} · ${translateUi('Click to select primary color.')}`} />
            <button className="swap-colors" type="button" onClick={editor.swapColors} aria-label={translateUi('Click to switch between primary and secondary color.')} title={`${translateUi('Click to switch between primary and secondary color.')} ${translateUi('Shortcut key')}: X`}><SwapColorsIcon /></button>
            <button className="reset-colors" type="button" onClick={() => {
              editor.setPrimary('#000000');
              editor.setSecondary('#ffffff');
            }} aria-label={translateUi('Click to reset primary and secondary color.')} title={translateUi('Click to reset primary and secondary color.')}><ResetColorsIcon /></button>
          </div>
          <div className="palette" aria-label="Color palette">
            {editor.palette.map((color, index) => (
              <button
                key={`${color}-${index}`}
                className="swatch"
                style={{ background: color }}
                title={`${color} · click for primary, right-click for secondary, Ctrl/⌘+click or middle-click to edit`}
                aria-label={`Set color ${color}`}
                type="button"
                onClick={(event) => {
                  if (event.ctrlKey || event.metaKey) setEditingPaletteIndex(index);
                  else editor.setPrimary(color);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  editor.setSecondary(color);
                }}
                onAuxClick={(event) => { if (event.button === 1) setEditingPaletteIndex(index); }}
                onDoubleClick={() => setEditingPaletteIndex(index)}
              />
            ))}
            <button
              className="palette-add-swatch"
              type="button"
              disabled={editor.palette.length >= 96}
              onClick={() => {
                if (editor.addPaletteColor(editor.primary)) notify(`Added ${editor.primary} to the palette`);
              }}
              aria-label={translateUi('Add Primary Color')}
              title={`${translateUi('Add Primary Color')}: ${editor.primary}`}
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
          <div className="status-spacer" />
          <div className="status-readout" dir="ltr"><PintaIcon file="ui-cursor-location-symbolic.svg" size={15} />{Math.round(editor.pointer.x)}, {Math.round(editor.pointer.y)}</div>
          <div className="status-readout" dir="ltr"><span className="dimension-glyph" />{editor.width}, {editor.height}</div>
          <div className="zoom-control">
            <IconButton label="Zoom out" onClick={() => editor.setZoom(editor.zoom - 0.1)}><PintaIcon file="value-decrease-symbolic.svg" size={14} standard /></IconButton>
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
            <IconButton label="Zoom in" onClick={() => editor.setZoom(editor.zoom + 0.1)}><PintaIcon file="value-increase-symbolic.svg" size={14} standard /></IconButton>
          </div>
        </footer>
      )}

      {isDraggingFile && (
        <div className="drop-overlay">
          <div><PintaIcon file="document-open-symbolic.svg" size={34} standard /><strong>Open images in Pinta</strong><span>Drop one or more OpenRaster, PNG, JPEG, WebP, GIF, BMP, PPM, or TGA images</span></div>
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
          onSubmit={(nextWidth, nextHeight, anchor, background, resampling) => {
            if (dialog === 'new') editor.newDocument(nextWidth, nextHeight, background);
            else if (dialog === 'resize-image') editor.resizeImage(nextWidth, nextHeight, resampling);
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
          onCancel={() => {
            editor.clearEffectPreview();
            setEffectDialog(null);
          }}
          onPreview={(parameters) => editor.previewEffect(effectDialog, parameters)}
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
      {showCloseAllConfirm && closeAllDocument && (
        <CloseDocumentDialog
          fileName={closeAllDocument.fileName}
          onCancel={() => {
            setCloseAllQueue([]);
            setShowCloseAllConfirm(false);
          }}
          onDiscard={() => completeCloseAllStep(closeAllDocument.id)}
          onSave={async () => {
            if (await editor.saveImage()) completeCloseAllStep(closeAllDocument.id);
          }}
        />
      )}
      {pendingPaste && (
        <PasteExpandDialog
          onCancel={() => setPendingPaste(null)}
          onPreserve={() => {
            performPaste(pendingPaste, false);
            setPendingPaste(null);
          }}
          onExpand={() => {
            performPaste(pendingPaste, true);
            setPendingPaste(null);
          }}
        />
      )}
      {showSaveAs && (
        <SaveAsDialog
          fileName={editor.fileName}
          layerCount={editor.layers.length}
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
      {showLanguage && <LanguageDialog onClose={() => setShowLanguage(false)} />}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {showAddinManager && (
        <AddinManagerDialog
          enabledAddins={enabledAddins}
          onToggle={(addin, enabled) => {
            setAddinEnabled(addin, enabled);
            if (!enabled && addin === 'block-brush' && editor.paintBrushType === 'block') editor.setPaintBrushType('normal');
          }}
          onSetAll={(enabled) => {
            setAllAddinsEnabled(enabled);
            if (!enabled && editor.paintBrushType === 'block') editor.setPaintBrushType('normal');
          }}
          onClose={() => setShowAddinManager(false)}
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
      {colorDialogTarget !== null && (
        <ColorPickerDialog
          key={colorDialogTarget}
          title="Choose Palette Color"
          primary={editor.primary}
          secondary={editor.secondary}
          initialTarget={colorDialogTarget}
          palette={editor.palette}
          onCancel={() => setColorDialogTarget(null)}
          onSubmit={(colors) => {
            editor.setPrimary(colors.primary);
            if (colors.secondary) editor.setSecondary(colors.secondary);
            setColorDialogTarget(null);
          }}
        />
      )}
      {editingPaletteIndex !== null && editor.palette[editingPaletteIndex] && (
        <ColorPickerDialog
          key={editingPaletteIndex}
          title="Choose Palette Color"
          primary={editor.palette[editingPaletteIndex]}
          palette={editor.palette}
          onCancel={() => setEditingPaletteIndex(null)}
          onSubmit={(colors) => {
            editor.setPaletteColor(editingPaletteIndex, colors.primary);
            setEditingPaletteIndex(null);
            notify(`Palette color changed to ${colors.primary}`);
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
          <BusySpinner size={18} /> Processing effect…
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
