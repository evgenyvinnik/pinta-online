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
import {
  documentIndexShortcut,
  focusedEditorOwnsShortcut,
  isEditableTarget,
  nextToolForShortcut,
  resolvePintaShortcut,
} from './editor/shortcuts';
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

function PintaIcon({ file, size = 22, standard = false, className = '' }: { file: string; size?: number; standard?: boolean; className?: string }) {
  return <img className={`pinta-icon ${className}`} src={`/${standard ? 'standard-icons' : 'actions'}/${file}`} width={size} height={size} alt="" draggable={false} />;
}

function BusySpinner({ size = 15 }: { size?: number }) {
  return <span className="busy-spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

function ToolbarStepper({ label, value, min, max, onChange, className = '' }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; className?: string }) {
  const update = (next: number) => onChange(Math.max(min, Math.min(max, Math.round(next))));
  return (
    <span className={`native-toolbar-stepper ${className}`}>
      <input aria-label={label} type="number" min={min} max={max} value={value} onChange={(event) => update(Number(event.target.value))} />
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => update(value - 1)}><PintaIcon file="value-decrease-symbolic.svg" size={13} standard /></button>
      <button type="button" aria-label={`Increase ${label}`} onClick={() => update(value + 1)}><PintaIcon file="value-increase-symbolic.svg" size={13} standard /></button>
    </span>
  );
}

interface ToolbarIconOption {
  value: string;
  label: string;
  icon: string;
}

function ToolbarIconSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly ToolbarIconOption[]; onChange: (value: string) => void }) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <label className="native-toolbar-icon-select" title={`${label}: ${selected.label}`}>
      <PintaIcon file={selected.icon} size={18} />
      <span className="native-select-chevron" aria-hidden="true">⌄</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
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

function NativeToolOptions({ editor, currentTool }: { editor: ReturnType<typeof usePaintEditor>; currentTool: (typeof TOOLS)[number] }) {
  const antialias = <ToolbarIconSelect label="Antialiasing" value={editor.shapeAntialiasing ? 'on' : 'off'} options={ANTIALIAS_OPTIONS} onChange={(value) => editor.setShapeAntialiasing(value === 'on')} />;
  const selectionMode = (
    <select className="native-toolbar-select selection-mode-select" value={editor.selectionMode} onChange={(event) => editor.setSelectionMode(event.target.value as SelectionMode)} aria-label="Selection mode">
      {SELECTION_MODE_OPTIONS.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
    </select>
  );
  const fillStyle = <ToolbarIconSelect label="Fill style" value={editor.shapeFillStyle} options={FILL_STYLE_OPTIONS} onChange={(value) => editor.setShapeFillStyle(value as ShapeFillStyle)} />;
  const dash = (
    <select className="native-toolbar-select dash-option-select" value={editor.shapeDashStyle} onChange={(event) => editor.setShapeDashStyle(event.target.value as ShapeDashStyle)} aria-label="Dash pattern">
      <option value="solid">−</option><option value="dash">− −</option><option value="dot">· ·</option><option value="dash-dot">− ·</option>
    </select>
  );
  const blend = <ToolbarIconSelect label="Blending" value={editor.alphaBlendingMode} options={BLENDING_OPTIONS} onChange={(value) => editor.setAlphaBlendingMode(value as typeof editor.alphaBlendingMode)} />;
  const shapeTool = ['line', 'rectangle', 'rounded-rectangle', 'ellipse'].includes(editor.tool);

  return (
    <div className="tool-options-bar">
      <span className="tool-label">Tool:</span>
      <PintaIcon file={currentTool.icon} size={19} />

      {['paintbrush', 'eraser', 'recolor', 'clone-stamp'].includes(editor.tool) && <>
        <span className="option-label">Brush width:</span>
        <ToolbarStepper label="Brush width" value={editor.brushSize} min={1} max={100000} onChange={editor.setBrushSize} />
        {editor.tool === 'paintbrush' && <>
          <span className="option-label">Type:</span>
          <select className="native-toolbar-select" aria-label="Paintbrush type" value={editor.paintBrushType} onChange={(event) => editor.setPaintBrushType(event.target.value as typeof editor.paintBrushType)}>
            <option value="normal">Normal</option><option value="grid">Grid</option><option value="squares">Squares</option><option value="circles">Circles</option><option value="splatter">Splatter</option><option value="slash">Slash</option>
          </select>
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
        {editor.tool === 'line' && <><span className="option-label">Arrow:</span><label className="native-toolbar-check"><input type="checkbox" checked={editor.lineArrowStart} onChange={(event) => editor.setLineArrowStart(event.target.checked)} />1</label><label className="native-toolbar-check"><input type="checkbox" checked={editor.lineArrowEnd} onChange={(event) => editor.setLineArrowEnd(event.target.checked)} />2</label></>}
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
        <select className="native-toolbar-select font-family-select" value={editor.textFontFamily} onChange={(event) => editor.setTextFontFamily(event.target.value)} aria-label="Font family">{['Adwaita Sans', 'Sans', 'Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New'].map((font) => <option key={font}>{font}</option>)}</select>
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
  const initialWidth = mode === 'new' ? 800 : currentWidth;
  const initialHeight = mode === 'new' ? 600 : currentHeight;
  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);
  const [preserveAspect, setPreserveAspect] = useState(mode === 'resize-image');
  const [anchor, setAnchor] = useState<CanvasAnchor>('center');
  const [preset, setPreset] = useState(mode === 'new' ? '800 x 600' : 'Custom');
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

  if (mode === 'new') {
    const previewBackground = background === 'secondary' ? secondaryColor : '#ffffff';
    return (
      <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}>
        <form className="pinta-dialog native-new-image-dialog" role="dialog" aria-modal="true" aria-labelledby="image-size-title" onSubmit={(event) => {
          event.preventDefault();
          onSubmit(width, height, anchor, background);
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
          <button type="submit" className="dialog-text-button suggested">Resize</button>
        </header>
        <div className="dialog-content">
          <div className="dialog-preview checkerboard">
            <div className={background === 'transparent' ? 'transparent-preview' : ''} style={{ aspectRatio: `${width} / ${height}`, backgroundColor: background === 'secondary' ? secondaryColor : undefined }}>
              <span>{width} × {height}</span>
            </div>
          </div>
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
          <PintaIcon file={position.icon} size={22} />
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
            {busy ? <><BusySpinner /> Applying</> : 'Apply'}
          </button>
        </header>
        <div className="dialog-content">
          <div className="effect-dialog-intro">
            <span className="effect-dialog-icon"><PintaIcon file={effect.icon} size={28} /></span>
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
          <span className="close-document-icon"><PintaIcon file="dialog-error-symbolic.svg" size={27} standard /></span>
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
          <span className="close-document-icon"><PintaIcon file="dialog-error-symbolic.svg" size={27} standard /></span>
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
          <p className="about-version" data-visual-version>Pinta Online {__PINTA_ONLINE_VERSION__} · based on Pinta 3.2</p>
          <p>Easily create and edit images, now in the browser.</p>
          <div className="about-links">
            <a href="/about/">Features &amp; Screenshots</a>
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
    document.title = `${editor.fileName}${editor.dirty ? '*' : ''} — Pinta Online Image Editor`;
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
      if (event.defaultPrevented || focusedEditorOwnsShortcut(event)) return;

      const shortcut = resolvePintaShortcut(event);
      const documentIndex = documentIndexShortcut(event);
      const modalOpen = Boolean(
        closingDocumentId
        || showCloseAllConfirm
        || printPreview
        || dialog
        || effectDialog
        || showOffsetSelection
        || showScreenshot
        || layerPropertiesId
        || rotateZoomLayerId
        || paletteDialog
        || editingPaletteIndex !== null
        || showSaveAs
        || showCanvasGridDialog
        || showKeyboardShortcuts
        || showAbout,
      );

      if (modalOpen) {
        if (shortcut || documentIndex !== null) event.preventDefault();
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (closingDocumentId) setClosingDocumentId(null);
        else if (showCloseAllConfirm) setShowCloseAllConfirm(false);
        else if (printPreview) setPrintPreview(null);
        else if (dialog) setDialog(null);
        else if (effectDialog && !editor.effectBusy) setEffectDialog(null);
        else if (showOffsetSelection) setShowOffsetSelection(false);
        else if (showScreenshot && !screenshotBusy) {
          setShowScreenshot(false);
          setScreenshotError('');
        } else if (layerPropertiesId) setLayerPropertiesId(null);
        else if (rotateZoomLayerId) setRotateZoomLayerId(null);
        else if (paletteDialog || editingPaletteIndex !== null) {
          setPaletteDialog(null);
          setEditingPaletteIndex(null);
        } else if (showSaveAs) setShowSaveAs(false);
        else if (showCanvasGridDialog) setShowCanvasGridDialog(false);
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
          case 'help': window.open('https://pinta-project.com/user-guide', '_blank', 'noopener,noreferrer'); break;
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
          case 'paste': if (editor.paste()) notify('Pasted into the current layer'); break;
          case 'paste-new-layer': if (editor.pasteIntoNewLayer()) notify('Pasted into a new layer'); break;
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
  }, [closingDocumentId, dialog, editingPaletteIndex, editor, effectDialog, layerPropertiesId, notify, openMenu, openPrintDialog, paletteDialog, printPreview, requestCloseAll, rotateZoomLayerId, screenshotBusy, showAbout, showCanvasGridDialog, showCloseAllConfirm, showKeyboardShortcuts, showOffsetSelection, showSaveAs, showScreenshot, showSidebar, showToolbox, toggleFullscreen, zoomToWindow]);

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
            <MenuItem icon={<PintaIcon file="help-about-symbolic.svg" size={15} standard />} label="About Pinta" onClick={() => closeAnd(() => setShowAbout(true))} />
            <MenuItem icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />} label="Keyboard Shortcuts…" shortcut="⌘," onClick={() => closeAnd(() => setShowKeyboardShortcuts(true))} />
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
            <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste" shortcut="⌘V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.paste())} />
            <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste Into New Layer" shortcut="⇧⌘V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.pasteIntoNewLayer())} />
            <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste Into New Image" shortcut="⌥⌘V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.pasteIntoNewImage())} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="edit-select-all-symbolic.svg" size={15} standard />} label="Select All" shortcut="⌘A" onClick={() => closeAnd(editor.selectAll)} />
            <MenuItem icon={<PintaIcon file="ui-deselect-symbolic.svg" size={15} />} label="Deselect All" shortcut="⇧⌘A" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.deselect)} />
            <MenuItem icon={<PintaIcon file="edit-selection-erase-symbolic.svg" size={16} />} label="Erase Selection" shortcut="⌦" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.clearActiveLayer)} />
            <MenuItem icon={<PintaIcon file="edit-selection-fill-symbolic.svg" size={16} />} label="Fill Selection" shortcut="⌫" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.fillSelection)} />
            <MenuItem icon={<PintaIcon file="edit-selection-invert-symbolic.svg" size={16} />} label="Invert Selection" shortcut="⌘I" disabled={!editor.hasSelection} onClick={() => closeAnd(editor.invertSelection)} />
            <MenuItem icon={<PintaIcon file="edit-selection-offset-symbolic.svg" size={16} />} label="Offset Selection…" shortcut="⇧⌘O" disabled={!editor.hasSelection} onClick={() => closeAnd(() => setShowOffsetSelection(true))} />
            <div className="menu-divider" />
            <div className="menu-caption">Palette</div>
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
        return EFFECT_DEFINITIONS.filter((effect) => effect.category === 'adjustment').map((effect) => (
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
            <div className="menu-caption">{label}</div>
            {EFFECT_DEFINITIONS.filter((effect) => effect.category === category).map((effect) => (
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
            <MenuItem icon={<PintaIcon file="addins-manage.png" size={15} />} label="Add-in Manager…" onClick={() => closeAnd(() => notify('Native Pinta add-ins are not available in the browser edition'))} />
            <div className="menu-note">Native add-ins require the desktop application.</div>
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
            <MenuItem icon={<PintaIcon file="help-browser-symbolic.svg" size={15} standard />} label="Pinta Help" shortcut="F1" onClick={() => closeAnd(() => window.open('https://pinta-project.com/user-guide', '_blank', 'noopener,noreferrer'))} />
            <MenuItem icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />} label="Keyboard Shortcuts…" shortcut="⌘," onClick={() => closeAnd(() => setShowKeyboardShortcuts(true))} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="help-website-symbolic.svg" size={15} />} label="Pinta Website" onClick={() => closeAnd(() => window.open('https://www.pinta-project.com', '_blank', 'noopener,noreferrer'))} />
            <MenuItem icon={<PintaIcon file="help-bug.png" size={15} />} label="File a Bug" onClick={() => closeAnd(() => window.open('https://github.com/PintaProject/Pinta/issues', '_blank', 'noopener,noreferrer'))} />
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
      <h1 className="visually-hidden">Pinta Online — free browser-based paint and image editor</h1>
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
            if (editor.paste()) notify('Pasted into the current layer');
          }}><PintaIcon file="edit-paste-symbolic.svg" size={iconSize} standard /></IconButton>
          <IconButton label="Crop to Selection" disabled={!editor.hasSelection} onClick={() => editor.cropToSelection()}><PintaIcon file="ui-crop-to-selection-symbolic.svg" size={iconSize} /></IconButton>
          <IconButton label="Deselect (Esc)" disabled={!editor.hasSelection} onClick={editor.deselect}><PintaIcon file="ui-deselect-symbolic.svg" size={iconSize} /></IconButton>
        </div>

        <div className="window-title">
          <span>{editor.fileName}{editor.dirty ? '*' : ''}</span>
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
                <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste" shortcut="Ctrl+V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.paste())} />
                <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste Into New Layer" shortcut="Ctrl+Shift+V" disabled={!editor.hasClipboard} onClick={() => closeAnd(() => editor.pasteIntoNewLayer())} />
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
                <div className="menu-caption">Palette</div>
                <MenuItem icon={<PintaIcon file="document-open-symbolic.svg" size={15} standard />} label="Open Palette…" onClick={() => closeAnd(() => paletteInputRef.current?.click())} />
                <MenuItem icon={<PintaIcon file="document-save-as-symbolic.svg" size={15} standard />} label="Save Palette As…" onClick={() => closeAnd(() => setPaletteDialog('save'))} />
                <MenuItem icon={<PintaIcon file="document-revert-symbolic.svg" size={15} standard />} label="Reset Palette to Default" onClick={() => closeAnd(() => {
                  editor.resetPalette();
                  notify('Palette reset to Pinta defaults');
                })} />
                <MenuItem label="Set Number of Colors…" onClick={() => closeAnd(() => setPaletteDialog('resize'))} />
                <div className="menu-divider" />
                <div className="menu-caption">Help</div>
                <MenuItem icon={<PintaIcon file="help-browser-symbolic.svg" size={15} standard />} label="Contents" shortcut="F1" onClick={() => closeAnd(() => window.open('https://pinta-project.com/user-guide', '_blank', 'noopener,noreferrer'))} />
                <MenuItem icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />} label="Keyboard Shortcuts" shortcut="Ctrl+," onClick={() => closeAnd(() => setShowKeyboardShortcuts(true))} />
                <MenuItem icon={<PintaIcon file="help-website-symbolic.svg" size={15} />} label="Pinta Website" onClick={() => closeAnd(() => window.open('https://www.pinta-project.com', '_blank', 'noopener,noreferrer'))} />
                <MenuItem icon={<PintaIcon file="help-bug.png" size={15} />} label="File a Bug" onClick={() => closeAnd(() => window.open('https://github.com/PintaProject/Pinta/issues', '_blank', 'noopener,noreferrer'))} />
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

      <NativeToolOptions editor={editor} currentTool={currentTool} />

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
                <PintaIcon file={item.icon} size={22} />
              </button>
            ))}
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
                      title={`${document.fileName} · ${document.width} × ${document.height}`}
                      onClick={() => editor.switchDocument(document.id)}
                    >
                      <PintaIcon file="image-x-generic-symbolic.svg" size={13} standard />
                      <span>{document.fileName}{document.dirty ? '*' : ''}</span>
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
                <span>Layers</span>
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
                      <PintaIcon file={layer.visible ? 'view-reveal-symbolic.svg' : 'view-conceal-symbolic.svg'} size={14} standard />
                    </button>
                    <span className="layer-thumbnail checkerboard">
                      <img src={layer.canvas.toDataURL()} alt="" />
                    </span>
                    <span className="layer-name">{layer.name}</span>
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
              <header className="dock-header"><span>History</span><PintaIcon file="open-menu-symbolic.svg" size={15} standard /></header>
              <div className="history-list">
                {editor.history.map((entry, index) => (
                  <button
                    key={`${index}-${entry.label}`}
                    type="button"
                    className={`history-row ${index === editor.historyIndex ? 'active' : ''} ${index > editor.historyIndex ? 'future' : ''}`}
                    onClick={() => editor.goToHistory(index)}
                  >
                    {index === 0 ? <PintaIcon file="document-new-symbolic.svg" size={14} standard /> : <PintaIcon file={index === 1 ? currentTool.icon : 'ui-historylist-symbolic.svg'} size={14} />}
                    <span>{entry.label}</span>
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
