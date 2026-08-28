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
import { clampZoom, zoomInLevel, zoomOutLevel } from './editor/zoom';
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
import { LayerPropertiesDialog, RotateZoomLayerDialog } from './components/dialogs/layerDialogs';
import { CloseDocumentDialog, FlattenConfirmDialog, initialExportFormat, JpegQualityDialog, PasteExpandDialog, SaveAsDialog } from './components/dialogs/documentDialogs';
import { ImageSizeDialog, type DialogName } from './components/dialogs/ImageSizeDialog';
import { AboutDialog, AddinManagerDialog, FontFamilyDialog, KeyboardShortcutsDialog, LanguageDialog } from './components/dialogs/aboutDialogs';
import { NativeToolOptions } from './components/NativeToolOptions';
import { EffectDialog } from './components/dialogs/effect/EffectDialog';
import { AlignmentEditor, CurvesEditor, HistogramChart, levelColor, levelParameterKey, LevelsEditor, type LevelChannel, type LevelControlKey } from './components/dialogs/effect/editors';
import { CanvasGridDialog, EffectProgressDialog, ErrorReportDialog, InformationDialog, OffsetSelectionDialog, PrintDialog, ScreenshotDialog, type ApplicationError, type PrintPreview, type PrintSettings } from './components/dialogs/systemDialogs';
import { ColorPickerDialog } from './components/ColorPickerDialog';
import { DialogActions, DialogResetButton, DialogStepper } from './components/dialogControls';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MenuItem, Popover, TopLevelMenu, type MenuName } from './components/menus';
import { StatusBar } from './components/StatusBar';
import {
  AngleDial,
  BusySpinner,
  IconButton,
  PintaIcon,
  PointPad,
  ToolbarIconSelect,
  ToolbarStepper,
} from './components/primitives';
import { context2d } from './editor/canvasContext';
import { USER_GUIDE_URL, WEB_BUG_REPORT_URL, WEB_REPOSITORY_URL } from './projectLinks';
import { formatStorageAmount } from './editor/workspacePersistence';
import { countRepeat, errorMessageOf, isForeignError, reportError } from './errorReporting';

type PaintEditorController = ReturnType<typeof usePaintEditor>;
type LayerPropertiesPreview = { id: string; name: string; visible: boolean; opacity: number; blendMode: BlendMode };

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
