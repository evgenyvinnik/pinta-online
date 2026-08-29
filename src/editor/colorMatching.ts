import { context2d } from './canvasContext';
import { colorToRgba, makeCanvas, rgbaToHex } from './canvasUtils';
import type { Point, Selection, ToolId } from './types';

export function colorDifferenceWithinTolerance(
  red: number,
  green: number,
  blue: number,
  alpha: number,
  target: readonly number[],
  tolerance: number,
) {
  const difference = (red - target[0]) ** 2 + (green - target[1]) ** 2 + (blue - target[2]) ** 2 + (alpha - target[3]) ** 2;
  return difference <= tolerance * tolerance * 4;
}

export function floodTolerance(sliderValue: number) {
  const fraction = Math.max(0, Math.min(100, sliderValue)) / 100;
  return Math.trunc(fraction * fraction * 256);
}

export function recolorColorTolerance(sliderValue: number) {
  return Math.trunc(Math.max(0, Math.min(100, sliderValue)) / 100 * 256);
}

export function magicWandSelection(source: HTMLCanvasElement, x: number, y: number, tolerance: number, global = false): Selection {
  const width = source.width;
  const height = source.height;
  const context = context2d(source);
  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  const startX = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const startY = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const startPixel = startY * width + startX;
  const startIndex = startPixel * 4;
  const target = [pixels[startIndex], pixels[startIndex + 1], pixels[startIndex + 2], pixels[startIndex + 3]];
  const visited = new Uint8Array(width * height);
  const selected = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let read = 0;
  let write = 0;
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  queue[write++] = startPixel;
  visited[startPixel] = 1;

  const matches = (pixel: number) => {
    const index = pixel * 4;
    return colorDifferenceWithinTolerance(
      pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3], target, floodTolerance(tolerance),
    );
  };

  if (global) {
    minX = width;
    minY = height;
    maxX = -1;
    maxY = -1;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      if (!matches(pixel)) continue;
      selected[pixel] = 1;
      const px = pixel % width;
      const py = Math.floor(pixel / width);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  } else {
    while (read < write) {
      const pixel = queue[read++];
      if (!matches(pixel)) continue;
      selected[pixel] = 1;
      const px = pixel % width;
      const py = Math.floor(pixel / width);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
      const neighbors = [
        px > 0 ? pixel - 1 : -1,
        px < width - 1 ? pixel + 1 : -1,
        py > 0 ? pixel - width : -1,
        py < height - 1 ? pixel + width : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || visited[neighbor]) continue;
        visited[neighbor] = 1;
        queue[write++] = neighbor;
      }
    }
  }

  const maskWidth = maxX - minX + 1;
  const maskHeight = maxY - minY + 1;
  const mask = makeCanvas(maskWidth, maskHeight);
  const maskContext = context2d(mask);
  const maskImage = maskContext.createImageData(maskWidth, maskHeight);
  for (let localY = 0; localY < maskHeight; localY += 1) {
    for (let localX = 0; localX < maskWidth; localX += 1) {
      const sourcePixel = (minY + localY) * width + minX + localX;
      if (!selected[sourcePixel]) continue;
      const index = (localY * maskWidth + localX) * 4;
      maskImage.data[index] = 255;
      maskImage.data[index + 1] = 255;
      maskImage.data[index + 2] = 255;
      maskImage.data[index + 3] = 255;
    }
  }
  maskContext.putImageData(maskImage, 0, 0);
  return {
    tool: 'magic-wand',
    start: { x: minX, y: minY },
    end: { x: maxX + 1, y: maxY + 1 },
    mask,
  };
}

export function getAnchorOffset(oldSize: number, newSize: number, position: 'start' | 'center' | 'end') {
  if (position === 'start') return 0;
  if (position === 'end') return newSize - oldSize;
  return Math.round((newSize - oldSize) / 2);
}

export function sampleCanvasColor(canvas: HTMLCanvasElement, point: Point, sampleSize: number) {
  const size = Math.max(1, Math.min(9, Math.round(sampleSize)));
  const half = Math.floor(size / 2);
  const left = Math.max(0, Math.min(canvas.width - 1, Math.floor(point.x) - half));
  const top = Math.max(0, Math.min(canvas.height - 1, Math.floor(point.y) - half));
  const width = Math.min(size, canvas.width - left);
  const height = Math.min(size, canvas.height - top);
  const pixels = context2d(canvas).getImageData(left, top, width, height).data;
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  let alphaTotal = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    red += pixels[index] * alpha;
    green += pixels[index + 1] * alpha;
    blue += pixels[index + 2] * alpha;
    weight += alpha;
    alphaTotal += pixels[index + 3];
  }
  if (weight === 0) return '#00000000';
  return rgbaToHex(red / weight, green / weight, blue / weight, alphaTotal / (pixels.length / 4));
}

export function floodFill(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  color: string,
  tolerance = 0,
  global = false,
  allowedMask?: Uint8ClampedArray,
) {
  const context = context2d(canvas);
  const width = canvas.width;
  const height = canvas.height;
  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  const startX = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const startY = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const start = (startY * width + startX) * 4;
  const target = [pixels[start], pixels[start + 1], pixels[start + 2], pixels[start + 3]];
  const replacement = colorToRgba(color);
  const startPixel = startY * width + startX;

  if (allowedMask && allowedMask[startPixel * 4 + 3] === 0) return false;

  if (
    target[0] === replacement.r && target[1] === replacement.g &&
    target[2] === replacement.b && target[3] === replacement.a
  ) return false;

  const threshold = floodTolerance(tolerance);
  const matches = (index: number) => colorDifferenceWithinTolerance(
    pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3], target, threshold,
  ) && (!allowedMask || allowedMask[index + 3] !== 0);

  const paint = (index: number) => {
    pixels[index] = replacement.r;
    pixels[index + 1] = replacement.g;
    pixels[index + 2] = replacement.b;
    pixels[index + 3] = replacement.a;
  };

  if (global) {
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const index = pixel * 4;
      if (matches(index)) paint(index);
    }
    context.putImageData(image, 0, 0);
    return true;
  }

  const queue = new Int32Array(width * height);
  let read = 0;
  let write = 0;
  queue[write++] = startY * width + startX;
  paint(start);

  while (read < write) {
    const point = queue[read++];
    const px = point % width;
    const py = Math.floor(point / width);
    const neighbors = [
      px > 0 ? point - 1 : -1,
      px < width - 1 ? point + 1 : -1,
      py > 0 ? point - width : -1,
      py < height - 1 ? point + width : -1,
    ];
    for (const neighbor of neighbors) {
      if (neighbor < 0) continue;
      const index = neighbor * 4;
      if (matches(index)) {
        paint(index);
        queue[write++] = neighbor;
      }
    }
  }

  context.putImageData(image, 0, 0);
  return true;
}
