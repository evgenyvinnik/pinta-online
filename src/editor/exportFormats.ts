import { context2d } from './canvasContext';
import { makeCanvas } from './canvasUtils';
import { makeLayer, paintLayer } from './layerSnapshots';
import {
  decodeBitmap,
  decodePortablePixmap,
  decodeTarga,
  decodeTiff,
  encodeBitmap,
  encodePortablePixmap,
  encodeTarga,
  encodeTiff,
} from './imageCodecs';
import { decodeOpenRasterArchive, encodeOpenRasterArchive } from './openRaster';
import type { ExportFormat, PaintLayer } from './types';

export function exportFormatFromFileName(fileName: string): ExportFormat | null {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'png';
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
  if (extension === 'webp') return 'webp';
  if (extension === 'bmp') return 'bmp';
  if (extension === 'tif' || extension === 'tiff') return 'tiff';
  if (extension === 'ora') return 'ora';
  if (extension === 'ppm') return 'ppm';
  if (extension === 'tga') return 'tga';
  return null;
}

export function exportExtension(format: ExportFormat) {
  if (format === 'jpeg') return 'jpg';
  if (format === 'tiff') return 'tif';
  return format;
}

export function exportMimeType(format: ExportFormat) {
  if (format === 'ora') return 'image/openraster';
  if (format === 'ppm') return 'image/x-portable-pixmap';
  if (format === 'tga') return 'image/x-tga';
  if (format === 'bmp') return 'image/bmp';
  if (format === 'tiff') return 'image/tiff';
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

export function canvasBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function writeExportBlob(blob: Blob, savedName: string, fileHandle?: FileSystemFileHandle) {
  if (fileHandle) {
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
    return fileHandle.name;
  }
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.download = savedName;
  link.href = url;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return savedName;
}

export async function canvasPngBytes(canvas: HTMLCanvasElement) {
  const blob = await canvasBlob(canvas);
  if (!blob) throw new Error('The canvas could not be encoded as PNG.');
  return new Uint8Array(await blob.arrayBuffer());
}

export function bytesBlob(bytes: Uint8Array, type: string) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type });
}

export async function createDocumentExportBlob(
  layers: PaintLayer[],
  width: number,
  height: number,
  format: ExportFormat,
  quality = 0.92,
) {
  const output = makeCanvas(width, height);
  const context = context2d(output);
  if (format === 'jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
  }
  for (const layer of layers) paintLayer(context, layer);
  if (format === 'ora') {
    return bytesBlob(
      await createOpenRasterArchive(layers, output.width, output.height, output),
      exportMimeType(format),
    );
  }
  if (format === 'ppm' || format === 'tga' || format === 'bmp' || format === 'tiff') {
    const pixels = context.getImageData(0, 0, output.width, output.height);
    const bytes =
      format === 'ppm'
        ? encodePortablePixmap(pixels)
        : format === 'tga'
          ? encodeTarga(pixels)
          : format === 'bmp'
            ? encodeBitmap(pixels)
            : encodeTiff(pixels);
    return bytesBlob(bytes, exportMimeType(format));
  }
  const mimeType = exportMimeType(format);
  const encoded = await canvasBlob(output, mimeType, quality);
  // Browsers are allowed to silently fall back to PNG when a requested canvas
  // encoder is unavailable. Never download PNG bytes under a WebP/JPEG name.
  if (!encoded || encoded.type !== mimeType)
    throw new Error('Pinta does not support saving images in this file format.');
  return encoded;
}

export async function drawPngBytes(canvas: HTMLCanvasElement, bytes: Uint8Array, x = 0, y = 0) {
  const bitmap = await createImageBitmap(bytesBlob(bytes, 'image/png'));
  context2d(canvas).drawImage(bitmap, x, y);
  bitmap.close();
}

export async function openRasterArchive(file: File) {
  const decoded = decodeOpenRasterArchive(new Uint8Array(await file.arrayBuffer()));
  const layers: PaintLayer[] = [];
  for (const decodedLayer of decoded.layers) {
    try {
      const layer = makeLayer(decoded.width, decoded.height, decodedLayer.name);
      layer.visible = decodedLayer.visible;
      layer.opacity = decodedLayer.opacity;
      layer.blendMode = decodedLayer.blendMode;
      await drawPngBytes(layer.canvas, decodedLayer.png, decodedLayer.x, decodedLayer.y);
      layers.push(layer);
    } catch {
      // Match desktop Pinta: a damaged layer is skipped while the remaining
      // layers are still opened.
    }
  }
  if (!layers.length) throw new Error('This OpenRaster file does not contain any readable layers.');
  return { width: decoded.width, height: decoded.height, layers };
}

export async function createOpenRasterArchive(
  layers: PaintLayer[],
  width: number,
  height: number,
  merged: HTMLCanvasElement,
) {
  const encodedLayers = [];
  for (const layer of layers)
    encodedLayers.push({
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      x: 0,
      y: 0,
      png: await canvasPngBytes(layer.canvas),
    });
  const thumbnailScale = Math.min(1, 256 / Math.max(width, height));
  const thumbnail = makeCanvas(
    Math.max(1, Math.round(width * thumbnailScale)),
    Math.max(1, Math.round(height * thumbnailScale)),
  );
  context2d(thumbnail).drawImage(merged, 0, 0, thumbnail.width, thumbnail.height);
  return encodeOpenRasterArchive({
    width,
    height,
    layers: encodedLayers,
    mergedPng: await canvasPngBytes(merged),
    thumbnailPng: await canvasPngBytes(thumbnail),
  });
}

export async function decodeImageFile(file: File): Promise<{ width: number; height: number; layers: PaintLayer[] }> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.ora') || file.type === 'image/openraster') return openRasterArchive(file);
  if (
    lowerName.endsWith('.ppm') ||
    lowerName.endsWith('.tga') ||
    lowerName.endsWith('.bmp') ||
    lowerName.endsWith('.tif') ||
    lowerName.endsWith('.tiff') ||
    file.type === 'image/x-portable-pixmap' ||
    file.type === 'image/x-tga' ||
    file.type === 'image/bmp' ||
    file.type === 'image/tiff'
  ) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded =
      lowerName.endsWith('.ppm') || file.type === 'image/x-portable-pixmap'
        ? decodePortablePixmap(bytes)
        : lowerName.endsWith('.bmp') || file.type === 'image/bmp'
          ? decodeBitmap(bytes)
          : lowerName.endsWith('.tif') || lowerName.endsWith('.tiff') || file.type === 'image/tiff'
            ? decodeTiff(bytes)
            : decodeTarga(bytes);
    const layer = makeLayer(decoded.width, decoded.height, file.name);
    const context = context2d(layer.canvas);
    const image = context.createImageData(decoded.width, decoded.height);
    image.data.set(decoded.data);
    context.putImageData(image, 0, 0);
    return { width: decoded.width, height: decoded.height, layers: [layer] };
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const layer = makeLayer(image.naturalWidth, image.naturalHeight, file.name);
      context2d(layer.canvas).drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight, layers: [layer] });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be opened.'));
    };
    image.src = url;
  });
}
