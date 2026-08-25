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

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'ora' | 'ppm' | 'tga';

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
  canvas: HTMLCanvasElement;
}

export interface LayerSnapshot {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  pixels: ImageData;
}

export interface HistorySnapshot {
  label: string;
  layers: LayerSnapshot[];
  activeLayerId: string;
  width: number;
  height: number;
  selection?: SelectionSnapshot | null;
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
