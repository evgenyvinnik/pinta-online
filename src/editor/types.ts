import type { PixelNode } from './historyPixels';
export type ToolId =
  | 'move-pixels'
  | 'move-selection'
  | 'zoom'
  | 'pan'
  | 'rectangle-select'
  | 'ellipse-select'
  | 'lasso-select'
  | 'magic-wand'
  | 'paintbrush'
  | 'pencil'
  | 'eraser'
  | 'paint-bucket'
  | 'gradient'
  | 'color-picker'
  | 'text'
  | 'line'
  | 'rectangle'
  | 'rounded-rectangle'
  | 'ellipse'
  | 'freeform'
  | 'clone-stamp'
  | 'recolor'
  | 'block-brush';

export interface ToolDefinition {
  id: ToolId;
  name: string;
  icon: string;
  shortcut?: string;
  status: string;
  addinId?: import('../addins/registry').AddinId;
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'color-burn'
  | 'color-dodge'
  | 'overlay'
  | 'difference'
  | 'lighten'
  | 'darken'
  | 'screen'
  | 'xor'
  | 'hard-light'
  | 'soft-light'
  | 'color'
  | 'luminosity'
  | 'hue'
  | 'saturation';

export const BLEND_MODES: ReadonlyArray<{ id: BlendMode; label: string }> = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'color-burn', label: 'Color Burn' },
  { id: 'color-dodge', label: 'Color Dodge' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'difference', label: 'Difference' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'darken', label: 'Darken' },
  { id: 'screen', label: 'Screen' },
  { id: 'xor', label: 'Xor' },
  { id: 'hard-light', label: 'Hard Light' },
  { id: 'soft-light', label: 'Soft Light' },
  { id: 'color', label: 'Color' },
  { id: 'luminosity', label: 'Luminosity' },
  { id: 'hue', label: 'Hue' },
  { id: 'saturation', label: 'Saturation' },
];

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'tiff' | 'ora' | 'ppm' | 'tga';

export interface ExportOptions {
  fileName?: string;
  format?: ExportFormat;
  quality?: number;
  fileHandle?: FileSystemFileHandle;
}

export interface PaintLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  /** Bumped only when this layer's pixels change, so thumbnail work stays layer-local. */
  revision: number;
  canvas: HTMLCanvasElement;
}

export interface LayerSnapshot {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  /**
   * Held as a node rather than an image so older entries can store a difference against the
   * entry that replaced them. Read it with `resolvePixels`.
   */
  pixels: PixelNode;
}

export interface HistorySnapshot {
  label: string;
  /** Set on the oldest surviving entry when memory pressure discarded the steps before it. */
  evicted?: boolean;
  layers: LayerSnapshot[];
  activeLayerId: string;
  width: number;
  height: number;
  selection?: SelectionSnapshot | null;
  floatingPixels?: FloatingPixelsSnapshot | null;
}

export interface AffineTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface FloatingPixelsSnapshot {
  layerId: string;
  pixels: ImageData;
  transform: AffineTransform;
}

export interface SelectionSnapshot {
  tool: ToolId;
  start: Point;
  end: Point;
  points?: Point[];
  mask?: ImageData;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * A live selection. The mask is a canvas rather than an ImageData because every consumer draws
 * with it; `SelectionSnapshot` is the serialisable form history keeps.
 */
export type Selection = {
  tool: ToolId;
  start: Point;
  end: Point;
  points?: Point[];
  mask?: HTMLCanvasElement;
};

/** Pixels lifted off a layer and being moved, before they are committed back down. */
export interface FloatingPixelsState {
  layerId: string;
  canvas: HTMLCanvasElement;
  transform: AffineTransform;
}

/** Where existing pixels sit when the canvas is resized, mirroring native's anchor grid. */
export type CanvasAnchor =
  | 'north-west' | 'north' | 'north-east'
  | 'west' | 'center' | 'east'
  | 'south-west' | 'south' | 'south-east';

/* ------------------------------------------------------------------------------------------
 * Tool and draft state.
 *
 * These describe what a tool is currently doing — an in-progress shape, the text being typed,
 * the gradient being dragged — and are shared between the drawing helpers and the editor hook.
 * They live here rather than in either, so neither has to import from the other.
 * ---------------------------------------------------------------------------------------- */

export interface GradientDraftState {
  layerId: string;
  start: Point;
  end: Point;
  reverseColors: boolean;
  options: ShapeDrawingOptions;
  selection: Selection | null;
  baseCanvas: HTMLCanvasElement;
}

export type TextVariant = 'normal' | 'small-caps' | 'all-small-caps' | 'petite-caps' | 'all-petite-caps' | 'unicase' | 'title-caps';

export type ShapeFillStyle = 'outline' | 'fill' | 'fill-outline';

export type ShapeDashStyle = string;

export type PaintBrushType = 'normal' | 'block' | 'grid' | 'squares' | 'circles' | 'splatter' | 'slash';

export type EraserType = 'normal' | 'smooth';

export type GradientType = 'linear' | 'reflected' | 'diamond' | 'radial' | 'conical';

export type AlphaBlendingMode = 'normal' | 'overwrite';

export interface EditableLineState {
  id: string;
  points: Point[];
  tensions: number[];
  selectedPoint: number;
  reverseColors: boolean;
  options: ShapeDrawingOptions;
}

export interface EditableShapeState {
  id: string;
  tool: EditableBoundsTool;
  points: [Point, Point, Point, Point];
  selectedPoint: number;
  reverseColors: boolean;
  options: ShapeDrawingOptions;
}

export interface TextEditorState {
  x: number;
  y: number;
  value: string;
}

export interface TextDrawingOptions {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  alignment: TextAlignment;
  style: TextStyle;
  variant: TextVariant;
  outlineWidth: number;
  lineJoin: CanvasLineJoin;
  primary: string;
  secondary: string;
}

export interface ShapeDrawingOptions {
  primary: string;
  secondary: string;
  size: number;
  fillStyle: ShapeFillStyle;
  dashStyle: ShapeDashStyle;
  arrowStart: boolean;
  arrowEnd: boolean;
  arrowSize: number;
  arrowAngle: number;
  arrowLength: number;
  roundedRadius: number;
  gradientType: GradientType;
  gradientColorMode: GradientColorMode;
  reverseColors?: boolean;
}

export type TextAlignment = 'left' | 'center' | 'right';

export type TextStyle = 'fill' | 'fill-outline' | 'outline' | 'background';

export type GradientColorMode = 'color' | 'transparency';

export type EditableBoundsTool = 'rectangle' | 'rounded-rectangle' | 'ellipse';
