import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  AlphaBlendingMode,
  ColorPickerAfterSelect,
  ColorPickerSampleType,
  EraserType,
  FloodMode,
  GradientColorMode,
  GradientType,
  LassoMode,
  PaintBrushType,
  SelectionMode,
  ShapeDashStyle,
  ShapeFillStyle,
  TextAlignment,
  TextStyle,
  TextVariant,
} from '../editor/usePaintEditor';
import type { ToolId } from '../editor/types';
import { ADDIN_IDS, DEFAULT_ENABLED_ADDINS, isAddinId, type AddinId } from '../addins/registry';

export interface CanvasGridSettings {
  showGrid: boolean;
  cellWidth: number;
  cellHeight: number;
  showAxonometricGrid: boolean;
  axonometricWidth: number;
  axonometricAngle: number;
}

export type RulerMetric = 'pixels' | 'inches' | 'centimeters';
export type ColorScheme = 'dark' | 'light';
type StateSetter<T> = T | ((current: T) => T);

export interface ToolSettings {
  tool: ToolId;
  primary: string;
  secondary: string;
  brushSize: number;
  paintBrushType: PaintBrushType;
  eraserType: EraserType;
  floodMode: FloodMode;
  paintBucketTolerance: number;
  selectionAutoScroll: boolean;
  lassoMode: LassoMode;
  gradientType: GradientType;
  gradientColorMode: GradientColorMode;
  alphaBlendingMode: AlphaBlendingMode;
  colorPickerSampleSize: number;
  colorPickerSampleType: ColorPickerSampleType;
  colorPickerAfterSelect: ColorPickerAfterSelect;
  roundedRectangleRadius: number;
  shapeFillStyle: ShapeFillStyle;
  shapeDashStyle: ShapeDashStyle;
  shapeAntialiasing: boolean;
  lineArrowStart: boolean;
  lineArrowEnd: boolean;
  lineArrowSize: number;
  magicWandTolerance: number;
  recolorTolerance: number;
  selectionMode: SelectionMode;
  textFontFamily: string;
  textFontSize: number;
  textFontWeight: number;
  textItalic: boolean;
  textUnderline: boolean;
  textAlignment: TextAlignment;
  textStyle: TextStyle;
  textVariant: TextVariant;
  textOutlineWidth: number;
  textLineJoin: CanvasLineJoin;
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  tool: 'paintbrush',
  primary: '#000000',
  secondary: '#ffffff',
  brushSize: 2,
  paintBrushType: 'normal',
  eraserType: 'normal',
  floodMode: 'contiguous',
  paintBucketTolerance: 0,
  selectionAutoScroll: true,
  lassoMode: 'freeform',
  gradientType: 'linear',
  gradientColorMode: 'color',
  alphaBlendingMode: 'normal',
  colorPickerSampleSize: 1,
  colorPickerSampleType: 'layer',
  colorPickerAfterSelect: 'none',
  roundedRectangleRadius: 20,
  shapeFillStyle: 'outline',
  shapeDashStyle: 'solid',
  shapeAntialiasing: true,
  lineArrowStart: false,
  lineArrowEnd: false,
  lineArrowSize: 16,
  magicWandTolerance: 0,
  recolorTolerance: 50,
  selectionMode: 'replace',
  textFontFamily: 'Adwaita Sans',
  textFontSize: 11,
  textFontWeight: 400,
  textItalic: false,
  textUnderline: false,
  textAlignment: 'left',
  textStyle: 'fill',
  textVariant: 'normal',
  textOutlineWidth: 2,
  textLineJoin: 'miter',
};

export const DEFAULT_CANVAS_GRID: CanvasGridSettings = {
  showGrid: false,
  cellWidth: 10,
  cellHeight: 10,
  showAxonometricGrid: false,
  axonometricWidth: 10,
  axonometricAngle: 30,
};

interface PreferenceState {
  theme: ColorScheme;
  showSidebar: boolean;
  showToolbox: boolean;
  showToolbar: boolean;
  showPalette: boolean;
  showDocumentTabs: boolean;
  canvasGrid: CanvasGridSettings;
  showRulers: boolean;
  rulerMetric: RulerMetric;
  toolSettings: ToolSettings;
  enabledAddins: AddinId[];
  setTheme: (theme: ColorScheme) => void;
  setShowSidebar: (value: StateSetter<boolean>) => void;
  setShowToolbox: (value: StateSetter<boolean>) => void;
  setShowToolbar: (value: StateSetter<boolean>) => void;
  setShowPalette: (value: StateSetter<boolean>) => void;
  setShowDocumentTabs: (value: StateSetter<boolean>) => void;
  setCanvasGrid: (settings: CanvasGridSettings) => void;
  setShowRulers: (value: StateSetter<boolean>) => void;
  setRulerMetric: (metric: RulerMetric) => void;
  setToolSetting: <Key extends keyof ToolSettings>(key: Key, value: ToolSettings[Key]) => void;
  setAddinEnabled: (addin: AddinId, enabled: boolean) => void;
  setAllAddinsEnabled: (enabled: boolean) => void;
}

function nextValue<T>(current: T, value: StateSetter<T>) {
  return typeof value === 'function' ? (value as (current: T) => T)(current) : value;
}

export const usePreferences = create<PreferenceState>()(persist(
  (set) => ({
    theme: 'dark',
    showSidebar: true,
    showToolbox: true,
    showToolbar: true,
    showPalette: true,
    showDocumentTabs: true,
    canvasGrid: DEFAULT_CANVAS_GRID,
    showRulers: false,
    rulerMetric: 'pixels',
    toolSettings: DEFAULT_TOOL_SETTINGS,
    enabledAddins: DEFAULT_ENABLED_ADDINS,
    setTheme: (theme) => set({ theme }),
    setShowSidebar: (value) => set((state) => ({ showSidebar: nextValue(state.showSidebar, value) })),
    setShowToolbox: (value) => set((state) => ({ showToolbox: nextValue(state.showToolbox, value) })),
    setShowToolbar: (value) => set((state) => ({ showToolbar: nextValue(state.showToolbar, value) })),
    setShowPalette: (value) => set((state) => ({ showPalette: nextValue(state.showPalette, value) })),
    setShowDocumentTabs: (value) => set((state) => ({ showDocumentTabs: nextValue(state.showDocumentTabs, value) })),
    setCanvasGrid: (canvasGrid) => set({ canvasGrid }),
    setShowRulers: (value) => set((state) => ({ showRulers: nextValue(state.showRulers, value) })),
    setRulerMetric: (rulerMetric) => set({ rulerMetric }),
    setToolSetting: (key, value) => set((state) => ({ toolSettings: { ...state.toolSettings, [key]: value } })),
    setAddinEnabled: (addin, enabled) => set((state) => ({
      enabledAddins: enabled
        ? [...new Set([...state.enabledAddins, addin])]
        : state.enabledAddins.filter((candidate) => candidate !== addin),
    })),
    setAllAddinsEnabled: (enabled) => set({ enabledAddins: enabled ? [...ADDIN_IDS] : [] }),
  }),
  {
    name: 'pinta-online-preferences-v1',
    storage: createJSONStorage(() => localStorage),
    partialize: ({
      theme,
      showSidebar,
      showToolbox,
      showToolbar,
      showPalette,
      showDocumentTabs,
      canvasGrid,
      showRulers,
      rulerMetric,
      toolSettings,
      enabledAddins,
    }) => ({
      theme,
      showSidebar,
      showToolbox,
      showToolbar,
      showPalette,
      showDocumentTabs,
      canvasGrid,
      showRulers,
      rulerMetric,
      toolSettings,
      enabledAddins,
    }),
    merge: (persisted, current) => {
      const saved = persisted as Partial<PreferenceState> | undefined;
      return {
        ...current,
        ...saved,
        enabledAddins: Array.isArray(saved?.enabledAddins)
          ? saved.enabledAddins.filter((addin): addin is AddinId => typeof addin === 'string' && isAddinId(addin))
          : DEFAULT_ENABLED_ADDINS,
        toolSettings: { ...current.toolSettings, ...saved?.toolSettings },
      };
    },
  },
));
