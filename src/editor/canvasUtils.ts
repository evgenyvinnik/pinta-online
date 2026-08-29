import { context2d } from './canvasContext';

export function imageDataCanvas(pixels: ImageData) {
  const canvas = makeCanvas(pixels.width, pixels.height);
  context2d(canvas).putImageData(pixels, 0, 0);
  return canvas;
}

export function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function cloneCanvas(source: HTMLCanvasElement) {
  const clone = makeCanvas(source.width, source.height);
  context2d(clone).drawImage(source, 0, 0);
  return clone;
}

export function canvasesHaveSamePixels(left: HTMLCanvasElement, right: HTMLCanvasElement) {
  if (left.width !== right.width || left.height !== right.height) return false;
  const leftData = context2d(left).getImageData(0, 0, left.width, left.height).data;
  const rightData = context2d(right).getImageData(0, 0, right.width, right.height).data;
  if (leftData.length !== rightData.length) return false;
  for (let index = 0; index < leftData.length; index += 1) {
    if (leftData[index] !== rightData[index]) return false;
  }
  return true;
}

export function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `layer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function imageDataEqual(first: ImageData, second: ImageData) {
  if (first.width !== second.width || first.height !== second.height || first.data.length !== second.data.length)
    return false;
  for (let index = 0; index < first.data.length; index += 1) {
    if (first.data[index] !== second.data[index]) return false;
  }
  return true;
}

export function colorToRgba(color: string) {
  const value = color.replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
    a: value.length >= 8 ? Number.parseInt(value.slice(6, 8), 16) : 255,
  };
}

export function rgbaToHex(r: number, g: number, b: number, a = 255) {
  const rgb = `#${[r, g, b]
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
  return a >= 255
    ? rgb
    : `${rgb}${Math.max(0, Math.min(255, Math.round(a)))
        .toString(16)
        .padStart(2, '0')}`;
}

export function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
