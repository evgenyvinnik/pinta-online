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

export interface DockLayout {
  /** Width of the Layers/History dock, mirroring `dock-right-splitpos`. */
  width: number;
  /** Share of the dock given to Layers, mirroring each pad's `-splitpos`. */
  layersShare: number;
  layersMinimized: boolean;
  historyMinimized: boolean;
}

export const DEFAULT_DOCK_LAYOUT: DockLayout = {
  width: 277,
  layersShare: 0.52,
  layersMinimized: false,
  historyMinimized: false,
};

export const MIN_DOCK_WIDTH = 190;
export const MAX_DOCK_WIDTH = 520;

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
export type ColorSchemePreference = 'default' | ColorScheme;

export function resolveColorScheme(preference: ColorSchemePreference, prefersDark: boolean): ColorScheme {
  if (preference !== 'default') return preference;
  return prefersDark ? 'dark' : 'light';
}
type StateSetter<T> = T | ((current: T) => T);

export interface ToolSettings {
  tool: ToolId;
  primary: string;
  secondary: string;
  brushSize: number;
  paintBrushType: PaintBrushType;
  slashBrushAngle: number;
  splatterMinimumSize: number;
  splatterMaximumSize: number;
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
  lineArrowAngle: number;
  lineArrowLength: number;
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

/**
 * Native Pinta keys these options by tool — `{tool}-brush-width`, `{tool}-antialias`,
 * `{tool}-alpha-blend`, `{prefix}-fill-style`, `{prefix}-dash-pattern` in
 * `Pinta.Tools/SettingNames.cs` — so widening the paintbrush never widens the eraser or a
 * shape outline. Missing entries fall back to the shared `ToolSettings` default, which
 * also carries a previously persisted global value forward.
 */
export interface ScopedToolSettings {
  brushSize: Record<string, number>;
  antialiasing: Record<string, boolean>;
  alphaBlending: Record<string, AlphaBlendingMode>;
  shapeFillStyle: Record<string, ShapeFillStyle>;
  shapeDashStyle: Record<string, ShapeDashStyle>;
}

export const DEFAULT_SCOPED_TOOL_SETTINGS: ScopedToolSettings = {
  brushSize: {},
  antialiasing: {},
  alphaBlending: {},
  shapeFillStyle: {},
  shapeDashStyle: {},
};

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  tool: 'paintbrush',
  primary: '#000000',
  secondary: '#ffffff',
  brushSize: 2,
  paintBrushType: 'normal',
  slashBrushAngle: 45,
  splatterMinimumSize: 5,
  splatterMaximumSize: 10,
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
  shapeDashStyle: '-',
  shapeAntialiasing: true,
  lineArrowStart: false,
  lineArrowEnd: false,
  lineArrowSize: 10,
  lineArrowAngle: 15,
  lineArrowLength: 10,
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
  cellWidth: 64,
  cellHeight: 64,
  showAxonometricGrid: false,
  axonometricWidth: 64,
  axonometricAngle: 30,
};

const DEFAULT_RECENT_COLORS = Array<string>(24).fill('#e5e5e5');

export interface PreferenceState {
  theme: ColorSchemePreference;
  showSidebar: boolean;
  showToolbox: boolean;
  showToolbar: boolean;
  showPalette: boolean;
  showDocumentTabs: boolean;
  canvasGrid: CanvasGridSettings;
  dockLayout: DockLayout;
  showRulers: boolean;
  rulerMetric: RulerMetric;
  /** Cleared when browser storage runs short, so restore keeps the images but drops undo. */
  persistHistory: boolean;
  toolSettings: ToolSettings;
  scopedToolSettings: ScopedToolSettings;
  recentColors: string[];
  enabledAddins: AddinId[];
  setTheme: (theme: ColorSchemePreference) => void;
  setShowSidebar: (value: StateSetter<boolean>) => void;
  setShowToolbox: (value: StateSetter<boolean>) => void;
  setShowToolbar: (value: StateSetter<boolean>) => void;
  setShowPalette: (value: StateSetter<boolean>) => void;
  setShowDocumentTabs: (value: StateSetter<boolean>) => void;
  setCanvasGrid: (settings: CanvasGridSettings) => void;
  setDockLayout: (value: StateSetter<DockLayout>) => void;
  setShowRulers: (value: StateSetter<boolean>) => void;
  setPersistHistory: (value: StateSetter<boolean>) => void;
  setRulerMetric: (metric: RulerMetric) => void;
  setToolSetting: <Key extends keyof ToolSettings>(key: Key, value: ToolSettings[Key]) => void;
  setScopedToolSetting: <Key extends keyof ScopedToolSettings>(
    key: Key,
    tool: string,
    value: ScopedToolSettings[Key][string],
  ) => void;
  addRecentColor: (color: string) => void;
  setAddinEnabled: (addin: AddinId, enabled: boolean) => void;
  setAllAddinsEnabled: (enabled: boolean) => void;
}

/**
 * Phones have no room for the docked pads beside the canvas, so Layers and History start
 * closed there. F12 and View -> Tool Windows still toggle them, and the choice persists.
 */
function docksFitBesideCanvas() {
  return typeof matchMedia !== 'function' || !matchMedia('(max-width: 640px)').matches;
}

function nextValue<T>(current: T, value: StateSetter<T>) {
  return typeof value === 'function' ? (value as (current: T) => T)(current) : value;
}

export const usePreferences = create<PreferenceState>()(
  persist(
    (set) => ({
      theme: 'default',
      showSidebar: docksFitBesideCanvas(),
      showToolbox: true,
      showToolbar: true,
      showPalette: true,
      showDocumentTabs: true,
      canvasGrid: DEFAULT_CANVAS_GRID,
      dockLayout: DEFAULT_DOCK_LAYOUT,
      showRulers: false,
      rulerMetric: 'pixels',
      persistHistory: true,
      toolSettings: DEFAULT_TOOL_SETTINGS,
      scopedToolSettings: DEFAULT_SCOPED_TOOL_SETTINGS,
      recentColors: DEFAULT_RECENT_COLORS,
      enabledAddins: DEFAULT_ENABLED_ADDINS,
      setTheme: (theme) => set({ theme }),
      setShowSidebar: (value) => set((state) => ({ showSidebar: nextValue(state.showSidebar, value) })),
      setShowToolbox: (value) => set((state) => ({ showToolbox: nextValue(state.showToolbox, value) })),
      setShowToolbar: (value) => set((state) => ({ showToolbar: nextValue(state.showToolbar, value) })),
      setShowPalette: (value) => set((state) => ({ showPalette: nextValue(state.showPalette, value) })),
      setShowDocumentTabs: (value) => set((state) => ({ showDocumentTabs: nextValue(state.showDocumentTabs, value) })),
      setCanvasGrid: (canvasGrid) => set({ canvasGrid }),
      setDockLayout: (value) => set((state) => ({ dockLayout: nextValue(state.dockLayout, value) })),
      setShowRulers: (value) => set((state) => ({ showRulers: nextValue(state.showRulers, value) })),
      setRulerMetric: (rulerMetric) => set({ rulerMetric }),
      setPersistHistory: (value) => set((state) => ({ persistHistory: nextValue(state.persistHistory, value) })),
      setToolSetting: (key, value) => set((state) => ({ toolSettings: { ...state.toolSettings, [key]: value } })),
      setScopedToolSetting: (key, tool, value) =>
        set((state) => ({
          scopedToolSettings: {
            ...state.scopedToolSettings,
            [key]: { ...state.scopedToolSettings[key], [tool]: value },
          },
        })),
      addRecentColor: (color) =>
        set((state) => {
          if (!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return state;
          const normalized = color.toLowerCase();
          const next = [...state.recentColors];
          const existingIndex = next.indexOf(normalized);
          if (existingIndex >= 0) next.splice(existingIndex, 1);
          else if (next.length >= 24) next.pop();
          next.unshift(normalized);
          return { recentColors: next.slice(0, 24) };
        }),
      setAddinEnabled: (addin, enabled) =>
        set((state) => ({
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
        dockLayout,
        showRulers,
        rulerMetric,
        persistHistory,
        toolSettings,
        scopedToolSettings,
        recentColors,
        enabledAddins,
      }) => ({
        theme,
        showSidebar,
        showToolbox,
        showToolbar,
        showPalette,
        showDocumentTabs,
        canvasGrid,
        dockLayout,
        showRulers,
        rulerMetric,
        persistHistory,
        toolSettings,
        scopedToolSettings,
        recentColors,
        enabledAddins,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<PreferenceState> | undefined;
        return {
          ...current,
          ...saved,
          showSidebar: saved?.showSidebar ?? docksFitBesideCanvas(),
          enabledAddins: Array.isArray(saved?.enabledAddins)
            ? saved.enabledAddins.filter((addin): addin is AddinId => typeof addin === 'string' && isAddinId(addin))
            : DEFAULT_ENABLED_ADDINS,
          recentColors: Array.isArray(saved?.recentColors)
            ? saved.recentColors
                .filter(
                  (color): color is string =>
                    typeof color === 'string' && /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color),
                )
                .slice(0, 24)
            : DEFAULT_RECENT_COLORS,
          toolSettings: { ...current.toolSettings, ...saved?.toolSettings },
          scopedToolSettings: {
            ...current.scopedToolSettings,
            ...saved?.scopedToolSettings,
          },
          dockLayout: { ...current.dockLayout, ...saved?.dockLayout },
        };
      },
    },
  ),
);
