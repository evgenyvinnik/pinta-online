import { useCallback } from 'react';
import { usePreferences } from '../state/preferences';
import type { SelectionMode } from './selectionGeometry';
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
  ShapeDashStyle,
  ShapeFillStyle,
  TextAlignment,
  TextStyle,
  TextVariant,
  ToolId,
} from './types';

/**
 * Every tool option and the setter that writes it back to preferences.
 *
 * Five of them — brush width, antialiasing, alpha blending, fill style and dash style — are
 * scoped per tool, matching native's `BrushWidth(tool)` keys, so a 30px paintbrush does not
 * silently become a 30px eraser. The rest are global. Reading and writing sit together here so
 * that pairing stays visible rather than being split across the hook.
 */
export function useToolSettings() {
  const toolSettings = usePreferences((state) => state.toolSettings);
  const scopedToolSettings = usePreferences((state) => state.scopedToolSettings);
  const recentColors = usePreferences((state) => state.recentColors);
  const persistHistory = usePreferences((state) => state.persistHistory);
  const setToolSetting = usePreferences((state) => state.setToolSetting);
  const setScopedToolSetting = usePreferences((state) => state.setScopedToolSetting);
  const addRecentColor = usePreferences((state) => state.addRecentColor);
  const {
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
  } = toolSettings;
  const brushSize = scopedToolSettings.brushSize[tool] ?? toolSettings.brushSize;
  const shapeAntialiasing = scopedToolSettings.antialiasing[tool] ?? toolSettings.shapeAntialiasing;
  const alphaBlendingMode = scopedToolSettings.alphaBlending[tool] ?? toolSettings.alphaBlendingMode;
  const shapeFillStyle = scopedToolSettings.shapeFillStyle[tool] ?? toolSettings.shapeFillStyle;
  const shapeDashStyle = scopedToolSettings.shapeDashStyle[tool] ?? toolSettings.shapeDashStyle;
  const setToolState = useCallback((value: ToolId) => setToolSetting('tool', value), [setToolSetting]);
  const setPrimary = useCallback(
    (value: string, addToRecent = true) => {
      setToolSetting('primary', value);
      if (addToRecent) addRecentColor(value);
    },
    [addRecentColor, setToolSetting],
  );
  const setSecondary = useCallback(
    (value: string, addToRecent = true) => {
      setToolSetting('secondary', value);
      if (addToRecent) addRecentColor(value);
    },
    [addRecentColor, setToolSetting],
  );
  const setBrushSize = useCallback(
    (value: number) => setScopedToolSetting('brushSize', tool, value),
    [setScopedToolSetting, tool],
  );
  const setPaintBrushType = useCallback(
    (value: PaintBrushType) => setToolSetting('paintBrushType', value),
    [setToolSetting],
  );
  const setSlashBrushAngle = useCallback((value: number) => setToolSetting('slashBrushAngle', value), [setToolSetting]);
  const setSplatterMinimumSize = useCallback(
    (value: number) => setToolSetting('splatterMinimumSize', value),
    [setToolSetting],
  );
  const setSplatterMaximumSize = useCallback(
    (value: number) => setToolSetting('splatterMaximumSize', value),
    [setToolSetting],
  );
  const setEraserType = useCallback((value: EraserType) => setToolSetting('eraserType', value), [setToolSetting]);
  const setFloodMode = useCallback((value: FloodMode) => setToolSetting('floodMode', value), [setToolSetting]);
  const setPaintBucketTolerance = useCallback(
    (value: number) => setToolSetting('paintBucketTolerance', value),
    [setToolSetting],
  );
  const setSelectionAutoScroll = useCallback(
    (value: boolean) => setToolSetting('selectionAutoScroll', value),
    [setToolSetting],
  );
  const setLassoMode = useCallback((value: LassoMode) => setToolSetting('lassoMode', value), [setToolSetting]);
  const setGradientType = useCallback((value: GradientType) => setToolSetting('gradientType', value), [setToolSetting]);
  const setGradientColorMode = useCallback(
    (value: GradientColorMode) => setToolSetting('gradientColorMode', value),
    [setToolSetting],
  );
  const setAlphaBlendingMode = useCallback(
    (value: AlphaBlendingMode) => setScopedToolSetting('alphaBlending', tool, value),
    [setScopedToolSetting, tool],
  );
  const setColorPickerSampleSize = useCallback(
    (value: number) => setToolSetting('colorPickerSampleSize', value),
    [setToolSetting],
  );
  const setColorPickerSampleType = useCallback(
    (value: ColorPickerSampleType) => setToolSetting('colorPickerSampleType', value),
    [setToolSetting],
  );
  const setColorPickerAfterSelect = useCallback(
    (value: ColorPickerAfterSelect) => setToolSetting('colorPickerAfterSelect', value),
    [setToolSetting],
  );
  const setRoundedRectangleRadius = useCallback(
    (value: number) => setToolSetting('roundedRectangleRadius', value),
    [setToolSetting],
  );
  const setShapeFillStyle = useCallback(
    (value: ShapeFillStyle) => setScopedToolSetting('shapeFillStyle', tool, value),
    [setScopedToolSetting, tool],
  );
  const setShapeDashStyle = useCallback(
    (value: ShapeDashStyle) => setScopedToolSetting('shapeDashStyle', tool, value),
    [setScopedToolSetting, tool],
  );
  const setShapeAntialiasing = useCallback(
    (value: boolean) => setScopedToolSetting('antialiasing', tool, value),
    [setScopedToolSetting, tool],
  );
  const setLineArrowStart = useCallback((value: boolean) => setToolSetting('lineArrowStart', value), [setToolSetting]);
  const setLineArrowEnd = useCallback((value: boolean) => setToolSetting('lineArrowEnd', value), [setToolSetting]);
  const setLineArrowSize = useCallback((value: number) => setToolSetting('lineArrowSize', value), [setToolSetting]);
  const setLineArrowAngle = useCallback((value: number) => setToolSetting('lineArrowAngle', value), [setToolSetting]);
  const setLineArrowLength = useCallback((value: number) => setToolSetting('lineArrowLength', value), [setToolSetting]);
  const setMagicWandTolerance = useCallback(
    (value: number) => setToolSetting('magicWandTolerance', value),
    [setToolSetting],
  );
  const setRecolorTolerance = useCallback(
    (value: number) => setToolSetting('recolorTolerance', value),
    [setToolSetting],
  );
  const setSelectionMode = useCallback(
    (value: SelectionMode) => setToolSetting('selectionMode', value),
    [setToolSetting],
  );
  const setTextFontFamily = useCallback((value: string) => setToolSetting('textFontFamily', value), [setToolSetting]);
  const setTextFontSize = useCallback((value: number) => setToolSetting('textFontSize', value), [setToolSetting]);
  const setTextFontWeight = useCallback((value: number) => setToolSetting('textFontWeight', value), [setToolSetting]);
  const setTextItalic = useCallback((value: boolean) => setToolSetting('textItalic', value), [setToolSetting]);
  const setTextUnderline = useCallback((value: boolean) => setToolSetting('textUnderline', value), [setToolSetting]);
  const setTextAlignment = useCallback(
    (value: TextAlignment) => setToolSetting('textAlignment', value),
    [setToolSetting],
  );
  const setTextStyle = useCallback((value: TextStyle) => setToolSetting('textStyle', value), [setToolSetting]);
  const setTextVariant = useCallback((value: TextVariant) => setToolSetting('textVariant', value), [setToolSetting]);
  const setTextOutlineWidth = useCallback(
    (value: number) => setToolSetting('textOutlineWidth', value),
    [setToolSetting],
  );
  const setTextLineJoin = useCallback(
    (value: CanvasLineJoin) => setToolSetting('textLineJoin', value),
    [setToolSetting],
  );

  return {
    toolSettings,
    scopedToolSettings,
    recentColors,
    persistHistory,
    setToolSetting,
    setScopedToolSetting,
    addRecentColor,
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
  };
}
