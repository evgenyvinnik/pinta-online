import {
  useCallback,
  useEffect,
  forwardRef,
  useLayoutEffect,
  useImperativeHandle,
  memo,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
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
  REGISTERED_SHORTCUT_SECTIONS,
  resolvePintaShortcut,
} from './editor/shortcuts';
import { TOOL_BY_ID, TOOLS } from './editor/tools';
import { ZOOM_LEVELS, clampZoom, formatZoomPercent, parseZoomPercent, zoomInLevel, zoomOutLevel } from './editor/zoom';
import { resolveColorScheme } from './state/preferences';
import type { CanvasAnchor, RgbHistogram, SelectionMode, ShapeDashStyle, ShapeFillStyle, TextAlignment, TextStyle, TextVariant } from './editor/usePaintEditor';
import { BLEND_MODES, type BlendMode, type ExportFormat, type PaintLayer, type ToolDefinition, type ToolId } from './editor/types';
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
import { MAX_DOCK_WIDTH, MIN_DOCK_WIDTH, usePreferences, type CanvasGridSettings } from './state/preferences';
import { aboutPathForLocale, changeLocale, currentLocale, SUPPORTED_LOCALES, translateDocumentName, translateUi, type LocaleCode } from './i18n';
import { ADDIN_DEFINITIONS, isAddinEnabled, type AddinId } from './addins/registry';
import { CanvasRuler } from './components/CanvasRuler';
import { PaletteResizeDialog, PaletteSaveDialog } from './components/dialogs/paletteDialogs';
import { ColorPickerDialog } from './components/ColorPickerDialog';
import { DialogActions, DialogResetButton, DialogStepper } from './components/dialogControls';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MenuItem, Popover, TopLevelMenu, type MenuName } from './components/menus';
import {
  AngleDial,
  BusySpinner,
  ColorSwatch,
  IconButton,
  PlusGlyph,
  PintaIcon,
  PointPad,
  ResetColorsIcon,
  SwapColorsIcon,
  ToolbarIconSelect,
  ToolbarStepper,
} from './components/primitives';
import { context2d } from './editor/canvasContext';
import type { EditorLiveMetrics, RafValueStore, SelectionSize } from './editor/liveMetrics';
import { formatStorageAmount } from './editor/workspacePersistence';
import { countRepeat, errorMessageOf, isForeignError, reportError } from './errorReporting';

type DialogName = 'new' | 'resize-image' | 'resize-canvas' | null;
type PaintEditorController = ReturnType<typeof usePaintEditor>;
type LayerPropertiesPreview = { id: string; name: string; visible: boolean; opacity: number; blendMode: BlendMode };

const WEB_REPOSITORY_URL = 'https://github.com/evgenyvinnik/pinta-online';
const WEB_BUG_REPORT_URL = `${WEB_REPOSITORY_URL}/issues/new?template=bug.md`;
const USER_GUIDE_URL = '/user-guide/';

const PINTA_DEVELOPERS = [
  '@badcel',
  '@bplaat',
  'Cameron White (@cameronwhite)',
  'Elvis Alistar (@ericksson)',
  'James Carroll (@JGCarroll)',
  'Lehonti Ramos (@Lehonti)',
  '@Matthieu-LAURENT39',
  '@PabloRufianJiminez',
  '@pedropaulosuzuki',
  '@spaghetti22',
  '@stefan-dangl',
  '@UrtsiSantsi',
] as const;

interface ApplicationError {
  title: string;
  message: string;
  details: string;
}

interface MenuChromeHandle {
  close: () => void;
  hasOpenMenu: () => boolean;
}

interface MenuChromeState {
  openMenu: MenuName;
  menuSurface: 'top' | 'header' | null;
  setOpenMenu: (menu: MenuName) => void;
  setMenuSurface: (surface: 'top' | 'header' | null) => void;
}

interface PrimaryDialogState {
  dialog: DialogName;
  effectDialog: EffectId | null;
  showSaveAs: boolean;
}

interface PrimaryDialogHandle {
  getState: () => PrimaryDialogState;
  setDialog: (dialog: DialogName) => void;
  setEffectDialog: (effect: EffectId | null) => void;
  setShowSaveAs: (show: boolean) => void;
  closeAll: () => void;
}

interface FilePickerType {
  description: string;
  accept: Record<string, string[]>;
}

const IMAGE_FILE_PICKER_TYPES: FilePickerType[] = [{
  description: 'Images supported by Pinta',
  accept: {
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/webp': ['.webp'],
    'image/gif': ['.gif'],
    'image/bmp': ['.bmp'],
    'image/tiff': ['.tif', '.tiff'],
    'image/svg+xml': ['.svg'],
    'image/x-icon': ['.ico'],
    'image/avif': ['.avif'],
    'image/openraster': ['.ora'],
    'image/x-portable-pixmap': ['.ppm'],
    'image/x-tga': ['.tga'],
  },
}];

const EXPORT_FILE_PICKER_TYPE: Record<ExportFormat, FilePickerType> = {
  png: { description: 'PNG image', accept: { 'image/png': ['.png'] } },
  jpeg: { description: 'JPEG image', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } },
  webp: { description: 'WebP image', accept: { 'image/webp': ['.webp'] } },
  bmp: { description: 'Bitmap image', accept: { 'image/bmp': ['.bmp'] } },
  tiff: { description: 'TIFF image', accept: { 'image/tiff': ['.tif', '.tiff'] } },
  ora: { description: 'OpenRaster image', accept: { 'image/openraster': ['.ora'] } },
  ppm: { description: 'Netpbm Portable Pixmap', accept: { 'image/x-portable-pixmap': ['.ppm'] } },
  tga: { description: 'Targa image', accept: { 'image/x-tga': ['.tga'] } },
};

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options: { multiple?: boolean; types?: FilePickerType[] }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: { suggestedName?: string; types?: FilePickerType[] }) => Promise<FileSystemFileHandle>;
};

interface LocalFontData {
  family: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
}

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};

const FALLBACK_FONT_FAMILIES = ['Adwaita Sans', 'Arial', 'Arial Black', 'Avenir Next', 'Baskerville', 'Brush Script MT', 'Charter', 'Courier New', 'Futura', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Impact', 'Menlo', 'Monaco', 'Noto Sans', 'Palatino', 'Sans', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

type PasteTarget = 'current' | 'new-layer' | 'new-image';

function isPickerCancellation(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorDetails(error: unknown) {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error, null, 2) || String(error) || 'Unknown error';
  } catch {
    return String(error) || 'Unknown error';
  }
}

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

function useLiveMetric<T>(store: RafValueStore<T>) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

const PointerReadout = memo(function PointerReadout({ store }: { store: EditorLiveMetrics['pointer'] }) {
  const pointer = useLiveMetric(store);
  return <div className="status-readout" dir="ltr" data-live-readout="pointer"><PintaIcon file="ui-cursor-location-symbolic.svg" size={15} />{Math.round(pointer.x)}, {Math.round(pointer.y)}</div>;
});

const SelectionSizeReadout = memo(function SelectionSizeReadout({
  store,
  width,
  height,
}: {
  store: RafValueStore<SelectionSize | null>;
  width: number;
  height: number;
}) {
  const selection = useLiveMetric(store);
  return (
    <div className="status-readout" dir="ltr" aria-label={translateUi('Selection size')} data-live-readout="selection">
      <PintaIcon className="selection-size-glyph" file="tool-select-rectangle-symbolic.svg" size={15} />
      {selection?.width ?? width}, {selection?.height ?? height}
    </div>
  );
});

const LayerThumbnail = memo(function LayerThumbnail({ layer }: { layer: PaintLayer }) {
  const thumbnailRef = useRef<HTMLCanvasElement>(null);
  const pixelRatio = Math.max(1, Math.min(2, globalThis.devicePixelRatio ?? 1));
  useLayoutEffect(() => {
    const thumbnail = thumbnailRef.current;
    if (!thumbnail) return;
    const context = context2d(thumbnail);
    context.clearRect(0, 0, thumbnail.width, thumbnail.height);
    const scale = Math.min(thumbnail.width / layer.canvas.width, thumbnail.height / layer.canvas.height);
    const width = Math.max(1, Math.round(layer.canvas.width * scale));
    const height = Math.max(1, Math.round(layer.canvas.height * scale));
    context.drawImage(layer.canvas, Math.floor((thumbnail.width - width) / 2), Math.floor((thumbnail.height - height) / 2), width, height);
  }, [layer.canvas, layer.revision, pixelRatio]);
  return <canvas ref={thumbnailRef} width={Math.round(53 * pixelRatio)} height={Math.round(42 * pixelRatio)} aria-hidden="true" />;
}, (previous, next) => previous.layer.canvas === next.layer.canvas && previous.layer.revision === next.layer.revision);

const ToolButton = memo(function ToolButton({ item, active, onSelect }: {
  item: ToolDefinition;
  active: boolean;
  onSelect: (tool: ToolId) => void;
}) {
  useTranslation();
  const toolName = translateUi(item.name);
  return (
    <button
      className={`tool-button ${active ? 'active' : ''}`}
      type="button"
      title={`${toolName}${item.shortcut ? `\n${translateUi('Shortcut key')}: ${item.shortcut}` : ''}\n${translateUi(item.status)}`}
      aria-label={toolName}
      onClick={() => onSelect(item.id)}
    >
      <PintaIcon file={item.icon} size={22} />
    </button>
  );
});

interface LayerRowPreview {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
}

const LayerRow = memo(function LayerRow({ layer, active, preview, onSelect, onToggle, onEdit }: {
  layer: PaintLayer;
  active: boolean;
  preview: LayerRowPreview | null;
  onSelect: (id: string) => boolean;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  useTranslation();
  const displayName = preview?.name ?? layer.name;
  const displayVisible = preview?.visible ?? layer.visible;
  const displayOpacity = preview?.opacity ?? layer.opacity;
  const displayBlendMode = preview?.blendMode ?? layer.blendMode;
  return (
    <div
      className={`layer-row ${active ? 'active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(layer.id)}
      onDoubleClick={() => onEdit(layer.id)}
      title={`${displayName === 'Background' ? translateUi(displayName) : displayName} · ${translateUi(BLEND_MODES.find((mode) => mode.id === displayBlendMode)?.label ?? 'Normal')} · ${Math.round(displayOpacity * 100)}%`}
      onKeyDown={(event) => { if (event.key === 'Enter') onSelect(layer.id); }}
    >
      <button
        type="button"
        className="layer-eye"
        aria-label={displayVisible ? 'Hide layer' : 'Show layer'}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(layer.id);
        }}
      >
        <PintaIcon file={displayVisible ? 'view-reveal-symbolic.svg' : 'view-conceal-symbolic.svg'} size={14} standard />
      </button>
      <span className="layer-thumbnail checkerboard"><LayerThumbnail layer={layer} /></span>
      <span className="layer-name">{displayName === 'Background' ? translateUi(displayName) : displayName}</span>
      {active && <span className="layer-check native-checkmark" aria-hidden="true" />}
    </div>
  );
});

const HistoryRow = memo(function HistoryRow({ index, label, active, future, toolIcon, onSelect }: {
  index: number;
  label: string;
  active: boolean;
  future: boolean;
  toolIcon: string;
  onSelect: (index: number) => void;
}) {
  useTranslation();
  return (
    <button
      type="button"
      className={`history-row ${active ? 'active' : ''} ${future ? 'future' : ''}`}
      data-history-index={index}
      onClick={() => onSelect(index)}
    >
      {index === 0 ? <PintaIcon file="document-new-symbolic.svg" size={14} standard /> : <PintaIcon file={index === 1 ? toolIcon : 'ui-historylist-symbolic.svg'} size={14} />}
      <span>{translateUi(label)}</span>
    </button>
  );
});

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

function NativeToolOptions({ editor, currentTool, blockBrushEnabled, onChooseFont }: { editor: ReturnType<typeof usePaintEditor>; currentTool: (typeof TOOLS)[number]; blockBrushEnabled: boolean; onChooseFont: () => void }) {
  const antialias = <ToolbarIconSelect label="Antialiasing" value={editor.shapeAntialiasing ? 'on' : 'off'} options={ANTIALIAS_OPTIONS} onChange={(value) => editor.setShapeAntialiasing(value === 'on')} />;
  const primaryModifier = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Command' : 'Ctrl';
  const alternateModifier = primaryModifier === 'Command' ? 'Option' : 'Alt';
  const selectionMode = <ToolbarIconSelect className="selection-mode-select" label="Selection mode" showLabel value={editor.selectionMode} options={SELECTION_MODE_OPTIONS.map((mode) => ({ value: mode.value, label: translateUi(mode.label).replace('{0}', mode.value === 'intersect' ? alternateModifier : primaryModifier) }))} onChange={(value) => editor.setSelectionMode(value as SelectionMode)} />;
  const fillStyle = <ToolbarIconSelect label="Fill style" value={editor.shapeFillStyle} options={FILL_STYLE_OPTIONS} onChange={(value) => editor.setShapeFillStyle(value as ShapeFillStyle)} />;
  const dash = (
    <><input className="native-toolbar-select dash-option-select" list="pinta-dash-patterns" value={editor.shapeDashStyle} onChange={(event) => editor.setShapeDashStyle(event.target.value as ShapeDashStyle)} aria-label={translateUi('Dash pattern')} /><datalist id="pinta-dash-patterns">{['-', ' -', ' --', ' ---', '  -', '   -', ' - --', ' - - --------', ' - - ---- - ----'].map((pattern) => <option key={pattern} value={pattern} />)}</datalist></>
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
          <ToolbarIconSelect className="brush-type-select" label="Paintbrush type" showLabel value={editor.paintBrushType} options={[
            { value: 'normal', label: 'Normal' },
            ...(blockBrushEnabled ? [{ value: 'block', label: 'Block' }] : []),
            { value: 'circles', label: 'Circles' },
            { value: 'grid', label: 'Grid' },
            { value: 'slash', label: 'Slash' },
            { value: 'splatter', label: 'Splatter' },
            { value: 'squares', label: 'Squares' },
          ]} onChange={(value) => editor.setPaintBrushType(value as typeof editor.paintBrushType)} />
          {editor.paintBrushType === 'slash' && <><span className="option-label">{translateUi('Angle:')}</span><ToolbarStepper label="Slash angle" value={editor.slashBrushAngle} min={0} max={180} onChange={editor.setSlashBrushAngle} /></>}
          {editor.paintBrushType === 'splatter' && <><span className="option-label">{translateUi('Minimum Size:')}</span><ToolbarStepper label="Splatter minimum size" value={editor.splatterMinimumSize} min={1} max={10000} onChange={editor.setSplatterMinimumSize} /><span className="option-label">{translateUi('Maximum Size:')}</span><ToolbarStepper label="Splatter maximum size" value={editor.splatterMaximumSize} min={1} max={10000} onChange={editor.setSplatterMaximumSize} /></>}
        </>}
        {editor.tool === 'eraser' && <>
          <span className="option-label">{translateUi('Type:')}</span>
          <ToolbarIconSelect className="brush-type-select" label="Eraser type" showLabel value={editor.eraserType} options={[{ value: 'normal', label: 'Normal' }, { value: 'smooth', label: 'Smooth' }]} onChange={(value) => editor.setEraserType(value as typeof editor.eraserType)} />
        </>}
        {editor.tool === 'recolor' && <>
          <span className="option-label">{translateUi('Tolerance:')}</span><output className="native-toolbar-value">{editor.recolorTolerance}</output>
          <input className="tool-option-slider compact" type="range" min="0" max="100" value={editor.recolorTolerance} onChange={(event) => editor.setRecolorTolerance(Number(event.target.value))} aria-label={translateUi('Recolor tolerance')} />
        </>}
        {antialias}
      </>}

      {editor.tool === 'pencil' && blend}

      {['paint-bucket', 'magic-wand'].includes(editor.tool) && <>
        <span className="option-label">{translateUi('Flood Mode:')}</span>
        <ToolbarIconSelect label="Flood Mode" value={editor.floodMode} options={[
          { value: 'contiguous', label: 'Contiguous', icon: 'tool-freeformshape-symbolic.svg' },
          { value: 'global', label: 'Global', icon: 'help-website-symbolic.svg' },
        ]} onChange={(value) => editor.setFloodMode(value as typeof editor.floodMode)} />
        <span className="option-label">{translateUi('Tolerance:')}</span>
        <input className="tool-option-slider compact" type="range" min="0" max="100" value={editor.tool === 'magic-wand' ? editor.magicWandTolerance : editor.paintBucketTolerance} onChange={(event) => editor.tool === 'magic-wand' ? editor.setMagicWandTolerance(Number(event.target.value)) : editor.setPaintBucketTolerance(Number(event.target.value))} aria-label={translateUi('Tolerance')} />
        {editor.tool === 'magic-wand' && <><span className="option-label">{translateUi('Selection Mode:')}</span>{selectionMode}</>}
      </>}

      {['rectangle-select', 'ellipse-select', 'lasso-select'].includes(editor.tool) && <>
        <span className="option-label">{translateUi('Selection Mode:')}</span>{selectionMode}
        {editor.tool === 'lasso-select' ? <>
          <span className="option-label">{translateUi('Lasso Mode:')}</span>
          <ToolbarIconSelect label="Lasso Mode" value={editor.lassoMode} options={[
            { value: 'freeform', label: 'Freeform', icon: 'tool-select-lasso-freeform-symbolic.svg' },
            { value: 'polygon', label: 'Polygon', icon: 'tool-select-lasso-polygon-symbolic.svg' },
          ]} onChange={(value) => editor.setLassoMode(value as typeof editor.lassoMode)} />
        </> : <ToolbarIconSelect label="Auto-scroll" value={editor.selectionAutoScroll ? 'on' : 'off'} options={[
          { value: 'on', label: 'Autoscroll On', icon: 'effects-blurs-zoomblur-symbolic.svg' },
          { value: 'off', label: 'Autoscroll Off', icon: 'effects-blurs-unfocus-symbolic.svg' },
        ]} onChange={(value) => editor.setSelectionAutoScroll(value === 'on')} />}
      </>}

      {shapeTool && <>
        <span className="option-label">{translateUi('Shape Type:')}</span>
        <ToolbarIconSelect label="Shape type" value={editor.tool} options={[
          { value: 'line', label: 'Line / Curve', icon: 'tool-line-symbolic.svg' },
          { value: 'rectangle', label: 'Rectangle', icon: 'tool-rectangle-symbolic.svg' },
          { value: 'rounded-rectangle', label: 'Rounded Rectangle', icon: 'tool-rectangle-rounded-symbolic.svg' },
          { value: 'ellipse', label: 'Ellipse', icon: 'tool-ellipse-symbolic.svg' },
        ]} onChange={(value) => editor.setTool(value as typeof editor.tool)} />
        {editor.tool === 'rounded-rectangle' && <><span className="option-label">{translateUi('Radius:')}</span><ToolbarStepper label="Radius" value={editor.roundedRectangleRadius} min={0} max={100000} onChange={editor.setRoundedRectangleRadius} /></>}
        <span className="option-label">{translateUi('Fill Style:')}</span>{fillStyle}
        {editor.shapeFillStyle !== 'fill' && <><span className="option-label">{translateUi('Outline width:')}</span><ToolbarStepper label="Outline width" value={editor.brushSize} min={1} max={100000} onChange={editor.setBrushSize} /><span className="option-label">{translateUi('Dash:')}</span>{dash}</>}
        {editor.tool === 'line' && <><span className="option-label">{translateUi('Arrow:')}</span><label className="native-toolbar-check"><input aria-label={translateUi('Start arrow')} type="checkbox" checked={editor.lineArrowStart} onChange={(event) => editor.setLineArrowStart(event.target.checked)} />1</label><label className="native-toolbar-check"><input aria-label={translateUi('End arrow')} type="checkbox" checked={editor.lineArrowEnd} onChange={(event) => editor.setLineArrowEnd(event.target.checked)} />2</label>{(editor.lineArrowStart || editor.lineArrowEnd) && <><span className="option-label">{translateUi('Size:')}</span><ToolbarStepper label="Arrow size" value={editor.lineArrowSize} min={1} max={100} onChange={editor.setLineArrowSize} /><span className="option-label">{translateUi('Angle:')}</span><ToolbarStepper label="Arrow angle" value={editor.lineArrowAngle} min={-89} max={89} onChange={editor.setLineArrowAngle} /><span className="option-label">{translateUi('Length:')}</span><ToolbarStepper label="Arrow length" value={editor.lineArrowLength} min={-100} max={100} onChange={editor.setLineArrowLength} /></>}</>}
        {antialias}
      </>}

      {editor.tool === 'freeform' && <>
        <span className="option-label">{translateUi('Fill Style:')}</span>{fillStyle}
        {editor.shapeFillStyle !== 'fill' && <><span className="option-label">{translateUi('Brush width:')}</span><ToolbarStepper label="Brush width" value={editor.brushSize} min={1} max={100000} onChange={editor.setBrushSize} /><span className="option-label">{translateUi('Dash:')}</span>{dash}</>}
        {antialias}
      </>}

      {editor.tool === 'gradient' && <>
        <span className="option-label">{translateUi('Gradient:')}</span>
        <ToolbarIconSelect label="Gradient" value={editor.gradientType} options={[
          { value: 'linear', label: 'Linear Gradient', icon: 'tool-gradient-linear-symbolic.svg' },
          { value: 'reflected', label: 'Linear Reflected Gradient', icon: 'tool-gradient-linear-reflected-symbolic.svg' },
          { value: 'diamond', label: 'Linear Diamond Gradient', icon: 'tool-gradient-diamond-symbolic.svg' },
          { value: 'radial', label: 'Radial Gradient', icon: 'tool-gradient-radial-symbolic.svg' },
          { value: 'conical', label: 'Conical Gradient', icon: 'tool-gradient-conical-symbolic.svg' },
        ]} onChange={(value) => editor.setGradientType(value as typeof editor.gradientType)} />
        <span className="option-label">{translateUi('Mode:')}</span>
        <ToolbarIconSelect label="Gradient mode" value={editor.gradientColorMode} options={[
          { value: 'color', label: 'Color Mode', icon: 'tool-gradient-colormode-color-symbolic.svg' },
          { value: 'transparency', label: 'Transparency Mode', icon: 'tool-gradient-colormode-transparency-symbolic.svg' },
        ]} onChange={(value) => editor.setGradientColorMode(value as typeof editor.gradientColorMode)} />
        {blend}
      </>}

      {editor.tool === 'color-picker' && <>
        <span className="option-label">{translateUi('Sampling:')}</span>
        <ToolbarIconSelect label="Sampling size" showLabel value={String(editor.colorPickerSampleSize)} options={[
          { value: '1', label: 'Single Pixel', icon: 'tool-colorpicker-sampling-1x1-symbolic.svg' },
          { value: '3', label: '3 x 3 Region', icon: 'tool-colorpicker-sampling-3x3-symbolic.svg' },
          { value: '5', label: '5 x 5 Region', icon: 'tool-colorpicker-sampling-5x5-symbolic.svg' },
          { value: '7', label: '7 x 7 Region', icon: 'tool-colorpicker-sampling-7x7-symbolic.svg' },
          { value: '9', label: '9 x 9 Region', icon: 'tool-colorpicker-sampling-9x9-symbolic.svg' },
        ]} onChange={(value) => editor.setColorPickerSampleSize(Number(value))} />
        <ToolbarIconSelect label="Sample source" showLabel value={editor.colorPickerSampleType} options={[
          { value: 'layer', label: 'Layer', icon: 'layers-merge-down-symbolic.svg' },
          { value: 'image', label: 'Image', icon: 'image-resize-canvas-base-symbolic.svg' },
        ]} onChange={(value) => editor.setColorPickerSampleType(value as typeof editor.colorPickerSampleType)} />
        <span className="option-label">{translateUi('After select:')}</span>
        <ToolbarIconSelect label="After select" showLabel value={editor.colorPickerAfterSelect} options={[
          { value: 'none', label: 'Do not switch tool', icon: 'tool-colorpicker-symbolic.svg' },
          { value: 'previous', label: 'Switch to previous tool', icon: 'go-previous-symbolic.svg', standard: true },
          { value: 'pencil', label: 'Switch to Pencil tool', icon: 'tool-pencil-symbolic.svg' },
        ]} onChange={(value) => editor.setColorPickerAfterSelect(value as typeof editor.colorPickerAfterSelect)} />
      </>}

      {editor.tool === 'text' && <>
        <span className="option-label">{translateUi('Font:')}</span>
        <button type="button" className="native-toolbar-select font-family-select" onClick={onChooseFont} aria-label={translateUi('Font family')} title={translateUi('Choose an installed font family')}>{editor.textFontFamily}</button>
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
        <button className={`text-format-button ${editor.textItalic ? 'active' : ''}`} type="button" aria-label={translateUi('Italic')} onClick={() => editor.setTextItalic(!editor.textItalic)}><PintaIcon file="format-text-italic-symbolic.svg" size={15} standard /></button>
        <button className={`text-format-button ${editor.textUnderline ? 'active' : ''}`} type="button" aria-label={translateUi('Underline')} onClick={() => editor.setTextUnderline(!editor.textUnderline)}><PintaIcon file="format-text-underline-symbolic.svg" size={15} standard /></button>
        {([['left', 'format-justify-left-symbolic.svg', 'Left align'], ['center', 'format-justify-center-symbolic.svg', 'Center align'], ['right', 'format-justify-right-symbolic.svg', 'Right align']] as const).map(([alignment, icon, label]) => <button key={alignment} className={`text-format-button ${editor.textAlignment === alignment ? 'active' : ''}`} type="button" aria-label={translateUi(label)} onClick={() => editor.setTextAlignment(alignment as TextAlignment)}><PintaIcon file={icon} size={15} standard /></button>)}
        <span className="option-label">{translateUi('Text Style:')}</span>
        <ToolbarIconSelect label="Text style" value={editor.textStyle} options={[
          { value: 'fill', label: 'Normal', icon: 'tool-fillstyle-fill-symbolic.svg' },
          { value: 'fill-outline', label: 'Normal and Outline', icon: 'tool-fillstyle-outlinefill-symbolic.svg' },
          { value: 'outline', label: 'Outline', icon: 'tool-fillstyle-outline-symbolic.svg' },
          { value: 'background', label: 'Fill Background', icon: 'tool-fillstyle-background-symbolic.svg' },
        ]} onChange={(value) => editor.setTextStyle(value as TextStyle)} />
        {(editor.textStyle === 'fill-outline' || editor.textStyle === 'outline') && <><span className="option-label">{translateUi('Outline width:')}</span><ToolbarStepper label="Text outline width" value={editor.textOutlineWidth} min={1} max={100000} onChange={editor.setTextOutlineWidth} /><span className="option-label">{translateUi('Join:')}</span><ToolbarIconSelect className="text-join-select" label="Text outline join" showLabel value={editor.textLineJoin} options={[{ value: 'miter', label: 'Miter Join' }, { value: 'round', label: 'Round Join' }, { value: 'bevel', label: 'Bevel Join' }]} onChange={(value) => editor.setTextLineJoin(value as CanvasLineJoin)} /></>}
        {antialias}
      </>}
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

const SELECTION_MODE_OPTIONS: Array<{ value: SelectionMode; label: string }> = [
  { value: 'replace', label: 'Replace' },
  { value: 'union', label: 'Union (+) ({0} + Left Click)' },
  { value: 'exclude', label: 'Exclude (-) (Right Click)' },
  { value: 'xor', label: 'Xor ({0} + Right Click)' },
  { value: 'intersect', label: 'Intersect ({0} + Left Click)' },
];

interface StoredResizeSettings {
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

function ImageSizeDialog({ mode, currentWidth, currentHeight, secondaryColor, onCancel, onSubmit }: ImageSizeDialogProps) {
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

interface EffectDialogProps {
  effect: EffectDefinition;
  busy: boolean;
  histogram: RgbHistogram;
  imageWidth: number;
  imageHeight: number;
  thumbnailUrl: string;
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
  histogram: RgbHistogram;
  onChooseColor: (control: Exclude<LevelControlKey, 'gamma'>) => void;
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

function levelValue(parameters: EffectParameters, channel: LevelChannel, control: LevelControlKey) {
  return parameters[levelParameterKey(channel, control)];
}

function levelColor(parameters: EffectParameters, control: Exclude<LevelControlKey, 'gamma'>) {
  return `#${(['red', 'green', 'blue'] as LevelChannel[])
    .map((channel) => Math.round(levelValue(parameters, channel, control)).toString(16).padStart(2, '0'))
    .join('')}`;
}

function mapLevelValue(input: number, parameters: EffectParameters, channel: LevelChannel) {
  const inputLow = levelValue(parameters, channel, 'inputLow');
  const inputHigh = levelValue(parameters, channel, 'inputHigh');
  const outputLow = levelValue(parameters, channel, 'outputLow');
  const outputHigh = levelValue(parameters, channel, 'outputHigh');
  const gamma = levelValue(parameters, channel, 'gamma');
  if (input <= inputLow) return outputLow;
  if (input >= inputHigh) return outputHigh;
  return Math.max(0, Math.min(255, Math.round(outputLow + (outputHigh - outputLow) * ((input - inputLow) / (inputHigh - inputLow)) ** gamma)));
}

function leveledHistogram(histogram: RgbHistogram, parameters: EffectParameters): RgbHistogram {
  const output: RgbHistogram = { red: Array<number>(256).fill(0), green: Array<number>(256).fill(0), blue: Array<number>(256).fill(0) };
  for (const channel of ['red', 'green', 'blue'] as LevelChannel[]) {
    histogram[channel].forEach((occurrences, input) => {
      output[channel][mapLevelValue(input, parameters, channel)] += occurrences;
    });
  }
  return output;
}

function HistogramChart({ histogram, activeChannels, output = false }: {
  histogram: RgbHistogram;
  activeChannels: Record<LevelChannel, boolean>;
  output?: boolean;
}) {
  const selected = (['red', 'green', 'blue'] as LevelChannel[]).filter((channel) => activeChannels[channel]);
  const maximum = Math.max(1, ...selected.flatMap((channel) => histogram[channel]));
  const total = selected.reduce((sum, channel) => sum + histogram[channel].reduce((channelSum, value) => channelSum + value, 0), 0);
  return (
    <svg className="levels-histogram" viewBox="0 0 255 100" preserveAspectRatio="none" role="img" aria-label={output ? 'Output histogram' : 'Input histogram'} data-total={total} data-output={output ? 'true' : 'false'}>
      {selected.map((channel) => {
        const points = histogram[channel].map((occurrences, index) => `${index},${100 - occurrences / maximum * 100}`).join(' ');
        return <polyline key={channel} className={`levels-histogram-channel channel-${channel}`} points={points} />;
      })}
    </svg>
  );
}

function LevelGradient({ kind, low, high, gamma, disabled, onChange }: {
  kind: 'input' | 'output';
  low: number;
  high: number;
  gamma: number;
  disabled: boolean;
  onChange: (control: LevelControlKey, value: number) => void;
}) {
  const dragRef = useRef<'low' | 'gamma' | 'high' | null>(null);
  const mid = low + (high - low) * Math.pow(0.5, gamma);
  const position = (value: number) => value / 2.55;
  const updateFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const handle = dragRef.current;
    if (!handle) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const value = Math.max(0, Math.min(255, Math.round((bounds.bottom - event.clientY) / bounds.height * 255)));
    if (handle === 'gamma') {
      const ratio = Math.max(0.000001, Math.min(0.999999, (value - low) / Math.max(1, high - low)));
      onChange('gamma', Math.max(0.1, Math.min(10, Math.log(ratio) / Math.log(0.5))));
    } else {
      onChange(kind === 'input' ? (handle === 'low' ? 'inputLow' : 'inputHigh') : (handle === 'low' ? 'outputLow' : 'outputHigh'), value);
    }
  };
  const handles = kind === 'input'
    ? [{ key: 'low' as const, value: low }, { key: 'high' as const, value: high }]
    : [{ key: 'low' as const, value: low }, { key: 'gamma' as const, value: mid }, { key: 'high' as const, value: high }];
  return (
    <div
      className={`levels-gradient vertical ${kind}`}
      role="application"
      aria-label={`${kind === 'input' ? 'Input' : 'Output'} levels gradient`}
      aria-disabled={disabled}
      onPointerDown={(event) => {
        if (disabled) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const pointerValue = (bounds.bottom - event.clientY) / bounds.height * 255;
        dragRef.current = handles.reduce((nearest, candidate) => (
          Math.abs(candidate.value - pointerValue) < Math.abs(nearest.value - pointerValue) ? candidate : nearest
        )).key;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
      }}
      onPointerCancel={() => { dragRef.current = null; }}
    >
      {handles.map((handle) => <i key={handle.key} className={`levels-marker ${handle.key}`} style={{ bottom: `${position(handle.value)}%` }} />)}
    </div>
  );
}

function LevelsEditor({ parameters, disabled, onChange, activeChannels, histogram, onChooseColor }: LevelsEditorProps) {
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
  const outputHistogram = leveledHistogram(histogram, parameters);
  const meanInput = (channel: LevelChannel) => {
    const total = histogram[channel].reduce((sum, count) => sum + count, 0);
    if (!total) return 0;
    return histogram[channel].reduce((sum, count, value) => sum + count * value, 0) / total;
  };
  const outputMidColor = `#${(['red', 'green', 'blue'] as LevelChannel[])
    .map((channel) => mapLevelValue(meanInput(channel), parameters, channel).toString(16).padStart(2, '0'))
    .join('')}`;

  return (
    <div className="levels-editor">
      <div className="levels-native-grid">
        <section className="levels-histogram-block">
          <strong>Input Histogram</strong>
          <HistogramChart histogram={histogram} activeChannels={activeChannels} />
        </section>
        <section className="levels-control-column levels-input-controls">
          <strong>Input</strong>
          <DialogStepper label="Input high value" min={1} max={255} value={inputHigh} disabled={disabled || !selectedChannels.length} onChange={(value) => updateControl('inputHigh', value)} />
          <button type="button" className="levels-color-panel" style={{ backgroundColor: levelColor(parameters, 'inputHigh') }} disabled={disabled} aria-label="Choose input high color" title="Choose input high color" onClick={() => onChooseColor('inputHigh')} />
          <span className="levels-control-spacer" />
          <button type="button" className="levels-color-panel" style={{ backgroundColor: levelColor(parameters, 'inputLow') }} disabled={disabled} aria-label="Choose input low color" title="Choose input low color" onClick={() => onChooseColor('inputLow')} />
          <DialogStepper label="Input low value" min={0} max={254} value={inputLow} disabled={disabled || !selectedChannels.length} onChange={(value) => updateControl('inputLow', value)} />
        </section>
        <section className="levels-gradient-column input" aria-label="Input range">
          <strong aria-hidden="true">&nbsp;</strong>
          <LevelGradient kind="input" low={inputLow} high={inputHigh} gamma={gamma} disabled={disabled || !selectedChannels.length} onChange={updateControl} />
        </section>
        <section className="levels-gradient-column output" aria-label="Output range">
          <strong>Output</strong>
          <LevelGradient kind="output" low={outputLow} high={outputHigh} gamma={gamma} disabled={disabled || !selectedChannels.length} onChange={updateControl} />
        </section>
        <section className="levels-control-column levels-output-controls">
          <strong aria-hidden="true">&nbsp;</strong>
          <DialogStepper label="Output high value" min={2} max={255} value={outputHigh} disabled={disabled || !selectedChannels.length} onChange={(value) => updateControl('outputHigh', value)} />
          <button type="button" className="levels-color-panel" style={{ backgroundColor: levelColor(parameters, 'outputHigh') }} disabled={disabled} aria-label="Choose output high color" title="Choose output high color" onClick={() => onChooseColor('outputHigh')} />
          <DialogStepper label="Gamma value" min={0.1} max={10} step={0.1} value={gamma} disabled={disabled || !selectedChannels.length} onChange={(value) => updateControl('gamma', value)} />
          <span className="levels-color-panel levels-output-mid" style={{ backgroundColor: outputMidColor }} aria-label="Leveled mean color" title="Leveled mean color" />
          <button type="button" className="levels-color-panel" style={{ backgroundColor: levelColor(parameters, 'outputLow') }} disabled={disabled} aria-label="Choose output low color" title="Choose output low color" onClick={() => onChooseColor('outputLow')} />
          <DialogStepper label="Output low value" min={0} max={252} value={outputLow} disabled={disabled || !selectedChannels.length} onChange={(value) => updateControl('outputLow', value)} />
        </section>
        <section className="levels-histogram-block">
          <strong>Output Histogram</strong>
          <HistogramChart histogram={outputHistogram} activeChannels={activeChannels} output />
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

function EffectDialog({ effect, busy, histogram, imageWidth, imageHeight, thumbnailUrl, onCancel, onPreview, onSubmit }: EffectDialogProps) {
  const defaults = useMemo(() => defaultEffectParameters(effect), [effect]);
  const [parameters, setParameters] = useState<EffectParameters>(() => defaults);
  const [pointDisplay, setPointDisplay] = useState<Record<string, { x: number; y: number }>>(() => (
    effect.id === 'chromatic-aberration'
      ? Object.fromEntries(['red', 'green', 'blue'].map((prefix) => [prefix, { x: Math.floor(imageWidth / 2), y: Math.floor(imageHeight / 2) }]))
      : {}
  ));
  const [posterizeLinked, setPosterizeLinked] = useState(true);
  const [colorParameterKey, setColorParameterKey] = useState<string | null>(null);
  const [levelColorTarget, setLevelColorTarget] = useState<Exclude<LevelControlKey, 'gamma'> | null>(null);
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

  const autoLevels = () => {
    setParameters((current) => {
      const next = { ...current };
      for (const channel of ['red', 'green', 'blue'] as LevelChannel[]) {
        const values = histogram[channel];
        const total = values.reduce((sum, count) => sum + count, 0);
        let cumulative = 0;
        let low = 0;
        let high = 255;
        const weighted = values.reduce((sum, count, value) => sum + value * count, 0);
        for (let value = 0; value < 256; value += 1) {
          const count = values[value];
          cumulative += count;
          if (cumulative > total * 0.005) { low = value; break; }
        }
        cumulative = 0;
        for (let value = 0; value < 256; value += 1) {
          cumulative += values[value];
          if (cumulative > total * 0.995) { high = value; break; }
        }
        if (high <= low) high = Math.min(255, low + 1);
        const mean = total ? weighted / total : 0;
        const ratio = (mean - low) / (high - low);
        const gamma = low < mean && mean < high && ratio > 0 && ratio !== 1
          ? Math.max(0.1, Math.min(10, Math.log(0.5) / Math.log(ratio)))
          : 1;
        next[levelParameterKey(channel, 'inputLow')] = Math.min(254, low);
        next[levelParameterKey(channel, 'inputHigh')] = high;
        next[levelParameterKey(channel, 'gamma')] = gamma;
        next[levelParameterKey(channel, 'outputLow')] = 0;
        next[levelParameterKey(channel, 'outputHigh')] = 255;
      }
      return next;
    });
  };

  const updateLevelColor = (control: Exclude<LevelControlKey, 'gamma'>, color: string) => {
    const bytes = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map((value) => Number.parseInt(value, 16));
    setParameters((current) => {
      const next = { ...current };
      (['red', 'green', 'blue'] as LevelChannel[]).forEach((channel, index) => {
        const value = bytes[index];
        next[levelParameterKey(channel, control)] = value;
        if (control === 'inputLow') next[levelParameterKey(channel, 'inputHigh')] = Math.max(value + 1, next[levelParameterKey(channel, 'inputHigh')]);
        if (control === 'inputHigh') next[levelParameterKey(channel, 'inputLow')] = Math.min(value - 1, next[levelParameterKey(channel, 'inputLow')]);
        if (control === 'outputLow') next[levelParameterKey(channel, 'outputHigh')] = Math.max(value + 1, next[levelParameterKey(channel, 'outputHigh')]);
        if (control === 'outputHigh') next[levelParameterKey(channel, 'outputLow')] = Math.min(value - 1, next[levelParameterKey(channel, 'outputLow')]);
      });
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
      const isCenterOffset = pointPrefix === 'offset';
      const isAbsolutePoint = effect.id === 'chromatic-aberration' && ['red', 'green', 'blue'].includes(pointPrefix);
      const pointTitle = isCenterOffset
        ? (['dents', 'polar-inversion', 'twist'].includes(effect.id) ? 'Center Offset' : 'Offset')
        : `${pointPrefix[0].toUpperCase()}${pointPrefix.slice(1)} shift`;
      const displayX = isCenterOffset
        ? Math.floor((parameters[parameter.key] + 1) * imageWidth / 2)
        : isAbsolutePoint ? pointDisplay[pointPrefix].x : parameters[parameter.key];
      const displayY = isCenterOffset
        ? Math.floor((parameters[following.key] + 1) * imageHeight / 2)
        : isAbsolutePoint ? pointDisplay[pointPrefix].y : parameters[following.key];
      const minX = isCenterOffset || isAbsolutePoint ? 0 : parameter.min;
      const maxX = isCenterOffset || isAbsolutePoint ? imageWidth : parameter.max;
      const minY = isCenterOffset || isAbsolutePoint ? 0 : following.min;
      const maxY = isCenterOffset || isAbsolutePoint ? imageHeight : following.max;
      const updatePoint = (x: number, y: number) => {
        if (isAbsolutePoint) setPointDisplay((current) => ({ ...current, [pointPrefix]: { x, y } }));
        setParameters((current) => ({
          ...current,
          [parameter.key]: isCenterOffset ? x * 2 / imageWidth - 1 : x,
          [following.key]: isCenterOffset ? y * 2 / imageHeight - 1 : y,
        }));
      };
      simpleControls.push(
        <div className="native-effect-point" key={`${parameter.key}-${following.key}`}>
          <strong>{translateUi(pointTitle)}</strong>
          <div>
            <PointPad x={displayX} y={displayY} minX={minX} maxX={maxX} minY={minY} maxY={maxY} stepX={isCenterOffset ? 1 : parameter.step} stepY={isCenterOffset ? 1 : following.step} thumbnailUrl={thumbnailUrl} disabled={busy} onChange={updatePoint} />
            <span className="native-effect-point-fields">
              <label><span>X:</span><DialogStepper label="Offset X" min={minX} max={maxX} step={isCenterOffset || isAbsolutePoint ? 1 : parameter.step} value={displayX} disabled={busy} onChange={(value) => updatePoint(value, displayY)} /><DialogResetButton label="Reset Offset X" disabled={busy} onClick={() => isAbsolutePoint ? updatePoint(Math.floor(imageWidth / 2), displayY) : updateParameter(parameter.key, parameter.defaultValue)} /></label>
              <label><span>Y:</span><DialogStepper label="Offset Y" min={minY} max={maxY} step={isCenterOffset || isAbsolutePoint ? 1 : following.step} value={displayY} disabled={busy} onChange={(value) => updatePoint(displayX, value)} /><DialogResetButton label="Reset Offset Y" disabled={busy} onClick={() => isAbsolutePoint ? updatePoint(displayX, Math.floor(imageHeight / 2)) : updateParameter(following.key, following.defaultValue)} /></label>
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
            <LevelsEditor parameters={parameters} disabled={busy} onChange={setParameters} activeChannels={levelChannels} histogram={histogram} onChooseColor={setLevelColorTarget} />
          ) : effect.dialog === 'alignment' ? (
            <AlignmentEditor parameters={parameters} disabled={busy} onChange={setParameters} />
          ) : (
            <div className="native-effect-parameter-list">
              {simpleControls}
              {effect.hint && <p className="native-effect-hint">{translateUi(effect.hint)}</p>}
              {effect.id === 'posterize' && (
                <label className="native-effect-boolean posterize-linked"><input type="checkbox" checked={posterizeLinked} disabled={busy} onChange={(event) => setPosterizeLinked(event.target.checked)} /><span>{translateUi('Linked')}</span></label>
              )}
            </div>
          )}
        </div>
        <DialogActions onCancel={onCancel} disabled={busy} cancelDisabled={false} submitLabel={busy ? 'Applying…' : 'OK'}>
          {effect.dialog === 'levels' && (
            <div className="levels-native-footer-controls">
              <button type="button" className="native-dialog-button" disabled={busy} onClick={autoLevels}>Auto</button>
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
      {levelColorTarget && (
        <ColorPickerDialog
          title="Choose Color"
          primary={levelColor(parameters, levelColorTarget)}
          onCancel={() => setLevelColorTarget(null)}
          onSubmit={(colors) => {
            updateLevelColor(levelColorTarget, colors.primary);
            setLevelColorTarget(null);
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

function PasteExpandDialog({ onCancel, onPreserve, onExpand }: { onCancel: () => void; onPreserve: () => void; onExpand: () => void }) {
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

function InformationDialog({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  return (
    <div className="dialog-backdrop native-alert-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="pinta-dialog native-alert-dialog information-dialog" role="alertdialog" aria-modal="true" aria-labelledby="information-dialog-title" aria-describedby="information-dialog-message">
        <div className="close-document-content">
          <h2 id="information-dialog-title">{translateUi(title)}</h2>
          <p id="information-dialog-message">{translateUi(message)}</p>
        </div>
        <footer className="native-dialog-actions compact-dialog-actions"><span className="native-dialog-actions-spacer" /><button type="button" className="native-dialog-button suggested" autoFocus onClick={onClose}>{translateUi('OK')}</button></footer>
      </div>
    </div>
  );
}

function ErrorReportDialog({ error, onClose, onReportBug }: {
  error: ApplicationError;
  onClose: () => void;
  onReportBug: () => void;
}) {
  return (
    <div className="dialog-backdrop native-alert-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="pinta-dialog native-alert-dialog error-report-dialog" role="alertdialog" aria-modal="true" aria-labelledby="error-report-title" aria-describedby="error-report-message">
        <div className="error-report-content">
          <h2 id="error-report-title">{translateUi(error.title)}</h2>
          <p id="error-report-message">{translateUi(error.message)}</p>
          <details>
            <summary>{translateUi('Details')}</summary>
            <pre data-visual-error-details>{error.details}</pre>
          </details>
        </div>
        <footer className="native-dialog-actions compact-dialog-actions">
          <button type="button" className="native-dialog-button suggested" onClick={onReportBug}>{translateUi('Report Bug...')}</button>
          <span className="native-dialog-actions-spacer" />
          <button type="button" className="native-dialog-button" autoFocus onClick={onClose}>{translateUi('OK')}</button>
        </footer>
      </div>
    </div>
  );
}

function EffectProgressDialog({ effectName, progress, onCancel }: { effectName: string; progress: number; onCancel: () => void }) {
  return (
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation">
      <div className="pinta-dialog effect-progress-dialog" role="dialog" aria-modal="true" aria-labelledby="effect-progress-title" aria-describedby="effect-progress-name">
        <h2 id="effect-progress-title">{translateUi('Rendering Effect')}</h2>
        <div className="effect-progress-content">
          <span id="effect-progress-name">{translateUi(effectName)}</span>
          <progress aria-label={translateUi('Rendering progress')} value={progress} max={1} />
          <small>{Math.round(progress * 100)}%</small>
        </div>
        <footer className="native-dialog-actions compact-dialog-actions">
          <span className="native-dialog-actions-spacer" />
          <button type="button" className="native-dialog-button" autoFocus onClick={onCancel}>{translateUi('Cancel')}</button>
        </footer>
      </div>
    </div>
  );
}

interface LayerPropertiesDialogProps {
  layer: PaintLayer;
  onCancel: () => void;
  onPreview: (properties: { name: string; visible: boolean; opacity: number; blendMode: BlendMode }) => void;
  onSubmit: (properties: { name: string; visible: boolean; opacity: number; blendMode: BlendMode }) => void;
}

function LayerPropertiesDialog({ layer, onCancel, onPreview, onSubmit }: LayerPropertiesDialogProps) {
  const [name, setName] = useState(layer.name);
  const [visible, setVisible] = useState(layer.visible);
  const [opacity, setOpacity] = useState(Math.round(layer.opacity * 100));
  const [blendMode, setBlendMode] = useState<BlendMode>(layer.blendMode);
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  const valid = name.trim().length > 0;
  useEffect(() => {
    onPreviewRef.current({ name, visible, opacity: opacity / 100, blendMode });
  }, [blendMode, name, opacity, visible]);

  return (
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog layer-properties-dialog" role="dialog" aria-modal="true" aria-labelledby="layer-properties-title" onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSubmit({ name, visible, opacity: opacity / 100, blendMode });
      }}>
        <h2 className="visually-hidden" id="layer-properties-title">{translateUi('Layer Properties')}</h2>
        <div className="dialog-content layer-properties-content">
          <label className="layer-property-field">
            <span>{translateUi('Name')}</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label={translateUi('Layer name')} />
          </label>
          <label className="dialog-checkbox layer-visible-field">
            <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />
            <span>{translateUi('Visible')}</span>
          </label>
          <label className="layer-property-field">
            <span>{translateUi('Blend Mode')}</span>
            <select value={blendMode} onChange={(event) => setBlendMode(event.target.value as BlendMode)} aria-label={translateUi('Blend mode')}>
              {BLEND_MODES.map((mode) => <option key={mode.id} value={mode.id}>{translateUi(mode.label)}</option>)}
            </select>
          </label>
          <label className="layer-opacity-field">
            <span>{translateUi('Opacity')}</span>
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

function RotateZoomLayerDialog({ layer, imageWidth, imageHeight, thumbnailUrl, onCancel, onPreview, onSubmit }: { layer: PaintLayer; imageWidth: number; imageHeight: number; thumbnailUrl: string; onCancel: () => void; onPreview: (layerId: string, angle: number, panHorizontal: number, panVertical: number, zoom: number) => void; onSubmit: (angle: number, panHorizontal: number, panVertical: number, zoom: number) => void }) {
  const [angle, setAngle] = useState(0);
  const [panX, setPanX] = useState(() => Math.floor(imageWidth / 2));
  const [panY, setPanY] = useState(() => Math.floor(imageHeight / 2));
  const [panHorizontal, setPanHorizontal] = useState(0);
  const [panVertical, setPanVertical] = useState(0);
  const [zoom, setZoom] = useState(1);
  const updatePanX = (x: number) => { setPanX(x); setPanHorizontal(x * 2 / imageWidth - 1); };
  const updatePanY = (y: number) => { setPanY(y); setPanVertical(y * 2 / imageHeight - 1); };
  useEffect(() => {
    onPreview(layer.id, angle, panHorizontal, panVertical, zoom);
  }, [angle, layer.id, onPreview, panHorizontal, panVertical, zoom]);
  return (
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog rotate-zoom-dialog" role="dialog" aria-modal="true" aria-labelledby="rotate-zoom-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(angle, panHorizontal, panVertical, zoom);
      }}>
        <h2 className="visually-hidden" id="rotate-zoom-title">{translateUi('Rotate / Zoom Layer')}</h2>
        <div className="dialog-content rotate-zoom-content">
          <div className="native-transform-control">
            <strong>{translateUi('Angle')}</strong>
            <div><AngleDial value={angle} min={-360} max={360} onChange={setAngle} /><DialogStepper label="Layer rotation angle" min={-360} max={360} value={angle} onChange={setAngle} /><DialogResetButton label="Reset angle" onClick={() => setAngle(0)} /></div>
          </div>
          <div className="native-transform-control native-transform-pan">
            <strong>{translateUi('Pan')}</strong>
            <div><PointPad x={panX} y={panY} minX={0} maxX={imageWidth} minY={0} maxY={imageHeight} stepX={1} stepY={1} thumbnailUrl={thumbnailUrl} onChange={(x, y) => { updatePanX(x); updatePanY(y); }} /><span className="native-effect-point-fields"><label><span>X:</span><DialogStepper label="Layer horizontal pan" min={0} max={imageWidth} value={panX} onChange={updatePanX} /><DialogResetButton label="Reset horizontal pan" onClick={() => updatePanX(Math.floor(imageWidth / 2))} /></label><label><span>Y:</span><DialogStepper label="Layer vertical pan" min={0} max={imageHeight} value={panY} onChange={updatePanY} /><DialogResetButton label="Reset vertical pan" onClick={() => updatePanY(Math.floor(imageHeight / 2))} /></label></span></div>
          </div>
          <label className="native-effect-range native-transform-zoom"><strong>{translateUi('Zoom')}</strong><span><input type="range" min="0" max="16" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><DialogStepper label="Layer zoom value" min={0} max={16} step={0.01} value={zoom} onChange={setZoom} /><DialogResetButton label="Reset zoom" onClick={() => setZoom(1)} /></span></label>
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
  onSaved?: () => void;
  onSubmit: (options: { fileName: string; format: ExportFormat; quality: number; flatten: boolean }) => Promise<boolean>;
}

function initialExportFormat(fileName: string): ExportFormat {
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

function FlattenConfirmDialog({ onCancel, onFlatten }: { onCancel: () => void; onFlatten: () => void }) {
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

function JpegQualityDialog({ initialQuality, onCancel, onSubmit }: { initialQuality: number; onCancel: () => void; onSubmit: (quality: number) => void }) {
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

function SaveAsDialog({ fileName, layerCount, onCancel, onSaved = onCancel, onSubmit }: SaveAsDialogProps) {
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

interface PrintPreview {
  dataUrl: string;
  fileName: string;
  width: number;
  height: number;
  settings: PrintSettings;
}

interface PrintSettings {
  orientation: 'portrait' | 'landscape';
  scaleMode: 'fit' | 'actual' | 'custom';
  scale: number;
  margin: number;
  center: boolean;
}

function PrintDialog({ preview, onCancel, onPrint, onSettingsChange }: { preview: PrintPreview; onCancel: () => void; onPrint: () => void; onSettingsChange: (settings: PrintSettings) => void }) {
  const update = (settings: Partial<PrintSettings>) => onSettingsChange({ ...preview.settings, ...settings });
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
            <span>{preview.width} × {preview.height} {translateUi('pixels')} · {translateUi('one page')}</span>
          </div>
          <fieldset className="print-settings-group">
            <legend>{translateUi('Page setup')}</legend>
            <label><span>{translateUi('Orientation')}</span><select aria-label={translateUi('Print orientation')} value={preview.settings.orientation} onChange={(event) => update({ orientation: event.target.value as PrintSettings['orientation'] })}><option value="portrait">{translateUi('Portrait')}</option><option value="landscape">{translateUi('Landscape')}</option></select></label>
            <label><span>{translateUi('Scaling')}</span><select aria-label={translateUi('Print scaling')} value={preview.settings.scaleMode} onChange={(event) => update({ scaleMode: event.target.value as PrintSettings['scaleMode'] })}><option value="fit">{translateUi('Scale to fit one page')}</option><option value="actual">{translateUi('Actual size (96 PPI)')}</option><option value="custom">{translateUi('Custom scale')}</option></select></label>
            {preview.settings.scaleMode === 'custom' && <label><span>{translateUi('Scale')}</span><span className="print-number-field"><input type="number" min="10" max="500" value={preview.settings.scale} onChange={(event) => update({ scale: Math.max(10, Math.min(500, Number(event.target.value) || 10)) })} aria-label={translateUi('Custom print scale')} /><i>%</i></span></label>}
            <label><span>{translateUi('Margins')}</span><span className="print-number-field"><input type="number" min="0" max="50" value={preview.settings.margin} onChange={(event) => update({ margin: Math.max(0, Math.min(50, Number(event.target.value) || 0)) })} aria-label={translateUi('Print margins')} /><i>mm</i></span></label>
            <label className="print-center-row"><input type="checkbox" checked={preview.settings.center} onChange={(event) => update({ center: event.target.checked })} /><span>{translateUi('Center image on page')}</span></label>
          </fieldset>
          <p className="dialog-hint">{translateUi('Paper size, printer options, and destination remain available in the browser’s print window.')}</p>
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

function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const sections = useMemo(() => [{
    title: 'Tools',
    entries: TOOLS.filter((tool) => tool.shortcut)
      .map((tool) => [tool.name, tool.shortcut!.toUpperCase()] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  }, ...REGISTERED_SHORTCUT_SECTIONS], []);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSections = sections.flatMap((section) => {
    const entries = normalizedQuery
      ? section.entries.filter(([label, shortcut]) => `${translateUi(label)} ${shortcut}`.toLocaleLowerCase().includes(normalizedQuery))
      : section.entries;
    return entries.length ? [{ ...section, entries }] : [];
  });
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="pinta-dialog shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <header className="dialog-header shortcuts-header">
          <button type="button" className={`about-header-button ${searching ? 'active' : ''}`} aria-label={translateUi('Search shortcuts')} aria-pressed={searching} onClick={() => {
            setSearching((current) => !current);
            if (searching) setQuery('');
          }}><PintaIcon file="system-search-symbolic.svg" size={15} standard /></button>
          <strong id="shortcuts-title">{translateUi('Keyboard Shortcuts')}</strong>
          <button type="button" className="about-header-button" aria-label={translateUi('Close')} onClick={onClose}>×</button>
        </header>
        {searching && <div className="shortcuts-search"><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translateUi('Search shortcuts')} aria-label={translateUi('Search shortcuts')} /></div>}
        <div className="shortcuts-layout">
          <nav className="shortcuts-navigation" aria-label={translateUi('Shortcut sections')}>
            {sections.map((section) => <button key={section.title} type="button" onClick={() => document.getElementById(`shortcut-section-${section.title.toLowerCase()}`)?.scrollIntoView({ block: 'start' })}>{translateUi(section.title)}</button>)}
          </nav>
          <div className="dialog-content shortcuts-content">
            {visibleSections.map((section) => (
              <section className="shortcut-section" id={`shortcut-section-${section.title.toLowerCase()}`} key={section.title}>
                <h3>{translateUi(section.title)}</h3>
                <div className="shortcut-list">
                  {section.entries.map(([label, shortcut]) => <div className="shortcut-row" key={label}><span>{translateUi(label)}</span><kbd>{shortcut}</kbd></div>)}
                </div>
              </section>
            ))}
            {!visibleSections.length && <div className="shortcuts-empty"><PintaIcon file="system-search-symbolic.svg" size={34} standard /><strong>{translateUi('No shortcuts found')}</strong></div>}
          </div>
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

type AboutPage = 'overview' | 'details' | 'credits' | 'legal';

function AboutDialog({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState<AboutPage>('overview');
  const translatorCredits = translateUi('translator-credits');
  const title = page === 'overview' ? 'About Pinta' : page === 'details' ? 'Details' : page === 'credits' ? 'Credits' : 'Legal';
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="pinta-dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <header className="dialog-header about-dialog-header">
          {page === 'overview'
            ? <span />
            : <button type="button" className="about-header-button" data-about-back aria-label={translateUi('Back')} onClick={() => setPage('overview')}>‹</button>}
          <strong id="about-title">{translateUi(title)}</strong>
          <button type="button" className="about-header-button" aria-label={translateUi('Close')} onClick={onClose}>×</button>
        </header>
        {page === 'overview' && (
          <div className="dialog-content about-content">
            <img src="/apps/com.github.PintaProject.Pinta.svg" alt="Pinta" />
            <h2>Pinta</h2>
            <p className="about-version" data-visual-version>Pinta Online {__PINTA_ONLINE_VERSION__} · based on Pinta 3.2</p>
            <p>{translateUi('Easily create and edit images, now in the browser.')}</p>
            <p className="about-port-credit">{translateUi('Ported to the web by')} <a href={WEB_REPOSITORY_URL} target="_blank" rel="noreferrer">Evgeny Vinnik</a>.</p>
            <div className="about-links">
              <button type="button" onClick={() => setPage('details')}><span>{translateUi('Details')}</span><b>›</b></button>
              <a href={USER_GUIDE_URL}><span>{translateUi('Support Questions')}</span><b>›</b></a>
              <a href={WEB_BUG_REPORT_URL} target="_blank" rel="noreferrer"><span>{translateUi('Report an Issue')}</span><b>›</b></a>
              <button type="button" onClick={() => setPage('credits')}><span>{translateUi('Credits')}</span><b>›</b></button>
              <button type="button" onClick={() => setPage('legal')}><span>{translateUi('Legal')}</span><b>›</b></button>
            </div>
            <p className="dialog-hint">Copyright © 2010–2026 {translateUi('by Pinta contributors')}</p>
          </div>
        )}
        {page === 'details' && (
          <article className="dialog-content about-subpage">
            <img src="/apps/com.github.PintaProject.Pinta.svg" alt="" />
            <h2>{translateUi('Easily create and edit images')}</h2>
            <p>{translateUi('Pinta Online brings the familiar Pinta painting and image-editing experience to modern web browsers.')}</p>
            <dl>
              <div><dt>{translateUi('Version')}</dt><dd>Pinta Online {__PINTA_ONLINE_VERSION__}</dd></div>
              <div><dt>{translateUi('Based on')}</dt><dd>Pinta 3.2</dd></div>
              <div><dt>{translateUi('Website')}</dt><dd><a href={aboutPathForLocale(currentLocale())} aria-label={translateUi('Website')}>{translateUi('Pinta Online website')}</a></dd></div>
              <div><dt>{translateUi('Source Code')}</dt><dd><a href={WEB_REPOSITORY_URL} target="_blank" rel="noreferrer" aria-label={translateUi('Source Code')}>github.com/evgenyvinnik/pinta-online</a></dd></div>
            </dl>
            <p>{translateUi('Ported to the web by')} <a href={WEB_REPOSITORY_URL} target="_blank" rel="noreferrer">Evgeny Vinnik</a>.</p>
          </article>
        )}
        {page === 'credits' && (
          <article className="dialog-content about-subpage about-credits">
            <section>
              <h2>{translateUi('Web port')}</h2>
              <p><a href={WEB_REPOSITORY_URL} target="_blank" rel="noreferrer">Evgeny Vinnik</a></p>
            </section>
            <section>
              <h2>{translateUi('Developers')}</h2>
              <ul>{PINTA_DEVELOPERS.map((developer) => <li key={developer}>{developer}</li>)}</ul>
              <a href="https://github.com/PintaProject/Pinta/graphs/contributors" target="_blank" rel="noreferrer">{translateUi('View all Pinta contributors')} ↗</a>
            </section>
            {translatorCredits !== 'translator-credits' && (
              <section>
                <h2>{translateUi('Translators')}</h2>
                <pre>{translatorCredits}</pre>
              </section>
            )}
          </article>
        )}
        {page === 'legal' && (
          <article className="dialog-content about-subpage about-legal">
            <h2>{translateUi('Copyright')}</h2>
            <p>Copyright © 2010–2026 {translateUi('by Pinta contributors')}</p>
            <h2>{translateUi('License')}</h2>
            <p>{translateUi('Released under the MIT X11 License.')}</p>
            <p><a href={`${WEB_REPOSITORY_URL}/blob/master/LICENSE`} target="_blank" rel="noreferrer">{translateUi('Read the complete license')} ↗</a></p>
            <h2>{translateUi('Based on the work of Paint.NET:')}</h2>
            <p><a href="https://www.getpaint.net/" target="_blank" rel="noreferrer">getpaint.net ↗</a></p>
            <h2>{translateUi('Using some icons from:')}</h2>
            <ul>
              <li>Silk — famfamfam.com</li>
              <li>Fugue — pinvoke.com</li>
              <li>Google Material Icons</li>
              <li>Microsoft Fluent UI System Icons</li>
              <li>{translateUi('Pinta contributors')}</li>
            </ul>
          </article>
        )}
      </div>
    </div>
  );
}

function FontFamilyDialog({ families, current, onCancel, onSubmit }: {
  families: string[];
  current: string;
  onCancel: () => void;
  onSubmit: (family: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(current);
  const visibleFamilies = families.filter((family) => family.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <div className="dialog-backdrop native-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="pinta-dialog font-family-dialog" role="dialog" aria-modal="true" aria-labelledby="font-family-dialog-title" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(selected);
      }}>
        <h2 className="visually-hidden" id="font-family-dialog-title">Choose Font Family</h2>
        <div className="font-family-dialog-content">
          <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search fonts" placeholder="Search fonts" />
          <div className="font-family-list" role="listbox" aria-label="Font families">
            {visibleFamilies.map((family) => (
              <button
                key={family}
                type="button"
                role="option"
                aria-selected={family === selected}
                className={family === selected ? 'selected' : ''}
                style={{ fontFamily: `"${family}"` }}
                onClick={() => setSelected(family)}
                onDoubleClick={() => onSubmit(family)}
              >{family}</button>
            ))}
            {!visibleFamilies.length && <p>No matching fonts</p>}
          </div>
          <div className="font-family-preview" style={{ fontFamily: `"${selected}"` }}>The quick brown fox jumps over the lazy dog.</div>
        </div>
        <DialogActions onCancel={onCancel} submitLabel="Select" />
      </form>
    </div>
  );
}

type AuxiliaryDialogName = 'shortcuts' | 'language' | 'about' | 'addins';

interface AuxiliaryDialogHandle {
  open: (dialog: AuxiliaryDialogName) => void;
  openFonts: () => Promise<void>;
  hasOpenDialog: () => boolean;
  closeTop: () => void;
  closeAll: () => void;
}

const AuxiliaryDialogHost = memo(forwardRef<AuxiliaryDialogHandle, {
  currentFont: string;
  setFont: (family: string) => void;
  enabledAddins: readonly AddinId[];
  paintBrushType: string;
  setPaintBrushType: (type: 'normal') => void;
  onToggleAddin: (addin: AddinId, enabled: boolean) => void;
  onSetAllAddins: (enabled: boolean) => void;
  notify: (message: string) => void;
}>(function AuxiliaryDialogHost({
  currentFont,
  setFont,
  enabledAddins,
  paintBrushType,
  setPaintBrushType,
  onToggleAddin,
  onSetAllAddins,
  notify,
}, ref) {
  const [dialog, setDialog] = useState<AuxiliaryDialogName | 'fonts' | null>(null);
  const [fontFamilies, setFontFamilies] = useState<string[]>(FALLBACK_FONT_FAMILIES);

  const closeTop = useCallback(() => {
    if (dialog === 'about') {
      const back = document.querySelector<HTMLButtonElement>('.about-dialog [data-about-back]');
      if (back) {
        back.click();
        return;
      }
    }
    setDialog(null);
  }, [dialog]);

  useImperativeHandle(ref, () => ({
    open: setDialog,
    openFonts: async () => {
      let available = FALLBACK_FONT_FAMILIES;
      const queryLocalFonts = (window as LocalFontWindow).queryLocalFonts;
      if (queryLocalFonts) {
        try {
          const localFonts = await queryLocalFonts.call(window);
          const installed = localFonts.map((font) => font.family.trim()).filter(Boolean);
          if (installed.length) available = [...new Set([...installed, currentFont])].sort((left, right) => left.localeCompare(right));
        } catch {
          notify('Installed font access was not granted; showing common fonts instead.');
        }
      }
      if (!available.includes(currentFont)) available = [currentFont, ...available];
      setFontFamilies(available);
      setDialog('fonts');
    },
    hasOpenDialog: () => dialog !== null,
    closeTop,
    closeAll: () => setDialog(null),
  }), [closeTop, currentFont, dialog, notify]);

  return (
    <>
      {dialog === 'shortcuts' && <KeyboardShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'language' && <LanguageDialog onClose={() => setDialog(null)} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
      {dialog === 'fonts' && (
        <FontFamilyDialog
          families={fontFamilies}
          current={currentFont}
          onCancel={() => setDialog(null)}
          onSubmit={(family) => {
            setFont(family);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'addins' && (
        <AddinManagerDialog
          enabledAddins={enabledAddins}
          onToggle={(addin, enabled) => {
            onToggleAddin(addin, enabled);
            if (!enabled && addin === 'block-brush' && paintBrushType === 'block') setPaintBrushType('normal');
          }}
          onSetAll={(enabled) => {
            onSetAllAddins(enabled);
            if (!enabled && paintBrushType === 'block') setPaintBrushType('normal');
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}));

const StatusBar = memo(function StatusBar({
  hasDocument,
  primary,
  secondary,
  recentColors,
  palette,
  liveMetrics,
  width,
  height,
  zoom,
  zoomMode,
  onOpenColor,
  onSwapColors,
  onResetColors,
  onSetPrimary,
  onSetSecondary,
  onEditPalette,
  onAddPalette,
  onSetZoom,
  onZoomToWindow,
}: {
  hasDocument: boolean;
  primary: string;
  secondary: string;
  recentColors: string[];
  palette: string[];
  liveMetrics: EditorLiveMetrics;
  width: number;
  height: number;
  zoom: number;
  zoomMode: 'fixed' | 'fit' | 'window';
  onOpenColor: (target: 'primary' | 'secondary') => void;
  onSwapColors: () => void;
  onResetColors: () => void;
  onSetPrimary: (color: string) => void;
  onSetSecondary: (color: string) => void;
  onEditPalette: (index: number) => void;
  onAddPalette: () => void;
  onSetZoom: (zoom: number) => void;
  onZoomToWindow: () => void;
}) {
  useTranslation();
  const [zoomDraft, setZoomDraft] = useState<string | null>(null);
  const [zoomListOpen, setZoomListOpen] = useState(false);
  useEffect(() => {
    const close = (event: Event) => {
      if (event.type === 'pointerdown' && (event.target as Element | null)?.closest('.zoom-combo')) return;
      setZoomListOpen(false);
    };
    window.addEventListener('blur', close);
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('blur', close);
      window.removeEventListener('pointerdown', close);
    };
  }, []);
  const commitZoomDraft = useCallback(() => {
    const draft = zoomDraft;
    setZoomDraft(null);
    if (draft === null) return;
    if (draft.trim().toLowerCase() === translateUi('Window').toLowerCase()) {
      onZoomToWindow();
      return;
    }
    const parsed = parseZoomPercent(draft);
    if (parsed !== null) onSetZoom(parsed);
  }, [onSetZoom, onZoomToWindow, zoomDraft]);

  return (
    <footer className="status-bar">
      <div className="color-wells" title="Click either color to open the full color picker. Press X to swap.">
        <button className="color-well secondary checkerboard" style={{ '--well-color': secondary } as CSSProperties} onClick={() => onOpenColor('secondary')} aria-label={translateUi('Click to select secondary color.')} title={`${secondary} · ${translateUi('Click to select secondary color.')}`} />
        <button className="color-well primary checkerboard" style={{ '--well-color': primary } as CSSProperties} onClick={() => onOpenColor('primary')} aria-label={translateUi('Click to select primary color.')} title={`${primary} · ${translateUi('Click to select primary color.')}`} />
        <button className="swap-colors" type="button" onClick={onSwapColors} aria-label={translateUi('Click to switch between primary and secondary color.')} title={`${translateUi('Click to switch between primary and secondary color.')} ${translateUi('Shortcut key')}: X`}><SwapColorsIcon /></button>
        <button className="reset-colors" type="button" onClick={onResetColors} aria-label={translateUi('Click to reset primary and secondary color.')} title={translateUi('Click to reset primary and secondary color.')}><ResetColorsIcon /></button>
      </div>
      <div className="recent-palette" aria-label={translateUi('Recently Used Colors')}>
        {recentColors.slice(0, 10).map((color, index) => (
          <ColorSwatch key={`${color}-${index}`} className="recent-swatch" color={color} title={`${color} · ${translateUi('Click to select primary color.')}`} label={`${translateUi('Recently Used Colors')}: ${color}`} onPrimary={() => onSetPrimary(color)} onSecondary={() => onSetSecondary(color)} />
        ))}
      </div>
      <div className="palette" aria-label="Color palette">
        {palette.map((color, index) => (
          <ColorSwatch
            key={`${color}-${index}`}
            className="swatch"
            color={color}
            title={`${color} · click for primary, right-click or long press for secondary, Ctrl/⌘+click or middle-click to edit`}
            label={`Set color ${color}`}
            onPrimary={(event) => { if (event.ctrlKey || event.metaKey) onEditPalette(index); else onSetPrimary(color); }}
            onSecondary={() => onSetSecondary(color)}
            onAuxClick={(event) => { if (event.button === 1) onEditPalette(index); }}
            onDoubleClick={() => onEditPalette(index)}
          />
        ))}
        <button className="palette-add-swatch" type="button" disabled={palette.length >= 96} onClick={onAddPalette} aria-label={translateUi('Add Primary Color')} title={`${translateUi('Add Primary Color')}: ${primary}`}><PlusGlyph /></button>
      </div>
      <div className="status-spacer" />
      {hasDocument && <PointerReadout store={liveMetrics.pointer} />}
      {hasDocument && <SelectionSizeReadout store={liveMetrics.selectionSize} width={width} height={height} />}
      <div className="zoom-control">
        <IconButton label="Zoom out" disabled={!hasDocument} onClick={() => onSetZoom(zoomOutLevel(zoom))}><PintaIcon file="value-decrease-symbolic.svg" size={14} standard /></IconButton>
        <div className="zoom-combo" onClick={(event) => event.stopPropagation()}>
          <input
            className="zoom-entry"
            type="text"
            inputMode="numeric"
            disabled={!hasDocument}
            aria-label={translateUi('Zoom level')}
            value={zoomDraft ?? (zoomMode === 'window' ? translateUi('Window') : formatZoomPercent(zoom))}
            data-zoom-mode={zoomMode}
            onChange={(event) => setZoomDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={commitZoomDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitZoomDraft();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setZoomDraft(null);
                event.currentTarget.blur();
              }
            }}
          />
          <button className="zoom-combo-arrow" type="button" disabled={!hasDocument} aria-label={translateUi('Choose zoom level')} aria-expanded={zoomListOpen} onClick={() => setZoomListOpen((open) => !open)}><PintaIcon file="pan-down-symbolic.svg" size={12} standard /></button>
          {zoomListOpen && (
            <Popover align="right" className="zoom-level-popover">
              {ZOOM_LEVELS.map((level) => <MenuItem key={level} label={`${level}%`} checked={zoomMode === 'fixed' && Math.round(zoom * 100) === level} onClick={() => { setZoomListOpen(false); onSetZoom(level / 100); }} />)}
              <MenuItem label="Window" checked={zoomMode === 'window'} onClick={() => { setZoomListOpen(false); onZoomToWindow(); }} />
            </Popover>
          )}
        </div>
        <IconButton label="Zoom in" disabled={!hasDocument} onClick={() => onSetZoom(zoomInLevel(zoom))}><PintaIcon file="value-increase-symbolic.svg" size={14} standard /></IconButton>
      </div>
    </footer>
  );
});

const PrimaryDialogBoundary = memo(forwardRef<PrimaryDialogHandle, {
  children: (state: PrimaryDialogState) => ReactNode;
}>(function PrimaryDialogBoundary({ children }, ref) {
  const [dialog, setDialog] = useState<DialogName>(null);
  const [effectDialog, setEffectDialog] = useState<EffectId | null>(null);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const stateRef = useRef<PrimaryDialogState>({ dialog: null, effectDialog: null, showSaveAs: false });
  stateRef.current = { dialog, effectDialog, showSaveAs };
  const closeAll = useCallback(() => {
    setDialog(null);
    setEffectDialog(null);
    setShowSaveAs(false);
  }, []);

  useImperativeHandle(ref, () => ({
    getState: () => stateRef.current,
    setDialog,
    setEffectDialog,
    setShowSaveAs,
    closeAll,
  }), [closeAll]);

  return children(stateRef.current);
}));

const MenuChromeBoundary = memo(forwardRef<MenuChromeHandle, {
  children: (state: MenuChromeState) => ReactNode;
}>(function MenuChromeBoundary({ children }, ref) {
  const [openMenu, setOpenMenu] = useState<MenuName>(null);
  const [menuSurface, setMenuSurface] = useState<'top' | 'header' | null>(null);
  const openMenuRef = useRef<MenuName>(null);
  openMenuRef.current = openMenu;
  const close = useCallback(() => {
    setOpenMenu(null);
    setMenuSurface(null);
  }, []);

  useImperativeHandle(ref, () => ({
    close,
    hasOpenMenu: () => openMenuRef.current !== null,
  }), [close]);

  useEffect(() => {
    const closeOutside = (event: Event) => {
      if (event.type === 'pointerdown' && (event.target as Element | null)?.closest('.macos-menu-bar, .header-cluster-end')) return;
      close();
    };
    window.addEventListener('blur', closeOutside);
    window.addEventListener('pointerdown', closeOutside);
    return () => {
      window.removeEventListener('blur', closeOutside);
      window.removeEventListener('pointerdown', closeOutside);
    };
  }, [close]);

  return children({ openMenu, menuSurface, setOpenMenu, setMenuSurface });
}));

const DockSidebar = memo(function DockSidebar({
  documentState,
  commands,
  toolIcon,
  layerPropertiesPreview,
  onImportLayer,
  onOpenRotateZoomLayer,
  onEditLayer,
}: {
  documentState: PaintEditorController['slices']['document'];
  commands: PaintEditorController['slices']['commands'];
  toolIcon: string;
  layerPropertiesPreview: LayerPropertiesPreview | null;
  onImportLayer: () => void;
  onOpenRotateZoomLayer: () => void;
  onEditLayer: (id: string) => void;
}) {
  useTranslation();
  const dockLayout = usePreferences((state) => state.dockLayout);
  const setDockLayout = usePreferences((state) => state.setDockLayout);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const activeLayerIndex = documentState.layers.findIndex((layer) => layer.id === documentState.activeLayerId);
  const canUndo = documentState.historyIndex > 0;
  const canRedo = documentState.historyIndex < documentState.history.length - 1;

  useEffect(() => {
    const close = (event: Event) => {
      if (event.type === 'pointerdown' && (event.target as Element | null)?.closest('.layer-menu-anchor')) return;
      setLayerMenuOpen(false);
    };
    window.addEventListener('blur', close);
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('blur', close);
      window.removeEventListener('pointerdown', close);
    };
  }, []);

  const startDockResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = dockLayout.width;
    const rtl = getComputedStyle(handle).direction === 'rtl';
    const move = (moveEvent: PointerEvent) => {
      const delta = (startX - moveEvent.clientX) * (rtl ? -1 : 1);
      setDockLayout((current) => ({
        ...current,
        width: Math.round(Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, startWidth + delta))),
      }));
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }, [dockLayout.width, setDockLayout]);

  const startPadResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const sidebar = handle.parentElement;
    if (!sidebar) return;
    handle.setPointerCapture(event.pointerId);
    const bounds = sidebar.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const share = (moveEvent.clientY - bounds.top) / Math.max(1, bounds.height);
      setDockLayout((current) => ({ ...current, layersShare: Math.max(0.15, Math.min(0.85, share)) }));
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }, [setDockLayout]);

  return (
    <aside
      className="dock-sidebar"
      style={{
        '--dock-width': `${dockLayout.width}px`,
        '--layers-share': dockLayout.layersShare,
      } as CSSProperties}
      data-layers-minimized={dockLayout.layersMinimized}
      data-history-minimized={dockLayout.historyMinimized}
    >
      <div
        className="dock-resize-handle dock-resize-width"
        role="separator"
        aria-label={translateUi('Resize tool windows')}
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={startDockResize}
        onKeyDown={(event) => {
          const step = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0;
          if (!step) return;
          event.preventDefault();
          setDockLayout((current) => ({
            ...current,
            width: Math.round(Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, current.width + step))),
          }));
        }}
      />
      <section className="dock-panel layers-panel">
        <header className="dock-header">
          <span>{translateUi('Layers')}</span>
          <button
            className="dock-menu-button dock-minimize-button"
            type="button"
            aria-label={translateUi(dockLayout.layersMinimized ? 'Restore Layers' : 'Minimize Layers')}
            aria-expanded={!dockLayout.layersMinimized}
            onClick={() => setDockLayout((current) => ({ ...current, layersMinimized: !current.layersMinimized }))}
          >
            <span aria-hidden="true">{dockLayout.layersMinimized ? '+' : '−'}</span>
          </button>
          <div className="menu-anchor layer-menu-anchor" onClick={(event) => event.stopPropagation()}>
            <button className="dock-menu-button" type="button" aria-label="Layer menu" aria-expanded={layerMenuOpen} disabled={!documentState.documents.length} onClick={() => setLayerMenuOpen((value) => !value)}><PintaIcon file="open-menu-symbolic.svg" size={15} standard /></button>
            {layerMenuOpen && (
              <Popover align="right" className="layer-menu-popover">
                <MenuItem icon={<PintaIcon file="layer-import-symbolic.svg" size={16} />} label="Import from File…" onClick={() => { setLayerMenuOpen(false); onImportLayer(); }} />
                <div className="menu-divider" />
                <MenuItem icon={<PintaIcon file="image-flip-horizontal-symbolic.svg" size={15} />} label="Flip Horizontal" shortcut="Ctrl+F" onClick={() => { setLayerMenuOpen(false); commands.flipLayer('horizontal'); }} />
                <MenuItem icon={<PintaIcon file="image-flip-vertical-symbolic.svg" size={15} />} label="Flip Vertical" shortcut="Shift+F" onClick={() => { setLayerMenuOpen(false); commands.flipLayer('vertical'); }} />
                <MenuItem icon={<PintaIcon file="layers-rotate-zoom-symbolic.svg" size={16} />} label="Rotate / Zoom Layer…" onClick={() => { setLayerMenuOpen(false); onOpenRotateZoomLayer(); }} />
                <div className="menu-divider" />
                <MenuItem icon={<PintaIcon file="document-properties-symbolic.svg" size={15} standard />} label="Layer Properties…" shortcut="F4" onClick={() => { setLayerMenuOpen(false); onEditLayer(documentState.activeLayerId); }} />
              </Popover>
            )}
          </div>
        </header>
        <div className="layer-list">
          {[...documentState.layers].reverse().map((layer) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              active={documentState.activeLayerId === layer.id}
              preview={layerPropertiesPreview?.id === layer.id ? layerPropertiesPreview : null}
              onSelect={commands.setActiveLayerId}
              onToggle={commands.toggleLayer}
              onEdit={onEditLayer}
            />
          ))}
        </div>
        <footer className="dock-toolbar">
          <IconButton label="Add New Layer" disabled={!documentState.documents.length} onClick={commands.addLayer}><PintaIcon file="layers-add-layer-symbolic.svg" size={15} /></IconButton>
          <IconButton label="Delete Layer" disabled={documentState.layers.length <= 1} onClick={commands.deleteLayer}><PintaIcon file="layers-remove-layer-symbolic.svg" size={15} /></IconButton>
          <IconButton label="Duplicate Layer" disabled={!documentState.documents.length} onClick={commands.duplicateLayer}><PintaIcon file="layers-duplicate-layer-symbolic.svg" size={15} /></IconButton>
          <IconButton label="Merge Layer Down" disabled={activeLayerIndex <= 0} onClick={commands.mergeLayerDown}><PintaIcon file="layers-merge-down-symbolic.svg" size={15} /></IconButton>
          <IconButton label="Move Layer Up" disabled={activeLayerIndex >= documentState.layers.length - 1} onClick={() => commands.moveLayer(1)}><PintaIcon file="pan-up-symbolic.svg" size={15} standard /></IconButton>
          <IconButton label="Move Layer Down" disabled={activeLayerIndex <= 0} onClick={() => commands.moveLayer(-1)}><PintaIcon file="pan-down-symbolic.svg" size={15} standard /></IconButton>
          <IconButton label="Layer Properties (F4)" disabled={!documentState.documents.length} onClick={() => onEditLayer(documentState.activeLayerId)}><PintaIcon file="document-properties-symbolic.svg" size={15} standard /></IconButton>
        </footer>
      </section>

      <div
        className="dock-resize-handle dock-resize-pads"
        role="separator"
        aria-label={translateUi('Resize Layers and History')}
        aria-orientation="horizontal"
        tabIndex={0}
        onPointerDown={startPadResize}
        onKeyDown={(event) => {
          const step = event.key === 'ArrowUp' ? -0.04 : event.key === 'ArrowDown' ? 0.04 : 0;
          if (!step) return;
          event.preventDefault();
          setDockLayout((current) => ({
            ...current,
            layersShare: Math.max(0.15, Math.min(0.85, current.layersShare + step)),
          }));
        }}
      />
      <section className="dock-panel history-panel">
        <header className="dock-header">
          <span>{translateUi('History')}</span>
          <button
            className="dock-menu-button dock-minimize-button"
            type="button"
            aria-label={translateUi(dockLayout.historyMinimized ? 'Restore History' : 'Minimize History')}
            aria-expanded={!dockLayout.historyMinimized}
            onClick={() => setDockLayout((current) => ({ ...current, historyMinimized: !current.historyMinimized }))}
          >
            <span aria-hidden="true">{dockLayout.historyMinimized ? '+' : '−'}</span>
          </button>
        </header>
        <div className="history-list">
          {documentState.history[0]?.evicted && (
            <p className="history-evicted" role="status">
              {translateUi('Older steps were discarded to free memory.')}
            </p>
          )}
          {documentState.history.map((entry, index) => (
            <HistoryRow
              key={`${index}-${entry.label}`}
              index={index}
              label={entry.label}
              active={index === documentState.historyIndex}
              future={index > documentState.historyIndex}
              toolIcon={toolIcon}
              onSelect={commands.goToHistory}
            />
          ))}
        </div>
        <footer className="dock-toolbar history-toolbar">
          <IconButton label="Undo" onClick={commands.undo} disabled={!canUndo}><PintaIcon file="edit-undo-symbolic.svg" size={15} standard /></IconButton>
          <IconButton label="Redo" onClick={commands.redo} disabled={!canRedo}><PintaIcon file="edit-redo-symbolic.svg" size={15} standard /></IconButton>
        </footer>
      </section>
    </aside>
  );
});

function App() {
  const { i18n } = useTranslation();
  const editor = usePaintEditor();
  const hasDocument = editor.documents.length > 0;
  const currentTool = TOOL_BY_ID[editor.tool];
  const theme = usePreferences((state) => state.theme);
  const showSidebar = usePreferences((state) => state.showSidebar);
  const showToolbox = usePreferences((state) => state.showToolbox);
  const showToolbar = usePreferences((state) => state.showToolbar);
  const showPalette = usePreferences((state) => state.showPalette);
  const showDocumentTabs = usePreferences((state) => state.showDocumentTabs);
  const canvasGrid = usePreferences((state) => state.canvasGrid);
  const showRulers = usePreferences((state) => state.showRulers);
  const rulerMetric = usePreferences((state) => state.rulerMetric);
  const persistHistory = usePreferences((state) => state.persistHistory);
  const enabledAddins = usePreferences((state) => state.enabledAddins);
  const setTheme = usePreferences((state) => state.setTheme);
  const setShowSidebar = usePreferences((state) => state.setShowSidebar);
  const setShowToolbox = usePreferences((state) => state.setShowToolbox);
  const setShowToolbar = usePreferences((state) => state.setShowToolbar);
  const setShowPalette = usePreferences((state) => state.setShowPalette);
  const setShowDocumentTabs = usePreferences((state) => state.setShowDocumentTabs);
  const setCanvasGrid = usePreferences((state) => state.setCanvasGrid);
  const setShowRulers = usePreferences((state) => state.setShowRulers);
  const setPersistHistory = usePreferences((state) => state.setPersistHistory);
  const setRulerMetric = usePreferences((state) => state.setRulerMetric);
  const setAddinEnabled = usePreferences((state) => state.setAddinEnabled);
  const setAllAddinsEnabled = usePreferences((state) => state.setAllAddinsEnabled);
  const visibleEffects = useMemo(() => EFFECT_DEFINITIONS.filter((effect) => isAddinEnabled(enabledAddins, effect.addinId)), [enabledAddins]);
  const visibleTools = useMemo(() => TOOLS.filter((tool) => isAddinEnabled(enabledAddins, tool.addinId)), [enabledAddins]);
  const [toolboxRows, setToolboxRows] = useState(visibleTools.length);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const editorBodyRef = useRef<HTMLDivElement>(null);
  const [prefersDark, setPrefersDark] = useState(() => (
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true
  ));
  // Pinta's zoom combo keeps "Window" selected until an explicit zoom replaces it.
  const [zoomMode, setZoomMode] = useState<'fixed' | 'fit' | 'window'>('fixed');
  const [toast, setToast] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [effectThumbnailUrl, setEffectThumbnailUrl] = useState('');
  const [runningEffect, setRunningEffect] = useState<EffectId | null>(null);
  const [layerPropertiesId, setLayerPropertiesId] = useState<string | null>(null);
  const [layerPropertiesPreview, setLayerPropertiesPreview] = useState<LayerPropertiesPreview | null>(null);
  const [rotateZoomLayerId, setRotateZoomLayerId] = useState<string | null>(null);
  const [rotateZoomThumbnailUrl, setRotateZoomThumbnailUrl] = useState('');
  const [paletteDialog, setPaletteDialog] = useState<'save' | 'resize' | null>(null);
  const [editingPaletteIndex, setEditingPaletteIndex] = useState<number | null>(null);
  const [addingPaletteColor, setAddingPaletteColor] = useState(false);
  const [colorDialogTarget, setColorDialogTarget] = useState<'primary' | 'secondary' | null>(null);
  const [closingDocumentId, setClosingDocumentId] = useState<string | null>(null);
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const [closeAllQueue, setCloseAllQueue] = useState<string[]>([]);
  const [pendingPaste, setPendingPaste] = useState<'current' | 'new-layer' | null>(null);
  const [clipboardInformation, setClipboardInformation] = useState<{ title: string; message: string } | null>(null);
  const [applicationError, setApplicationError] = useState<ApplicationError | null>(null);
  const [pendingSaveAction, setPendingSaveAction] = useState<{ kind: 'close' | 'close-all' | 'save-all'; documentId: string } | null>(null);
  const [pendingFlattenAction, setPendingFlattenAction] = useState<{ kind: 'save' | 'close' | 'close-all' | 'save-all'; documentId: string } | null>(null);
  const [saveAllQueue, setSaveAllQueue] = useState<string[]>([]);
  const [saveAllCount, setSaveAllCount] = useState(0);
  const [printPreview, setPrintPreview] = useState<PrintPreview | null>(null);
  const [showOffsetSelection, setShowOffsetSelection] = useState(false);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [screenshotError, setScreenshotError] = useState('');
  const [showCanvasGridDialog, setShowCanvasGridDialog] = useState(false);
  const [viewportMetrics, setViewportMetrics] = useState({ width: 0, height: 0, scrollLeft: 0, scrollTop: 0 });
  const primaryDialogRef = useRef<PrimaryDialogHandle>(null);
  const menuChromeRef = useRef<MenuChromeHandle>(null);
  const auxiliaryDialogRef = useRef<AuxiliaryDialogHandle>(null);
  const [zoomMarquee, setZoomMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const layerFileInputRef = useRef<HTMLInputElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const colorDialogOriginalRef = useRef<{ primary: string; secondary: string } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const zoomDragRef = useRef<{ clientX: number; clientY: number; imageX: number; imageY: number; button: number } | null>(null);
  const textDragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const zoomRef = useRef(editor.zoom);
  const renderedZoomRef = useRef(editor.zoom);
  const zoomAnchorRef = useRef<{ imageX: number; imageY: number; clientX: number; clientY: number } | null>(null);
  const gestureStartZoomRef = useRef<number | null>(null);
  const fallbackPasteTargetRef = useRef<PasteTarget>('current');
  const saveAllWriteRef = useRef(false);
  const lastWorkspaceErrorRef = useRef('');
  const setDialog = useCallback((value: DialogName) => primaryDialogRef.current?.setDialog(value), []);
  const setEffectDialog = useCallback((value: EffectId | null) => primaryDialogRef.current?.setEffectDialog(value), []);
  const setShowSaveAs = useCallback((value: boolean) => primaryDialogRef.current?.setShowSaveAs(value), []);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  }, []);

  const showError = useCallback((title: string, message: string, error: unknown) => {
    setApplicationError({ title, message, details: errorDetails(error) });
  }, []);

  useEffect(() => {
    if (!editor.workspaceError || editor.workspaceError === lastWorkspaceErrorRef.current) return;
    lastWorkspaceErrorRef.current = editor.workspaceError;
    showError(
      editor.workspaceErrorOperation === 'restore' ? 'Failed to restore workspace' : 'Failed to save workspace',
      editor.workspaceError,
      editor.workspaceError,
    );
  }, [editor.workspaceError, editor.workspaceErrorOperation, showError]);

  useEffect(() => {
    // An error thrown from an animation frame or a pointer handler fires on every frame, and a
    // browser extension's failing script fires for something the user cannot act on. Neither
    // should bury the editor behind a dialog.
    const surface = (error: unknown) => {
      const message = errorMessageOf(error);
      if (countRepeat(message) > 0) return;
      reportError(error, 'unknown');
      showError('Unexpected application error', 'Pinta Online encountered an unexpected error.', error);
    };
    const onWindowError = (event: ErrorEvent) => {
      if (isForeignError(event)) return;
      surface(event.error ?? event.message);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      surface(event.reason);
    };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [showError]);

  const openFontFamilyDialog = useCallback(() => auxiliaryDialogRef.current?.openFonts() ?? Promise.resolve(), []);

  const performPaste = useCallback((target: PasteTarget, expandCanvas = false) => {
    const effectiveTarget = editor.documents.length ? target : 'new-image';
    const pasted = effectiveTarget === 'current'
      ? editor.paste(expandCanvas)
      : effectiveTarget === 'new-layer'
        ? editor.pasteIntoNewLayer(expandCanvas)
        : editor.pasteIntoNewImage();
    if (pasted) notify(effectiveTarget === 'current' ? 'Pasted into the current layer' : effectiveTarget === 'new-layer' ? 'Pasted into a new layer' : 'Pasted into a new image');
    return pasted;
  }, [editor, notify]);

  const pasteImportedImage = useCallback(async (blob: Blob, target: PasteTarget) => {
    const size = await editor.importClipboardImage(blob);
    const effectiveTarget = editor.documents.length ? target : 'new-image';
    if (effectiveTarget !== 'new-image' && (size.width > editor.width || size.height > editor.height)) {
      menuChromeRef.current?.close();
      setPendingPaste(effectiveTarget);
      return true;
    }
    return performPaste(effectiveTarget);
  }, [editor, performPaste]);

  const showEmptyClipboard = useCallback(() => {
    setClipboardInformation({ title: 'Image cannot be pasted', message: 'The clipboard does not contain an image.' });
  }, []);

  const requestPaste = useCallback(async (target: PasteTarget = 'current') => {
    menuChromeRef.current?.close();
    if (navigator.clipboard?.read) {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((type) => type.startsWith('image/'));
          if (imageType) return pasteImportedImage(await item.getType(imageType), target);
        }
      } catch {
        // Permission-restricted browsers can still use Pinta's in-app clipboard.
      }
    }
    // Browsers that refuse the image write, or an operating-system clipboard holding
    // unrelated content, must still paste whatever Pinta itself copied.
    if (!editor.hasClipboard) {
      showEmptyClipboard();
      return false;
    }
    if (editor.documents.length && target !== 'new-image' && (editor.clipboardSize.width > editor.width || editor.clipboardSize.height > editor.height)) {
      setPendingPaste(target);
      return true;
    }
    return performPaste(target);
  }, [editor.clipboardSize.height, editor.clipboardSize.width, editor.documents.length, editor.hasClipboard, editor.height, editor.width, pasteImportedImage, performPaste, showEmptyClipboard]);

  const publishClipboardImage = useCallback(async () => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    const pending = editor.clipboardPngBlob().then((blob) => {
      if (!blob) throw new Error('Pinta has no image to publish');
      return blob;
    });
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pending })]);
      return true;
    } catch {
      return false;
    }
  }, [editor]);

  const copyImage = useCallback((kind: 'copy' | 'copy-merged' | 'cut') => {
    const copied = kind === 'copy' ? editor.copySelection() : kind === 'copy-merged' ? editor.copyMerged() : editor.cutSelection();
    if (!copied) return false;
    void publishClipboardImage();
    notify(kind === 'cut' ? 'Cut selection' : kind === 'copy-merged' ? 'Copied merged image' : 'Copied selection');
    return true;
  }, [editor, notify, publishClipboardImage]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const image = [...(event.clipboardData?.files ?? [])].find((file) => file.type.startsWith('image/'));
      event.preventDefault();
      const target = fallbackPasteTargetRef.current;
      fallbackPasteTargetRef.current = 'current';
      if (image) {
        void pasteImportedImage(image, target).catch(showEmptyClipboard);
      } else if (editor.hasClipboard) {
        if (editor.documents.length && target !== 'new-image' && (editor.clipboardSize.width > editor.width || editor.clipboardSize.height > editor.height)) setPendingPaste(target);
        else performPaste(target);
      } else {
        showEmptyClipboard();
      }
    };
    window.addEventListener('paste', onPaste, { capture: true });
    return () => window.removeEventListener('paste', onPaste, { capture: true });
  }, [editor.clipboardSize.height, editor.clipboardSize.width, editor.documents.length, editor.hasClipboard, editor.height, editor.width, pasteImportedImage, performPaste, showEmptyClipboard]);

  const reportOpenFailures = useCallback((failures: Array<{ name: string; error: unknown }>, opened: number) => {
    if (!failures.length) return;
    const names = failures.map(({ name }) => name).join(', ');
    showError(
      'Unsupported file format',
      opened
        ? `Opened ${opened} images, but could not open: ${names}`
        : `Could not open file: ${names}`,
      failures.map(({ name, error }) => `${name}\n${errorDetails(error)}`).join('\n\n'),
    );
  }, [showError]);

  const openImages = useCallback(async () => {
    menuChromeRef.current?.close();
    const picker = (window as FilePickerWindow).showOpenFilePicker;
    if (!picker) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const handles = await picker({ multiple: true, types: IMAGE_FILE_PICKER_TYPES });
      let opened = 0;
      const failures: Array<{ name: string; error: unknown }> = [];
      for (const handle of handles) {
        try {
          await editor.openFile(await handle.getFile(), handle);
          opened += 1;
        } catch (error) {
          failures.push({ name: handle.name, error });
        }
      }
      if (failures.length) reportOpenFailures(failures, opened);
      else if (opened) notify(opened === 1 ? `Opened ${handles[0].name}` : `Opened ${opened} images`);
    } catch (error) {
      if (!isPickerCancellation(error)) fileInputRef.current?.click();
    }
  }, [editor, notify, reportOpenFailures]);

  const saveImageAs = useCallback(async (options: { fileName: string; format: ExportFormat; quality: number; flatten: boolean }) => {
    const extension = options.format === 'jpeg' ? 'jpg' : options.format === 'tiff' ? 'tif' : options.format;
    const suggestedName = `${options.fileName.replace(/\.[^.]+$/, '') || 'pinta-image'}.${extension}`;
    const picker = (window as FilePickerWindow).showSaveFilePicker;
    if (!picker) {
      try {
        if (options.flatten) editor.flattenImage();
        return await editor.saveImage(options);
      } catch (error) {
        showError('Failed to save image', error instanceof Error ? error.message : 'The image could not be saved.', error);
        return false;
      }
    }
    let handle: FileSystemFileHandle;
    try {
      handle = await picker({ suggestedName, types: [EXPORT_FILE_PICKER_TYPE[options.format]] });
    } catch (pickerError) {
      if (isPickerCancellation(pickerError)) return false;
      try {
        if (options.flatten) editor.flattenImage();
        return await editor.saveImage(options);
      } catch (fallbackError) {
        showError('Failed to save image', fallbackError instanceof Error ? fallbackError.message : 'The image could not be saved.', fallbackError);
        return false;
      }
    }
    try {
      if (options.flatten) editor.flattenImage();
      return await editor.saveImage({ ...options, fileHandle: handle });
    } catch (error) {
      showError('Failed to save image', error instanceof Error ? error.message : 'The image could not be saved.', error);
      return false;
    }
  }, [editor, showError]);

  const saveCurrentImage = useCallback(() => {
    if (/^Unsaved Image(?:\s+\d+)?$/i.test(editor.fileName)) {
      setPendingSaveAction(null);
      setShowSaveAs(true);
      return;
    }
    if (editor.layers.length > 1 && initialExportFormat(editor.fileName) !== 'ora') {
      setPendingFlattenAction({ kind: 'save', documentId: editor.activeDocumentId });
      return;
    }
    void editor.saveImage().catch((error) => showError('Failed to save image', error instanceof Error ? error.message : 'The image could not be saved.', error));
  }, [editor, showError]);

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
      showError('Unsupported palette format', `Could not open file: ${file.name}`, error);
    }
  }, [editor, notify, showError]);

  const handleLayerFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      await editor.importLayerFromFile(file);
      notify(`Imported ${file.name} as a layer`);
    } catch (error) {
      showError('Failed to open image', `Could not open file: ${file.name}`, error);
    }
  }, [editor, notify, showError]);

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
    menuChromeRef.current?.close();
    setPrintPreview({
      dataUrl: editor.createCompositeDataUrl(),
      fileName: editor.fileName,
      width: editor.width,
      height: editor.height,
      settings: {
        orientation: editor.width > editor.height ? 'landscape' : 'portrait',
        scaleMode: 'fit',
        scale: 100,
        margin: 12,
        center: true,
      },
    });
  }, [editor]);

  useEffect(() => {
    if (!printPreview) return;
    const closeAfterPrint = () => setPrintPreview(null);
    window.addEventListener('afterprint', closeAfterPrint, { once: true });
    return () => window.removeEventListener('afterprint', closeAfterPrint);
  }, [printPreview]);

  const captureScreenshot = useCallback(async (delay: number) => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setShowScreenshot(false);
      showError('Failed to capture screenshot', 'Screen capture is not supported by this browser.', 'navigator.mediaDevices.getDisplayMedia is unavailable.');
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
      context2d(canvas).drawImage(video, 0, 0);
      editor.newDocumentFromCanvas(canvas, 'New Screenshot');
      setShowScreenshot(false);
      notify(`Captured ${canvas.width} × ${canvas.height} screenshot`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setScreenshotError('Screen capture was canceled or not allowed.');
      } else {
        setShowScreenshot(false);
        showError('Failed to capture screenshot', error instanceof Error ? error.message : 'The screenshot could not be captured.', error);
      }
    } finally {
      for (const track of stream?.getTracks() ?? []) track.stop();
      setScreenshotBusy(false);
    }
  }, [editor, notify, showError]);

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  const fitZoomToWindow = useCallback(() => {
    const viewport = viewportRef.current;
    const frame = viewport?.querySelector<HTMLElement>('.canvas-centering-frame');
    if (!viewport || !frame || !editor.width || !editor.height) return;
    // MainWindow.ZoomToWindow_Activated keeps a 20px margin around the fitted image; the
    // web frame's own padding already supplies one, so the larger of the two is used.
    const frameStyle = getComputedStyle(frame);
    const marginX = Math.max(20, parseFloat(frameStyle.paddingLeft) + parseFloat(frameStyle.paddingRight));
    const marginY = Math.max(20, parseFloat(frameStyle.paddingTop) + parseFloat(frameStyle.paddingBottom));
    const windowWidth = Math.max(1, viewport.clientWidth - marginX);
    const windowHeight = Math.max(1, viewport.clientHeight - marginY);
    // An image that already fits is shown at 100% rather than magnified.
    if (editor.width <= windowWidth && editor.height <= windowHeight) {
      editor.setZoom(1);
      return;
    }
    editor.setZoom(Math.min(windowWidth / editor.width, windowHeight / editor.height));
  }, [editor]);

  const zoomToWindow = useCallback((mode: 'fit' | 'window' = 'window') => {
    setZoomMode(mode);
    fitZoomToWindow();
  }, [fitZoomToWindow]);

  /** Any explicit zoom leaves Window mode, matching ZoomToWindowActivated = false. */
  const setFixedZoom = useCallback((zoom: number) => {
    setZoomMode('fixed');
    editor.setZoom(zoom);
  }, [editor]);

  const fittedViewportSizeRef = useRef<string | null>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || zoomMode === 'fixed') {
      fittedViewportSizeRef.current = null;
      return;
    }
    const observer = new ResizeObserver(() => {
      const size = `${viewport.clientWidth}x${viewport.clientHeight}`;
      if (fittedViewportSizeRef.current === size) return;
      fittedViewportSizeRef.current = size;
      fitZoomToWindow();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitZoomToWindow, zoomMode]);

  useEffect(() => {
    const body = editorBodyRef.current;
    if (!body) return;
    const TOOL_BUTTON_PITCH = 47;
    const TOOLBOX_PADDING = 4;
    const update = () => {
      const usable = Math.max(0, body.clientHeight - TOOLBOX_PADDING);
      const fitting = Math.floor((usable + 1) / TOOL_BUTTON_PITCH);
      setToolboxRows(Math.max(8, Math.min(visibleTools.length, fitting)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  }, [visibleTools.length]);

  const autoFittedDocumentsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!editor.workspaceReady) return;
    if (autoFittedDocumentsRef.current === null) {
      autoFittedDocumentsRef.current = new Set(editor.restoredDocumentIds);
    }
    const id = editor.activeDocumentId;
    if (!id || autoFittedDocumentsRef.current.has(id)) return;
    autoFittedDocumentsRef.current.add(id);
    zoomToWindow('fit');
  }, [editor.activeDocumentId, editor.restoredDocumentIds, editor.workspaceReady, zoomToWindow]);

  const zoomToSelection = useCallback(() => {
    const viewport = viewportRef.current;
    const bounds = editor.selectionBounds;
    if (!viewport || !bounds) return;
    const availableWidth = Math.max(1, viewport.clientWidth - 52);
    const availableHeight = Math.max(1, viewport.clientHeight - 52);
    const nextZoom = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
    setZoomMode('fixed');
    editor.setZoom(nextZoom);
    requestAnimationFrame(() => {
      const canvas = viewport.querySelector<HTMLElement>('.canvas-stack');
      if (!canvas) return;
      const viewportRect = viewport.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const centerX = canvasRect.left + (bounds.x + bounds.width / 2) * clampZoom(nextZoom);
      const centerY = canvasRect.top + (bounds.y + bounds.height / 2) * clampZoom(nextZoom);
      viewport.scrollLeft += centerX - viewportRect.left - viewport.clientWidth / 2;
      viewport.scrollTop += centerY - viewportRect.top - viewport.clientHeight / 2;
    });
  }, [editor]);

  const requestCloseAll = useCallback(() => {
    menuChromeRef.current?.close();
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
    setShowCloseAllConfirm(true);
  }, [closeAllQueue, editor]);

  const completeSaveAllStep = useCallback((completedId: string, saved: boolean) => {
    const remaining = saveAllQueue.filter((id) => id !== completedId);
    const completedCount = saveAllCount + (saved ? 1 : 0);
    setSaveAllCount(completedCount);
    setSaveAllQueue(remaining);
    if (!remaining.length) {
      notify(completedCount
        ? `Saved ${completedCount} ${completedCount === 1 ? 'image' : 'images'}`
        : 'All images are already saved');
      return;
    }
    editor.switchDocument(remaining[0]);
  }, [editor, notify, saveAllCount, saveAllQueue]);

  const requestSaveAll = useCallback(() => {
    menuChromeRef.current?.close();
    const queue = editor.documents.filter((document) => document.dirty).map((document) => document.id);
    if (!queue.length) {
      notify('All images are already saved');
      return;
    }
    setSaveAllCount(0);
    setSaveAllQueue(queue);
    editor.switchDocument(queue[0]);
  }, [editor, notify]);

  useEffect(() => {
    const documentId = saveAllQueue[0];
    if (!documentId || saveAllWriteRef.current || primaryDialogRef.current?.getState().showSaveAs || pendingFlattenAction) return;
    if (editor.activeDocumentId !== documentId) {
      editor.switchDocument(documentId);
      return;
    }
    const documentState = editor.documents.find((document) => document.id === documentId);
    if (!documentState?.dirty) {
      completeSaveAllStep(documentId, false);
      return;
    }
    if (/^Unsaved Image(?:\s+\d+)?$/i.test(documentState.fileName)) {
      setPendingSaveAction({ kind: 'save-all', documentId });
      setShowSaveAs(true);
      return;
    }
    if (editor.layers.length > 1 && initialExportFormat(documentState.fileName) !== 'ora') {
      setPendingFlattenAction({ kind: 'save-all', documentId });
      return;
    }
    saveAllWriteRef.current = true;
    void editor.saveImage().then((saved) => {
      saveAllWriteRef.current = false;
      if (saved) completeSaveAllStep(documentId, true);
      else setSaveAllQueue([]);
    }).catch((error) => {
      saveAllWriteRef.current = false;
      setSaveAllQueue([]);
      showError('Failed to save image', error instanceof Error ? error.message : 'The image could not be saved.', error);
    });
  }, [completeSaveAllStep, editor, pendingFlattenAction, saveAllQueue, showError, setShowSaveAs]);

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
    document.title = hasDocument
      ? `${translateDocumentName(editor.fileName)}${editor.dirty ? '*' : ''} — Pinta Online Image Editor`
      : 'Pinta Online Image Editor';
  }, [editor.dirty, editor.fileName, hasDocument, i18n.resolvedLanguage]);

  useEffect(() => {
    document.querySelector('.document-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [editor.activeDocumentId]);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setPrefersDark(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
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
      const primaryDialogs = primaryDialogRef.current?.getState() ?? { dialog: null, effectDialog: null, showSaveAs: false };
      const modalOpen = Boolean(
        closingDocumentId
        || showCloseAllConfirm
        || pendingPaste
        || pendingFlattenAction
        || applicationError
        || clipboardInformation
        || printPreview
        || primaryDialogs.dialog
        || editor.effectBusy
        || primaryDialogs.effectDialog
        || showOffsetSelection
        || showScreenshot
        || layerPropertiesId
        || rotateZoomLayerId
        || paletteDialog
        || editingPaletteIndex !== null
        || addingPaletteColor
        || colorDialogTarget !== null
        || primaryDialogs.showSaveAs
        || showCanvasGridDialog
        || auxiliaryDialogRef.current?.hasOpenDialog(),
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
        else if (pendingFlattenAction) {
          if (pendingFlattenAction.kind === 'close-all') setCloseAllQueue([]);
          if (pendingFlattenAction.kind === 'save-all') setSaveAllQueue([]);
          setPendingFlattenAction(null);
        }
        else if (applicationError) setApplicationError(null);
        else if (clipboardInformation) setClipboardInformation(null);
        else if (printPreview) setPrintPreview(null);
        else if (primaryDialogs.dialog) setDialog(null);
        else if (editor.effectBusy) editor.cancelEffect();
        else if (primaryDialogs.effectDialog && !editor.effectBusy) {
          editor.clearEffectPreview();
          setEffectDialog(null);
        }
        else if (showOffsetSelection) setShowOffsetSelection(false);
        else if (showScreenshot && !screenshotBusy) {
          setShowScreenshot(false);
          setScreenshotError('');
        } else if (layerPropertiesId) {
          editor.clearLayerTransformPreview();
          setLayerPropertiesPreview(null);
          setLayerPropertiesId(null);
        }
        else if (rotateZoomLayerId) {
          editor.clearLayerTransformPreview();
          setRotateZoomLayerId(null);
        }
        else if (colorDialogTarget !== null) {
          const original = colorDialogOriginalRef.current;
          if (original) {
            editor.setPrimary(original.primary, false);
            editor.setSecondary(original.secondary, false);
          }
          colorDialogOriginalRef.current = null;
          setColorDialogTarget(null);
        }
        else if (paletteDialog || editingPaletteIndex !== null || addingPaletteColor) {
          setPaletteDialog(null);
          setEditingPaletteIndex(null);
          setAddingPaletteColor(false);
        } else if (primaryDialogs.showSaveAs) {
          setShowSaveAs(false);
          if (pendingSaveAction?.kind === 'close-all') setCloseAllQueue([]);
          if (pendingSaveAction?.kind === 'save-all') setSaveAllQueue([]);
          setPendingSaveAction(null);
        }
        else if (showCanvasGridDialog) setShowCanvasGridDialog(false);
        else auxiliaryDialogRef.current?.closeTop();
        return;
      }

      if (event.key === 'Escape' && menuChromeRef.current?.hasOpenMenu()) {
        event.preventDefault();
        menuChromeRef.current.close();
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
        if (!hasDocument && (shortcut === 'paste' || shortcut === 'paste-new-layer')) {
          event.preventDefault();
          void requestPaste('new-image');
          return;
        }
        if (!hasDocument && !['help', 'keyboard-shortcuts', 'quit', 'fullscreen', 'tool-windows', 'new-image', 'open-image', 'paste-new-image'].includes(shortcut)) {
          event.preventDefault();
          return;
        }
        if (!navigator.clipboard?.read && (event.ctrlKey || event.metaKey) && (shortcut === 'paste' || shortcut === 'paste-new-layer')) {
          fallbackPasteTargetRef.current = shortcut === 'paste-new-layer' ? 'new-layer' : 'current';
          return;
        }
        event.preventDefault();
        menuChromeRef.current?.close();
        switch (shortcut) {
          case 'help': window.open(USER_GUIDE_URL, '_blank', 'noopener,noreferrer'); break;
          case 'keyboard-shortcuts': auxiliaryDialogRef.current?.open('shortcuts'); break;
          case 'quit': requestCloseAll(); break;
          case 'fullscreen': void toggleFullscreen(); break;
          case 'tool-windows': {
            const next = !(showToolbox || showSidebar);
            setShowToolbox(next);
            setShowSidebar(next);
            break;
          }
          case 'zoom-in': setFixedZoom(zoomInLevel(editor.zoom)); break;
          case 'zoom-out': setFixedZoom(zoomOutLevel(editor.zoom)); break;
          case 'best-fit': zoomToWindow('fit'); break;
          case 'actual-size': setFixedZoom(1); break;
          case 'previous-document':
          case 'next-document': {
            const activeIndex = editor.documents.findIndex((document) => document.id === editor.activeDocumentId);
            const offset = shortcut === 'previous-document' ? -1 : 1;
            const nextIndex = (activeIndex + offset + editor.documents.length) % editor.documents.length;
            editor.switchDocument(editor.documents[nextIndex].id);
            break;
          }
          case 'new-image': setDialog('new'); break;
          case 'open-image': void openImages(); break;
          case 'close-image': {
            const active = editor.documents.find((document) => document.id === editor.activeDocumentId);
            if (active?.dirty) setClosingDocumentId(active.id);
            else if (active) editor.closeDocument(active.id);
            break;
          }
          case 'close-all': requestCloseAll(); break;
          case 'save-image': saveCurrentImage(); break;
          case 'save-as': setPendingSaveAction(null); setShowSaveAs(true); break;
          case 'save-all': requestSaveAll(); break;
          case 'print': openPrintDialog(); break;
          case 'undo': editor.undo(); break;
          case 'redo': editor.redo(); break;
          case 'cut': copyImage('cut'); break;
          case 'copy': copyImage('copy'); break;
          case 'copy-merged': copyImage('copy-merged'); break;
          case 'paste': void requestPaste('current'); break;
          case 'paste-new-layer': void requestPaste('new-layer'); break;
          case 'paste-new-image': void requestPaste('new-image'); break;
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
          case 'invert-colors': void editor.applyEffect('invert').catch((error) => showError('Effect could not be applied', 'Invert Colors could not be applied.', error)); break;
          case 'levels': setEffectDialog('levels'); break;
        }
        return;
      }

      if ((editor.tool === 'move-selection' || editor.tool === 'move-pixels') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const amount = event.ctrlKey || event.metaKey ? 10 : 1;
        editor.nudgeTransform(
          event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0,
          event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0,
        );
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
      } else if (editor.tool === 'text' && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === '[' || event.key === ']')) {
        event.preventDefault();
        editor.setTextFontSize(editor.textFontSize + (event.key === ']' ? 1 : -1));
      } else if (event.key === 'Enter' && editor.polygonLassoPointCount > 0) {
        event.preventDefault();
        editor.finishPolygonLasso();
      } else if (event.key === 'Enter' && editor.lineDraft) {
        event.preventDefault();
        editor.commitLine();
      } else if (event.key === 'Enter' && editor.shapeDraft) {
        event.preventDefault();
        editor.commitShape();
      } else if (event.key === 'Enter' && editor.gradientDraft) {
        event.preventDefault();
        editor.finalizeGradient();
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
  }, [addingPaletteColor, applicationError, clipboardInformation, closingDocumentId, colorDialogTarget, copyImage, editingPaletteIndex, editor, layerPropertiesId, notify, openImages, openPrintDialog, paletteDialog, pendingFlattenAction, pendingPaste, pendingSaveAction, printPreview, requestCloseAll, requestPaste, requestSaveAll, rotateZoomLayerId, saveCurrentImage, screenshotBusy, showCanvasGridDialog, showCloseAllConfirm, showOffsetSelection, showScreenshot, showSidebar, showToolbox, showError, setDialog, setEffectDialog, setFixedZoom, setShowSaveAs, toggleFullscreen, zoomToWindow]);

  const handleFiles = useCallback(async (files: Iterable<File> | ArrayLike<File>) => {
    const queued = Array.from(files);
    if (!queued.length) return;
    const failures: Array<{ name: string; error: unknown }> = [];
    let opened = 0;
    for (const file of queued) {
      try {
        await editor.openFile(file);
        opened += 1;
      } catch (error) {
        failures.push({ name: file.name, error });
      }
    }
    if (!failures.length) notify(opened === 1 ? `Opened ${queued[0].name}` : `Opened ${opened} images`);
    else reportOpenFailures(failures, opened);
  }, [editor, notify, reportOpenFailures]);

  useEffect(() => {
    const launchQueue = (window as Window & {
      launchQueue?: { setConsumer: (consumer: (parameters: { files: FileSystemFileHandle[] }) => void) => void };
    }).launchQueue;
    if (!launchQueue) return;
    launchQueue.setConsumer((parameters) => {
      void (async () => {
        if (!parameters.files.length) return;
        if (!document.querySelector('.app-shell[data-workspace-ready="true"]')) {
          await new Promise<void>((resolve) => {
            const observer = new MutationObserver(() => {
              if (!document.querySelector('.app-shell[data-workspace-ready="true"]')) return;
              observer.disconnect();
              resolve();
            });
            observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
          });
        }
        let opened = 0;
        const failures: Array<{ name: string; error: unknown }> = [];
        for (const handle of parameters.files) {
          try {
            await editor.openFile(await handle.getFile(), handle);
            opened += 1;
          } catch (error) {
            failures.push({ name: handle.name, error });
          }
        }
        if (failures.length) reportOpenFailures(failures, opened);
        else notify(opened === 1 ? `Opened ${parameters.files[0].name}` : `Opened ${opened} images`);
      })().catch((error) => showError('Failed to open image', 'The launched images could not be opened.', error));
    });
  }, [editor, notify, reportOpenFailures, showError]);

  const closeAllOverlays = useCallback(() => {
    setDialog(null);
    setEffectDialog(null);
    setApplicationError(null);
    setPrintPreview(null);
    setColorDialogTarget(null);
    setEditingPaletteIndex(null);
    setAddingPaletteColor(false);
    setLayerPropertiesId(null);
    setRotateZoomLayerId(null);
    setPaletteDialog(null);
    setShowSaveAs(false);
    auxiliaryDialogRef.current?.closeAll();
    setShowCanvasGridDialog(false);
    setShowOffsetSelection(false);
    setShowScreenshot(false);
    setClipboardInformation(null);
    setPendingPaste(null);
    setPendingFlattenAction(null);
    setClosingDocumentId(null);
    setShowCloseAllConfirm(false);
  }, []);

  const closeAnd = useCallback((action: () => void) => {
    menuChromeRef.current?.close();
    action();
  }, []);

  const openDialog = useCallback((name: Exclude<DialogName, null>) => {
    menuChromeRef.current?.close();
    setDialog(name);
  }, []);

  const runEffect = useCallback(async (effect: EffectId, parameters: EffectParameters = {}) => {
    setRunningEffect(effect);
    try {
      const applied = await editor.applyEffect(effect, parameters);
      if (applied) notify(`${EFFECT_BY_ID[effect].name} applied`);
      return applied;
    } catch (error) {
      showError('Effect could not be applied', error instanceof Error ? error.message : 'The effect could not be applied.', error);
      return false;
    } finally {
      setRunningEffect((current) => current === effect ? null : current);
    }
  }, [editor, notify, showError]);

  const chooseEffect = useCallback((effect: EffectId) => {
    menuChromeRef.current?.close();
    const definition = EFFECT_BY_ID[effect];
    if (definition.parameters.length || definition.dialog) {
      setEffectThumbnailUrl(editor.createCompositeDataUrl());
      setEffectDialog(effect);
    }
    else void runEffect(effect);
  }, [editor, runEffect]);

  const requestCloseDocument = useCallback((id: string) => {
    const document = editor.documents.find((candidate) => candidate.id === id);
    if (!document) return;
    menuChromeRef.current?.close();
    if (id !== editor.activeDocumentId && !editor.switchDocument(id)) return;
    if (document.dirty) setClosingDocumentId(id);
    else editor.closeDocument(id);
  }, [editor]);

  const zoomAtPoint = useCallback((requestedZoom: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    const canvas = viewport?.querySelector<HTMLElement>('.canvas-stack');
    if (!viewport || !canvas) return;
    const nextZoom = clampZoom(requestedZoom);
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
    setZoomMode('fixed');
    editor.setZoom(nextZoom);
  }, [editor.setZoom]);

  const zoomImagePointToClient = useCallback((requestedZoom: number, imageX: number, imageY: number, clientX: number, clientY: number) => {
    const nextZoom = clampZoom(requestedZoom);
    if (Math.abs(nextZoom - zoomRef.current) < 0.0001) return;
    zoomAnchorRef.current = { imageX, imageY, clientX, clientY };
    zoomRef.current = nextZoom;
    setZoomMode('fixed');
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
    if ((event.button === 1 || editor.tool === 'pan') && viewportRef.current) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = {
        x: event.clientX,
        y: event.clientY,
        left: viewportRef.current.scrollLeft,
        top: viewportRef.current.scrollTop,
      };
      return;
    }
    if (editor.tool === 'zoom') {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      zoomDragRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        imageX: (event.clientX - bounds.left) / editor.zoom,
        imageY: (event.clientY - bounds.top) / editor.zoom,
        button: event.button,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
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
    if (zoomDragRef.current) {
      const drag = zoomDragRef.current;
      if (drag.button === 0 && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) >= 3) {
        const bounds = event.currentTarget.getBoundingClientRect();
        const imageX = (event.clientX - bounds.left) / editor.zoom;
        const imageY = (event.clientY - bounds.top) / editor.zoom;
        setZoomMarquee({
          x: Math.min(drag.imageX, imageX),
          y: Math.min(drag.imageY, imageY),
          width: Math.abs(imageX - drag.imageX),
          height: Math.abs(imageY - drag.imageY),
        });
      }
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
    if (zoomDragRef.current) {
      const drag = zoomDragRef.current;
      const marquee = zoomMarquee;
      zoomDragRef.current = null;
      setZoomMarquee(null);
      if (drag.button === 2) {
        zoomAtPoint(zoomOutLevel(zoomRef.current), event.clientX, event.clientY);
      } else if (marquee && marquee.width >= 2 && marquee.height >= 2 && viewportRef.current) {
        const viewportBounds = viewportRef.current.getBoundingClientRect();
        const requested = Math.min(
          Math.max(1, viewportRef.current.clientWidth - 52) / marquee.width,
          Math.max(1, viewportRef.current.clientHeight - 52) / marquee.height,
        );
        zoomImagePointToClient(
          requested,
          marquee.x + marquee.width / 2,
          marquee.y + marquee.height / 2,
          viewportBounds.left + viewportBounds.width / 2,
          viewportBounds.top + viewportBounds.height / 2,
        );
      } else {
        zoomAtPoint(zoomInLevel(zoomRef.current), event.clientX, event.clientY);
      }
      return;
    }
    editor.onPointerUp(event);
  };

  const iconSize = 17;
  const canUndo = editor.historyIndex > 0;
  const canRedo = editor.historyIndex < editor.history.length - 1;
  const resolvedTheme = resolveColorScheme(theme, prefersDark);
  const canvasStyle = {
    width: `${editor.width * editor.zoom}px`,
    height: `${editor.height * editor.zoom}px`,
    // CanvasRenderer.cs picks nearest-neighbour once the destination surface is larger
    // than the source, so zoomed-in pixels stay hard-edged instead of interpolated.
    imageRendering: editor.zoom > 1 ? 'pixelated' : 'auto',
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
            <MenuItem icon={<PintaIcon file="help-about-symbolic.svg" size={15} standard />} label="About Pinta" onClick={() => closeAnd(() => auxiliaryDialogRef.current?.open('about'))} />
            <MenuItem icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />} label="Keyboard Shortcuts…" shortcut="⌘," onClick={() => closeAnd(() => auxiliaryDialogRef.current?.open('shortcuts'))} />
            <MenuItem icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />} label="Language…" onClick={() => closeAnd(() => auxiliaryDialogRef.current?.open('language'))} />
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
            <MenuItem icon={<PintaIcon file="document-open-symbolic.svg" size={15} standard />} label="Open…" shortcut="⌘O" onClick={() => closeAnd(() => { void openImages(); })} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="document-save-symbolic.svg" size={15} standard />} label="Save" shortcut="⌘S" disabled={!hasDocument} onClick={() => closeAnd(saveCurrentImage)} />
            <MenuItem icon={<PintaIcon file="document-save-as-symbolic.svg" size={15} standard />} label="Save As…" shortcut="⇧⌘S" disabled={!hasDocument} onClick={() => closeAnd(() => { setPendingSaveAction(null); setShowSaveAs(true); })} />
            <MenuItem icon={<PintaIcon file="document-print-symbolic.svg" size={15} standard />} label="Print…" shortcut="⌘P" disabled={!hasDocument} onClick={openPrintDialog} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="window-close-symbolic.svg" size={15} standard />} label="Close" shortcut="⌘W" disabled={!hasDocument} onClick={() => requestCloseDocument(editor.activeDocumentId)} />
            <div className="menu-divider" />
            <div className="menu-caption">{translateUi('Browser Storage')}</div>
            <MenuItem
              checked={persistHistory}
              label="Restore Undo History"
              onClick={() => closeAnd(() => setPersistHistory((value) => !value))}
            />
          </>
        );
      case 'edit':
        return (
          <>
            <MenuItem icon={<PintaIcon file="edit-undo-symbolic.svg" size={15} standard />} label="Undo" shortcut="⌘Z" disabled={!canUndo} onClick={() => closeAnd(editor.undo)} />
            <MenuItem icon={<PintaIcon file="edit-redo-symbolic.svg" size={15} standard />} label="Redo" shortcut="⇧⌘Z" disabled={!canRedo} onClick={() => closeAnd(editor.redo)} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="edit-cut-symbolic.svg" size={15} standard />} label="Cut" shortcut="⌘X" disabled={!hasDocument} onClick={() => closeAnd(() => { copyImage('cut'); })} />
            <MenuItem icon={<PintaIcon file="edit-copy-symbolic.svg" size={15} standard />} label="Copy" shortcut="⌘C" disabled={!hasDocument} onClick={() => closeAnd(() => { copyImage('copy'); })} />
            <MenuItem icon={<PintaIcon file="edit-copy-symbolic.svg" size={15} standard />} label="Copy Merged" shortcut="⇧⌘C" disabled={!hasDocument} onClick={() => closeAnd(() => { copyImage('copy-merged'); })} />
            <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste" shortcut="⌘V" onClick={() => closeAnd(() => { void requestPaste('current'); })} />
            <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste Into New Layer" shortcut="⇧⌘V" onClick={() => closeAnd(() => { void requestPaste('new-layer'); })} />
            <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste Into New Image" shortcut="⌥⌘V" onClick={() => closeAnd(() => { void requestPaste('new-image'); })} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="edit-select-all-symbolic.svg" size={15} standard />} label="Select All" shortcut="⌘A" disabled={!hasDocument} onClick={() => closeAnd(editor.selectAll)} />
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
            <MenuItem icon={<PintaIcon file="value-increase-symbolic.svg" size={15} standard />} label="Zoom In" shortcut="+" onClick={() => closeAnd(() => setFixedZoom(zoomInLevel(editor.zoom)))} />
            <MenuItem icon={<PintaIcon file="value-decrease-symbolic.svg" size={15} standard />} label="Zoom Out" shortcut="−" onClick={() => closeAnd(() => setFixedZoom(zoomOutLevel(editor.zoom)))} />
            <MenuItem icon={<PintaIcon file="zoom-original-symbolic.svg" size={15} standard />} label="Normal Size" shortcut="⌘0" onClick={() => closeAnd(() => setFixedZoom(1))} />
            <MenuItem icon={<PintaIcon file="zoom-fit-best-symbolic.svg" size={15} standard />} label="Best Fit" shortcut="⌘B" onClick={() => closeAnd(() => zoomToWindow('fit'))} />
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
            <MenuItem checked={theme === 'default'} label="Default" onClick={() => closeAnd(() => setTheme('default'))} />
            <MenuItem checked={theme === 'light'} label="Light" onClick={() => closeAnd(() => setTheme('light'))} />
            <MenuItem checked={theme === 'dark'} label="Dark" onClick={() => closeAnd(() => setTheme('dark'))} />
          </>
        );
      case 'image':
        return (
          <>
            <MenuItem icon={<PintaIcon file="ui-crop-to-selection-symbolic.svg" size={15} />} label="Crop to Selection" shortcut="⇧⌘X" disabled={!editor.hasSelection} onClick={() => closeAnd(() => editor.cropToSelection())} />
            <MenuItem icon={<PintaIcon file="ui-crop-to-selection-symbolic.svg" size={15} />} label="Auto Crop" shortcut="⌃⌥X" disabled={!hasDocument} onClick={() => closeAnd(() => {
              if (!editor.autoCropImage()) notify('The image already fits its visible content');
            })} />
            <MenuItem icon={<PintaIcon file="image-resize-symbolic.svg" size={15} />} label="Resize Image…" shortcut="⌘R" disabled={!hasDocument} onClick={() => openDialog('resize-image')} />
            <MenuItem icon={<PintaIcon file="image-resize-canvas-symbolic.svg" size={15} />} label="Resize Canvas…" shortcut="⇧⌘R" disabled={!hasDocument} onClick={() => openDialog('resize-canvas')} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="image-flip-horizontal-symbolic.svg" size={15} />} label="Flip Horizontal" disabled={!hasDocument} onClick={() => closeAnd(() => editor.flipImage('horizontal'))} />
            <MenuItem icon={<PintaIcon file="image-flip-vertical-symbolic.svg" size={15} />} label="Flip Vertical" disabled={!hasDocument} onClick={() => closeAnd(() => editor.flipImage('vertical'))} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="image-rotate-90cw-symbolic.svg" size={15} />} label="Rotate 90° Clockwise" shortcut="⌘H" disabled={!hasDocument} onClick={() => closeAnd(() => editor.rotateImage('clockwise'))} />
            <MenuItem icon={<PintaIcon file="image-rotate-90ccw-symbolic.svg" size={15} />} label="Rotate 90° Counter-Clockwise" shortcut="⌘G" disabled={!hasDocument} onClick={() => closeAnd(() => editor.rotateImage('counter-clockwise'))} />
            <MenuItem icon={<PintaIcon file="image-rotate-180-symbolic.svg" size={15} />} label="Rotate 180°" shortcut="⌘J" disabled={!hasDocument} onClick={() => closeAnd(() => editor.rotateImage('180'))} />
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
            disabled={!hasDocument}
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
                disabled={!hasDocument}
                onClick={() => chooseEffect(effect.id)}
              />
            ))}
          </div>
        ));
      case 'addins':
        return (
          <>
            <MenuItem icon={<PintaIcon file="addins-manage.png" size={15} />} label="Add-in Manager…" onClick={() => closeAnd(() => auxiliaryDialogRef.current?.open('addins'))} />
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
            <MenuItem icon={<PintaIcon file="document-save-symbolic.svg" size={15} standard />} label="Save All" shortcut="⌃⌥A" disabled={!editor.documents.some((document) => document.dirty)} onClick={() => closeAnd(requestSaveAll)} />
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
            <MenuItem icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />} label="Keyboard Shortcuts…" shortcut="⌘," onClick={() => closeAnd(() => auxiliaryDialogRef.current?.open('shortcuts'))} />
            <div className="menu-divider" />
            <MenuItem icon={<PintaIcon file="help-website-symbolic.svg" size={15} />} label="Pinta Website" onClick={() => closeAnd(() => window.open('https://www.pinta-project.com', '_blank', 'noopener,noreferrer'))} />
            <MenuItem icon={<PintaIcon file="help-bug.png" size={15} />} label="File a Bug" onClick={() => closeAnd(() => window.open(WEB_BUG_REPORT_URL, '_blank', 'noopener,noreferrer'))} />
            <MenuItem icon={<PintaIcon file="help-translate.png" size={15} />} label="Translate This Application" onClick={() => closeAnd(() => window.open('https://hosted.weblate.org/engage/pinta/', '_blank', 'noopener,noreferrer'))} />
          </>
        );
    }
  };

  const openStatusColor = useCallback((target: 'primary' | 'secondary') => {
    colorDialogOriginalRef.current = { primary: editor.primary, secondary: editor.secondary };
    setColorDialogTarget(target);
  }, [editor.primary, editor.secondary]);
  const resetStatusColors = useCallback(() => {
    editor.slices.commands.setPrimary('#000000');
    editor.slices.commands.setSecondary('#ffffff');
  }, [editor.slices.commands]);
  const editStatusPalette = useCallback((index: number) => setEditingPaletteIndex(index), []);
  const addStatusPaletteColor = useCallback(() => setAddingPaletteColor(true), []);
  const importLayerFromDock = useCallback(() => layerFileInputRef.current?.click(), []);
  const openRotateZoomLayerFromDock = useCallback(() => {
    setRotateZoomThumbnailUrl(editor.slices.commands.createCompositeDataUrl());
    setRotateZoomLayerId(editor.activeLayerId);
  }, [editor.activeLayerId, editor.slices.commands]);

  return (
    <div
      className={`app-shell theme-${resolvedTheme} ${showToolbar ? '' : 'toolbar-hidden'}`}
      data-locale={i18n.resolvedLanguage ?? i18n.language}
      onClick={(event) => {
        if (event.target === event.currentTarget) menuChromeRef.current?.close();
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
      data-has-floating-pixels={editor.hasFloatingPixels ? 'true' : 'false'}
      data-has-line-draft={editor.lineDraft ? 'true' : 'false'}
      data-has-shape-draft={editor.shapeDraft ? 'true' : 'false'}
      data-has-gradient-draft={editor.gradientDraft ? 'true' : 'false'}
      data-text-editor-position={editor.textEditor ? `${editor.textEditor.x.toFixed(2)},${editor.textEditor.y.toFixed(2)}` : ''}
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
        accept=".ora,.ppm,.tga,.bmp,.tif,.tiff,.gif,.svg,.ico,.avif,image/openraster,image/x-portable-pixmap,image/x-tga,image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff,image/svg+xml,image/x-icon,image/avif"
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
        accept=".ora,.ppm,.tga,.bmp,.tif,.tiff,image/openraster,image/x-portable-pixmap,image/x-tga,image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff"
        onChange={(event) => {
          void handleLayerFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      <MenuChromeBoundary ref={menuChromeRef}>
        {({ openMenu, menuSurface, setOpenMenu, setMenuSurface }) => {
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
          return <>
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
          <IconButton label="Open Image (Ctrl+O)" onClick={() => { void openImages(); }}><PintaIcon file="document-open-symbolic.svg" size={iconSize} standard /></IconButton>
          <IconButton label="Save Image (Ctrl+S)" disabled={!hasDocument} onClick={saveCurrentImage}><PintaIcon file="document-save-symbolic.svg" size={iconSize} standard /></IconButton>
          <span className="toolbar-separator" />
          <IconButton label="Undo (Ctrl+Z)" onClick={editor.undo} disabled={!canUndo}><PintaIcon file="edit-undo-symbolic.svg" size={iconSize} standard /></IconButton>
          <IconButton label="Redo (Ctrl+Y)" onClick={editor.redo} disabled={!canRedo}><PintaIcon file="edit-redo-symbolic.svg" size={iconSize} standard /></IconButton>
          <span className="toolbar-separator" />
          <IconButton label="Cut (Ctrl+X)" onClick={() => { copyImage('cut'); }}><PintaIcon file="edit-cut-symbolic.svg" size={iconSize} standard /></IconButton>
          <IconButton label="Copy (Ctrl+C)" onClick={() => { copyImage('copy'); }}><PintaIcon file="edit-copy-symbolic.svg" size={iconSize} standard /></IconButton>
          <IconButton label="Paste (Ctrl+V)" disabled={!editor.hasClipboard} onClick={() => { void requestPaste('current'); }}><PintaIcon file="edit-paste-symbolic.svg" size={iconSize} standard /></IconButton>
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
            <IconButton label="Image" disabled={!hasDocument} active={menuSurface === 'header' && openMenu === 'image'} onClick={() => toggleHeaderMenu('image')}><PintaIcon file="image-x-generic-symbolic.svg" size={iconSize} standard /></IconButton>
            {menuSurface === 'header' && openMenu === 'image' && (
              <Popover align="right">{renderMenuContent('image')}</Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Adjustments" disabled={!hasDocument} active={menuSurface === 'header' && openMenu === 'adjustments'} onClick={() => toggleHeaderMenu('adjustments')}><PintaIcon file="adjustments-default-symbolic.svg" size={iconSize} /></IconButton>
            {menuSurface === 'header' && openMenu === 'adjustments' && (
              <Popover align="right" className="effect-menu-popover">{renderMenuContent('adjustments')}</Popover>
            )}
          </div>
          <div className="menu-anchor">
            <IconButton label="Effects" disabled={!hasDocument} active={menuSurface === 'header' && openMenu === 'effects'} onClick={() => toggleHeaderMenu('effects')}><PintaIcon file="effects-default-symbolic.svg" size={iconSize} /></IconButton>
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
                <MenuItem icon={<PintaIcon file="document-open-symbolic.svg" size={15} standard />} label="Open…" shortcut="Ctrl+O" onClick={() => closeAnd(() => { void openImages(); })} />
                <MenuItem icon={<PintaIcon file="document-save-symbolic.svg" size={15} standard />} label="Save" shortcut="Ctrl+S" disabled={!hasDocument} onClick={() => closeAnd(saveCurrentImage)} />
                <MenuItem icon={<PintaIcon file="document-save-as-symbolic.svg" size={15} standard />} label="Save As…" shortcut="Ctrl+Shift+S" disabled={!hasDocument} onClick={() => closeAnd(() => { setPendingSaveAction(null); setShowSaveAs(true); })} />
                <MenuItem icon={<PintaIcon file="document-print-symbolic.svg" size={15} standard />} label="Print…" shortcut="Ctrl+P" disabled={!hasDocument} onClick={openPrintDialog} />
                <MenuItem icon={<PintaIcon file="window-close-symbolic.svg" size={15} standard />} label="Close" shortcut="Ctrl+W" disabled={!hasDocument} onClick={() => requestCloseDocument(editor.activeDocumentId)} />
                <MenuItem icon={<PintaIcon file="document-save-symbolic.svg" size={15} standard />} label="Save All" shortcut="Ctrl+Alt+A" disabled={!editor.documents.some((document) => document.dirty)} onClick={() => closeAnd(requestSaveAll)} />
                <MenuItem icon={<PintaIcon file="window-close-symbolic.svg" size={15} standard />} label="Close All" shortcut="Ctrl+Shift+W" onClick={requestCloseAll} />
                <div className="menu-divider" />
                <MenuItem icon={<PintaIcon file="edit-undo-symbolic.svg" size={15} standard />} label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => closeAnd(editor.undo)} />
                <MenuItem icon={<PintaIcon file="edit-redo-symbolic.svg" size={15} standard />} label="Redo" shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={() => closeAnd(editor.redo)} />
                <div className="menu-divider" />
                <MenuItem icon={<PintaIcon file="edit-cut-symbolic.svg" size={15} standard />} label="Cut" shortcut="Ctrl+X" disabled={!hasDocument} onClick={() => closeAnd(() => { copyImage('cut'); })} />
                <MenuItem icon={<PintaIcon file="edit-copy-symbolic.svg" size={15} standard />} label="Copy" shortcut="Ctrl+C" disabled={!hasDocument} onClick={() => closeAnd(() => { copyImage('copy'); })} />
                <MenuItem icon={<PintaIcon file="edit-copy-symbolic.svg" size={15} standard />} label="Copy Merged" shortcut="Ctrl+Shift+C" disabled={!hasDocument} onClick={() => closeAnd(() => { copyImage('copy-merged'); })} />
                <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste" shortcut="Ctrl+V" onClick={() => closeAnd(() => { void requestPaste('current'); })} />
                <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste Into New Layer" shortcut="Ctrl+Shift+V" onClick={() => closeAnd(() => { void requestPaste('new-layer'); })} />
                <MenuItem icon={<PintaIcon file="edit-paste-symbolic.svg" size={15} standard />} label="Paste Into New Image" shortcut="Shift+V" onClick={() => closeAnd(() => { void requestPaste('new-image'); })} />
                <div className="menu-divider" />
                <MenuItem icon={<PintaIcon file="edit-select-all-symbolic.svg" size={15} standard />} label="Select All" shortcut="Ctrl+A" disabled={!hasDocument} onClick={() => closeAnd(editor.selectAll)} />
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
                <MenuItem icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />} label="Keyboard Shortcuts" shortcut="Ctrl+," onClick={() => closeAnd(() => auxiliaryDialogRef.current?.open('shortcuts'))} />
                <MenuItem icon={<PintaIcon file="preferences-system-symbolic.svg" size={15} standard />} label="Language…" onClick={() => closeAnd(() => auxiliaryDialogRef.current?.open('language'))} />
                <MenuItem icon={<PintaIcon file="help-website-symbolic.svg" size={15} />} label="Pinta Website" onClick={() => closeAnd(() => window.open('https://www.pinta-project.com', '_blank', 'noopener,noreferrer'))} />
                <MenuItem icon={<PintaIcon file="help-bug.png" size={15} />} label="File a Bug" onClick={() => closeAnd(() => window.open(WEB_BUG_REPORT_URL, '_blank', 'noopener,noreferrer'))} />
                <MenuItem icon={<PintaIcon file="help-translate.png" size={15} />} label="Translate This Application" onClick={() => closeAnd(() => window.open('https://hosted.weblate.org/engage/pinta/', '_blank', 'noopener,noreferrer'))} />
                <div className="menu-divider" />
                <MenuItem icon={<PintaIcon file="help-about-symbolic.svg" size={15} standard />} label="About" onClick={() => closeAnd(() => auxiliaryDialogRef.current?.open('about'))} />
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
          </>;
        }}
      </MenuChromeBoundary>

      <NativeToolOptions editor={editor} currentTool={currentTool} blockBrushEnabled={enabledAddins.includes('block-brush')} onChooseFont={() => { void openFontFamilyDialog(); }} />

      {editor.persistenceSuspended && (
        <div className="persistence-suspended-banner" role="status">
          {editor.persistenceSuspendedReason === 'newer-workspace' ? (
            <>
              <strong>{translateUi('A newer version of Pinta Online saved this work.')}</strong>
              <span>{translateUi('Saving is paused so nothing is overwritten. Reload the page to pick up the update and get your images back.')}</span>
              <button type="button" className="native-dialog-button" onClick={() => window.location.reload()}>
                {translateUi('Reload')}
              </button>
            </>
          ) : (
            <>
              <strong>{translateUi('Started without your saved workspace.')}</strong>
              <span>{translateUi('Saving is paused so the stored work is not overwritten. Open or export what you need, then reload normally.')}</span>
            </>
          )}
        </div>
      )}
      {editor.storagePressure && (
        <div className="persistence-suspended-banner storage-pressure-banner" role="status">
          <strong>{translateUi('Browser storage is nearly full.')}</strong>
          <span>
            {formatStorageAmount(editor.storagePressure.usage)}
            {' '}{translateUi('of about')}{' '}
            {formatStorageAmount(editor.storagePressure.quota)}{' '}
            {persistHistory
              ? translateUi('is in use. Saving undo history for every open image is what fills it fastest.')
              : translateUi('is in use. Close images you have already exported to free more space.')}
          </span>
          {persistHistory && (
            <button type="button" className="native-dialog-button" onClick={() => setPersistHistory(false)}>
              {translateUi('Stop saving undo history')}
            </button>
          )}
        </div>
      )}
      <div ref={editorBodyRef} className={`editor-body ${showSidebar ? 'with-sidebar' : ''}`} onClick={() => menuChromeRef.current?.close()}>
        {showToolbox && (
          <aside className="toolbox" style={{ '--toolbox-rows': toolboxRows } as CSSProperties} aria-label={translateUi('Tools')}>
            {visibleTools.map((item) => (
              <ToolButton key={item.id} item={item} active={editor.tool === item.id} onSelect={editor.slices.commands.setTool} />
            ))}
          </aside>
        )}

        <ErrorBoundary region="canvas">
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

          {editor.documents.length > 0 ? (
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
                {zoomMarquee && <div
                  className="zoom-marquee"
                  aria-hidden="true"
                  style={{
                    left: zoomMarquee.x * editor.zoom,
                    top: zoomMarquee.y * editor.zoom,
                    width: zoomMarquee.width * editor.zoom,
                    height: zoomMarquee.height * editor.zoom,
                  }}
                />}
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
                      dir="auto"
                      wrap="off"
                      className={`canvas-text-editor text-style-${editor.textStyle}`}
                      aria-label="Text editor"
                      value={editor.textEditor.value}
                      spellCheck
                      placeholder="Type text…"
                      onChange={(event) => editor.updateText(event.target.value)}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (event.button !== 2) return;
                        event.preventDefault();
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
                        if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                        editor.moveText(
                          drag.originX + (event.clientX - drag.x) / editor.zoom,
                          drag.originY + (event.clientY - drag.y) / editor.zoom,
                        );
                      }}
                      onPointerUp={(event) => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                        textDragRef.current = null;
                      }}
                      onPointerCancel={() => { textDragRef.current = null; }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          editor.commitText();
                        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey) {
                          event.preventDefault();
                          const input = event.currentTarget;
                          const start = input.selectionStart;
                          const end = input.selectionEnd;
                          editor.updateText(`${input.value.slice(0, start)}\n${input.value.slice(end)}`);
                          requestAnimationFrame(() => input.setSelectionRange(start + 1, start + 1));
                        } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                          event.preventDefault();
                          const input = event.currentTarget;
                          const start = input.selectionStart;
                          const end = input.selectionEnd;
                          editor.updateText(`${input.value.slice(0, start)}\t${input.value.slice(end)}`);
                          requestAnimationFrame(() => input.setSelectionRange(start + 1, start + 1));
                        } else if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          if (event.shiftKey) setShowSaveAs(true);
                          else saveCurrentImage();
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
          ) : (
            <main className="empty-workspace" aria-label={translateUi('No image open')}>
              <PintaIcon file="image-x-generic-symbolic.svg" size={64} standard />
              <h2>{translateUi('No image open')}</h2>
              <p>{translateUi('Create a new image or open an existing image to start editing.')}</p>
              <div>
                <button type="button" className="native-dialog-button suggested" onClick={() => setDialog('new')}><PintaIcon file="document-new-symbolic.svg" size={16} standard />{translateUi('New Image')}</button>
                <button type="button" className="native-dialog-button" onClick={() => { void openImages(); }}><PintaIcon file="document-open-symbolic.svg" size={16} standard />{translateUi('Open Image')}</button>
              </div>
            </main>
          )}
        </div>
        </ErrorBoundary>

        {showSidebar && (
          <ErrorBoundary region="dock">
            <DockSidebar
              documentState={editor.slices.document}
              commands={editor.slices.commands}
              toolIcon={currentTool.icon}
              layerPropertiesPreview={layerPropertiesPreview}
              onImportLayer={importLayerFromDock}
              onOpenRotateZoomLayer={openRotateZoomLayerFromDock}
              onEditLayer={setLayerPropertiesId}
            />
          </ErrorBoundary>
        )}
      </div>

      {showPalette && (
        <StatusBar
          hasDocument={hasDocument}
          primary={editor.primary}
          secondary={editor.secondary}
          recentColors={editor.recentColors}
          palette={editor.palette}
          liveMetrics={editor.liveMetrics}
          width={editor.width}
          height={editor.height}
          zoom={editor.zoom}
          zoomMode={zoomMode}
          onOpenColor={openStatusColor}
          onSwapColors={editor.slices.commands.swapColors}
          onResetColors={resetStatusColors}
          onSetPrimary={editor.slices.commands.setPrimary}
          onSetSecondary={editor.slices.commands.setSecondary}
          onEditPalette={editStatusPalette}
          onAddPalette={addStatusPaletteColor}
          onSetZoom={setFixedZoom}
          onZoomToWindow={zoomToWindow}
        />
      )}

      {isDraggingFile && (
        <div className="drop-overlay">
          <div><PintaIcon file="document-open-symbolic.svg" size={34} standard /><strong>Open images in Pinta</strong><span>Drop one or more OpenRaster, PNG, JPEG, WebP, AVIF, GIF, BMP, TIFF, SVG, ICO, PPM, or TGA images</span></div>
        </div>
      )}
      <PrimaryDialogBoundary ref={primaryDialogRef}>
      {({ dialog, effectDialog, showSaveAs }) => (
      <ErrorBoundary region="dialog" onDismiss={closeAllOverlays}>
      <>
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
          histogram={editor.getActiveHistogram()}
          imageWidth={editor.width}
          imageHeight={editor.height}
          thumbnailUrl={effectThumbnailUrl}
          onCancel={() => {
            editor.cancelEffect();
            setEffectDialog(null);
          }}
          onPreview={(parameters) => editor.previewEffect(effectDialog, parameters)}
          onSubmit={async (parameters) => {
            const effect = effectDialog;
            setEffectDialog(null);
            await runEffect(effect, parameters);
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
            if (/^Unsaved Image(?:\s+\d+)?$/i.test(closingDocument.fileName)) {
              setPendingSaveAction({ kind: 'close', documentId: closingDocument.id });
              setClosingDocumentId(null);
              setShowSaveAs(true);
            } else if (editor.layers.length > 1 && initialExportFormat(closingDocument.fileName) !== 'ora') {
              setPendingFlattenAction({ kind: 'close', documentId: closingDocument.id });
              setClosingDocumentId(null);
            } else if (await editor.saveImage()) {
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
            if (/^Unsaved Image(?:\s+\d+)?$/i.test(closeAllDocument.fileName)) {
              setPendingSaveAction({ kind: 'close-all', documentId: closeAllDocument.id });
              setShowCloseAllConfirm(false);
              setShowSaveAs(true);
            } else if (editor.layers.length > 1 && initialExportFormat(closeAllDocument.fileName) !== 'ora') {
              setPendingFlattenAction({ kind: 'close-all', documentId: closeAllDocument.id });
              setShowCloseAllConfirm(false);
            } else if (await editor.saveImage()) completeCloseAllStep(closeAllDocument.id);
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
      {pendingFlattenAction && (
        <FlattenConfirmDialog
          onCancel={() => {
            if (pendingFlattenAction.kind === 'close-all') setCloseAllQueue([]);
            if (pendingFlattenAction.kind === 'save-all') setSaveAllQueue([]);
            setPendingFlattenAction(null);
          }}
          onFlatten={() => {
            const action = pendingFlattenAction;
            setPendingFlattenAction(null);
            editor.flattenImage();
            void editor.saveImage().then((saved) => {
              if (!saved) return;
              if (action.kind === 'close') editor.closeDocument(action.documentId);
              else if (action.kind === 'close-all') completeCloseAllStep(action.documentId);
              else if (action.kind === 'save-all') completeSaveAllStep(action.documentId, true);
            }).catch((error) => showError('Failed to save image', error instanceof Error ? error.message : 'The image could not be saved.', error));
          }}
        />
      )}
      {clipboardInformation && <InformationDialog title={clipboardInformation.title} message={clipboardInformation.message} onClose={() => setClipboardInformation(null)} />}
      {showSaveAs && (
        <SaveAsDialog
          fileName={editor.fileName}
          layerCount={editor.layers.length}
          onCancel={() => {
            setShowSaveAs(false);
            if (pendingSaveAction?.kind === 'close-all') setCloseAllQueue([]);
            if (pendingSaveAction?.kind === 'save-all') setSaveAllQueue([]);
            setPendingSaveAction(null);
          }}
          onSaved={() => setShowSaveAs(false)}
          onSubmit={async (options) => {
            const saved = await saveImageAs(options);
            if (!saved || !pendingSaveAction) return saved;
            const action = pendingSaveAction;
            setPendingSaveAction(null);
            if (action.kind === 'close') editor.closeDocument(action.documentId);
            else if (action.kind === 'close-all') completeCloseAllStep(action.documentId);
            else completeSaveAllStep(action.documentId, true);
            return true;
          }}
        />
      )}
      {printPreview && (
        <PrintDialog
          preview={printPreview}
          onCancel={() => setPrintPreview(null)}
          onPrint={() => window.print()}
          onSettingsChange={(settings) => setPrintPreview((current) => current ? { ...current, settings } : null)}
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
      <AuxiliaryDialogHost
        ref={auxiliaryDialogRef}
        currentFont={editor.textFontFamily}
        setFont={editor.slices.commands.setTextFontFamily}
        enabledAddins={enabledAddins}
        paintBrushType={editor.paintBrushType}
        setPaintBrushType={editor.slices.commands.setPaintBrushType}
        onToggleAddin={setAddinEnabled}
        onSetAllAddins={setAllAddinsEnabled}
        notify={notify}
      />
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
          title="Choose Colors"
          primary={editor.primary}
          secondary={editor.secondary}
          initialTarget={colorDialogTarget}
          onCancel={() => {
            const original = colorDialogOriginalRef.current;
            if (original) {
              editor.setPrimary(original.primary, false);
              editor.setSecondary(original.secondary, false);
            }
            colorDialogOriginalRef.current = null;
            setColorDialogTarget(null);
          }}
          onChange={(colors) => {
            editor.setPrimary(colors.primary, false);
            if (colors.secondary) editor.setSecondary(colors.secondary, false);
          }}
          onSubmit={(colors) => {
            editor.setPrimary(colors.primary);
            if (colors.secondary) editor.setSecondary(colors.secondary);
            colorDialogOriginalRef.current = null;
            setColorDialogTarget(null);
          }}
        />
      )}
      {editingPaletteIndex !== null && editor.palette[editingPaletteIndex] && (
        <ColorPickerDialog
          key={editingPaletteIndex}
          title="Choose Palette Color"
          primary={editor.palette[editingPaletteIndex]}
          recentColors={editor.recentColors}
          palette={editor.palette}
          onCancel={() => setEditingPaletteIndex(null)}
          onSubmit={(colors) => {
            editor.setPaletteColor(editingPaletteIndex, colors.primary);
            setEditingPaletteIndex(null);
            notify(`Palette color changed to ${colors.primary}`);
          }}
        />
      )}
      {addingPaletteColor && (
        <ColorPickerDialog
          title="Add Palette Color"
          primary={editor.primary}
          recentColors={editor.recentColors}
          palette={editor.palette}
          onCancel={() => setAddingPaletteColor(false)}
          onSubmit={(colors) => {
            setAddingPaletteColor(false);
            if (editor.addPaletteColor(colors.primary)) notify(`Added ${colors.primary} to the palette`);
          }}
        />
      )}
      {layerPropertiesId && (() => {
        const layer = editor.layers.find((candidate) => candidate.id === layerPropertiesId);
        return layer ? (
          <LayerPropertiesDialog
            key={layer.id}
            layer={layer}
            onPreview={(properties) => {
              setLayerPropertiesPreview({ id: layer.id, ...properties });
              editor.previewLayerProperties(layer.id, properties);
            }}
            onCancel={() => {
              editor.clearLayerTransformPreview();
              setLayerPropertiesPreview(null);
              setLayerPropertiesId(null);
            }}
            onSubmit={(properties) => {
              editor.clearLayerTransformPreview();
              setLayerPropertiesPreview(null);
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
            imageWidth={editor.width}
            imageHeight={editor.height}
            thumbnailUrl={rotateZoomThumbnailUrl}
            onPreview={editor.previewRotateZoomLayer}
            onCancel={() => {
              editor.clearLayerTransformPreview();
              setRotateZoomLayerId(null);
            }}
            onSubmit={(angle, panHorizontal, panVertical, zoom) => {
              editor.rotateZoomLayer(angle, panHorizontal, panVertical, zoom);
              setRotateZoomLayerId(null);
            }}
          />
        ) : null;
      })()}
      {editor.effectBusy && !effectDialog && runningEffect && (
        <EffectProgressDialog effectName={EFFECT_BY_ID[runningEffect].name} progress={editor.effectProgress} onCancel={editor.cancelEffect} />
      )}
      {applicationError && (
        <ErrorReportDialog
          error={applicationError}
          onClose={() => setApplicationError(null)}
          onReportBug={() => {
            window.open(WEB_BUG_REPORT_URL, '_blank', 'noopener,noreferrer');
            setApplicationError(null);
          }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
      {isFullscreen && <button className="fullscreen-exit" type="button" onClick={() => void toggleFullscreen()}>Exit fullscreen</button>}
      {printPreview && (
        <>
          <style>{`@media print { @page { size: ${printPreview.settings.orientation}; margin: ${printPreview.settings.margin}mm; } }`}</style>
          <div
            className={`print-surface print-scale-${printPreview.settings.scaleMode} ${printPreview.settings.center ? 'print-centered' : ''}`}
            data-print-orientation={printPreview.settings.orientation}
            data-print-scale={printPreview.settings.scaleMode === 'custom' ? printPreview.settings.scale : printPreview.settings.scaleMode}
            data-print-margin={printPreview.settings.margin}
            aria-hidden="true"
          >
            <img
              src={printPreview.dataUrl}
              alt=""
              style={printPreview.settings.scaleMode === 'fit' ? undefined : {
                width: `${printPreview.width / 96 * (printPreview.settings.scaleMode === 'custom' ? printPreview.settings.scale / 100 : 1)}in`,
                maxWidth: 'none',
                maxHeight: 'none',
              }}
            />
          </div>
        </>
      )}
      </>
      </ErrorBoundary>
      )}
      </PrimaryDialogBoundary>
    </div>
  );
}

export default App;
