export const ADDIN_IDS = [
  'ars-kali-glitches',
  'block-brush',
  'colored-grayscale',
  'more-pixelates',
  'night-vision',
] as const;

export type AddinId = (typeof ADDIN_IDS)[number];

export interface AddinDefinition {
  id: AddinId;
  name: string;
  version: string;
  author: string;
  description: string;
  sourceUrl: string;
  license: string;
  capabilities: readonly string[];
  implementation: 'ported' | 'independent';
}

export const ADDIN_DEFINITIONS: readonly AddinDefinition[] = [
  {
    id: 'ars-kali-glitches',
    name: 'Ars Kali: Glitches',
    version: '0.1.1-web.1',
    author: 'Kali Rosenkreuz',
    description: 'A pack of stylized digital glitch, scanline, slicing, and artifact effects.',
    sourceUrl: 'https://github.com/hyenaheartbeats/Ars-Kali--Glitches',
    license: 'Independent web implementation',
    capabilities: [
      'Chromatic Aberration',
      'Scanlines',
      'Colored Artifacts',
      'Pixel Drag',
      'Row Slice',
      'Adjustment Noise',
    ],
    implementation: 'independent',
  },
  {
    id: 'block-brush',
    name: 'Block Brush',
    version: '0.2.4-web.1',
    author: 'Pinta Project / Cameron White',
    description: 'A hard-edged rectangular brush that paints continuous block-shaped strokes.',
    sourceUrl: 'https://github.com/PintaProject/BlockBrush',
    license: 'MIT/X11',
    capabilities: ['Block Brush tool'],
    implementation: 'ported',
  },
  {
    id: 'colored-grayscale',
    name: 'Colored Grayscale',
    version: '1.0.0-web.1',
    author: 'Intedai',
    description: 'Turns an image into grayscale on paper tinted with the current primary color.',
    sourceUrl: 'https://github.com/Intedai/ColoredGrayscaleAddin',
    license: 'Independent web implementation',
    capabilities: ['Colored Grayscale adjustment'],
    implementation: 'independent',
  },
  {
    id: 'more-pixelates',
    name: 'More Pixelates',
    version: '1.0.0-web.1',
    author: 'Matthieu Laurent',
    description: 'Adds configurable hexagonal pixelation with center or average sampling.',
    sourceUrl: 'https://github.com/Matthieu-LAURENT39/MorePixelatesAddin',
    license: 'MIT',
    capabilities: ['Hexagon Pixelate effect'],
    implementation: 'ported',
  },
  {
    id: 'night-vision',
    name: 'Night Vision Effect',
    version: '1.3.4-web.1',
    author: 'Pinta Project / Robert Nordan',
    description: 'Recolors the image with a night-vision green response and optional sensor noise.',
    sourceUrl: 'https://github.com/PintaProject/NightVisionEffect',
    license: 'MIT/X11',
    capabilities: ['Night Vision effect'],
    implementation: 'ported',
  },
] as const;

// Browser add-ins are bundled but opt-in, mirroring installation in desktop Pinta.
export const DEFAULT_ENABLED_ADDINS: AddinId[] = [];

export function isAddinId(value: string): value is AddinId {
  return (ADDIN_IDS as readonly string[]).includes(value);
}

export function isAddinEnabled(enabledAddins: readonly AddinId[], addinId?: AddinId) {
  return !addinId || enabledAddins.includes(addinId);
}
