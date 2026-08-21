import { defaultCurveParameters } from './curves';

export type EffectId =
  | 'auto-level'
  | 'black-white'
  | 'brightness-contrast'
  | 'curves'
  | 'hue-saturation'
  | 'invert'
  | 'levels'
  | 'posterize'
  | 'sepia'
  | 'fragment'
  | 'gaussian-blur'
  | 'motion-blur'
  | 'radial-blur'
  | 'unfocus'
  | 'zoom-blur'
  | 'bulge'
  | 'dents'
  | 'frosted-glass'
  | 'pixelate'
  | 'polar-inversion'
  | 'tile-reflection'
  | 'twist'
  | 'add-noise'
  | 'median'
  | 'reduce-noise'
  | 'ink-sketch'
  | 'oil-painting'
  | 'pencil-sketch'
  | 'dithering'
  | 'cells'
  | 'clouds'
  | 'julia-fractal'
  | 'mandelbrot-fractal'
  | 'voronoi-diagram'
  | 'align-object'
  | 'feather-object'
  | 'outline-object'
  | 'glow'
  | 'red-eye-removal'
  | 'sharpen'
  | 'soften-portrait'
  | 'vignette'
  | 'edge-detect'
  | 'emboss'
  | 'outline-edge'
  | 'relief';

export type EffectCategory = 'adjustment' | 'artistic' | 'blur' | 'color' | 'distort' | 'noise' | 'object' | 'photo' | 'render' | 'stylize';

export interface EffectParameterDefinition {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
  kind?: 'range' | 'boolean' | 'select' | 'color';
  options?: { value: number; label: string }[];
  visibleWhen?: { key: string; equals: number };
}

export interface EffectDefinition {
  id: EffectId;
  name: string;
  category: EffectCategory;
  icon: string;
  description: string;
  parameters: EffectParameterDefinition[];
  dialog?: 'alignment' | 'curves' | 'levels';
}

export type EffectParameters = Record<string, number>;

const EDGE_BEHAVIOR_OPTIONS = [
  { value: 0, label: 'Clamp' },
  { value: 1, label: 'Wrap' },
  { value: 2, label: 'Reflect' },
  { value: 3, label: 'Primary' },
  { value: 4, label: 'Secondary' },
  { value: 5, label: 'Transparent' },
  { value: 6, label: 'Original' },
];

const COLOR_SCHEME_SOURCE_OPTIONS = [
  { value: 0, label: 'Preset Gradient' },
  { value: 1, label: 'Selected Colors' },
  { value: 2, label: 'Random' },
];

const GRADIENT_OPTIONS = [
  { value: 0, label: 'Beautiful Italy' }, { value: 1, label: 'Black and White' },
  { value: 2, label: 'Bonfire' }, { value: 3, label: 'Cherry Blossom' },
  { value: 4, label: 'Cotton Candy' }, { value: 5, label: 'Electric' },
  { value: 6, label: 'Lime Lemon' }, { value: 7, label: 'Martian Lava' },
  { value: 8, label: 'Piña Colada' },
];

const DISTANCE_OPTIONS = [
  { value: 0, label: 'Euclidean' }, { value: 1, label: 'Manhattan' }, { value: 2, label: 'Chebyshev' },
];

const POINT_ARRANGEMENT_OPTIONS = [
  { value: 0, label: 'Random' }, { value: 1, label: 'Circular' }, { value: 2, label: 'Phyllotaxis' },
];

export const EFFECT_DEFINITIONS: EffectDefinition[] = [
  {
    id: 'auto-level', name: 'Auto Level', category: 'adjustment',
    icon: 'adjustments-autolevel-symbolic.svg', description: 'Stretch each color channel across the available tonal range.', parameters: [],
  },
  {
    id: 'black-white', name: 'Black and White', category: 'adjustment',
    icon: 'adjustments-blackandwhite-symbolic.svg', description: 'Convert the active layer to luminance.', parameters: [],
  },
  {
    id: 'brightness-contrast', name: 'Brightness / Contrast', category: 'adjustment',
    icon: 'adjustments-brightnesscontrast-symbolic.svg', description: 'Adjust overall lightness and tonal separation.',
    parameters: [
      { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, defaultValue: 0, unit: '%' },
      { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, defaultValue: 0, unit: '%' },
    ],
  },
  {
    id: 'curves', name: 'Curves', category: 'adjustment', dialog: 'curves',
    icon: 'adjustments-curves-symbolic.svg', description: 'Remap luminosity or individual color channels with a natural cubic spline.', parameters: [],
  },
  {
    id: 'hue-saturation', name: 'Hue / Saturation', category: 'adjustment',
    icon: 'adjustments-huesaturation-symbolic.svg', description: 'Shift hues and tune color intensity and lightness.',
    parameters: [
      { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, defaultValue: 0, unit: '°' },
      { key: 'saturation', label: 'Saturation', min: 0, max: 200, step: 1, defaultValue: 100, unit: '%' },
      { key: 'lightness', label: 'Lightness', min: -100, max: 100, step: 1, defaultValue: 0, unit: '%' },
    ],
  },
  {
    id: 'invert', name: 'Invert Colors', category: 'adjustment',
    icon: 'adjustments-invertcolors-symbolic.svg', description: 'Invert the red, green, and blue channels.', parameters: [],
  },
  {
    id: 'levels', name: 'Levels', category: 'adjustment', dialog: 'levels',
    icon: 'adjustments-levels-symbolic.svg', description: 'Set input range, gamma, and output range for all color channels.',
    parameters: [],
  },
  {
    id: 'posterize', name: 'Posterize', category: 'adjustment',
    icon: 'adjustments-posterize-symbolic.svg', description: 'Reduce the number of available levels in each channel.',
    parameters: [
      { key: 'red', label: 'Red', min: 2, max: 32, step: 1, defaultValue: 4 },
      { key: 'green', label: 'Green', min: 2, max: 32, step: 1, defaultValue: 4 },
      { key: 'blue', label: 'Blue', min: 2, max: 32, step: 1, defaultValue: 4 },
    ],
  },
  {
    id: 'sepia', name: 'Sepia', category: 'adjustment',
    icon: 'adjustments-sepia-symbolic.svg', description: 'Apply a warm monochrome tone.', parameters: [],
  },
  {
    id: 'fragment', name: 'Fragment', category: 'blur',
    icon: 'effects-blurs-fragment-symbolic.svg', description: 'Blend rotated copies offset around each pixel.',
    parameters: [
      { key: 'fragments', label: 'Fragments', min: 2, max: 50, step: 1, defaultValue: 4 },
      { key: 'distance', label: 'Distance', min: 0, max: 100, step: 1, defaultValue: 8, unit: 'px' },
      { key: 'rotation', label: 'Rotation', min: 0, max: 360, step: 1, defaultValue: 0, unit: '°' },
    ],
  },
  {
    id: 'gaussian-blur', name: 'Gaussian Blur', category: 'blur',
    icon: 'effects-blurs-gaussianblur-symbolic.svg', description: 'Smooth detail with a Gaussian convolution.',
    parameters: [{ key: 'radius', label: 'Radius', min: 1, max: 30, step: 1, defaultValue: 4, unit: 'px' }],
  },
  {
    id: 'motion-blur', name: 'Motion Blur', category: 'blur',
    icon: 'effects-blurs-motionblur-symbolic.svg', description: 'Blur pixels along a configurable direction and distance.',
    parameters: [
      { key: 'angle', label: 'Angle', min: -180, max: 180, step: 1, defaultValue: 25, unit: '°' },
      { key: 'distance', label: 'Distance', min: 1, max: 200, step: 1, defaultValue: 10, unit: 'px' },
      { key: 'centered', label: 'Centered', min: 0, max: 1, step: 1, defaultValue: 1, kind: 'boolean' },
    ],
  },
  {
    id: 'radial-blur', name: 'Radial Blur', category: 'blur',
    icon: 'effects-blurs-radialblur-symbolic.svg', description: 'Blur around an adjustable rotational center.',
    parameters: [
      { key: 'angle', label: 'Angle', min: -180, max: 180, step: 1, defaultValue: 2, unit: '°' },
      { key: 'offsetX', label: 'Offset X', min: -1, max: 1, step: 0.05, defaultValue: 0 },
      { key: 'offsetY', label: 'Offset Y', min: -1, max: 1, step: 0.05, defaultValue: 0 },
      { key: 'quality', label: 'Quality', min: 1, max: 5, step: 1, defaultValue: 2 },
    ],
  },
  {
    id: 'unfocus', name: 'Unfocus', category: 'blur',
    icon: 'effects-blurs-unfocus-symbolic.svg', description: 'Average a square neighborhood for a broad defocus blur.',
    parameters: [{ key: 'radius', label: 'Radius', min: 1, max: 200, step: 1, defaultValue: 4, unit: 'px' }],
  },
  {
    id: 'zoom-blur', name: 'Zoom Blur', category: 'blur',
    icon: 'effects-blurs-zoomblur-symbolic.svg', description: 'Draw pixels toward an adjustable focal point.',
    parameters: [
      { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, defaultValue: 10, unit: '%' },
      { key: 'offsetX', label: 'Offset X', min: -1, max: 1, step: 0.05, defaultValue: 0 },
      { key: 'offsetY', label: 'Offset Y', min: -1, max: 1, step: 0.05, defaultValue: 0 },
    ],
  },
  {
    id: 'bulge', name: 'Bulge', category: 'distort',
    icon: 'effects-distort-bulge-symbolic.svg', description: 'Expand or pinch pixels around an adjustable center.',
    parameters: [
      { key: 'amount', label: 'Amount', min: -200, max: 100, step: 1, defaultValue: 45, unit: '%' },
      { key: 'offsetX', label: 'Offset X', min: -1, max: 1, step: 0.05, defaultValue: 0 },
      { key: 'offsetY', label: 'Offset Y', min: -1, max: 1, step: 0.05, defaultValue: 0 },
      { key: 'radiusPercentage', label: 'Radius Percentage', min: 10, max: 100, step: 1, defaultValue: 100, unit: '%' },
    ],
  },
  {
    id: 'dents', name: 'Dents', category: 'distort',
    icon: 'effects-distort-dents-symbolic.svg', description: 'Refract the image through turbulent procedural noise.',
    parameters: [
      { key: 'scale', label: 'Scale', min: 1, max: 200, step: 1, defaultValue: 25 },
      { key: 'refraction', label: 'Refraction', min: 0, max: 200, step: 1, defaultValue: 50 },
      { key: 'roughness', label: 'Roughness', min: 0, max: 100, step: 1, defaultValue: 10 },
      { key: 'turbulence', label: 'Turbulence', min: 0, max: 100, step: 1, defaultValue: 10 },
      { key: 'seed', label: 'Random Noise Seed', min: 0, max: 255, step: 1, defaultValue: 0 },
      { key: 'quality', label: 'Quality', min: 1, max: 5, step: 1, defaultValue: 2 },
      { key: 'offsetX', label: 'Offset X', min: -1, max: 1, step: 0.05, defaultValue: 0 },
      { key: 'offsetY', label: 'Offset Y', min: -1, max: 1, step: 0.05, defaultValue: 0 },
      { key: 'edgeBehavior', label: 'Edge Behavior', min: 0, max: 6, step: 1, defaultValue: 1, kind: 'select', options: EDGE_BEHAVIOR_OPTIONS },
    ],
  },
  {
    id: 'frosted-glass', name: 'Frosted Glass', category: 'distort',
    icon: 'effects-distort-frostedglass-symbolic.svg', description: 'Scatter pixels among nearby intensity groups.',
    parameters: [
      { key: 'amount', label: 'Amount', min: 1, max: 10, step: 1, defaultValue: 1, unit: 'px' },
      { key: 'seed', label: 'Random Noise Seed', min: 0, max: 2147483647, step: 1, defaultValue: 0 },
    ],
  },
  {
    id: 'pixelate', name: 'Pixelate', category: 'distort',
    icon: 'effects-distort-pixelate-symbolic.svg', description: 'Replace each cell with a blend of its four corner pixels.',
    parameters: [{ key: 'cellSize', label: 'Cell Size', min: 1, max: 100, step: 1, defaultValue: 2, unit: 'px' }],
  },
  {
    id: 'polar-inversion', name: 'Polar Inversion', category: 'distort',
    icon: 'effects-distort-polarinversion-symbolic.svg', description: 'Invert radial distance around an adjustable center.',
    parameters: [
      { key: 'amount', label: 'Amount', min: -4, max: 4, step: 0.1, defaultValue: 0 },
      { key: 'quality', label: 'Quality', min: 1, max: 5, step: 1, defaultValue: 2 },
      { key: 'offsetX', label: 'Offset X', min: -1, max: 1, step: 0.05, defaultValue: 0 },
      { key: 'offsetY', label: 'Offset Y', min: -1, max: 1, step: 0.05, defaultValue: 0 },
      { key: 'edgeBehavior', label: 'Edge Behavior', min: 0, max: 6, step: 1, defaultValue: 2, kind: 'select', options: EDGE_BEHAVIOR_OPTIONS },
    ],
  },
  {
    id: 'tile-reflection', name: 'Tile Reflection', category: 'distort',
    icon: 'effects-distort-tile-symbolic.svg', description: 'Create repeated wave-reflected tiles at an adjustable angle.',
    parameters: [
      { key: 'rotation', label: 'Rotation', min: -45, max: 45, step: 1, defaultValue: 30, unit: '°' },
      { key: 'tileSize', label: 'Tile Size', min: 2, max: 200, step: 1, defaultValue: 40, unit: 'px' },
      { key: 'intensity', label: 'Intensity', min: -20, max: 20, step: 1, defaultValue: 8 },
      { key: 'tileType', label: 'Tile Type', min: 0, max: 1, step: 1, defaultValue: 0, kind: 'select', options: [{ value: 0, label: 'Sharp Edges' }, { value: 1, label: 'Curved' }] },
      { key: 'edgeBehavior', label: 'Edge Behavior', min: 0, max: 6, step: 1, defaultValue: 1, kind: 'select', options: EDGE_BEHAVIOR_OPTIONS },
    ],
  },
  {
    id: 'twist', name: 'Twist', category: 'distort',
    icon: 'effects-distort-twist-symbolic.svg', description: 'Rotate pixels progressively toward an adjustable center.',
    parameters: [
      { key: 'amount', label: 'Amount', min: -100, max: 100, step: 1, defaultValue: 30 },
      { key: 'radiusPercentage', label: 'Radius Percentage', min: 0, max: 100, step: 1, defaultValue: 100, unit: '%' },
      { key: 'antialias', label: 'Antialias', min: 0, max: 5, step: 1, defaultValue: 2 },
      { key: 'offsetX', label: 'Offset X', min: -1, max: 1, step: 0.05, defaultValue: 0 },
      { key: 'offsetY', label: 'Offset Y', min: -1, max: 1, step: 0.05, defaultValue: 0 },
      { key: 'edgeBehavior', label: 'Edge Behavior', min: 0, max: 6, step: 1, defaultValue: 0, kind: 'select', options: EDGE_BEHAVIOR_OPTIONS },
    ],
  },
  {
    id: 'add-noise', name: 'Add Noise', category: 'noise',
    icon: 'effects-noise-addnoise-symbolic.svg', description: 'Add randomized luminance and color variation.',
    parameters: [
      { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, defaultValue: 24, unit: '%' },
      { key: 'colorSaturation', label: 'Color saturation', min: 0, max: 100, step: 1, defaultValue: 35, unit: '%' },
    ],
  },
  {
    id: 'median', name: 'Median', category: 'noise',
    icon: 'effects-noise-median-symbolic.svg', description: 'Replace each channel with a percentile from its circular neighborhood.',
    parameters: [
      { key: 'radius', label: 'Radius', min: 1, max: 200, step: 1, defaultValue: 10, unit: 'px' },
      { key: 'percentile', label: 'Percentile', min: 0, max: 100, step: 1, defaultValue: 50, unit: '%' },
    ],
  },
  {
    id: 'reduce-noise', name: 'Reduce Noise', category: 'noise',
    icon: 'effects-noise-reducenoise-symbolic.svg', description: 'Suppress local channel outliers while preserving tonal structure.',
    parameters: [
      { key: 'radius', label: 'Radius', min: 1, max: 200, step: 1, defaultValue: 6, unit: 'px' },
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
    ],
  },
  {
    id: 'ink-sketch', name: 'Ink Sketch', category: 'artistic',
    icon: 'effects-artistic-inksketch-symbolic.svg', description: 'Combine a glowing color wash with bold ink outlines.',
    parameters: [
      { key: 'inkOutline', label: 'Ink Outline', min: 0, max: 99, step: 1, defaultValue: 50, unit: '%' },
      { key: 'coloring', label: 'Coloring', min: 0, max: 100, step: 1, defaultValue: 50, unit: '%' },
    ],
  },
  {
    id: 'oil-painting', name: 'Oil Painting', category: 'artistic',
    icon: 'effects-artistic-oilpainting-symbolic.svg', description: 'Paint each pixel from the dominant local intensity band.',
    parameters: [
      { key: 'brushSize', label: 'Brush Size', min: 1, max: 8, step: 1, defaultValue: 3, unit: 'px' },
      { key: 'coarseness', label: 'Coarseness', min: 3, max: 255, step: 1, defaultValue: 50 },
    ],
  },
  {
    id: 'pencil-sketch', name: 'Pencil Sketch', category: 'artistic',
    icon: 'effects-artistic-pencilsketch-symbolic.svg', description: 'Create a monochrome pencil drawing with color-dodge shading.',
    parameters: [
      { key: 'pencilTipSize', label: 'Pencil Tip Size', min: 1, max: 20, step: 1, defaultValue: 2, unit: 'px' },
      { key: 'colorRange', label: 'Color Range', min: -20, max: 20, step: 1, defaultValue: 0 },
    ],
  },
  {
    id: 'dithering', name: 'Dithering', category: 'color',
    icon: 'effects-color-dithering-symbolic.svg', description: 'Reduce colors to a palette and diffuse quantization error.',
    parameters: [
      { key: 'diffusionMethod', label: 'Error Diffusion Method', min: 0, max: 8, step: 1, defaultValue: 7, kind: 'select', options: [
        { value: 0, label: 'Sierra' }, { value: 1, label: 'Two-Row Sierra' }, { value: 2, label: 'Sierra Lite' },
        { value: 3, label: 'Burkes' }, { value: 4, label: 'Atkinson' }, { value: 5, label: 'Stucki' },
        { value: 6, label: 'Jarvis-Judice-Ninke' }, { value: 7, label: 'Floyd-Steinberg' }, { value: 8, label: 'Floyd-Steinberg Lite' },
      ] },
      { key: 'paletteSource', label: 'Palette Source', min: 0, max: 2, step: 1, defaultValue: 0, kind: 'select', options: [
        { value: 0, label: 'Preset Palettes' }, { value: 1, label: 'Current Palette' }, { value: 2, label: 'Recently Used Colors' },
      ] },
      { key: 'paletteChoice', label: 'Palette', min: 0, max: 7, step: 1, defaultValue: 2, kind: 'select', visibleWhen: { key: 'paletteSource', equals: 0 }, options: [
        { value: 0, label: 'Black and White' }, { value: 1, label: 'Old MS Paint' }, { value: 2, label: 'Old Windows 16' },
        { value: 3, label: 'Old Windows 20' }, { value: 4, label: '3-bit RGB' }, { value: 5, label: 'RGB 6×6×6' },
        { value: 6, label: '6-bit RGB' }, { value: 7, label: '12-bit RGB' },
      ] },
    ],
  },
  {
    id: 'cells', name: 'Cells', category: 'render',
    icon: 'effects-render-cells-symbolic.svg', description: 'Render distance fields around generated control points.',
    parameters: [
      { key: 'distanceMetric', label: 'Distance Metric', min: 0, max: 2, step: 1, defaultValue: 0, kind: 'select', options: DISTANCE_OPTIONS },
      { key: 'pointArrangement', label: 'Point Arrangement', min: 0, max: 2, step: 1, defaultValue: 0, kind: 'select', options: POINT_ARRANGEMENT_OPTIONS },
      { key: 'pointSeed', label: 'Random Point Locations', min: 0, max: 2147483647, step: 1, defaultValue: 0, visibleWhen: { key: 'pointArrangement', equals: 0 } },
      { key: 'showPoints', label: 'Show Points', min: 0, max: 1, step: 1, defaultValue: 0, kind: 'boolean' },
      { key: 'pointSize', label: 'Point Size', min: 1, max: 16, step: 1, defaultValue: 4, visibleWhen: { key: 'showPoints', equals: 1 } },
      { key: 'pointColor', label: 'Point Color', min: 0, max: 16777215, step: 1, defaultValue: 0, kind: 'color', visibleWhen: { key: 'showPoints', equals: 1 } },
      { key: 'numberOfCells', label: 'Number of Cells', min: 1, max: 1024, step: 1, defaultValue: 100 },
      { key: 'cellRadius', label: 'Cell Radius', min: 4, max: 100, step: 1, defaultValue: 32, unit: 'px' },
      { key: 'colorSchemeSource', label: 'Color Scheme Source', min: 0, max: 2, step: 1, defaultValue: 0, kind: 'select', options: COLOR_SCHEME_SOURCE_OPTIONS },
      { key: 'colorScheme', label: 'Color Scheme', min: 0, max: 8, step: 1, defaultValue: 1, kind: 'select', options: GRADIENT_OPTIONS, visibleWhen: { key: 'colorSchemeSource', equals: 0 } },
      { key: 'colorSchemeSeed', label: 'Random Color Scheme Seed', min: 0, max: 2147483647, step: 1, defaultValue: 0, visibleWhen: { key: 'colorSchemeSource', equals: 2 } },
      { key: 'reverseColorScheme', label: 'Reverse Color Scheme', min: 0, max: 1, step: 1, defaultValue: 0, kind: 'boolean' },
      { key: 'colorSchemeEdgeBehavior', label: 'Color Scheme Edge Behavior', min: 0, max: 6, step: 1, defaultValue: 0, kind: 'select', options: EDGE_BEHAVIOR_OPTIONS },
      { key: 'quality', label: 'Quality', min: 1, max: 4, step: 1, defaultValue: 3 },
    ],
  },
  {
    id: 'clouds', name: 'Clouds', category: 'render',
    icon: 'effects-render-clouds-symbolic.svg', description: 'Render layered Perlin noise through a color gradient.',
    parameters: [
      { key: 'scale', label: 'Scale', min: 2, max: 1000, step: 1, defaultValue: 250 },
      { key: 'power', label: 'Power', min: 0, max: 100, step: 1, defaultValue: 50, unit: '%' },
      { key: 'seed', label: 'Random Noise Seed', min: 0, max: 2147483647, step: 1, defaultValue: 0 },
      { key: 'colorSchemeSource', label: 'Color Scheme Source', min: 0, max: 2, step: 1, defaultValue: 1, kind: 'select', options: COLOR_SCHEME_SOURCE_OPTIONS },
      { key: 'colorScheme', label: 'Color Scheme', min: 0, max: 8, step: 1, defaultValue: 0, kind: 'select', options: GRADIENT_OPTIONS, visibleWhen: { key: 'colorSchemeSource', equals: 0 } },
      { key: 'colorSchemeSeed', label: 'Random Color Scheme Seed', min: 0, max: 2147483647, step: 1, defaultValue: 0, visibleWhen: { key: 'colorSchemeSource', equals: 2 } },
      { key: 'reverseColorScheme', label: 'Reverse Color Scheme', min: 0, max: 1, step: 1, defaultValue: 0, kind: 'boolean' },
    ],
  },
  {
    id: 'julia-fractal', name: 'Julia Fractal', category: 'render',
    icon: 'effects-render-juliafractal-symbolic.svg', description: 'Render a rotated Julia set with gradient coloring.',
    parameters: [
      { key: 'factor', label: 'Factor', min: 1, max: 10, step: 1, defaultValue: 4 },
      { key: 'quality', label: 'Quality', min: 1, max: 5, step: 1, defaultValue: 2 },
      { key: 'zoom', label: 'Zoom', min: 0.5, max: 50, step: 0.5, defaultValue: 1 },
      { key: 'colorSchemeSource', label: 'Color Scheme Source', min: 0, max: 2, step: 1, defaultValue: 0, kind: 'select', options: COLOR_SCHEME_SOURCE_OPTIONS },
      { key: 'colorScheme', label: 'Color Scheme', min: 0, max: 8, step: 1, defaultValue: 2, kind: 'select', options: GRADIENT_OPTIONS, visibleWhen: { key: 'colorSchemeSource', equals: 0 } },
      { key: 'colorSchemeSeed', label: 'Random Color Scheme Seed', min: 0, max: 2147483647, step: 1, defaultValue: 0, visibleWhen: { key: 'colorSchemeSource', equals: 2 } },
      { key: 'reverseColorScheme', label: 'Reverse Color Scheme', min: 0, max: 1, step: 1, defaultValue: 0, kind: 'boolean' },
      { key: 'angle', label: 'Angle', min: -180, max: 180, step: 1, defaultValue: 0, unit: '°' },
    ],
  },
  {
    id: 'mandelbrot-fractal', name: 'Mandelbrot Fractal', category: 'render',
    icon: 'effects-render-mandelbrotfractal-symbolic.svg', description: 'Render a zoomed and rotated Mandelbrot set.',
    parameters: [
      { key: 'factor', label: 'Factor', min: 1, max: 10, step: 1, defaultValue: 1 },
      { key: 'quality', label: 'Quality', min: 1, max: 5, step: 1, defaultValue: 2 },
      { key: 'zoom', label: 'Zoom', min: 0, max: 100, step: 0.5, defaultValue: 10 },
      { key: 'angle', label: 'Angle', min: -180, max: 180, step: 1, defaultValue: 0, unit: '°' },
      { key: 'colorSchemeSource', label: 'Color Scheme Source', min: 0, max: 2, step: 1, defaultValue: 0, kind: 'select', options: COLOR_SCHEME_SOURCE_OPTIONS },
      { key: 'colorScheme', label: 'Color Scheme', min: 0, max: 8, step: 1, defaultValue: 5, kind: 'select', options: GRADIENT_OPTIONS, visibleWhen: { key: 'colorSchemeSource', equals: 0 } },
      { key: 'colorSchemeSeed', label: 'Random Color Scheme Seed', min: 0, max: 2147483647, step: 1, defaultValue: 0, visibleWhen: { key: 'colorSchemeSource', equals: 2 } },
      { key: 'reverseColorScheme', label: 'Reverse Color Scheme', min: 0, max: 1, step: 1, defaultValue: 0, kind: 'boolean' },
      { key: 'invertColors', label: 'Invert Colors', min: 0, max: 1, step: 1, defaultValue: 0, kind: 'boolean' },
    ],
  },
  {
    id: 'voronoi-diagram', name: 'Voronoi Diagram', category: 'render',
    icon: 'effects-default-symbolic.svg', description: 'Fill generated Voronoi cells with deterministic colors.',
    parameters: [
      { key: 'distanceMetric', label: 'Distance Metric', min: 0, max: 2, step: 1, defaultValue: 0, kind: 'select', options: DISTANCE_OPTIONS },
      { key: 'numberOfCells', label: 'Number of Cells', min: 1, max: 1024, step: 1, defaultValue: 100 },
      { key: 'colorSorting', label: 'Color Sorting', min: 0, max: 6, step: 1, defaultValue: 0, kind: 'select', options: [
        { value: 0, label: 'Random' }, { value: 1, label: 'Horizontal blue (B)' }, { value: 2, label: 'Horizontal green (G)' },
        { value: 3, label: 'Horizontal red (R)' }, { value: 4, label: 'Vertical blue (B)' }, { value: 5, label: 'Vertical green (G)' },
        { value: 6, label: 'Vertical red (R)' },
      ] },
      { key: 'reverseColorSorting', label: 'Reverse Color Sorting', min: 0, max: 1, step: 1, defaultValue: 0, kind: 'boolean' },
      { key: 'colorSeed', label: 'Random Colors', min: 0, max: 2147483647, step: 1, defaultValue: 0 },
      { key: 'pointArrangement', label: 'Point Arrangement', min: 0, max: 2, step: 1, defaultValue: 0, kind: 'select', options: POINT_ARRANGEMENT_OPTIONS },
      { key: 'pointSeed', label: 'Random Point Locations', min: 0, max: 2147483647, step: 1, defaultValue: 0, visibleWhen: { key: 'pointArrangement', equals: 0 } },
      { key: 'showPoints', label: 'Show Points', min: 0, max: 1, step: 1, defaultValue: 0, kind: 'boolean' },
      { key: 'pointSize', label: 'Point Size', min: 1, max: 16, step: 1, defaultValue: 4, visibleWhen: { key: 'showPoints', equals: 1 } },
      { key: 'pointColor', label: 'Point Color', min: 0, max: 16777215, step: 1, defaultValue: 0, kind: 'color', visibleWhen: { key: 'showPoints', equals: 1 } },
      { key: 'quality', label: 'Quality', min: 1, max: 4, step: 1, defaultValue: 3 },
    ],
  },
  {
    id: 'align-object', name: 'Align Object', category: 'object', dialog: 'alignment',
    icon: 'tool-move-symbolic.svg', description: 'Move the non-background object to a selected position inside the selection.',
    parameters: [],
  },
  {
    id: 'feather-object', name: 'Feather Object', category: 'object',
    icon: 'effects-object-featherobject-symbolic.svg', description: 'Fade object alpha inward from its transparent boundary.',
    parameters: [
      { key: 'radius', label: 'Radius', min: 1, max: 100, step: 1, defaultValue: 6, unit: 'px' },
      { key: 'tolerance', label: 'Tolerance', min: 0, max: 255, step: 1, defaultValue: 20 },
      { key: 'featherCanvasEdge', label: 'Feather Canvas Edge', min: 0, max: 1, step: 1, defaultValue: 0, kind: 'boolean' },
    ],
  },
  {
    id: 'outline-object', name: 'Outline Object', category: 'object',
    icon: 'effects-stylize-outline-symbolic.svg', description: 'Draw a palette-colored outline around opaque objects.',
    parameters: [
      { key: 'radius', label: 'Radius', min: 0, max: 100, step: 1, defaultValue: 6, unit: 'px' },
      { key: 'tolerance', label: 'Tolerance', min: 0, max: 255, step: 1, defaultValue: 20 },
      { key: 'alphaGradient', label: 'Alpha Gradient', min: 0, max: 1, step: 1, defaultValue: 1, kind: 'boolean' },
      { key: 'colorGradient', label: 'Color Gradient', min: 0, max: 1, step: 1, defaultValue: 1, kind: 'boolean' },
      { key: 'outlineBorder', label: 'Outline Border', min: 0, max: 1, step: 1, defaultValue: 0, kind: 'boolean' },
      { key: 'fillObjectBackground', label: 'Fill Object Background', min: 0, max: 1, step: 1, defaultValue: 1, kind: 'boolean' },
    ],
  },
  {
    id: 'glow', name: 'Glow', category: 'photo',
    icon: 'effects-photo-glow-symbolic.svg', description: 'Blend a softened, brighter copy into the image.',
    parameters: [
      { key: 'radius', label: 'Radius', min: 1, max: 24, step: 1, defaultValue: 6, unit: 'px' },
      { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, defaultValue: 10, unit: '%' },
      { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, defaultValue: 10, unit: '%' },
    ],
  },
  {
    id: 'red-eye-removal', name: 'Red Eye Removal', category: 'photo',
    icon: 'effects-photo-redeyeremove-symbolic.svg', description: 'Reduce saturated red pixels inside the selected eye area.',
    parameters: [
      { key: 'tolerance', label: 'Tolerance', min: 0, max: 100, step: 1, defaultValue: 70 },
      { key: 'saturation', label: 'Saturation Percentage', min: 0, max: 100, step: 1, defaultValue: 90, unit: '%' },
    ],
  },
  {
    id: 'sharpen', name: 'Sharpen', category: 'photo',
    icon: 'effects-photo-sharpen-symbolic.svg', description: 'Increase local edge contrast.',
    parameters: [{ key: 'amount', label: 'Amount', min: 1, max: 10, step: 1, defaultValue: 2 }],
  },
  {
    id: 'soften-portrait', name: 'Soften Portrait', category: 'photo',
    icon: 'effects-photo-softenportrait-symbolic.svg', description: 'Smooth detail while adjusting lighting and skin-tone warmth.',
    parameters: [
      { key: 'softness', label: 'Softness', min: 0, max: 10, step: 1, defaultValue: 5 },
      { key: 'lighting', label: 'Lighting', min: -20, max: 20, step: 1, defaultValue: 0 },
      { key: 'warmth', label: 'Warmth', min: 0, max: 20, step: 1, defaultValue: 10 },
    ],
  },
  {
    id: 'vignette', name: 'Vignette', category: 'photo',
    icon: 'effects-photo-vignette-symbolic.svg', description: 'Darken pixels progressively toward the image edges.',
    parameters: [
      { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, defaultValue: 55, unit: '%' },
      { key: 'radius', label: 'Radius', min: 10, max: 100, step: 1, defaultValue: 65, unit: '%' },
    ],
  },
  {
    id: 'edge-detect', name: 'Edge Detect', category: 'stylize',
    icon: 'effects-stylize-edgedetect-symbolic.svg', description: 'Detect directional color differences.',
    parameters: [{ key: 'angle', label: 'Angle', min: -180, max: 180, step: 1, defaultValue: 45, unit: '°' }],
  },
  {
    id: 'emboss', name: 'Emboss', category: 'stylize',
    icon: 'effects-stylize-emboss-symbolic.svg', description: 'Shade edges to create a raised surface.',
    parameters: [{ key: 'angle', label: 'Angle', min: -180, max: 180, step: 1, defaultValue: 0, unit: '°' }],
  },
  {
    id: 'outline-edge', name: 'Outline Edge', category: 'stylize',
    icon: 'effects-stylize-outline-symbolic.svg', description: 'Outline local channel differences over an adjustable neighborhood.',
    parameters: [
      { key: 'thickness', label: 'Thickness', min: 1, max: 200, step: 1, defaultValue: 3, unit: 'px' },
      { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, defaultValue: 50, unit: '%' },
    ],
  },
  {
    id: 'relief', name: 'Relief', category: 'stylize',
    icon: 'effects-stylize-relief-symbolic.svg', description: 'Apply a directional color-difference relief filter.',
    parameters: [{ key: 'angle', label: 'Angle', min: -180, max: 180, step: 1, defaultValue: 45, unit: '°' }],
  },
];

export const EFFECT_BY_ID = Object.fromEntries(
  EFFECT_DEFINITIONS.map((effect) => [effect.id, effect]),
) as Record<EffectId, EffectDefinition>;

export function defaultEffectParameters(effect: EffectDefinition): EffectParameters {
  if (effect.id === 'curves') return defaultCurveParameters();
  if (effect.id === 'levels') {
    const parameters: EffectParameters = {};
    for (const channel of ['red', 'green', 'blue']) {
      parameters[`levels_${channel}_inputLow`] = 0;
      parameters[`levels_${channel}_inputHigh`] = 255;
      parameters[`levels_${channel}_gamma`] = 1;
      parameters[`levels_${channel}_outputLow`] = 0;
      parameters[`levels_${channel}_outputHigh`] = 255;
    }
    return parameters;
  }
  return Object.fromEntries(effect.parameters.map((parameter) => [parameter.key, parameter.defaultValue]));
}
