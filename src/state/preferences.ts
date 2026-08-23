import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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
  setTheme: (theme: ColorScheme) => void;
  setShowSidebar: (value: StateSetter<boolean>) => void;
  setShowToolbox: (value: StateSetter<boolean>) => void;
  setShowToolbar: (value: StateSetter<boolean>) => void;
  setShowPalette: (value: StateSetter<boolean>) => void;
  setShowDocumentTabs: (value: StateSetter<boolean>) => void;
  setCanvasGrid: (settings: CanvasGridSettings) => void;
  setShowRulers: (value: StateSetter<boolean>) => void;
  setRulerMetric: (metric: RulerMetric) => void;
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
    setTheme: (theme) => set({ theme }),
    setShowSidebar: (value) => set((state) => ({ showSidebar: nextValue(state.showSidebar, value) })),
    setShowToolbox: (value) => set((state) => ({ showToolbox: nextValue(state.showToolbox, value) })),
    setShowToolbar: (value) => set((state) => ({ showToolbar: nextValue(state.showToolbar, value) })),
    setShowPalette: (value) => set((state) => ({ showPalette: nextValue(state.showPalette, value) })),
    setShowDocumentTabs: (value) => set((state) => ({ showDocumentTabs: nextValue(state.showDocumentTabs, value) })),
    setCanvasGrid: (canvasGrid) => set({ canvasGrid }),
    setShowRulers: (value) => set((state) => ({ showRulers: nextValue(state.showRulers, value) })),
    setRulerMetric: (rulerMetric) => set({ rulerMetric }),
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
    }),
  },
));
