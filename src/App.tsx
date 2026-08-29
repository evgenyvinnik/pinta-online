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
import { type ExportFormat } from './editor/types';
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
import { usePreferences, type CanvasGridSettings } from './state/preferences';
import { aboutPathForLocale, changeLocale, currentLocale, SUPPORTED_LOCALES, translateDocumentName, translateUi, type LocaleCode } from './i18n';
import { ADDIN_DEFINITIONS, isAddinEnabled } from './addins/registry';
import { CanvasArea } from './components/CanvasArea';
import { initialExportFormat } from './components/dialogs/documentDialogs';
import type { DialogName } from './components/dialogs/ImageSizeDialog';
import { NativeToolOptions } from './components/NativeToolOptions';
import { AlignmentEditor, CurvesEditor, HistogramChart, levelColor, levelParameterKey, LevelsEditor, type LevelChannel, type LevelControlKey } from './components/dialogs/effect/editors';
import { type ApplicationError, type PrintPreview, type PrintSettings } from './components/dialogs/systemDialogs';
import { DialogActions, DialogResetButton, DialogStepper } from './components/dialogControls';
import { DialogHost, type AuxiliaryDialogHandle, type PrimaryDialogHandle } from './components/DialogHost';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useToast } from './hooks/useToast';
import { usePrintAndScreenshot } from './hooks/usePrintAndScreenshot';
import { useClipboardBridge } from './hooks/useClipboardBridge';
import { useBulkDocumentActions } from './hooks/useBulkDocumentActions';
import { DockSidebar, type LayerPropertiesPreview } from './components/DockSidebar';
import { HeaderBar } from './components/HeaderBar';
import { MenuBar } from './components/MenuBar';
import { MenuItem, Popover, type MenuName } from './components/menus';
import { StatusBar } from './components/StatusBar';
import { StatusBanners } from './components/StatusBanners';
import { Toolbox } from './components/Toolbox';
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
import { countRepeat, errorMessageOf, isForeignError, reportError } from './errorReporting';


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
  const [applicationError, setApplicationError] = useState<ApplicationError | null>(null);
  const [pendingSaveAction, setPendingSaveAction] = useState<{ kind: 'close' | 'close-all' | 'save-all'; documentId: string } | null>(null);
  const [pendingFlattenAction, setPendingFlattenAction] = useState<{ kind: 'save' | 'close' | 'close-all' | 'save-all'; documentId: string } | null>(null);
  const [showOffsetSelection, setShowOffsetSelection] = useState(false);
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
  const lastWorkspaceErrorRef = useRef('');
  const setDialog = useCallback((value: DialogName) => primaryDialogRef.current?.setDialog(value), []);
  const setEffectDialog = useCallback((value: EffectId | null) => primaryDialogRef.current?.setEffectDialog(value), []);
  const setShowSaveAs = useCallback((value: boolean) => primaryDialogRef.current?.setShowSaveAs(value), []);

  const { toast, notify } = useToast();

  const showError = useCallback((title: string, message: string, error: unknown) => {
    setApplicationError({ title, message, details: errorDetails(error) });
  }, []);

  const {
    pendingPaste, setPendingPaste, clipboardInformation, setClipboardInformation,
    fallbackPasteTargetRef, performPaste, pasteImportedImage, showEmptyClipboard,
    requestPaste, publishClipboardImage, copyImage,
  } = useClipboardBridge({ editor, notify, closeMenus: () => menuChromeRef.current?.close() });

  const {
    closingDocumentId, setClosingDocumentId, showCloseAllConfirm, setShowCloseAllConfirm,
    closeAllQueue, setCloseAllQueue, saveAllQueue, setSaveAllQueue, saveAllCount,
    requestCloseAll, completeCloseAllStep, completeSaveAllStep, requestSaveAll,
  } = useBulkDocumentActions({
    editor,
    notify,
    showError,
    pendingFlattenAction,
    setPendingFlattenAction,
    setPendingSaveAction,
    setShowSaveAs,
    isSaveAsOpen: () => Boolean(primaryDialogRef.current?.getState().showSaveAs),
    closeMenus: () => menuChromeRef.current?.close(),
  });

  const {
    printPreview, setPrintPreview, openPrintDialog,
    showScreenshot, setShowScreenshot, screenshotBusy, screenshotError, setScreenshotError,
    captureScreenshot,
  } = usePrintAndScreenshot({
    editor,
    notify,
    showError,
    closeMenus: () => menuChromeRef.current?.close(),
  });

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
          return <>
      <MenuBar
        openMenu={openMenu}
        menuSurface={menuSurface}
        fileName={editor.fileName}
        dirty={editor.dirty}
        renderMenuContent={renderMenuContent}
        onSetOpenMenu={setOpenMenu}
        onSetMenuSurface={setMenuSurface}
      />

      {showToolbar && (
        <HeaderBar
          editor={editor}
          iconSize={iconSize}
          canUndo={canUndo}
          canRedo={canRedo}
          showSidebar={showSidebar}
          openMenu={openMenu}
          menuSurface={menuSurface}
          renderMenuContent={renderMenuContent}
          commands={{
            openDialog,
            openImages: () => { void openImages(); },
            saveCurrentImage,
            copyImage,
            requestPaste: (target) => { void requestPaste(target); },
            closeAnd,
            openScreenshot: () => {
              setScreenshotError('');
              setShowScreenshot(true);
            },
            openSaveAs: () => {
              setPendingSaveAction(null);
              setShowSaveAs(true);
            },
            openPrintDialog,
            requestCloseDocument,
            requestSaveAll,
            requestCloseAll,
            openOffsetSelection: () => setShowOffsetSelection(true),
            notify,
            openPalette: () => paletteInputRef.current?.click(),
            savePalette: () => setPaletteDialog('save'),
            resizePalette: () => setPaletteDialog('resize'),
            openAuxiliary: (dialog) => auxiliaryDialogRef.current?.open(dialog),
            toggleSidebar: () => setShowSidebar((value) => !value),
            toggleFullscreen: () => { void toggleFullscreen(); },
          }}
          onSetOpenMenu={setOpenMenu}
          onSetMenuSurface={setMenuSurface}
        />
      )}
          </>;
        }}
      </MenuChromeBoundary>

      <NativeToolOptions editor={editor} currentTool={currentTool} blockBrushEnabled={enabledAddins.includes('block-brush')} onChooseFont={() => { void openFontFamilyDialog(); }} />

      <StatusBanners
        persistenceSuspended={editor.persistenceSuspended}
        persistenceSuspendedReason={editor.persistenceSuspendedReason}
        storagePressure={editor.storagePressure}
        persistHistory={persistHistory}
        onReload={() => window.location.reload()}
        onStopSavingHistory={() => setPersistHistory(false)}
      />
      <div ref={editorBodyRef} className={`editor-body ${showSidebar ? 'with-sidebar' : ''}`} onClick={() => menuChromeRef.current?.close()}>
        {showToolbox && (
          <Toolbox
            items={visibleTools}
            rows={toolboxRows}
            activeTool={editor.tool}
            onSelect={editor.slices.commands.setTool}
          />
        )}

        <ErrorBoundary region="canvas">
          <CanvasArea
            editor={editor}
            showDocumentTabs={showDocumentTabs}
            showRulers={showRulers}
            rulerMetric={rulerMetric}
            viewportMetrics={viewportMetrics}
            viewportRef={viewportRef}
            canvasStyle={canvasStyle}
            zoomMarquee={zoomMarquee}
            canvasGrid={canvasGrid}
            textEditorLeft={textEditorLeft}
            textEditorWidth={textEditorWidth}
            textDragRef={textDragRef}
            onViewportScroll={(scrollLeft, scrollTop) => {
              setViewportMetrics((current) => ({ ...current, scrollLeft, scrollTop }));
            }}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onRequestCloseDocument={requestCloseDocument}
            onOpenSaveAs={() => setShowSaveAs(true)}
            onSaveCurrentImage={saveCurrentImage}
            onNewImage={() => setDialog('new')}
            onOpenImages={() => { void openImages(); }}
          />
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
      <DialogHost
        editor={editor}
        primaryDialogRef={primaryDialogRef}
        auxiliaryDialogRef={auxiliaryDialogRef}
        closeAllOverlays={closeAllOverlays}
        effectThumbnailUrl={effectThumbnailUrl}
        runEffect={runEffect}
        closingDocumentId={closingDocumentId}
        setClosingDocumentId={setClosingDocumentId}
        showCloseAllConfirm={showCloseAllConfirm}
        setShowCloseAllConfirm={setShowCloseAllConfirm}
        closeAllQueue={closeAllQueue}
        setCloseAllQueue={setCloseAllQueue}
        completeCloseAllStep={completeCloseAllStep}
        pendingPaste={pendingPaste}
        setPendingPaste={setPendingPaste}
        performPaste={performPaste}
        pendingFlattenAction={pendingFlattenAction}
        setPendingFlattenAction={setPendingFlattenAction}
        setSaveAllQueue={setSaveAllQueue}
        completeSaveAllStep={completeSaveAllStep}
        showError={showError}
        clipboardInformation={clipboardInformation}
        setClipboardInformation={setClipboardInformation}
        pendingSaveAction={pendingSaveAction}
        setPendingSaveAction={setPendingSaveAction}
        saveImageAs={saveImageAs}
        printPreview={printPreview}
        setPrintPreview={setPrintPreview}
        showOffsetSelection={showOffsetSelection}
        setShowOffsetSelection={setShowOffsetSelection}
        showScreenshot={showScreenshot}
        setShowScreenshot={setShowScreenshot}
        screenshotBusy={screenshotBusy}
        screenshotError={screenshotError}
        setScreenshotError={setScreenshotError}
        captureScreenshot={captureScreenshot}
        showCanvasGridDialog={showCanvasGridDialog}
        setShowCanvasGridDialog={setShowCanvasGridDialog}
        canvasGrid={canvasGrid}
        setCanvasGrid={setCanvasGrid}
        enabledAddins={enabledAddins}
        setAddinEnabled={setAddinEnabled}
        setAllAddinsEnabled={setAllAddinsEnabled}
        notify={notify}
        paletteDialog={paletteDialog}
        setPaletteDialog={setPaletteDialog}
        savePalette={savePalette}
        colorDialogTarget={colorDialogTarget}
        setColorDialogTarget={setColorDialogTarget}
        colorDialogOriginalRef={colorDialogOriginalRef}
        editingPaletteIndex={editingPaletteIndex}
        setEditingPaletteIndex={setEditingPaletteIndex}
        addingPaletteColor={addingPaletteColor}
        setAddingPaletteColor={setAddingPaletteColor}
        layerPropertiesId={layerPropertiesId}
        setLayerPropertiesId={setLayerPropertiesId}
        setLayerPropertiesPreview={setLayerPropertiesPreview}
        rotateZoomLayerId={rotateZoomLayerId}
        setRotateZoomLayerId={setRotateZoomLayerId}
        rotateZoomThumbnailUrl={rotateZoomThumbnailUrl}
        runningEffect={runningEffect}
        applicationError={applicationError}
        setApplicationError={setApplicationError}
        toast={toast}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
      />
    </div>
  );
}

export default App;
