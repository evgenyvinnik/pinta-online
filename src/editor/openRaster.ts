import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { BlendMode } from './types';

export interface OpenRasterLayerData {
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  x: number;
  y: number;
  png: Uint8Array;
}

export interface OpenRasterData {
  width: number;
  height: number;
  layers: OpenRasterLayerData[];
  mergedPng?: Uint8Array;
  thumbnailPng?: Uint8Array;
}

const SUPPORTED_BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'color-burn', 'color-dodge', 'overlay', 'difference', 'lighten', 'darken',
  'screen', 'xor', 'hard-light', 'soft-light', 'color', 'luminosity', 'hue', 'saturation',
];

function blendModeFromOra(value: string | undefined): BlendMode {
  const normalized = value?.replace(/^svg:/, '') ?? 'normal';
  return SUPPORTED_BLEND_MODES.includes(normalized as BlendMode) ? normalized as BlendMode : 'normal';
}

function blendModeToOra(value: BlendMode) {
  return value === 'normal' ? 'svg:src-over' : `svg:${value}`;
}

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function attributesOf(tag: string) {
  const attributes: Record<string, string> = {};
  const expression = /([\w:-]+)\s*=\s*(["'])(.*?)\2/g;
  for (const match of tag.matchAll(expression)) attributes[match[1]] = decodeXml(match[3]);
  return attributes;
}

export function createOpenRasterStackXml(width: number, height: number, layersTopToBottom: Omit<OpenRasterLayerData, 'png'>[]) {
  const layerXml = layersTopToBottom.map((layer, index) => (
    `    <layer name="${escapeXml(layer.name)}" src="data/layer${index}.png" visibility="${layer.visible ? 'visible' : 'hidden'}" opacity="${layer.opacity.toFixed(6)}" composite-op="${blendModeToOra(layer.blendMode)}" x="${Math.trunc(layer.x)}" y="${Math.trunc(layer.y)}"/>`
  ));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.5" w="${width}" h="${height}" name="Pinta Online">\n  <stack name="root">\n${layerXml.join('\n')}\n  </stack>\n</image>\n`;
}

export function encodeOpenRasterArchive(data: OpenRasterData) {
  const topToBottom = [...data.layers].reverse();
  const files: Zippable = {
    mimetype: [strToU8('image/openraster'), { level: 0 }],
    'stack.xml': strToU8(createOpenRasterStackXml(data.width, data.height, topToBottom)),
  };
  topToBottom.forEach((layer, index) => { files[`data/layer${index}.png`] = layer.png; });
  if (data.mergedPng) files['mergedimage.png'] = data.mergedPng;
  if (data.thumbnailPng) files['Thumbnails/thumbnail.png'] = data.thumbnailPng;
  return zipSync(files, { level: 6 });
}

export function decodeOpenRasterArchive(bytes: Uint8Array): OpenRasterData {
  const archive = unzipSync(bytes);
  const stackBytes = archive['stack.xml'];
  if (!stackBytes) throw new Error('This OpenRaster file does not contain stack.xml.');
  const xml = strFromU8(stackBytes);
  const imageTag = xml.match(/<image\b[^>]*>/i)?.[0];
  if (!imageTag) throw new Error('The OpenRaster layer description is invalid.');
  const imageAttributes = attributesOf(imageTag);
  const width = Number.parseInt(imageAttributes.w ?? '', 10);
  const height = Number.parseInt(imageAttributes.h ?? '', 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error('The OpenRaster image dimensions are invalid.');
  const layerTags = Array.from(xml.matchAll(/<layer\b[^>]*\/?\s*>/gi), (match) => match[0]);
  if (!layerTags.length) throw new Error('This OpenRaster file does not contain any layers.');
  const layers = layerTags.flatMap((tag, index) => {
    const attributes = attributesOf(tag);
    const source = attributes.src;
    if (!source || !archive[source]) return [];
    const parsedOpacity = Number.parseFloat(attributes.opacity ?? '1');
    const parsedX = Number.parseInt(attributes.x ?? '0', 10);
    const parsedY = Number.parseInt(attributes.y ?? '0', 10);
    return [{
      name: attributes.name || `Layer ${index + 1}`,
      visible: attributes.visibility !== 'hidden',
      opacity: Number.isFinite(parsedOpacity) ? Math.max(0, Math.min(1, parsedOpacity)) : 1,
      blendMode: blendModeFromOra(attributes['composite-op']),
      x: Number.isFinite(parsedX) ? parsedX : 0,
      y: Number.isFinite(parsedY) ? parsedY : 0,
      png: archive[source],
    } satisfies OpenRasterLayerData];
  }).reverse();
  if (!layers.length) throw new Error('This OpenRaster file does not contain any readable layers.');
  return {
    width,
    height,
    layers,
    mergedPng: archive['mergedimage.png'],
    thumbnailPng: archive['Thumbnails/thumbnail.png'],
  };
}
