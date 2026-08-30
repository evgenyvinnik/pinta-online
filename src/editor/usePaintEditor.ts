import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_HEIGHT, DEFAULT_WIDTH } from './types';
import { documentFromPersisted, documentTabOf, persistedDocumentOf } from './workspaceSerialization';
import { useToolSettings } from './useToolSettings';
import { useImageCommands } from './useImageCommands';
import { useEffectRunner } from './useEffectRunner';
import { useLayerCommands } from './useLayerCommands';
import { useSelectionCommands } from './useSelectionCommands';
import { usePaletteState } from './usePaletteState';
import { useFileCommands } from './useFileCommands';
import { PALETTE } from './tools';
import { context2d } from './canvasContext';
import { canvasesHaveSamePixels, clampByte, cloneCanvas, colorToRgba, makeCanvas, makeId } from './canvasUtils';
import {
  drawFloatingPixels,
  floatingPixelsFromSnapshot,
  layerFromSnapshot,
  makeLayer,
  paintLayer,
  selectionFromSnapshot,
  snapshotOf,
} from './layerSnapshots';
import {
  combineSelectionMasks,
  constrainCanvasMutationToSelection,
  constrainSelectionPoint,
  copySelectionToCanvas,
  createSelectionMask,
  drawSelectionOverlay,
  isResizableSelection,
  normalizeSelection,
  resizeSelection,
  SELECTION_TOOLS,
  selectionMaskOnCanvas,
  selectionResizeHandleAtPoint,
  transformSelection,
  type SelectionMode,
  type SelectionResizeHandle,
} from './selectionGeometry';
export type { SelectionMode } from './selectionGeometry';
export type { CanvasAnchor } from './types';
export type { DocumentSession, DocumentTab } from './types';
export type { RgbHistogram } from './types';
export type { ColorPickerAfterSelect, ColorPickerSampleType, FloodMode, LassoMode } from './types';
export type { EditableBoundsTool, GradientColorMode, TextAlignment, TextStyle } from './types';
export type {
  AlphaBlendingMode,
  EditableLineState,
  EditableShapeState,
  EraserType,
  GradientDraftState,
  GradientType,
  PaintBrushType,
  ShapeDashStyle,
  ShapeDrawingOptions,
  ShapeFillStyle,
  TextDrawingOptions,
  TextEditorState,
  TextVariant,
} from './types';
import {
  colorDifferenceWithinTolerance,
  floodFill,
  magicWandSelection,
  recolorColorTolerance,
  sampleCanvasColor,
} from './colorMatching';
import {
  configureStroke,
  constrainLinePoint,
  constrainShapePoint,
  distanceToLineDraft,
  distanceToShapeDraft,
  drawEditableLine,
  drawEditableShape,
  drawFreeformShape,
  drawPaintBrushSegment,
  drawShape,
  drawTextEditor,
  isRenderableLineDraft,
  isRenderableShapeDraft,
  moveRectangularControlPoint,
  rectangularControlPoints,
  removeAntialiasing,
  renderGradientDraftToLayer,
  textEditorBounds,
  distanceToSegment,
} from './drawing';
import { multiplyTransforms, transformDelta, translationTransform } from './geometry';
import { firstAffordableHistoryIndex, historyByteBudget } from './historyBudget';
import { demoteToDiff, promoteToAnchor, shouldAnchorAt } from './historyPixels';
import { createEditorLiveMetrics } from './liveMetrics';
import { consumeRestoreSkip } from './workspaceRecovery';
import { clampZoom, zoomInLevel, zoomOutLevel } from './zoom';
import type {
  AffineTransform,
  DocumentSession,
  DocumentTab,
  EditableBoundsTool,
  EditableLineState,
  EditableShapeState,
  FloatingPixelsState,
  GradientDraftState,
  HistorySnapshot,
  PaintLayer,
  Point,
  ReeditableText,
  Selection,
  ShapeDrawingOptions,
  StoredEditableDraft,
  TextDrawingOptions,
  TextEditorState,
  ToolId,
} from './types';
import {
  loadWorkspace,
  saveWorkspace,
  storagePressure,
  WorkspaceVersionError,
  type PersistedWorkspace,
} from './workspacePersistence';

function useShallowStableObject<Value extends Record<string, unknown>>(value: Value): Value {
  const previousRef = useRef(value);
  const previous = previousRef.current;
  const keys = Object.keys(value);
  if (keys.length !== Object.keys(previous).length || keys.some((key) => !Object.is(value[key], previous[key]))) {
    previousRef.current = value;
  }
  return previousRef.current;
}

interface TransformGesture {
  mode: 'translate' | 'scale' | 'rotate';
  start: Point;
  center: Point;
  originalSelection: Selection;
  originalTransform: AffineTransform | null;
}

const SELECTION_RESIZE_CURSORS: Record<SelectionResizeHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

const DRAWING_TOOLS: ToolId[] = ['paintbrush', 'block-brush', 'pencil', 'eraser', 'recolor', 'clone-stamp'];
const SHAPE_TOOLS: ToolId[] = ['line', 'rectangle', 'rounded-rectangle', 'ellipse', 'gradient'];
const EDITABLE_BOUNDS_TOOLS: EditableBoundsTool[] = ['rectangle', 'rounded-rectangle', 'ellipse'];
const EDITABLE_SHAPE_TOOLS: ToolId[] = ['line', ...EDITABLE_BOUNDS_TOOLS];

export function usePaintEditor() {
  const {
    recentColors,
    persistHistory,
    setToolSetting,
    tool,
    primary,
    secondary,
    paintBrushType,
    slashBrushAngle,
    splatterMinimumSize,
    splatterMaximumSize,
    eraserType,
    floodMode,
    paintBucketTolerance,
    selectionAutoScroll,
    lassoMode,
    gradientType,
    gradientColorMode,
    colorPickerSampleSize,
    colorPickerSampleType,
    colorPickerAfterSelect,
    roundedRectangleRadius,
    lineArrowStart,
    lineArrowEnd,
    lineArrowSize,
    lineArrowAngle,
    lineArrowLength,
    magicWandTolerance,
    recolorTolerance,
    selectionMode,
    textFontFamily,
    textFontSize,
    textFontWeight,
    textItalic,
    textUnderline,
    textAlignment,
    textStyle,
    textVariant,
    textOutlineWidth,
    textLineJoin,
    brushSize,
    shapeAntialiasing,
    alphaBlendingMode,
    shapeFillStyle,
    shapeDashStyle,
    setToolState,
    setPrimary,
    setSecondary,
    setBrushSize,
    setPaintBrushType,
    setSlashBrushAngle,
    setSplatterMinimumSize,
    setSplatterMaximumSize,
    setEraserType,
    setFloodMode,
    setPaintBucketTolerance,
    setSelectionAutoScroll,
    setLassoMode,
    setGradientType,
    setGradientColorMode,
    setAlphaBlendingMode,
    setColorPickerSampleSize,
    setColorPickerSampleType,
    setColorPickerAfterSelect,
    setRoundedRectangleRadius,
    setShapeFillStyle,
    setShapeDashStyle,
    setShapeAntialiasing,
    setLineArrowStart,
    setLineArrowEnd,
    setLineArrowSize,
    setLineArrowAngle,
    setLineArrowLength,
    setMagicWandTolerance,
    setRecolorTolerance,
    setSelectionMode,
    setTextFontFamily,
    setTextFontSize,
    setTextFontWeight,
    setTextItalic,
    setTextUnderline,
    setTextAlignment,
    setTextStyle,
    setTextVariant,
    setTextOutlineWidth,
    setTextLineJoin,
  } = useToolSettings();
  const initialLayerRef = useRef<PaintLayer | null>(null);
  if (!initialLayerRef.current) initialLayerRef.current = makeLayer(DEFAULT_WIDTH, DEFAULT_HEIGHT, 'Background', true);
  const initialLayer = initialLayerRef.current;

  const [layers, setLayers] = useState<PaintLayer[]>([initialLayer]);
  const layersRef = useRef(layers);
  const [activeLayerId, setActiveLayerIdState] = useState(initialLayer.id);
  const activeLayerIdRef = useRef(activeLayerId);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dimensionsRef = useRef({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const initialSnapshot = useRef(
    snapshotOf([initialLayer], initialLayer.id, DEFAULT_WIDTH, DEFAULT_HEIGHT, 'New Image'),
  );
  const historyRef = useRef<HistorySnapshot[]>([initialSnapshot.current]);
  const [history, setHistory] = useState<HistorySnapshot[]>(historyRef.current);
  const [historyIndex, setHistoryIndexState] = useState(0);
  const historyIndexRef = useRef(0);
  const cleanHistoryIndexRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const previousToolRef = useRef<ToolId>(tool);
  const [palette, setPaletteState] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('pinta-online-palette') ?? 'null');
      if (
        Array.isArray(stored) &&
        stored.length &&
        stored.every((color) => typeof color === 'string' && /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color))
      ) {
        return stored.map((color) => color.toLowerCase());
      }
    } catch {
      // Ignore malformed or unavailable local storage and use Pinta's defaults.
    }
    return [...PALETTE];
  });
  const [lineDraft, setLineDraft] = useState<EditableLineState | null>(null);
  const [shapeDraft, setShapeDraft] = useState<EditableShapeState | null>(null);
  const [gradientDraft, setGradientDraft] = useState<GradientDraftState | null>(null);
  const [archivedShapeDrafts, setArchivedShapeDrafts] = useState<StoredEditableDraft[]>([]);
  const [cloneSource, setCloneSource] = useState<Point | null>(null);
  const [zoom, setZoomState] = useState(1);
  const pointerRef = useRef<Point>({ x: 0, y: 0 });
  const liveMetricsRef = useRef<ReturnType<typeof createEditorLiveMetrics> | null>(null);
  if (!liveMetricsRef.current) liveMetricsRef.current = createEditorLiveMetrics();
  const liveMetrics = liveMetricsRef.current;
  const [selectionCursor, setSelectionCursorState] = useState('');
  const selectionCursorRef = useRef('');
  const [fileName, setFileName] = useState('Unsaved Image 1');
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectionRef = useRef<Selection | null>(selection);
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const [movingPixels, setMovingPixelsState] = useState<FloatingPixelsState | null>(null);
  const floatingPixelsRef = useRef<FloatingPixelsState | null>(movingPixels);
  const clipboardRef = useRef<HTMLCanvasElement | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const [clipboardSize, setClipboardSize] = useState({ width: 0, height: 0 });
  const [effectBusy, setEffectBusy] = useState(false);
  const [effectProgress, setEffectProgress] = useState(0);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  /**
   * Set when the user escaped a workspace that crashed on restore. Saving stays off for the
   * rest of the session so an empty editor cannot overwrite the work it just declined to load.
   */
  const [persistenceSuspended, setPersistenceSuspended] = useState(false);
  /** Why saving is off, so the banner can say something true rather than something generic. */
  const [persistenceSuspendedReason, setPersistenceSuspendedReason] = useState<
    'skipped-restore' | 'newer-workspace' | null
  >(null);
  const persistenceSuspendedRef = useRef(false);
  /** Documents rebuilt from IndexedDB keep the zoom they were saved with. */
  const [restoredDocumentIds, setRestoredDocumentIds] = useState<string[]>([]);
  const [workspaceSaveState, setWorkspaceSaveState] = useState<'restoring' | 'saved' | 'saving' | 'error'>('restoring');
  const [storagePressureState, setStoragePressure] = useState<{ usage: number; quota: number; ratio: number } | null>(
    null,
  );
  const lastStorageSampleRef = useRef(0);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceErrorOperation, setWorkspaceErrorOperation] = useState<'restore' | 'save' | null>(null);
  const workspaceReadyRef = useRef(false);
  const workspaceSaveTimerRef = useRef<number | null>(null);
  const workspaceSaveGenerationRef = useRef(0);
  const workspaceSaveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    try {
      localStorage.setItem('pinta-online-palette', JSON.stringify(palette));
    } catch {
      // Palette persistence is optional in privacy-restricted browser contexts.
    }
  }, [palette]);
  const initialDocumentIdRef = useRef('');
  if (!initialDocumentIdRef.current) initialDocumentIdRef.current = makeId();
  const initialDocumentSessionRef = useRef<DocumentSession | null>(null);
  if (!initialDocumentSessionRef.current) {
    initialDocumentSessionRef.current = {
      id: initialDocumentIdRef.current,
      fileName: 'Unsaved Image 1',
      dirty: false,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      layers: [initialLayer],
      activeLayerId: initialLayer.id,
      history: historyRef.current,
      historyIndex: 0,
      cleanHistoryIndex: 0,
      zoom: 1,
      selection: null,
      floatingPixels: null,
      textEditor: null,
      reeditableTexts: [],
      reeditingText: null,
      lineDraft: null,
      shapeDraft: null,
      archivedShapeDrafts: [],
      shapeDraftOrder: [],
      gradientDraft: null,
    };
  }
  const documentsRef = useRef<DocumentSession[]>([initialDocumentSessionRef.current]);
  const [documents, setDocuments] = useState<DocumentTab[]>([documentTabOf(initialDocumentSessionRef.current)]);
  const [activeDocumentId, setActiveDocumentIdState] = useState(initialDocumentIdRef.current);
  const activeDocumentIdRef = useRef(activeDocumentId);
  const untitledCounterRef = useRef(2);
  const currentDocumentViewRef = useRef({ fileName, dirty, zoom, selection, floatingPixels: movingPixels });
  currentDocumentViewRef.current = { fileName, dirty, zoom, selection, floatingPixels: movingPixels };

  const updateSelection = useCallback(
    (next: Selection | null) => {
      selectionRef.current = next;
      currentDocumentViewRef.current.selection = next;
      const bounds = next ? normalizeSelection(next, dimensionsRef.current.width, dimensionsRef.current.height) : null;
      liveMetrics.selectionSize.publish(bounds ? { width: bounds.width, height: bounds.height } : null);
      if (!next && selectionCursorRef.current) {
        selectionCursorRef.current = '';
        setSelectionCursorState('');
      }
      setSelection(next);
    },
    [liveMetrics.selectionSize],
  );

  const updateFloatingPixels = useCallback((next: FloatingPixelsState | null) => {
    floatingPixelsRef.current = next;
    currentDocumentViewRef.current.floatingPixels = next;
    setMovingPixelsState(next);
  }, []);

  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const startRef = useRef<Point>({ x: 0, y: 0 });
  const lastRef = useRef<Point>({ x: 0, y: 0 });
  const moveSelectionRef = useRef<Selection | null>(null);
  const transformGestureRef = useRef<TransformGesture | null>(null);
  const lassoPointsRef = useRef<Point[]>([]);
  const freeformPointsRef = useRef<Point[]>([]);
  const shapeReverseRef = useRef(false);
  const lineDraftRef = useRef<EditableLineState | null>(lineDraft);
  lineDraftRef.current = lineDraft;
  const lineDragPointRef = useRef<number | null>(null);
  const lineTensionDragRef = useRef<{ index: number; last: Point } | null>(null);
  const shapeDraftRef = useRef<EditableShapeState | null>(shapeDraft);
  shapeDraftRef.current = shapeDraft;
  const shapeDragPointRef = useRef<number | null>(null);
  const gradientDraftRef = useRef<GradientDraftState | null>(gradientDraft);
  gradientDraftRef.current = gradientDraft;
  const gradientDragHandleRef = useRef<'start' | 'end' | 'new' | null>(null);
  const archivedShapeDraftsRef = useRef<StoredEditableDraft[]>(archivedShapeDrafts);
  archivedShapeDraftsRef.current = archivedShapeDrafts;
  const shapeDraftOrderRef = useRef<string[]>([]);
  const selectionGestureRef = useRef<{ previous: Selection | null; mode: SelectionMode } | null>(null);
  const selectionResizeRef = useRef<{ original: Selection; handle: SelectionResizeHandle; start: Point } | null>(null);
  const cloneSourceRef = useRef<Point | null>(null);
  const cloneOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const cloneStrokeRef = useRef<{ snapshot: HTMLCanvasElement; offsetX: number; offsetY: number } | null>(null);
  const recolorImageRef = useRef<ImageData | null>(null);
  const recolorReverseRef = useRef(false);
  const rasterStrokeBaselineRef = useRef<HTMLCanvasElement | null>(null);
  const rasterStrokeSelectionRef = useRef<Selection | null>(null);
  const rasterStrokeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const splatterTimerRef = useRef<number | null>(null);
  const effectBusyRef = useRef(false);
  const effectPreviewTokenRef = useRef(0);
  const effectRequestAbortRef = useRef<AbortController | null>(null);
  const textEditorRef = useRef(textEditor);
  textEditorRef.current = textEditor;
  const textMoveRef = useRef<{ start: Point; origin: Point } | null>(null);
  const reeditableTextsRef = useRef<ReeditableText[]>([]);
  const reeditingTextRef = useRef<ReeditableText | null>(null);
  const commitTextRef = useRef<() => boolean>(() => false);
  const finalizeShapeDraftsRef = useRef<() => boolean>(() => false);
  const commitPendingEditsRef = useRef<() => boolean>(() => false);
  const pushHistoryRef = useRef<(label: string) => void>(() => {});

  const setLayerList = useCallback((next: PaintLayer[]) => {
    layersRef.current = next;
    setLayers(next);
  }, []);

  const setActiveLayerId = useCallback((id: string) => {
    activeLayerIdRef.current = id;
    setActiveLayerIdState(id);
  }, []);

  const setDimensions = useCallback(
    (nextWidth: number, nextHeight: number) => {
      dimensionsRef.current = { width: nextWidth, height: nextHeight };
      const currentSelection = selectionRef.current;
      const bounds = currentSelection ? normalizeSelection(currentSelection, nextWidth, nextHeight) : null;
      liveMetrics.selectionSize.publish(bounds ? { width: bounds.width, height: bounds.height } : null);
      setWidth(nextWidth);
      setHeight(nextHeight);
    },
    [liveMetrics.selectionSize],
  );

  const setHistoryIndex = useCallback((index: number) => {
    historyIndexRef.current = index;
    setHistoryIndexState(index);
  }, []);

  const setActiveDocumentId = useCallback((id: string) => {
    activeDocumentIdRef.current = id;
    setActiveDocumentIdState(id);
  }, []);

  const publishDocumentTabs = useCallback(() => {
    setDocuments(documentsRef.current.map(documentTabOf));
  }, []);

  const publishPointer = useCallback(
    (point: Point) => {
      pointerRef.current = point;
      liveMetrics.pointer.publish(point);
    },
    [liveMetrics.pointer],
  );

  const publishSelectionCursor = useCallback((cursor: string) => {
    if (selectionCursorRef.current === cursor) return;
    selectionCursorRef.current = cursor;
    setSelectionCursorState(cursor);
  }, []);

  const resetTransientDocumentState = useCallback(() => {
    drawingRef.current = false;
    updateFloatingPixels(null);
    moveSelectionRef.current = null;
    transformGestureRef.current = null;
    lassoPointsRef.current = [];
    freeformPointsRef.current = [];
    lineDragPointRef.current = null;
    lineTensionDragRef.current = null;
    lineDraftRef.current = null;
    setLineDraft(null);
    shapeDragPointRef.current = null;
    shapeDraftRef.current = null;
    setShapeDraft(null);
    gradientDraftRef.current = null;
    setGradientDraft(null);
    gradientDragHandleRef.current = null;
    archivedShapeDraftsRef.current = [];
    setArchivedShapeDrafts([]);
    shapeDraftOrderRef.current = [];
    selectionGestureRef.current = null;
    selectionResizeRef.current = null;
    cloneSourceRef.current = null;
    cloneOffsetRef.current = null;
    cloneStrokeRef.current = null;
    recolorImageRef.current = null;
    rasterStrokeBaselineRef.current = null;
    rasterStrokeSelectionRef.current = null;
    rasterStrokeCanvasRef.current = null;
    if (splatterTimerRef.current !== null) window.clearInterval(splatterTimerRef.current);
    splatterTimerRef.current = null;
    setCloneSource(null);
    textEditorRef.current = null;
    setTextEditor(null);
    textMoveRef.current = null;
    reeditableTextsRef.current = [];
    reeditingTextRef.current = null;
  }, [updateFloatingPixels]);

  const captureActiveDocument = useCallback(() => {
    const session = documentsRef.current.find((candidate) => candidate.id === activeDocumentIdRef.current);
    if (!session) return;
    const view = currentDocumentViewRef.current;
    session.fileName = view.fileName;
    session.dirty = view.dirty;
    session.width = dimensionsRef.current.width;
    session.height = dimensionsRef.current.height;
    session.layers = layersRef.current;
    session.activeLayerId = activeLayerIdRef.current;
    session.history = historyRef.current;
    session.historyIndex = historyIndexRef.current;
    session.cleanHistoryIndex = cleanHistoryIndexRef.current;
    session.zoom = view.zoom;
    session.selection = view.selection;
    session.floatingPixels = view.floatingPixels;
    session.textEditor = textEditorRef.current ? { ...textEditorRef.current } : null;
    session.reeditableTexts = reeditableTextsRef.current;
    session.reeditingText = reeditingTextRef.current;
    session.lineDraft = lineDraftRef.current;
    session.shapeDraft = shapeDraftRef.current;
    session.archivedShapeDrafts = archivedShapeDraftsRef.current;
    session.shapeDraftOrder = [...shapeDraftOrderRef.current];
    session.gradientDraft = gradientDraftRef.current;
  }, []);

  const loadDocument = useCallback(
    (session: DocumentSession) => {
      setActiveDocumentId(session.id);
      setDimensions(session.width, session.height);
      setLayerList(session.layers);
      setActiveLayerId(session.activeLayerId);
      historyRef.current = session.history;
      setHistory(session.history);
      setHistoryIndex(session.historyIndex);
      cleanHistoryIndexRef.current = session.cleanHistoryIndex;
      setFileName(session.fileName);
      setDirty(session.dirty);
      setZoomState(session.zoom);
      resetTransientDocumentState();
      // Keep the imperative document snapshot in lockstep with the session we
      // just activated. File imports can finish before React has rendered the
      // preceding import; without this synchronous update, the next capture
      // can write the previous tab's name and dirty state into the new tab.
      currentDocumentViewRef.current = {
        fileName: session.fileName,
        dirty: session.dirty,
        zoom: session.zoom,
        selection: session.selection,
        floatingPixels: session.floatingPixels,
      };
      updateSelection(session.selection);
      updateFloatingPixels(session.floatingPixels);
      textEditorRef.current = session.textEditor ? { ...session.textEditor } : null;
      setTextEditor(session.textEditor ? { ...session.textEditor } : null);
      reeditableTextsRef.current = session.reeditableTexts;
      reeditingTextRef.current = session.reeditingText;
      lineDraftRef.current = session.lineDraft;
      setLineDraft(session.lineDraft);
      shapeDraftRef.current = session.shapeDraft;
      setShapeDraft(session.shapeDraft);
      archivedShapeDraftsRef.current = session.archivedShapeDrafts;
      setArchivedShapeDrafts(session.archivedShapeDrafts);
      shapeDraftOrderRef.current = [...session.shapeDraftOrder];
      gradientDraftRef.current = session.gradientDraft;
      setGradientDraft(session.gradientDraft);
      publishPointer({ x: 0, y: 0 });
      setRevision((value) => value + 1);
    },
    [
      publishPointer,
      resetTransientDocumentState,
      setActiveDocumentId,
      setActiveLayerId,
      setDimensions,
      setHistoryIndex,
      setLayerList,
      updateFloatingPixels,
      updateSelection,
    ],
  );

  const clearActiveDocument = useCallback(() => {
    resetTransientDocumentState();
    setActiveDocumentId('');
    setDimensions(DEFAULT_WIDTH, DEFAULT_HEIGHT);
    setLayerList([]);
    setActiveLayerId('');
    historyRef.current = [];
    setHistory([]);
    setHistoryIndex(0);
    cleanHistoryIndexRef.current = 0;
    currentDocumentViewRef.current = { fileName: '', dirty: false, zoom: 1, selection: null, floatingPixels: null };
    setFileName('');
    setDirty(false);
    setZoomState(1);
    updateSelection(null);
    updateFloatingPixels(null);
    publishPointer({ x: 0, y: 0 });
    setRevision((value) => value + 1);
  }, [
    publishPointer,
    resetTransientDocumentState,
    setActiveDocumentId,
    setActiveLayerId,
    setDimensions,
    setHistoryIndex,
    setLayerList,
    updateFloatingPixels,
    updateSelection,
  ]);

  useEffect(() => {
    let cancelled = false;
    const restoreWorkspace = async () => {
      try {
        if (consumeRestoreSkip()) {
          persistenceSuspendedRef.current = true;
          setPersistenceSuspended(true);
          setPersistenceSuspendedReason('skipped-restore');
          workspaceReadyRef.current = true;
          setWorkspaceReady(true);
          setWorkspaceSaveState('saved');
          return;
        }
        const stored = await loadWorkspace();
        if (stored?.documents.length) {
          const restoredResults = await Promise.allSettled(stored.documents.map(documentFromPersisted));
          const restored = restoredResults.flatMap((result) =>
            result.status === 'fulfilled' && result.value ? [result.value] : [],
          );
          if (!cancelled && restored.length) {
            documentsRef.current = restored;
            setRestoredDocumentIds(restored.map((session) => session.id));
            untitledCounterRef.current = Math.max(2, Math.round(stored.untitledCounter || 2));
            const active = restored.find((session) => session.id === stored.activeDocumentId) ?? restored[0];
            loadDocument(active);
            publishDocumentTabs();
          }
        } else if (stored && !cancelled) {
          documentsRef.current = [];
          untitledCounterRef.current = Math.max(2, Math.round(stored.untitledCounter || 2));
          clearActiveDocument();
          publishDocumentTabs();
        }
        if (!cancelled) {
          workspaceReadyRef.current = true;
          setWorkspaceReady(true);
          setWorkspaceSaveState('saved');
        }
      } catch (error) {
        if (cancelled) return;
        workspaceReadyRef.current = true;
        setWorkspaceReady(true);
        if (error instanceof WorkspaceVersionError) {
          // A newer build wrote this. Saving over it would destroy work the running bundle
          // cannot read, so stop writing entirely until the page picks up the update. The
          // banner explains it in place; a modal titled "failed to restore" would be wrong,
          // because nothing failed and nothing was lost.
          persistenceSuspendedRef.current = true;
          setPersistenceSuspended(true);
          setPersistenceSuspendedReason('newer-workspace');
          setWorkspaceSaveState('saved');
          return;
        }
        setWorkspaceSaveState('error');
        setWorkspaceErrorOperation('restore');
        setWorkspaceError(error instanceof Error ? error.message : 'The saved workspace could not be restored.');
      }
    };
    void restoreWorkspace();
    return () => {
      cancelled = true;
    };
  }, [clearActiveDocument, loadDocument, publishDocumentTabs]);

  const switchDocument = useCallback(
    (id: string) => {
      if (id === activeDocumentIdRef.current || effectBusyRef.current) return id === activeDocumentIdRef.current;
      const target = documentsRef.current.find((candidate) => candidate.id === id);
      if (!target) return false;
      commitPendingEditsRef.current();
      captureActiveDocument();
      loadDocument(target);
      publishDocumentTabs();
      return true;
    },
    [captureActiveDocument, loadDocument, publishDocumentTabs],
  );

  useEffect(() => {
    const active = documentsRef.current.find((candidate) => candidate.id === activeDocumentId);
    if (!active) return;
    active.fileName = fileName;
    active.dirty = dirty;
    active.width = width;
    active.height = height;
    active.zoom = zoom;
    active.selection = selection;
    publishDocumentTabs();
  }, [activeDocumentId, dirty, fileName, height, publishDocumentTabs, selection, width, zoom]);

  /**
   * `estimate()` is a real async call, so sample it at most once a minute rather than after
   * every debounced save. The threshold sits well below the point where writes start failing,
   * because the warning is only useful while there is still room to act on it.
   */
  const sampleStoragePressure = useCallback(async () => {
    const now = Date.now();
    if (now - lastStorageSampleRef.current < 60_000) return;
    lastStorageSampleRef.current = now;
    const pressure = await storagePressure();
    if (!pressure) return;
    setStoragePressure(pressure.ratio >= 0.85 ? pressure : null);
  }, []);

  const persistWorkspaceNow = useCallback(async () => {
    if (!workspaceReadyRef.current) return;
    captureActiveDocument();
    const sessions = [...documentsRef.current];
    const workspace: PersistedWorkspace = {
      version: 2,
      activeDocumentId: activeDocumentIdRef.current,
      untitledCounter: untitledCounterRef.current,
      savedAt: Date.now(),
      documents: await Promise.all(sessions.map((session) => persistedDocumentOf(session, persistHistory))),
    };
    await saveWorkspace(workspace);
    await sampleStoragePressure();
  }, [captureActiveDocument, persistHistory, sampleStoragePressure]);

  useEffect(() => {
    if (!workspaceReady || persistenceSuspended) return;
    const generation = ++workspaceSaveGenerationRef.current;
    if (workspaceSaveTimerRef.current !== null) window.clearTimeout(workspaceSaveTimerRef.current);
    setWorkspaceSaveState('saving');
    workspaceSaveTimerRef.current = window.setTimeout(() => {
      workspaceSaveTimerRef.current = null;
      workspaceSaveChainRef.current = workspaceSaveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (generation !== workspaceSaveGenerationRef.current) return;
          try {
            await persistWorkspaceNow();
            if (generation === workspaceSaveGenerationRef.current) {
              setWorkspaceError('');
              setWorkspaceErrorOperation(null);
              setWorkspaceSaveState('saved');
            }
          } catch (error) {
            if (generation === workspaceSaveGenerationRef.current) {
              setWorkspaceError(error instanceof Error ? error.message : 'The workspace could not be saved.');
              setWorkspaceErrorOperation('save');
              setWorkspaceSaveState('error');
            }
          }
        });
    }, 450);
    return () => {
      if (workspaceSaveTimerRef.current !== null) {
        window.clearTimeout(workspaceSaveTimerRef.current);
        workspaceSaveTimerRef.current = null;
      }
    };
  }, [
    activeDocumentId,
    archivedShapeDrafts,
    dirty,
    documents,
    gradientDraft,
    height,
    layers,
    lineDraft,
    persistenceSuspended,
    persistHistory,
    persistWorkspaceNow,
    revision,
    selection,
    shapeDraft,
    textEditor,
    width,
    workspaceReady,
    zoom,
  ]);

  useEffect(() => {
    const persistBeforeLeaving = () => {
      if (!workspaceReadyRef.current || persistenceSuspendedRef.current) return;
      // Browsers may invalidate canvas backing stores while a page is being hidden or torn down.
      // This is a best-effort final flush and there is no live UI left to report through; letting
      // its rejection escape creates an unhandled InvalidStateError in the departing page.
      void persistWorkspaceNow().catch(() => undefined);
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') persistBeforeLeaving();
    };
    window.addEventListener('pagehide', persistBeforeLeaving);
    document.addEventListener('visibilitychange', persistWhenHidden);
    return () => {
      window.removeEventListener('pagehide', persistBeforeLeaving);
      document.removeEventListener('visibilitychange', persistWhenHidden);
    };
  }, [persistWorkspaceNow]);

  const renderComposite = useCallback((target: HTMLCanvasElement | null = displayCanvasRef.current) => {
    if (!target) return;
    if (target.width !== dimensionsRef.current.width) target.width = dimensionsRef.current.width;
    if (target.height !== dimensionsRef.current.height) target.height = dimensionsRef.current.height;
    const context = context2d(target);
    context.clearRect(0, 0, target.width, target.height);
    for (const layer of layersRef.current) {
      paintLayer(context, layer);
    }
  }, []);

  useEffect(() => {
    renderComposite();
    const preview = previewCanvasRef.current;
    if (preview && (preview.width !== width || preview.height !== height)) {
      preview.width = width;
      preview.height = height;
    }
  }, [height, layers, renderComposite, revision, width]);

  useEffect(() => {
    const preview = previewCanvasRef.current;
    if (!preview) return;
    const context = context2d(preview);
    context.clearRect(0, 0, preview.width, preview.height);
    if (movingPixels) drawFloatingPixels(context, movingPixels);
    const draftsById = new Map<string, StoredEditableDraft>();
    for (const archived of archivedShapeDrafts) draftsById.set(archived.draft.id, archived);
    if (lineDraft) draftsById.set(lineDraft.id, { kind: 'line', draft: lineDraft });
    if (shapeDraft) draftsById.set(shapeDraft.id, { kind: 'shape', draft: shapeDraft });
    for (const id of shapeDraftOrderRef.current) {
      const stored = draftsById.get(id);
      if (!stored) continue;
      if (stored.kind === 'line') {
        drawEditableLine(
          context,
          stored.draft,
          stored.draft.options,
          stored.draft.id === lineDraft?.id && tool === 'line',
          zoom,
        );
      } else {
        drawEditableShape(
          context,
          stored.draft,
          stored.draft.options,
          stored.draft.id === shapeDraft?.id && stored.draft.tool === tool,
          zoom,
        );
      }
    }
    if (gradientDraft && tool === 'gradient') {
      context.save();
      context.lineWidth = Math.max(1, 1 / zoom);
      context.setLineDash([4 / zoom, 3 / zoom]);
      context.strokeStyle = '#ffffff';
      context.beginPath();
      context.moveTo(gradientDraft.start.x, gradientDraft.start.y);
      context.lineTo(gradientDraft.end.x, gradientDraft.end.y);
      context.stroke();
      context.setLineDash([]);
      for (const [index, point] of [gradientDraft.start, gradientDraft.end].entries()) {
        context.beginPath();
        context.arc(point.x, point.y, Math.max(3, 5 / zoom), 0, Math.PI * 2);
        context.fillStyle = index === 0 ? '#ffffff' : '#4da3ff';
        context.fill();
        context.strokeStyle = '#17324d';
        context.stroke();
      }
      context.restore();
    }
    if (tool === 'clone-stamp' && cloneSource) {
      context.save();
      context.strokeStyle = '#4da3ff';
      context.lineWidth = 1;
      context.setLineDash([3, 2]);
      context.beginPath();
      context.arc(cloneSource.x, cloneSource.y, Math.max(3, brushSize / 2), 0, Math.PI * 2);
      context.moveTo(cloneSource.x - 5, cloneSource.y);
      context.lineTo(cloneSource.x + 5, cloneSource.y);
      context.moveTo(cloneSource.x, cloneSource.y - 5);
      context.lineTo(cloneSource.x, cloneSource.y + 5);
      context.stroke();
      context.restore();
    }
  }, [archivedShapeDrafts, brushSize, cloneSource, gradientDraft, lineDraft, movingPixels, shapeDraft, tool, zoom]);

  useEffect(() => {
    const overlay = selectionCanvasRef.current;
    if (!overlay) return;
    if (overlay.width !== width) overlay.width = width;
    if (overlay.height !== height) overlay.height = height;
    drawSelectionOverlay(overlay, selection, tool, zoom);
    if (!selection || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let animationFrame = 0;
    let lastPhase = 0;
    const animate = (timestamp: number) => {
      const phase = Math.floor(timestamp / 80);
      if (phase !== lastPhase) {
        lastPhase = phase;
        drawSelectionOverlay(overlay, selection, tool, zoom, phase);
      }
      animationFrame = window.requestAnimationFrame(animate);
    };
    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [height, selection, tool, width, zoom]);

  const hasSelection =
    selection !== null &&
    normalizeSelection(selection, width, height).width > 0 &&
    normalizeSelection(selection, width, height).height > 0;
  const selectionBounds = hasSelection && selection ? normalizeSelection(selection, width, height) : null;
  const selectionResizable = hasSelection && isResizableSelection(selection, tool);

  const pushHistory = useCallback(
    (label: string, nextLayers = layersRef.current) => {
      // Any pixel-producing command finalizes the active layer's old text
      // engine. A later Text commit installs a fresh re-editable record after
      // this history checkpoint, while records on untouched layers survive.
      reeditableTextsRef.current = reeditableTextsRef.current.filter(
        (record) => record.layerId !== activeLayerIdRef.current,
      );
      const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
      const previousEntry = trimmed.at(-1);
      if (previousEntry && trimmed.length < historyRef.current.length) {
        // The redo tail is being discarded, and the surviving newest entry may be rebuilding
        // itself from entries that are about to go. Make it whole again before it becomes the
        // thing the new entry is diffed against.
        for (const layer of previousEntry.layers) promoteToAnchor(layer.pixels);
      }
      const entry = snapshotOf(
        nextLayers,
        activeLayerIdRef.current,
        dimensionsRef.current.width,
        dimensionsRef.current.height,
        label,
        selectionRef.current,
        floatingPixelsRef.current,
        trimmed.at(-1),
      );
      // A layer whose pixel node is shared with the previous entry did not change, so its
      // thumbnail does not need redrawing. Read this before the demotion below: demotion leaves
      // node identity alone, but taking the pristine state first keeps the ordering obviously
      // correct rather than incidentally so.
      const previousPixels = new Map(trimmed.at(-1)?.layers.map((layer) => [layer.id, layer.pixels]));
      const capturedPixels = new Map(entry.layers.map((layer) => [layer.id, layer.pixels]));
      const revisedLayers = nextLayers.map((layer) =>
        previousPixels.get(layer.id) !== capturedPixels.get(layer.id)
          ? { ...layer, revision: layer.revision + 1 }
          : layer,
      );
      if (revisedLayers.some((layer, index) => layer !== nextLayers[index])) setLayerList(revisedLayers);
      if (previousEntry && !shouldAnchorAt(trimmed.length - 1)) {
        // The entry that was newest no longer needs a full copy of anything: it can be rebuilt
        // from the entry that just replaced it. This is where the memory is actually saved —
        // a brush stroke now costs its own bounding box instead of a copy of the whole layer.
        const replacements = new Map(entry.layers.map((layer) => [layer.id, layer.pixels]));
        for (const layer of previousEntry.layers) {
          const replacement = replacements.get(layer.id);
          // A shared node means the layer did not change, so there is nothing to diff.
          if (replacement && replacement !== layer.pixels) demoteToDiff(layer.pixels, replacement);
        }
      }
      let nextCleanIndex = cleanHistoryIndexRef.current;
      if (nextCleanIndex > historyIndexRef.current) nextCleanIndex = -1;
      let next = [...trimmed, entry];
      // Measured after demotion, so the budget sees what the entries actually cost.
      const evictFrom = firstAffordableHistoryIndex(next, historyByteBudget());
      if (evictFrom > 0) {
        next = next.slice(evictFrom);
        // Marking the survivor rather than tracking a flag keeps the notice attached to this
        // document's stack, so switching tabs cannot show it against the wrong history.
        next[0] = { ...next[0], evicted: true };
        // A discarded clean checkpoint can no longer prove the document is unmodified.
        nextCleanIndex = nextCleanIndex >= evictFrom ? nextCleanIndex - evictFrom : -1;
      }
      cleanHistoryIndexRef.current = nextCleanIndex;
      historyRef.current = next;
      setHistory(next);
      setHistoryIndex(next.length - 1);
      currentDocumentViewRef.current.dirty = true;
      setDirty(true);
      setRevision((value) => value + 1);
    },
    [setHistoryIndex, setLayerList],
  );
  pushHistoryRef.current = (label) => pushHistory(label);

  const currentShapeOptions = useCallback(
    (reverseColors = false): ShapeDrawingOptions => ({
      primary,
      secondary,
      size: brushSize,
      fillStyle: shapeFillStyle,
      dashStyle: shapeDashStyle,
      arrowStart: lineArrowStart,
      arrowEnd: lineArrowEnd,
      arrowSize: lineArrowSize,
      arrowAngle: lineArrowAngle,
      arrowLength: lineArrowLength,
      roundedRadius: roundedRectangleRadius,
      gradientType,
      gradientColorMode,
      reverseColors,
    }),
    [
      brushSize,
      gradientColorMode,
      gradientType,
      lineArrowAngle,
      lineArrowEnd,
      lineArrowLength,
      lineArrowSize,
      lineArrowStart,
      primary,
      roundedRectangleRadius,
      secondary,
      shapeDashStyle,
      shapeFillStyle,
    ],
  );

  const applyShapeOptions = useCallback(
    (options: ShapeDrawingOptions) => {
      setPrimary(options.primary);
      setSecondary(options.secondary);
      setBrushSize(options.size);
      setShapeFillStyle(options.fillStyle);
      setShapeDashStyle(options.dashStyle);
      setLineArrowStart(options.arrowStart);
      setLineArrowEnd(options.arrowEnd);
      setLineArrowSize(options.arrowSize);
      setLineArrowAngle(options.arrowAngle ?? 15);
      setLineArrowLength(options.arrowLength ?? 10);
      setRoundedRectangleRadius(options.roundedRadius);
      setGradientType(options.gradientType);
      setGradientColorMode(options.gradientColorMode);
    },
    [
      setBrushSize,
      setGradientColorMode,
      setGradientType,
      setLineArrowAngle,
      setLineArrowEnd,
      setLineArrowLength,
      setLineArrowSize,
      setLineArrowStart,
      setPrimary,
      setRoundedRectangleRadius,
      setSecondary,
      setShapeDashStyle,
      setShapeFillStyle,
    ],
  );

  const updateGradientDraft = useCallback(
    (next: GradientDraftState | null, render = true) => {
      gradientDraftRef.current = next;
      setGradientDraft(next);
      if (!next || !render) return;
      const layer = layersRef.current.find((candidate) => candidate.id === next.layerId);
      if (!layer) return;
      renderGradientDraftToLayer(layer, next, alphaBlendingMode);
      renderComposite();
    },
    [alphaBlendingMode, renderComposite],
  );

  const finalizeGradient = useCallback(() => {
    if (!gradientDraftRef.current) return false;
    gradientDragHandleRef.current = null;
    updateGradientDraft(null, false);
    pushHistory('Gradient Finalized');
    return true;
  }, [pushHistory, updateGradientDraft]);

  useEffect(() => {
    const draft = gradientDraftRef.current;
    if (!draft) return;
    updateGradientDraft({
      ...draft,
      options: currentShapeOptions(draft.reverseColors),
    });
  }, [alphaBlendingMode, currentShapeOptions, updateGradientDraft]);

  const renderDraftToActiveLayer = useCallback(
    (draw: (context: CanvasRenderingContext2D) => void) => {
      const layer = layersRef.current.find((candidate) => candidate.id === activeLayerIdRef.current);
      if (!layer) return false;
      const draft = makeCanvas(dimensionsRef.current.width, dimensionsRef.current.height);
      const context = context2d(draft);
      draw(context);
      if (!shapeAntialiasing) removeAntialiasing(context);
      if (selection) {
        const bounds = normalizeSelection(selection, draft.width, draft.height);
        const fullMask = makeCanvas(draft.width, draft.height);
        context2d(fullMask).drawImage(createSelectionMask(bounds), bounds.x, bounds.y);
        context.globalCompositeOperation = 'destination-in';
        context.drawImage(fullMask, 0, 0);
        context.globalCompositeOperation = 'source-over';
      }
      context2d(layer.canvas).drawImage(draft, 0, 0);
      return true;
    },
    [selection, shapeAntialiasing],
  );

  const updateLineDraft = useCallback((next: EditableLineState | null) => {
    lineDraftRef.current = next;
    setLineDraft(next);
  }, []);

  const cancelLine = useCallback(() => {
    const id = lineDraftRef.current?.id;
    if (id) shapeDraftOrderRef.current = shapeDraftOrderRef.current.filter((candidate) => candidate !== id);
    lineDragPointRef.current = null;
    lineTensionDragRef.current = null;
    updateLineDraft(null);
  }, [updateLineDraft]);

  const commitLine = useCallback(() => {
    return finalizeShapeDraftsRef.current();
  }, []);

  const deleteLinePoint = useCallback(() => {
    const draft = lineDraftRef.current;
    if (!draft || draft.points.length <= 2) return false;
    const points = draft.points.filter((_, index) => index !== draft.selectedPoint);
    const tensions = draft.tensions.filter((_, index) => index !== draft.selectedPoint);
    updateLineDraft({ ...draft, points, tensions, selectedPoint: Math.min(draft.selectedPoint, points.length - 1) });
    return true;
  }, [updateLineDraft]);

  const setSelectedLineTension = useCallback(
    (tension: number) => {
      const draft = lineDraftRef.current;
      if (!draft || !draft.points[draft.selectedPoint]) return false;
      const tensions = [...draft.tensions];
      tensions[draft.selectedPoint] = Math.max(0, Math.min(1, tension));
      updateLineDraft({ ...draft, tensions });
      return true;
    },
    [updateLineDraft],
  );

  const nudgeLinePoint = useCallback(
    (dx: number, dy: number) => {
      const draft = lineDraftRef.current;
      if (!draft || !draft.points[draft.selectedPoint]) return false;
      const points = [...draft.points];
      const point = points[draft.selectedPoint];
      points[draft.selectedPoint] = {
        x: Math.max(0, Math.min(dimensionsRef.current.width, point.x + dx)),
        y: Math.max(0, Math.min(dimensionsRef.current.height, point.y + dy)),
      };
      updateLineDraft({ ...draft, points });
      return true;
    },
    [updateLineDraft],
  );

  const updateShapeDraft = useCallback((next: EditableShapeState | null) => {
    shapeDraftRef.current = next;
    setShapeDraft(next);
  }, []);

  const updateArchivedShapeDrafts = useCallback((next: StoredEditableDraft[]) => {
    archivedShapeDraftsRef.current = next;
    setArchivedShapeDrafts(next);
  }, []);

  const removeDraftFromOrder = useCallback((id: string) => {
    shapeDraftOrderRef.current = shapeDraftOrderRef.current.filter((candidate) => candidate !== id);
  }, []);

  const archiveCurrentLine = useCallback(() => {
    const current = lineDraftRef.current;
    if (!current) return false;
    if (isRenderableLineDraft(current)) {
      updateArchivedShapeDrafts([...archivedShapeDraftsRef.current, { kind: 'line', draft: current }]);
    } else {
      removeDraftFromOrder(current.id);
    }
    lineDragPointRef.current = null;
    lineTensionDragRef.current = null;
    updateLineDraft(null);
    return true;
  }, [removeDraftFromOrder, updateArchivedShapeDrafts, updateLineDraft]);

  const archiveCurrentShape = useCallback(() => {
    const current = shapeDraftRef.current;
    if (!current) return false;
    if (isRenderableShapeDraft(current)) {
      updateArchivedShapeDrafts([...archivedShapeDraftsRef.current, { kind: 'shape', draft: current }]);
    } else {
      removeDraftFromOrder(current.id);
    }
    shapeDragPointRef.current = null;
    updateShapeDraft(null);
    return true;
  }, [removeDraftFromOrder, updateArchivedShapeDrafts, updateShapeDraft]);

  const activateArchivedDraft = useCallback(
    (id: string) => {
      const stored = archivedShapeDraftsRef.current.find((candidate) => candidate.draft.id === id);
      if (!stored) return false;
      let next = archivedShapeDraftsRef.current.filter((candidate) => candidate.draft.id !== id);
      if (stored.kind === 'line') {
        const current = lineDraftRef.current;
        if (current && current.id !== id) {
          if (isRenderableLineDraft(current)) next = [...next, { kind: 'line', draft: current }];
          else removeDraftFromOrder(current.id);
        }
        updateLineDraft(stored.draft);
      } else {
        const current = shapeDraftRef.current;
        if (current && current.id !== id) {
          if (isRenderableShapeDraft(current)) next = [...next, { kind: 'shape', draft: current }];
          else removeDraftFromOrder(current.id);
        }
        updateShapeDraft(stored.draft);
      }
      updateArchivedShapeDrafts(next);
      applyShapeOptions(stored.draft.options);
      return true;
    },
    [applyShapeOptions, removeDraftFromOrder, updateArchivedShapeDrafts, updateLineDraft, updateShapeDraft],
  );

  useEffect(() => {
    if (tool === 'line' && lineDraftRef.current) {
      const current = lineDraftRef.current;
      updateLineDraft({ ...current, options: currentShapeOptions(current.reverseColors) });
    } else if (EDITABLE_BOUNDS_TOOLS.includes(tool as EditableBoundsTool) && shapeDraftRef.current?.tool === tool) {
      const current = shapeDraftRef.current;
      updateShapeDraft({ ...current, options: currentShapeOptions(current.reverseColors) });
    }
  }, [currentShapeOptions, tool, updateLineDraft, updateShapeDraft]);

  const cancelShape = useCallback(() => {
    const id = shapeDraftRef.current?.id;
    if (id) shapeDraftOrderRef.current = shapeDraftOrderRef.current.filter((candidate) => candidate !== id);
    shapeDragPointRef.current = null;
    updateShapeDraft(null);
  }, [updateShapeDraft]);

  const commitShape = useCallback(() => {
    return finalizeShapeDraftsRef.current();
  }, []);

  const nudgeShapePoint = useCallback(
    (dx: number, dy: number) => {
      const draft = shapeDraftRef.current;
      if (!draft || !draft.points[draft.selectedPoint]) return false;
      const current = draft.points[draft.selectedPoint];
      const nextPoint = {
        x: Math.max(0, Math.min(dimensionsRef.current.width, current.x + dx)),
        y: Math.max(0, Math.min(dimensionsRef.current.height, current.y + dy)),
      };
      updateShapeDraft(moveRectangularControlPoint(draft, draft.selectedPoint, nextPoint));
      return true;
    },
    [updateShapeDraft],
  );

  const finalizeShapeDrafts = useCallback(() => {
    const line = lineDraftRef.current;
    const shape = shapeDraftRef.current;
    const draftsById = new Map<string, StoredEditableDraft>();
    for (const archived of archivedShapeDraftsRef.current) draftsById.set(archived.draft.id, archived);
    if (line) draftsById.set(line.id, { kind: 'line', draft: line });
    if (shape) draftsById.set(shape.id, { kind: 'shape', draft: shape });
    if (!draftsById.size) return false;
    let rendered = false;
    for (const id of shapeDraftOrderRef.current) {
      const stored = draftsById.get(id);
      if (!stored) continue;
      if (stored.kind === 'line' && isRenderableLineDraft(stored.draft)) {
        rendered =
          renderDraftToActiveLayer((context) => drawEditableLine(context, stored.draft, stored.draft.options)) ||
          rendered;
      } else if (stored.kind === 'shape' && isRenderableShapeDraft(stored.draft)) {
        rendered =
          renderDraftToActiveLayer((context) => drawEditableShape(context, stored.draft, stored.draft.options)) ||
          rendered;
      }
    }
    lineDragPointRef.current = null;
    lineTensionDragRef.current = null;
    shapeDragPointRef.current = null;
    updateLineDraft(null);
    updateShapeDraft(null);
    updateArchivedShapeDrafts([]);
    shapeDraftOrderRef.current = [];
    if (rendered) pushHistory('Finalize Shapes');
    return rendered;
  }, [pushHistory, renderDraftToActiveLayer, updateArchivedShapeDrafts, updateLineDraft, updateShapeDraft]);
  finalizeShapeDraftsRef.current = finalizeShapeDrafts;

  const cancelText = useCallback(() => {
    const reediting = reeditingTextRef.current;
    if (reediting) {
      const layer = layersRef.current.find((candidate) => candidate.id === reediting.layerId);
      if (layer) {
        const context = context2d(layer.canvas);
        context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        context.drawImage(reediting.renderedCanvas, 0, 0);
        renderComposite();
      }
    }
    reeditingTextRef.current = null;
    textEditorRef.current = null;
    setTextEditor(null);
  }, [renderComposite]);

  const commitText = useCallback(() => {
    const editor = textEditorRef.current;
    if (!editor) return false;
    if (!editor.value.length) {
      cancelText();
      return false;
    }
    const layer = layersRef.current.find((candidate) => candidate.id === activeLayerIdRef.current);
    if (!layer) {
      cancelText();
      return false;
    }
    const options: TextDrawingOptions = {
      fontFamily: textFontFamily,
      fontSize: textFontSize,
      fontWeight: textFontWeight,
      italic: textItalic,
      underline: textUnderline,
      alignment: textAlignment,
      style: textStyle,
      variant: textVariant,
      outlineWidth: textOutlineWidth,
      lineJoin: textLineJoin,
      primary,
      secondary,
    };
    const reediting = reeditingTextRef.current;
    const baseCanvas = reediting?.baseCanvas ?? cloneCanvas(layer.canvas);
    const draft = makeCanvas(dimensionsRef.current.width, dimensionsRef.current.height);
    const draftContext = context2d(draft);
    drawTextEditor(draftContext, editor, options);
    if (!shapeAntialiasing) removeAntialiasing(draftContext);
    if (selection) {
      const bounds = normalizeSelection(selection, draft.width, draft.height);
      const fullMask = makeCanvas(draft.width, draft.height);
      context2d(fullMask).drawImage(createSelectionMask(bounds), bounds.x, bounds.y);
      draftContext.globalCompositeOperation = 'destination-in';
      draftContext.drawImage(fullMask, 0, 0);
      draftContext.globalCompositeOperation = 'source-over';
    }
    context2d(layer.canvas).drawImage(draft, 0, 0);
    textEditorRef.current = null;
    setTextEditor(null);
    pushHistory('Text');
    const record: ReeditableText = {
      editor: { ...editor },
      options,
      bounds: textEditorBounds(editor, options),
      layerId: layer.id,
      historyIndex: historyIndexRef.current,
      baseCanvas,
      renderedCanvas: cloneCanvas(layer.canvas),
    };
    reeditableTextsRef.current = [
      ...reeditableTextsRef.current.filter((candidate) => candidate.layerId !== layer.id),
      record,
    ];
    reeditingTextRef.current = null;
    return true;
  }, [
    cancelText,
    primary,
    pushHistory,
    secondary,
    selection,
    shapeAntialiasing,
    textAlignment,
    textFontFamily,
    textFontSize,
    textFontWeight,
    textItalic,
    textLineJoin,
    textOutlineWidth,
    textStyle,
    textUnderline,
    textVariant,
  ]);
  commitTextRef.current = commitText;

  const commitFloatingPixels = useCallback(() => {
    const floating = floatingPixelsRef.current;
    if (!floating) return false;
    const layer = layersRef.current.find((candidate) => candidate.id === floating.layerId);
    if (!layer) {
      updateFloatingPixels(null);
      return false;
    }
    drawFloatingPixels(context2d(layer.canvas), floating);
    updateFloatingPixels(null);
    pushHistory('Finish Selected Pixels');
    return true;
  }, [pushHistory, updateFloatingPixels]);

  const commitPendingEdits = useCallback(() => {
    const textCommitted = commitTextRef.current();
    const shapesCommitted = finalizeShapeDraftsRef.current();
    const pixelsCommitted = commitFloatingPixels();
    const gradientCommitted = finalizeGradient();
    return textCommitted || shapesCommitted || pixelsCommitted || gradientCommitted;
  }, [commitFloatingPixels, finalizeGradient]);
  commitPendingEditsRef.current = commitPendingEdits;

  const setTool = useCallback(
    (nextTool: ToolId) => {
      if (nextTool !== tool && tool === 'lasso-select' && lassoMode === 'polygon' && selectionGestureRef.current) {
        updateSelection(selectionGestureRef.current.previous);
        selectionGestureRef.current = null;
        lassoPointsRef.current = [];
      }
      const staysInEditableShapeFamily = EDITABLE_SHAPE_TOOLS.includes(tool) && EDITABLE_SHAPE_TOOLS.includes(nextTool);
      if (nextTool !== tool && !staysInEditableShapeFamily) commitPendingEditsRef.current();
      if (
        nextTool !== tool &&
        staysInEditableShapeFamily &&
        EDITABLE_BOUNDS_TOOLS.includes(tool as EditableBoundsTool) &&
        EDITABLE_BOUNDS_TOOLS.includes(nextTool as EditableBoundsTool) &&
        shapeDraftRef.current?.tool !== nextTool
      ) {
        archiveCurrentShape();
      }
      if (nextTool !== tool) previousToolRef.current = tool;
      setToolState(nextTool);
    },
    [archiveCurrentShape, lassoMode, setToolState, tool, updateSelection],
  );

  const beginText = useCallback((point: Point) => {
    commitPendingEditsRef.current();
    reeditableTextsRef.current = reeditableTextsRef.current.filter(
      (record) => record.layerId !== activeLayerIdRef.current,
    );
    reeditingTextRef.current = null;
    const next = { x: point.x, y: point.y, value: '' };
    textEditorRef.current = next;
    setTextEditor(next);
  }, []);

  const beginReeditingText = useCallback(
    (point: Point) => {
      const record = reeditableTextsRef.current.find((candidate) => candidate.layerId === activeLayerIdRef.current);
      if (!record) return false;
      if (
        point.x < record.bounds.x ||
        point.y < record.bounds.y ||
        point.x > record.bounds.x + record.bounds.width ||
        point.y > record.bounds.y + record.bounds.height
      )
        return false;
      const layer = layersRef.current.find((candidate) => candidate.id === record.layerId);
      if (!layer) return false;
      if (!canvasesHaveSamePixels(layer.canvas, record.renderedCanvas)) {
        reeditableTextsRef.current = reeditableTextsRef.current.filter((candidate) => candidate !== record);
        return false;
      }
      const context = context2d(layer.canvas);
      context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      context.drawImage(record.baseCanvas, 0, 0);
      setToolSetting('primary', record.options.primary);
      setToolSetting('secondary', record.options.secondary);
      setToolSetting('textFontFamily', record.options.fontFamily);
      setToolSetting('textFontSize', record.options.fontSize);
      setToolSetting('textFontWeight', record.options.fontWeight);
      setToolSetting('textItalic', record.options.italic);
      setToolSetting('textUnderline', record.options.underline);
      setToolSetting('textAlignment', record.options.alignment);
      setToolSetting('textStyle', record.options.style);
      setToolSetting('textVariant', record.options.variant);
      setToolSetting('textOutlineWidth', record.options.outlineWidth);
      setToolSetting('textLineJoin', record.options.lineJoin);
      reeditingTextRef.current = record;
      textEditorRef.current = { ...record.editor };
      setTextEditor({ ...record.editor });
      renderComposite();
      return true;
    },
    [renderComposite, setToolSetting],
  );

  const updateText = useCallback((value: string) => {
    const current = textEditorRef.current;
    if (!current) return;
    const next = { ...current, value };
    textEditorRef.current = next;
    setTextEditor(next);
  }, []);

  const moveText = useCallback((x: number, y: number) => {
    const current = textEditorRef.current;
    if (!current) return;
    const next = {
      ...current,
      x,
      y,
    };
    textEditorRef.current = next;
    setTextEditor(next);
  }, []);

  const restoreHistory = useCallback(
    (index: number) => {
      commitPendingEditsRef.current();
      const entry = historyRef.current[index];
      if (!entry) return;
      const restored = entry.layers.map(layerFromSnapshot);
      setDimensions(entry.width, entry.height);
      setLayerList(restored);
      setActiveLayerId(entry.activeLayerId);
      setHistoryIndex(index);
      const nextDirty = index !== cleanHistoryIndexRef.current;
      currentDocumentViewRef.current.dirty = nextDirty;
      setDirty(nextDirty);
      updateSelection(selectionFromSnapshot(entry.selection));
      updateFloatingPixels(floatingPixelsFromSnapshot(entry.floatingPixels));
      updateGradientDraft(null, false);
      cloneSourceRef.current = null;
      cloneOffsetRef.current = null;
      setCloneSource(null);
      setRevision((value) => value + 1);
    },
    [
      setActiveLayerId,
      setDimensions,
      setHistoryIndex,
      setLayerList,
      updateFloatingPixels,
      updateGradientDraft,
      updateSelection,
    ],
  );

  const undo = useCallback(() => {
    if (
      textEditorRef.current ||
      lineDraftRef.current ||
      shapeDraftRef.current ||
      gradientDraftRef.current ||
      archivedShapeDraftsRef.current.length
    ) {
      const committed = commitPendingEditsRef.current();
      if (committed && historyIndexRef.current > 0) restoreHistory(historyIndexRef.current - 1);
      return;
    }
    if (historyIndexRef.current > 0) restoreHistory(historyIndexRef.current - 1);
  }, [restoreHistory]);

  const redo = useCallback(() => {
    if (
      textEditorRef.current ||
      lineDraftRef.current ||
      shapeDraftRef.current ||
      gradientDraftRef.current ||
      archivedShapeDraftsRef.current.length
    ) {
      commitPendingEditsRef.current();
      return;
    }
    if (historyIndexRef.current < history.length - 1) restoreHistory(historyIndexRef.current + 1);
  }, [history.length, restoreHistory]);

  const {
    newDocument,
    newDocumentFromCanvas,
    openFile,
    saveImage,
    saveAllImages,
    createCompositeDataUrl,
    closeDocument,
    closeAllDocuments,
  } = useFileCommands({
    layersRef,
    dimensionsRef,
    documentsRef,
    activeDocumentIdRef,
    historyIndexRef,
    cleanHistoryIndexRef,
    untitledCounterRef,
    currentDocumentViewRef,
    effectBusyRef,
    commitPendingEditsRef,
    captureActiveDocument,
    loadDocument,
    clearActiveDocument,
    publishDocumentTabs,
    setFileName,
    setDirty,
    secondary,
  });

  const {
    activeLayer,
    addLayer,
    importLayerFromFile,
    duplicateLayer,
    deleteLayer,
    mergeLayerDown,
    moveLayer,
    flipLayer,
    clearLayerTransformPreview,
    previewLayerProperties,
    previewRotateZoomLayer,
    rotateZoomLayer,
    flattenImage,
    toggleLayer,
    renameLayer,
    updateLayerProperties,
  } = useLayerCommands({
    layersRef,
    activeLayerIdRef,
    dimensionsRef,
    previewCanvasRef,
    commitPendingEditsRef,
    pushHistory,
    setLayerList,
    setActiveLayerId,
    width,
    height,
  });

  const {
    selectAll,
    deselect,
    copySelection,
    copyMerged,
    clipboardPngBlob,
    importClipboardImage,
    eraseCurrentSelection,
    cutSelection,
    paste,
    pasteIntoNewLayer,
    pasteIntoNewImage,
    fillSelection,
    invertSelection,
    offsetSelection,
  } = useSelectionCommands({
    layersRef,
    activeLayerIdRef,
    dimensionsRef,
    selectionRef,
    floatingPixelsRef,
    clipboardRef,
    selection,
    activeLayer,
    primary,
    newDocumentFromCanvas,
    commitPendingEditsRef,
    pushHistoryRef,
    pushHistory,
    setLayerList,
    setActiveLayerId,
    setDimensions,
    setHasClipboard,
    setClipboardSize,
    setTool,
    updateSelection,
    updateFloatingPixels,
  });

  const { cropToSelection, autoCropImage, resizeImage, resizeCanvas, flipImage, rotateImage, clearActiveLayer } =
    useImageCommands({
      layersRef,
      dimensionsRef,
      commitPendingEditsRef,
      selection,
      eraseCurrentSelection,
      pushHistory,
      setDimensions,
      setLayerList,
      updateSelection,
    });

  const { clearEffectPreview, getActiveHistogram, previewEffect, applyEffect, cancelEffect } = useEffectRunner({
    layersRef,
    activeLayerIdRef,
    selectionRef,
    historyIndexRef,
    previewCanvasRef,
    commitPendingEditsRef,
    effectBusyRef,
    effectPreviewTokenRef,
    effectRequestAbortRef,
    activeLayer,
    palette,
    primary,
    secondary,
    recentColors,
    pushHistory,
    setEffectBusy,
    setEffectProgress,
  });

  const setZoom = useCallback((value: number) => {
    setZoomState(clampZoom(value));
  }, []);

  const clearPreview = useCallback(() => {
    const preview = previewCanvasRef.current;
    if (preview) context2d(preview).clearRect(0, 0, preview.width, preview.height);
  }, []);

  const eventPoint = useCallback(
    (event: ReactPointerEvent<HTMLElement>): Point => {
      const bounds = event.currentTarget.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(width, (event.clientX - bounds.left) * (width / bounds.width))),
        y: Math.max(0, Math.min(height, (event.clientY - bounds.top) * (height / bounds.height))),
      };
    },
    [height, width],
  );

  const determineSelectionMode = useCallback(
    (event: ReactPointerEvent<HTMLElement>): SelectionMode => {
      if (event.button === 2) return event.ctrlKey || event.metaKey ? 'xor' : 'exclude';
      if (event.ctrlKey || event.metaKey) return 'union';
      if (event.altKey) return 'intersect';
      return selectionMode;
    },
    [selectionMode],
  );

  const updateSelectionGesture = useCallback(
    (point: Point, constrain = false) => {
      const gesture = selectionGestureRef.current;
      if (!gesture) return;
      let nextSelection: Selection;
      if (tool === 'lasso-select') {
        const lastPoint = lassoPointsRef.current.at(-1);
        if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= 1.5)
          lassoPointsRef.current.push(point);
        const points = lassoPointsRef.current;
        const xs = points.map((item) => item.x);
        const ys = points.map((item) => item.y);
        nextSelection = {
          tool,
          start: { x: Math.min(...xs), y: Math.min(...ys) },
          end: { x: Math.max(...xs), y: Math.max(...ys) },
          points: [...points],
        };
      } else {
        const end =
          constrain && (tool === 'rectangle-select' || tool === 'ellipse-select')
            ? constrainSelectionPoint(
                startRef.current,
                point,
                dimensionsRef.current.width,
                dimensionsRef.current.height,
              )
            : point;
        nextSelection = { tool, start: startRef.current, end };
      }
      updateSelection(
        combineSelectionMasks(
          gesture.previous,
          nextSelection,
          gesture.mode,
          dimensionsRef.current.width,
          dimensionsRef.current.height,
        ),
      );
    },
    [tool, updateSelection],
  );

  const finishPolygonLasso = useCallback(() => {
    const gesture = selectionGestureRef.current;
    if (tool !== 'lasso-select' || lassoMode !== 'polygon' || !gesture) return false;
    if (lassoPointsRef.current.length < 3) {
      updateSelection(gesture.previous);
      selectionGestureRef.current = null;
      lassoPointsRef.current = [];
      return false;
    }
    selectionGestureRef.current = null;
    lassoPointsRef.current = [];
    pushHistory('Select');
    return true;
  }, [lassoMode, pushHistory, tool, updateSelection]);

  const removePolygonLassoPoint = useCallback(() => {
    const gesture = selectionGestureRef.current;
    if (tool !== 'lasso-select' || lassoMode !== 'polygon' || !gesture || !lassoPointsRef.current.length) return false;
    lassoPointsRef.current.pop();
    const lastPoint = lassoPointsRef.current.at(-1);
    if (!lastPoint) {
      updateSelection(gesture.previous);
      selectionGestureRef.current = null;
      return true;
    }
    updateSelectionGesture(lastPoint);
    return true;
  }, [lassoMode, tool, updateSelection, updateSelectionGesture]);

  const cancelPolygonLasso = useCallback(() => {
    const gesture = selectionGestureRef.current;
    if (tool !== 'lasso-select' || lassoMode !== 'polygon' || !gesture) return false;
    updateSelection(gesture.previous);
    selectionGestureRef.current = null;
    lassoPointsRef.current = [];
    return true;
  }, [lassoMode, tool, updateSelection]);

  const drawStroke = useCallback(
    (from: Point, to: Point) => {
      const layer = activeLayer();
      if (!layer) return;
      const strokeCanvas = rasterStrokeCanvasRef.current;
      const context = context2d(strokeCanvas ?? layer.canvas);

      if (tool === 'clone-stamp') {
        const clone = cloneStrokeRef.current;
        if (!clone) return;
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        const steps = Math.max(1, Math.ceil(distance / Math.max(1, brushSize / 4)));
        for (let step = 0; step <= steps; step += 1) {
          const amount = step / steps;
          const x = from.x + (to.x - from.x) * amount;
          const y = from.y + (to.y - from.y) * amount;
          context.save();
          context.beginPath();
          context.arc(x, y, Math.max(0.5, brushSize / 2), 0, Math.PI * 2);
          context.clip();
          context.drawImage(clone.snapshot, clone.offsetX, clone.offsetY);
          context.restore();
        }
        constrainCanvasMutationToSelection(
          layer.canvas,
          rasterStrokeBaselineRef.current,
          rasterStrokeSelectionRef.current,
        );
        renderComposite();
        return;
      }

      if (tool === 'recolor') {
        const image = recolorImageRef.current;
        if (!image) return;
        const target = colorToRgba(recolorReverseRef.current ? primary : secondary);
        const replacement = colorToRgba(recolorReverseRef.current ? secondary : primary);
        const threshold = recolorColorTolerance(recolorTolerance);
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        const steps = Math.max(1, Math.ceil(distance / Math.max(1, brushSize / 3)));
        for (let step = 0; step <= steps; step += 1) {
          const amount = step / steps;
          const centerX = Math.round(from.x + (to.x - from.x) * amount);
          const centerY = Math.round(from.y + (to.y - from.y) * amount);
          const radius = Math.max(1, brushSize / 2);
          const minX = Math.max(0, Math.floor(centerX - radius));
          const maxX = Math.min(image.width - 1, Math.ceil(centerX + radius));
          const minY = Math.max(0, Math.floor(centerY - radius));
          const maxY = Math.min(image.height - 1, Math.ceil(centerY + radius));
          for (let y = minY; y <= maxY; y += 1) {
            for (let x = minX; x <= maxX; x += 1) {
              if ((x - centerX) ** 2 + (y - centerY) ** 2 > radius ** 2) continue;
              const index = (y * image.width + x) * 4;
              if (
                !colorDifferenceWithinTolerance(
                  image.data[index],
                  image.data[index + 1],
                  image.data[index + 2],
                  image.data[index + 3],
                  [target.r, target.g, target.b, target.a],
                  threshold,
                )
              )
                continue;
              image.data[index] = clampByte(replacement.r + image.data[index] - target.r);
              image.data[index + 1] = clampByte(replacement.g + image.data[index + 1] - target.g);
              image.data[index + 2] = clampByte(replacement.b + image.data[index + 2] - target.b);
            }
          }
        }
        context.putImageData(image, 0, 0);
        constrainCanvasMutationToSelection(
          layer.canvas,
          rasterStrokeBaselineRef.current,
          rasterStrokeSelectionRef.current,
        );
        renderComposite();
        return;
      }

      context.save();
      configureStroke(context, tool, primary, brushSize, eraserType, alphaBlendingMode);
      if (strokeCanvas && tool === 'eraser') {
        context.globalCompositeOperation = 'source-over';
        context.strokeStyle = '#ffffff';
        context.fillStyle = '#ffffff';
      }
      if (tool === 'paintbrush')
        drawPaintBrushSegment(
          context,
          paintBrushType,
          from,
          to,
          primary,
          brushSize,
          slashBrushAngle,
          splatterMinimumSize,
          splatterMaximumSize,
        );
      else if (tool === 'block-brush') {
        const halfWidth = Math.max(0.5, brushSize);
        const endY = Math.abs(to.y - from.y) < 0.001 ? to.y + 1 : to.y;
        context.beginPath();
        context.moveTo(from.x - halfWidth, from.y);
        context.lineTo(from.x + halfWidth, from.y);
        context.lineTo(to.x + halfWidth, endY);
        context.lineTo(to.x - halfWidth, endY);
        context.closePath();
        context.fill();
      } else {
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
      }
      context.restore();
      if (strokeCanvas) {
        if (!shapeAntialiasing) {
          const sourceAlpha =
            tool === 'eraser'
              ? eraserType === 'smooth'
                ? 255 * 0.45
                : 255
              : colorToRgba(primary).a *
                (tool === 'paintbrush' && (paintBrushType === 'circles' || paintBrushType === 'grid') ? 0.05 : 1);
          removeAntialiasing(context, Math.max(1, Math.round(sourceAlpha)));
        }
        const baseline = rasterStrokeBaselineRef.current;
        const layerContext = context2d(layer.canvas);
        layerContext.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        if (baseline) layerContext.drawImage(baseline, 0, 0);
        if (tool === 'eraser') {
          layerContext.save();
          layerContext.globalCompositeOperation = 'destination-out';
          layerContext.drawImage(strokeCanvas, 0, 0);
          layerContext.restore();
        } else {
          layerContext.drawImage(strokeCanvas, 0, 0);
        }
      }
      constrainCanvasMutationToSelection(
        layer.canvas,
        rasterStrokeBaselineRef.current,
        rasterStrokeSelectionRef.current,
      );
      renderComposite();
    },
    [
      activeLayer,
      alphaBlendingMode,
      brushSize,
      eraserType,
      paintBrushType,
      primary,
      recolorTolerance,
      renderComposite,
      secondary,
      shapeAntialiasing,
      slashBrushAngle,
      splatterMaximumSize,
      splatterMinimumSize,
      tool,
    ],
  );

  const nudgeTransform = useCallback(
    (dx: number, dy: number) => {
      if (tool !== 'move-selection' && tool !== 'move-pixels') return false;
      let activeSelection = selectionRef.current;
      if (!activeSelection && tool === 'move-pixels') {
        activeSelection = {
          tool: 'rectangle-select',
          start: { x: 0, y: 0 },
          end: { x: dimensionsRef.current.width, y: dimensionsRef.current.height },
        };
      }
      if (!activeSelection) return false;

      if (tool === 'move-pixels' && !floatingPixelsRef.current) {
        const layer = activeLayer();
        if (!layer) return false;
        const bounds = normalizeSelection(activeSelection, dimensionsRef.current.width, dimensionsRef.current.height);
        const pixels = copySelectionToCanvas(layer.canvas, bounds);
        const context = context2d(layer.canvas);
        context.save();
        context.globalCompositeOperation = 'destination-out';
        context.drawImage(createSelectionMask(bounds), bounds.x, bounds.y);
        context.restore();
        updateFloatingPixels({
          layerId: layer.id,
          canvas: pixels,
          transform: translationTransform(bounds.x, bounds.y),
        });
        renderComposite();
      }

      const delta = translationTransform(dx, dy);
      updateSelection(
        transformSelection(activeSelection, delta, dimensionsRef.current.width, dimensionsRef.current.height),
      );
      const floating = floatingPixelsRef.current;
      if (tool === 'move-pixels' && floating)
        updateFloatingPixels({
          ...floating,
          transform: multiplyTransforms(delta, floating.transform),
        });
      pushHistory(tool === 'move-pixels' ? 'Move Selected Pixels' : 'Move Selection');
      return true;
    },
    [activeLayer, pushHistory, renderComposite, tool, updateFloatingPixels, updateSelection],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const point = eventPoint(event);
      publishPointer(point);
      event.currentTarget.setPointerCapture(event.pointerId);
      startRef.current = point;
      lastRef.current = point;

      if (event.button === 0 && (tool === 'rectangle-select' || tool === 'ellipse-select')) {
        const resizeHandle = selectionResizeHandleAtPoint(
          selection,
          tool,
          point,
          dimensionsRef.current.width,
          dimensionsRef.current.height,
          zoom,
        );
        if (resizeHandle && selection) {
          const bounds = normalizeSelection(selection, dimensionsRef.current.width, dimensionsRef.current.height);
          selectionResizeRef.current = {
            original: {
              tool,
              start: { x: bounds.x, y: bounds.y },
              end: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
            },
            handle: resizeHandle,
            start: point,
          };
          selectionGestureRef.current = null;
          drawingRef.current = true;
          return;
        }
      }

      if (tool === 'lasso-select' && lassoMode === 'polygon') {
        if (!selectionGestureRef.current) {
          selectionGestureRef.current = { previous: selection, mode: determineSelectionMode(event) };
          lassoPointsRef.current = [point];
        } else {
          const previousPoint = lassoPointsRef.current.at(-1);
          if (!previousPoint || Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) >= 1.5) {
            lassoPointsRef.current.push(point);
          }
        }
        updateSelectionGesture(point);
        return;
      }

      if (tool === 'move-selection' || tool === 'move-pixels') {
        let activeSelection = selectionRef.current;
        if (!activeSelection && tool === 'move-pixels') {
          activeSelection = {
            tool: 'rectangle-select',
            start: { x: 0, y: 0 },
            end: { x: dimensionsRef.current.width, y: dimensionsRef.current.height },
          };
          updateSelection(activeSelection);
        }
        if (!activeSelection) return;

        let originalTransform: AffineTransform | null = null;
        if (tool === 'move-pixels') {
          const layer = activeLayer();
          if (!layer) return;
          let floating = floatingPixelsRef.current;
          if (!floating) {
            const bounds = normalizeSelection(
              activeSelection,
              dimensionsRef.current.width,
              dimensionsRef.current.height,
            );
            if (bounds.width < 1 || bounds.height < 1) return;
            const pixels = copySelectionToCanvas(layer.canvas, bounds);
            const context = context2d(layer.canvas);
            context.save();
            context.globalCompositeOperation = 'destination-out';
            context.drawImage(createSelectionMask(bounds), bounds.x, bounds.y);
            context.restore();
            floating = {
              layerId: layer.id,
              canvas: pixels,
              transform: translationTransform(bounds.x, bounds.y),
            };
            updateFloatingPixels(floating);
            renderComposite();
          }
          originalTransform = { ...floating.transform };
        }

        const bounds = normalizeSelection(activeSelection, dimensionsRef.current.width, dimensionsRef.current.height);
        moveSelectionRef.current = activeSelection;
        transformGestureRef.current = {
          mode: event.button === 2 ? 'rotate' : event.ctrlKey || event.metaKey ? 'scale' : 'translate',
          start: point,
          center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
          originalSelection: activeSelection,
          originalTransform,
        };
        drawingRef.current = true;
        return;
      }

      if (tool === 'magic-wand') {
        const layer = activeLayer();
        if (layer) {
          const nextSelection = magicWandSelection(
            layer.canvas,
            point.x,
            point.y,
            magicWandTolerance,
            floodMode === 'global' || event.shiftKey,
          );
          updateSelection(
            combineSelectionMasks(
              selection,
              nextSelection,
              determineSelectionMode(event),
              dimensionsRef.current.width,
              dimensionsRef.current.height,
            ),
          );
          pushHistory('Magic Wand Selection');
        }
        return;
      }

      if (tool === 'clone-stamp') {
        if (event.ctrlKey || event.metaKey) {
          cloneSourceRef.current = point;
          cloneOffsetRef.current = null;
          setCloneSource(point);
          return;
        }
        const source = cloneSourceRef.current;
        const layer = activeLayer();
        if (!source || !layer) return;
        const snapshot = makeCanvas(layer.canvas.width, layer.canvas.height);
        context2d(snapshot).drawImage(layer.canvas, 0, 0);
        const offset = cloneOffsetRef.current ?? { x: point.x - source.x, y: point.y - source.y };
        cloneOffsetRef.current = offset;
        cloneStrokeRef.current = {
          snapshot,
          offsetX: offset.x,
          offsetY: offset.y,
        };
        rasterStrokeSelectionRef.current = selectionRef.current;
        rasterStrokeBaselineRef.current = selectionRef.current ? cloneCanvas(layer.canvas) : null;
        rasterStrokeCanvasRef.current = null;
        drawingRef.current = true;
        drawStroke(point, { x: point.x + 0.01, y: point.y + 0.01 });
        return;
      }

      if (tool === 'recolor') {
        const layer = activeLayer();
        if (!layer) return;
        recolorImageRef.current = context2d(layer.canvas).getImageData(0, 0, layer.canvas.width, layer.canvas.height);
        recolorReverseRef.current = event.button === 2;
        rasterStrokeSelectionRef.current = selectionRef.current;
        rasterStrokeBaselineRef.current = selectionRef.current ? cloneCanvas(layer.canvas) : null;
        rasterStrokeCanvasRef.current = null;
        drawingRef.current = true;
        drawStroke(point, { x: point.x + 0.01, y: point.y + 0.01 });
        return;
      }

      if (tool === 'zoom') {
        setZoom(event.altKey ? zoomOutLevel(zoom) : zoomInLevel(zoom));
        return;
      }

      if (tool === 'color-picker') {
        const layer = activeLayer();
        if (colorPickerSampleType === 'image') renderComposite();
        const source = colorPickerSampleType === 'layer' ? layer?.canvas : displayCanvasRef.current;
        if (source) {
          const color = sampleCanvasColor(source, point, colorPickerSampleSize);
          if (event.button === 2) setSecondary(color);
          else setPrimary(color);
        }
        if (colorPickerAfterSelect === 'previous') setTool(previousToolRef.current);
        if (colorPickerAfterSelect === 'pencil') setTool('pencil');
        return;
      }

      if (tool === 'paint-bucket') {
        const layer = activeLayer();
        if (layer) {
          const activeSelection = selectionRef.current;
          const before = activeSelection ? cloneCanvas(layer.canvas) : null;
          const allowedMask = activeSelection
            ? context2d(selectionMaskOnCanvas(activeSelection, layer.canvas.width, layer.canvas.height)).getImageData(
                0,
                0,
                layer.canvas.width,
                layer.canvas.height,
              ).data
            : undefined;
          const changed = floodFill(
            layer.canvas,
            point.x,
            point.y,
            event.button === 2 ? secondary : primary,
            paintBucketTolerance,
            floodMode === 'global' || event.shiftKey,
            allowedMask,
          );
          if (!changed) return;
          constrainCanvasMutationToSelection(layer.canvas, before, activeSelection);
          pushHistory('Paint Bucket');
        }
        return;
      }

      if (tool === 'text') {
        if (event.button === 2) {
          const current = textEditorRef.current;
          if (!current) return;
          textMoveRef.current = { start: point, origin: { x: current.x, y: current.y } };
          drawingRef.current = true;
          return;
        }
        if (event.button !== 0) return;
        if ((event.ctrlKey || event.metaKey) && beginReeditingText(point)) return;
        beginText(point);
        return;
      }

      if (tool === 'line') {
        const current = lineDraftRef.current;
        const hitRadius = Math.max(4, 9 / zoom);
        if (current && event.button === 0 && (event.ctrlKey || event.metaKey)) {
          const origin = current.points[current.selectedPoint] ?? current.points.at(-1)!;
          archiveCurrentLine();
          const next: EditableLineState = {
            id: makeId(),
            points: [origin, point],
            tensions: [0, 0],
            selectedPoint: 1,
            reverseColors: false,
            options: currentShapeOptions(),
          };
          shapeDraftOrderRef.current.push(next.id);
          updateLineDraft(next);
          lineDragPointRef.current = 1;
          drawingRef.current = true;
          return;
        }
        if (current) {
          const handleIndex = current.points.findIndex(
            (candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= hitRadius,
          );
          if (handleIndex >= 0) {
            updateLineDraft({ ...current, selectedPoint: handleIndex });
            if (event.button === 0) {
              lineDragPointRef.current = handleIndex;
              lineTensionDragRef.current = null;
            } else {
              lineDragPointRef.current = null;
              lineTensionDragRef.current = { index: handleIndex, last: point };
            }
            drawingRef.current = true;
            return;
          }
          if (event.button !== 0) return;
          let segmentIndex = -1;
          let segmentDistance = Number.POSITIVE_INFINITY;
          for (let index = 0; index < current.points.length - 1; index += 1) {
            const distance = distanceToSegment(point, current.points[index], current.points[index + 1]);
            if (distance < segmentDistance) {
              segmentDistance = distance;
              segmentIndex = index;
            }
          }
          if (segmentIndex >= 0 && segmentDistance <= hitRadius) {
            const points = [...current.points];
            const tensions = [...current.tensions];
            points.splice(segmentIndex + 1, 0, point);
            tensions.splice(segmentIndex + 1, 0, 1 / 3);
            updateLineDraft({ ...current, points, tensions, selectedPoint: segmentIndex + 1 });
            lineDragPointRef.current = segmentIndex + 1;
            drawingRef.current = true;
            return;
          }
        }
        if (event.button !== 0) return;
        const archivedHit = [...archivedShapeDraftsRef.current]
          .reverse()
          .find((stored) => stored.kind === 'line' && distanceToLineDraft(point, stored.draft) <= hitRadius);
        if (archivedHit) {
          activateArchivedDraft(archivedHit.draft.id);
          return;
        }
        archiveCurrentLine();
        const next: EditableLineState = {
          id: makeId(),
          points: [point, point],
          tensions: [0, 0],
          selectedPoint: 1,
          reverseColors: false,
          options: currentShapeOptions(),
        };
        shapeDraftOrderRef.current.push(next.id);
        updateLineDraft(next);
        lineDragPointRef.current = 1;
        drawingRef.current = true;
        return;
      }

      if (EDITABLE_BOUNDS_TOOLS.includes(tool as EditableBoundsTool)) {
        const current = shapeDraftRef.current;
        const hitRadius = Math.max(4, 9 / zoom);
        if (current) {
          const handleIndex = current.points.findIndex(
            (candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= hitRadius,
          );
          if (handleIndex >= 0) {
            updateShapeDraft({ ...current, selectedPoint: handleIndex });
            shapeDragPointRef.current = handleIndex;
            drawingRef.current = true;
            return;
          }
          if (distanceToShapeDraft(point, current) <= hitRadius) return;
        }
        if (event.button === 0) {
          const archivedHit = [...archivedShapeDraftsRef.current]
            .reverse()
            .find(
              (stored) =>
                stored.kind === 'shape' &&
                stored.draft.tool === tool &&
                distanceToShapeDraft(point, stored.draft) <= hitRadius,
            );
          if (archivedHit) {
            activateArchivedDraft(archivedHit.draft.id);
            return;
          }
        }
        archiveCurrentShape();
        const next: EditableShapeState = {
          id: makeId(),
          tool: tool as EditableBoundsTool,
          points: rectangularControlPoints(point, point),
          selectedPoint: 2,
          reverseColors: event.button === 2,
          options: currentShapeOptions(event.button === 2),
        };
        shapeDraftOrderRef.current.push(next.id);
        updateShapeDraft(next);
        shapeDragPointRef.current = 2;
        drawingRef.current = true;
        return;
      }

      if (tool === 'freeform') {
        freeformPointsRef.current = [point];
        shapeReverseRef.current = event.button === 2;
        drawingRef.current = true;
        return;
      }

      if (tool === 'gradient') {
        const layer = activeLayer();
        if (!layer) return;
        const current = gradientDraftRef.current;
        const hitRadius = Math.max(4, 9 / zoom);
        if (current) {
          const startDistance = Math.hypot(point.x - current.start.x, point.y - current.start.y);
          const endDistance = Math.hypot(point.x - current.end.x, point.y - current.end.y);
          if (Math.min(startDistance, endDistance) <= hitRadius) {
            gradientDragHandleRef.current = startDistance <= endDistance ? 'start' : 'end';
            drawingRef.current = true;
            return;
          }
        }
        const next: GradientDraftState = {
          layerId: layer.id,
          start: point,
          end: point,
          reverseColors: event.button === 2,
          options: currentShapeOptions(event.button === 2),
          selection: selectionRef.current,
          baseCanvas: cloneCanvas(layer.canvas),
        };
        gradientDragHandleRef.current = 'new';
        updateGradientDraft(next, false);
        drawingRef.current = true;
        return;
      }

      if (DRAWING_TOOLS.includes(tool)) {
        const layer = activeLayer();
        const usesToolLayer = tool === 'paintbrush' || tool === 'block-brush' || tool === 'eraser';
        rasterStrokeSelectionRef.current = selectionRef.current;
        rasterStrokeBaselineRef.current =
          layer && (selectionRef.current || usesToolLayer) ? cloneCanvas(layer.canvas) : null;
        rasterStrokeCanvasRef.current =
          layer && usesToolLayer ? makeCanvas(layer.canvas.width, layer.canvas.height) : null;
        drawingRef.current = true;
        drawStroke(point, { x: point.x + 0.01, y: point.y + 0.01 });
        if (tool === 'paintbrush' && paintBrushType === 'splatter') {
          if (splatterTimerRef.current !== null) window.clearInterval(splatterTimerRef.current);
          splatterTimerRef.current = window.setInterval(() => {
            if (!drawingRef.current) return;
            drawStroke(lastRef.current, { x: lastRef.current.x + 0.01, y: lastRef.current.y + 0.01 });
          }, 100);
        }
        return;
      }

      if (SHAPE_TOOLS.includes(tool) || SELECTION_TOOLS.includes(tool)) {
        drawingRef.current = true;
        if (SHAPE_TOOLS.includes(tool)) shapeReverseRef.current = event.button === 2;
        if (SELECTION_TOOLS.includes(tool)) {
          const mode = determineSelectionMode(event);
          selectionGestureRef.current = { previous: selection, mode };
          if (tool === 'lasso-select') {
            lassoPointsRef.current = [point];
            const nextSelection: Selection = { tool, start: point, end: point, points: [point] };
            updateSelection(
              combineSelectionMasks(
                selection,
                nextSelection,
                mode,
                dimensionsRef.current.width,
                dimensionsRef.current.height,
              ),
            );
          } else {
            const nextSelection: Selection = { tool, start: point, end: point };
            updateSelection(
              combineSelectionMasks(
                selection,
                nextSelection,
                mode,
                dimensionsRef.current.width,
                dimensionsRef.current.height,
              ),
            );
          }
        }
      }
    },
    [
      activateArchivedDraft,
      activeLayer,
      archiveCurrentLine,
      archiveCurrentShape,
      beginReeditingText,
      beginText,
      colorPickerAfterSelect,
      colorPickerSampleSize,
      colorPickerSampleType,
      currentShapeOptions,
      determineSelectionMode,
      drawStroke,
      eventPoint,
      floodMode,
      lassoMode,
      magicWandTolerance,
      paintBrushType,
      paintBucketTolerance,
      primary,
      publishPointer,
      pushHistory,
      renderComposite,
      secondary,
      selection,
      setPrimary,
      setSecondary,
      setTool,
      setZoom,
      tool,
      updateFloatingPixels,
      updateGradientDraft,
      updateLineDraft,
      updateSelection,
      updateSelectionGesture,
      updateShapeDraft,
      zoom,
    ],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const point = eventPoint(event);
      publishPointer(point);
      if (!drawingRef.current) {
        const resizeHandle = selectionResizeHandleAtPoint(
          selectionRef.current,
          tool,
          point,
          dimensionsRef.current.width,
          dimensionsRef.current.height,
          zoom,
        );
        publishSelectionCursor(resizeHandle ? SELECTION_RESIZE_CURSORS[resizeHandle] : '');
        return;
      }

      if (tool === 'text' && textMoveRef.current) {
        const drag = textMoveRef.current;
        moveText(drag.origin.x + point.x - drag.start.x, drag.origin.y + point.y - drag.start.y);
        return;
      }

      if (selectionResizeRef.current) {
        const resize = selectionResizeRef.current;
        updateSelection(
          resizeSelection(
            resize.original,
            resize.handle,
            point,
            dimensionsRef.current.width,
            dimensionsRef.current.height,
            event.shiftKey,
          ),
        );
        return;
      }

      if (tool === 'line' && lineTensionDragRef.current) {
        const drag = lineTensionDragRef.current;
        const draft = lineDraftRef.current;
        const current = draft?.points[drag.index];
        if (!draft || !current) return;
        const previous = draft.points[drag.index - 1] ?? current;
        const next = draft.points[drag.index + 1] ?? current;
        const midpoint = { x: (previous.x + next.x) / 2, y: (previous.y + next.y) / 2 };
        const xDifference = previous.x - next.x;
        const yDifference = previous.y - next.y;
        const totalDifference = xDifference + yDifference;
        const xChange = current.x <= midpoint.x ? point.x - drag.last.x : drag.last.x - point.x;
        const yChange = current.y <= midpoint.y ? point.y - drag.last.y : drag.last.y - point.y;
        const rawChange =
          Math.abs(totalDifference) < 0.001
            ? (drag.last.y - point.y) / 50
            : Math.round(Math.max(-1, Math.min(1, (xChange * yDifference + yChange * xDifference) / totalDifference))) /
              50;
        const tensions = [...draft.tensions];
        tensions[drag.index] = Math.max(0, Math.min(1, (tensions[drag.index] ?? 0) + rawChange));
        lineTensionDragRef.current = { ...drag, last: point };
        updateLineDraft({ ...draft, tensions, selectedPoint: drag.index });
        return;
      }

      if (tool === 'line' && lineDragPointRef.current !== null) {
        const draft = lineDraftRef.current;
        const index = lineDragPointRef.current;
        if (!draft || !draft.points[index]) return;
        const anchor = index > 0 ? draft.points[index - 1] : draft.points[1];
        const nextPoint = event.shiftKey && anchor ? constrainLinePoint(anchor, point) : point;
        const points = [...draft.points];
        points[index] = nextPoint;
        updateLineDraft({ ...draft, points, selectedPoint: index });
        return;
      }

      if (EDITABLE_BOUNDS_TOOLS.includes(tool as EditableBoundsTool) && shapeDragPointRef.current !== null) {
        const draft = shapeDraftRef.current;
        const index = shapeDragPointRef.current;
        if (!draft || !draft.points[index]) return;
        const opposite = draft.points[(index + 2) % 4];
        const nextPoint = event.shiftKey ? constrainShapePoint(opposite, point) : point;
        updateShapeDraft(moveRectangularControlPoint(draft, index, nextPoint));
        return;
      }

      if (tool === 'freeform') {
        const lastPoint = freeformPointsRef.current.at(-1);
        if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= 1.5)
          freeformPointsRef.current.push(point);
        const preview = previewCanvasRef.current;
        if (!preview) return;
        const context = context2d(preview);
        context.clearRect(0, 0, preview.width, preview.height);
        drawFreeformShape(context, freeformPointsRef.current, currentShapeOptions(shapeReverseRef.current));
        return;
      }

      if (tool === 'gradient' && gradientDragHandleRef.current && gradientDraftRef.current) {
        const draft = gradientDraftRef.current;
        updateGradientDraft(
          gradientDragHandleRef.current === 'start' ? { ...draft, start: point } : { ...draft, end: point },
        );
        return;
      }

      if ((tool === 'move-selection' || tool === 'move-pixels') && transformGestureRef.current) {
        const gesture = transformGestureRef.current;
        const delta = transformDelta(gesture, point, event.shiftKey);
        updateSelection(
          transformSelection(
            gesture.originalSelection,
            delta,
            dimensionsRef.current.width,
            dimensionsRef.current.height,
          ),
        );
        if (tool === 'move-pixels' && gesture.originalTransform) {
          const floating = floatingPixelsRef.current;
          if (floating)
            updateFloatingPixels({
              ...floating,
              transform: multiplyTransforms(delta, gesture.originalTransform),
            });
        }
        return;
      }

      if (DRAWING_TOOLS.includes(tool)) {
        drawStroke(lastRef.current, point);
        lastRef.current = point;
        return;
      }

      if (SELECTION_TOOLS.includes(tool)) {
        if (tool !== 'magic-wand') updateSelectionGesture(point, event.shiftKey);
        return;
      }

      if (SHAPE_TOOLS.includes(tool)) {
        const preview = previewCanvasRef.current;
        if (!preview) return;
        const context = context2d(preview);
        context.clearRect(0, 0, preview.width, preview.height);
        const previewPoint =
          event.shiftKey && tool !== 'gradient' ? constrainShapePoint(startRef.current, point) : point;
        drawShape(context, tool, startRef.current, previewPoint, currentShapeOptions(shapeReverseRef.current));
      }
    },
    [
      currentShapeOptions,
      drawStroke,
      eventPoint,
      moveText,
      publishPointer,
      publishSelectionCursor,
      tool,
      updateFloatingPixels,
      updateGradientDraft,
      updateLineDraft,
      updateSelection,
      updateSelectionGesture,
      updateShapeDraft,
      zoom,
    ],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!drawingRef.current) return;
      const point = eventPoint(event);
      drawingRef.current = false;

      if (tool === 'text' && textMoveRef.current) {
        const drag = textMoveRef.current;
        moveText(drag.origin.x + point.x - drag.start.x, drag.origin.y + point.y - drag.start.y);
        textMoveRef.current = null;
        return;
      }

      if (selectionResizeRef.current) {
        const resize = selectionResizeRef.current;
        if (Math.hypot(point.x - resize.start.x, point.y - resize.start.y) < Math.max(1, 3 / zoom)) {
          updateSelection(null);
          selectionResizeRef.current = null;
          pushHistory('Deselect');
          return;
        }
        updateSelection(
          resizeSelection(
            resize.original,
            resize.handle,
            point,
            dimensionsRef.current.width,
            dimensionsRef.current.height,
            event.shiftKey,
          ),
        );
        selectionResizeRef.current = null;
        pushHistory('Resize Selection');
        return;
      }

      if (tool === 'line') {
        const draft = lineDraftRef.current;
        const index = lineDragPointRef.current;
        if (draft && index !== null && draft.points[index]) {
          const anchor = index > 0 ? draft.points[index - 1] : draft.points[1];
          const nextPoint = event.shiftKey && anchor ? constrainLinePoint(anchor, point) : point;
          const points = [...draft.points];
          points[index] = nextPoint;
          updateLineDraft({ ...draft, points, selectedPoint: index });
        }
        lineDragPointRef.current = null;
        lineTensionDragRef.current = null;
        return;
      }

      if (EDITABLE_BOUNDS_TOOLS.includes(tool as EditableBoundsTool)) {
        const draft = shapeDraftRef.current;
        const index = shapeDragPointRef.current;
        if (draft && index !== null && draft.points[index]) {
          const opposite = draft.points[(index + 2) % 4];
          const nextPoint = event.shiftKey ? constrainShapePoint(opposite, point) : point;
          updateShapeDraft(moveRectangularControlPoint(draft, index, nextPoint));
        }
        shapeDragPointRef.current = null;
        return;
      }

      if (tool === 'freeform') {
        const points = [...freeformPointsRef.current, point];
        freeformPointsRef.current = [];
        clearPreview();
        if (
          points.length >= 3 &&
          renderDraftToActiveLayer((context) =>
            drawFreeformShape(context, points, currentShapeOptions(shapeReverseRef.current)),
          )
        ) {
          pushHistory('Freeform Shape');
        }
        return;
      }

      if (tool === 'gradient' && gradientDragHandleRef.current && gradientDraftRef.current) {
        const handle = gradientDragHandleRef.current;
        const draft = gradientDraftRef.current;
        updateGradientDraft(handle === 'start' ? { ...draft, start: point } : { ...draft, end: point });
        gradientDragHandleRef.current = null;
        pushHistory(handle === 'new' ? 'Gradient Created' : 'Gradient Modified');
        return;
      }

      if (tool === 'move-selection' && transformGestureRef.current) {
        transformGestureRef.current = null;
        moveSelectionRef.current = null;
        pushHistory('Move Selection');
        return;
      }

      if (tool === 'move-pixels' && transformGestureRef.current) {
        transformGestureRef.current = null;
        moveSelectionRef.current = null;
        pushHistory('Move Selected Pixels');
        return;
      }

      if (SELECTION_TOOLS.includes(tool)) {
        const gesture = selectionGestureRef.current;
        const completedFreeformLasso = tool === 'lasso-select' && lassoPointsRef.current.length >= 3;
        if (
          tool !== 'magic-wand' &&
          !completedFreeformLasso &&
          Math.hypot(point.x - startRef.current.x, point.y - startRef.current.y) < Math.max(1, 3 / zoom)
        ) {
          updateSelection(null);
          selectionGestureRef.current = null;
          lassoPointsRef.current = [];
          if (gesture?.previous) pushHistory('Deselect');
          return;
        }
        if (tool !== 'magic-wand') updateSelectionGesture(point, event.shiftKey);
        selectionGestureRef.current = null;
        pushHistory('Select');
        return;
      }

      if (DRAWING_TOOLS.includes(tool)) {
        if (splatterTimerRef.current !== null) window.clearInterval(splatterTimerRef.current);
        splatterTimerRef.current = null;
        if (tool === 'clone-stamp') cloneStrokeRef.current = null;
        if (tool === 'recolor') recolorImageRef.current = null;
        rasterStrokeBaselineRef.current = null;
        rasterStrokeSelectionRef.current = null;
        rasterStrokeCanvasRef.current = null;
        pushHistory(
          tool === 'eraser'
            ? 'Eraser'
            : tool === 'pencil'
              ? 'Pencil'
              : tool === 'clone-stamp'
                ? 'Clone Stamp'
                : tool === 'recolor'
                  ? 'Recolor'
                  : tool === 'block-brush' || (tool === 'paintbrush' && paintBrushType === 'block')
                    ? 'Block Brush'
                    : 'Paintbrush',
        );
      } else if (SHAPE_TOOLS.includes(tool) && tool !== 'gradient') {
        const finalPoint = event.shiftKey ? constrainShapePoint(startRef.current, point) : point;
        if (
          renderDraftToActiveLayer((context) =>
            drawShape(context, tool, startRef.current, finalPoint, currentShapeOptions(shapeReverseRef.current)),
          )
        ) {
          clearPreview();
          pushHistory('Draw Shape');
        }
      }
    },
    [
      clearPreview,
      currentShapeOptions,
      eventPoint,
      moveText,
      paintBrushType,
      pushHistory,
      renderDraftToActiveLayer,
      tool,
      updateGradientDraft,
      updateLineDraft,
      updateSelection,
      updateSelectionGesture,
      updateShapeDraft,
      zoom,
    ],
  );

  const { swapColors, replacePalette, resetPalette, resizePalette, setPaletteColor, addPaletteColor } = usePaletteState(
    { primary, secondary, palette, setPrimary, setSecondary, setPalette: setPaletteState },
  );

  const selectLayer = useCallback(
    (id: string) => {
      if (id === activeLayerIdRef.current) return true;
      if (!layersRef.current.some((layer) => layer.id === id)) return false;
      commitPendingEditsRef.current();
      setActiveLayerId(id);
      return true;
    },
    [setActiveLayerId],
  );

  const editor = {
    displayCanvasRef,
    previewCanvasRef,
    selectionCanvasRef,
    documents,
    activeDocumentId,
    workspaceReady,
    persistenceSuspended,
    persistenceSuspendedReason,
    restoredDocumentIds,
    workspaceSaveState,
    storagePressure: storagePressureState,
    workspaceError,
    workspaceErrorOperation,
    switchDocument,
    closeDocument,
    closeAllDocuments,
    layers,
    activeLayerId,
    setActiveLayerId: selectLayer,
    history,
    historyIndex,
    revision,
    width,
    height,
    tool,
    setTool,
    primary,
    setPrimary,
    secondary,
    setSecondary,
    swapColors,
    palette,
    recentColors,
    replacePalette,
    resetPalette,
    resizePalette,
    setPaletteColor,
    addPaletteColor,
    brushSize,
    setBrushSize,
    paintBrushType,
    setPaintBrushType,
    slashBrushAngle,
    setSlashBrushAngle,
    splatterMinimumSize,
    setSplatterMinimumSize,
    splatterMaximumSize,
    setSplatterMaximumSize,
    eraserType,
    setEraserType,
    floodMode,
    setFloodMode,
    paintBucketTolerance,
    setPaintBucketTolerance,
    selectionAutoScroll,
    setSelectionAutoScroll,
    lassoMode,
    setLassoMode,
    polygonLassoPointCount: lassoPointsRef.current.length,
    finishPolygonLasso,
    removePolygonLassoPoint,
    cancelPolygonLasso,
    gradientType,
    setGradientType,
    gradientColorMode,
    setGradientColorMode,
    gradientDraft,
    finalizeGradient,
    alphaBlendingMode,
    setAlphaBlendingMode,
    colorPickerSampleSize,
    setColorPickerSampleSize,
    colorPickerSampleType,
    setColorPickerSampleType,
    colorPickerAfterSelect,
    setColorPickerAfterSelect,
    roundedRectangleRadius,
    setRoundedRectangleRadius,
    shapeFillStyle,
    setShapeFillStyle,
    shapeDashStyle,
    setShapeDashStyle,
    shapeAntialiasing,
    setShapeAntialiasing,
    lineArrowStart,
    setLineArrowStart,
    lineArrowEnd,
    setLineArrowEnd,
    lineArrowSize,
    setLineArrowSize,
    lineArrowAngle,
    setLineArrowAngle,
    lineArrowLength,
    setLineArrowLength,
    lineDraft,
    commitLine,
    cancelLine,
    deleteLinePoint,
    nudgeLinePoint,
    setSelectedLineTension,
    shapeDraft,
    commitShape,
    cancelShape,
    nudgeShapePoint,
    magicWandTolerance,
    setMagicWandTolerance,
    recolorTolerance,
    setRecolorTolerance,
    selectionMode,
    setSelectionMode,
    textEditor,
    updateText,
    moveText,
    commitText,
    cancelText,
    textFontFamily,
    setTextFontFamily,
    textFontSize,
    setTextFontSize,
    textFontWeight,
    setTextFontWeight,
    textItalic,
    setTextItalic,
    textUnderline,
    setTextUnderline,
    textAlignment,
    setTextAlignment,
    textStyle,
    setTextStyle,
    textVariant,
    setTextVariant,
    textOutlineWidth,
    setTextOutlineWidth,
    textLineJoin,
    setTextLineJoin,
    cloneSource,
    zoom,
    setZoom,
    liveMetrics,
    fileName,
    dirty,
    selection,
    selectionBounds,
    selectionResizable,
    selectionCursor,
    hasSelection,
    hasFloatingPixels: movingPixels !== null,
    hasClipboard,
    clipboardSize,
    effectBusy,
    effectProgress,
    undo,
    redo,
    newDocument,
    newDocumentFromCanvas,
    openFile,
    saveImage,
    saveAllImages,
    createCompositeDataUrl,
    addLayer,
    importLayerFromFile,
    duplicateLayer,
    deleteLayer,
    mergeLayerDown,
    moveLayer,
    flipLayer,
    rotateZoomLayer,
    flattenImage,
    toggleLayer,
    renameLayer,
    updateLayerProperties,
    selectAll,
    deselect,
    copySelection,
    copyMerged,
    clipboardPngBlob,
    importClipboardImage,
    cutSelection,
    paste,
    pasteIntoNewLayer,
    pasteIntoNewImage,
    fillSelection,
    invertSelection,
    offsetSelection,
    nudgeTransform,
    cropToSelection,
    autoCropImage,
    resizeImage,
    resizeCanvas,
    flipImage,
    rotateImage,
    previewLayerProperties,
    previewRotateZoomLayer,
    clearLayerTransformPreview,
    clearActiveLayer,
    applyEffect,
    previewEffect,
    clearEffectPreview,
    cancelEffect,
    getActiveHistogram,
    goToHistory: restoreHistory,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };

  type Command = (...args: never[]) => unknown;
  type CommandKeys = {
    [Key in keyof typeof editor]: (typeof editor)[Key] extends Command ? Key : never;
  }[keyof typeof editor];
  type CommandSlice = Pick<typeof editor, CommandKeys>;
  const latestEditorRef = useRef(editor);
  latestEditorRef.current = editor;
  const commandsRef = useRef<CommandSlice | null>(null);
  if (!commandsRef.current) {
    commandsRef.current = Object.fromEntries(
      Object.entries(editor)
        .filter(([, value]) => typeof value === 'function')
        .map(([name]) => [
          name,
          (...args: never[]) =>
            Reflect.apply(latestEditorRef.current[name as keyof typeof editor] as Command, undefined, args),
        ]),
    ) as CommandSlice;
  }

  const documentState = useShallowStableObject({
    documents,
    activeDocumentId,
    workspaceReady,
    persistenceSuspended,
    persistenceSuspendedReason,
    restoredDocumentIds,
    workspaceSaveState,
    storagePressure: storagePressureState,
    workspaceError,
    workspaceErrorOperation,
    layers,
    activeLayerId,
    history,
    historyIndex,
    revision,
    width,
    height,
    fileName,
    dirty,
    selection,
    selectionBounds,
    selectionResizable,
    hasSelection,
    hasFloatingPixels: movingPixels !== null,
    hasClipboard,
    clipboardSize,
  });
  const toolState = useShallowStableObject({
    tool,
    primary,
    secondary,
    palette,
    recentColors,
    brushSize,
    paintBrushType,
    slashBrushAngle,
    splatterMinimumSize,
    splatterMaximumSize,
    eraserType,
    floodMode,
    paintBucketTolerance,
    selectionAutoScroll,
    lassoMode,
    polygonLassoPointCount: lassoPointsRef.current.length,
    gradientType,
    gradientColorMode,
    gradientDraft,
    alphaBlendingMode,
    colorPickerSampleSize,
    colorPickerSampleType,
    colorPickerAfterSelect,
    roundedRectangleRadius,
    shapeFillStyle,
    shapeDashStyle,
    shapeAntialiasing,
    lineArrowStart,
    lineArrowEnd,
    lineArrowSize,
    lineArrowAngle,
    lineArrowLength,
    lineDraft,
    shapeDraft,
    magicWandTolerance,
    recolorTolerance,
    selectionMode,
    textEditor,
    textFontFamily,
    textFontSize,
    textFontWeight,
    textItalic,
    textUnderline,
    textAlignment,
    textStyle,
    textVariant,
    textOutlineWidth,
    textLineJoin,
    cloneSource,
  });
  const transient = useShallowStableObject({
    displayCanvasRef,
    previewCanvasRef,
    selectionCanvasRef,
    zoom,
    liveMetrics,
    selectionCursor,
    effectBusy,
    effectProgress,
  });
  const slices = useShallowStableObject({
    commands: commandsRef.current as CommandSlice,
    document: documentState,
    tool: toolState,
    transient,
  });
  return useShallowStableObject({ ...editor, slices });
}
