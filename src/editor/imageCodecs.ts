export interface DecodedRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface RasterPixels extends DecodedRaster {}

const encoder = new TextEncoder();
function validateRaster(image: RasterPixels) {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1) {
    throw new Error('Invalid image dimensions.');
  }
  if (image.data.length !== image.width * image.height * 4) throw new Error('Invalid image pixel buffer.');
}

function isAsciiWhitespace(value: number) {
  return value === 9 || value === 10 || value === 11 || value === 12 || value === 13 || value === 32;
}

function readPortablePixmapToken(bytes: Uint8Array, initialOffset: number) {
  let offset = initialOffset;
  while (offset < bytes.length) {
    if (isAsciiWhitespace(bytes[offset])) {
      offset += 1;
      continue;
    }
    if (bytes[offset] === 35) {
      while (offset < bytes.length && bytes[offset] !== 10 && bytes[offset] !== 13) offset += 1;
      continue;
    }
    break;
  }
  const start = offset;
  while (offset < bytes.length && !isAsciiWhitespace(bytes[offset]) && bytes[offset] !== 35) offset += 1;
  if (start === offset) throw new Error('The portable pixmap header is truncated.');
  return { token: String.fromCharCode(...bytes.subarray(start, offset)), offset };
}

export function decodePortablePixmap(bytes: Uint8Array): DecodedRaster {
  let offset = 0;
  const magic = readPortablePixmapToken(bytes, offset);
  offset = magic.offset;
  if (magic.token !== 'P3' && magic.token !== 'P6') throw new Error("Expected a 'P3' or 'P6' portable pixmap magic sequence.");
  const widthToken = readPortablePixmapToken(bytes, offset);
  offset = widthToken.offset;
  const heightToken = readPortablePixmapToken(bytes, offset);
  offset = heightToken.offset;
  const maxToken = readPortablePixmapToken(bytes, offset);
  offset = maxToken.offset;
  const width = Number(widthToken.token);
  const height = Number(heightToken.token);
  const maxValue = Number(maxToken.token);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Invalid portable pixmap dimensions.');
  if (!Number.isInteger(maxValue) || maxValue < 1 || maxValue > 65535) throw new Error('Invalid portable pixmap maximum color value.');
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > 268_435_455) throw new Error('Portable pixmap dimensions are too large.');
  const data = new Uint8ClampedArray(pixelCount * 4);

  if (magic.token === 'P3') {
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const component = readPortablePixmapToken(bytes, offset);
        offset = component.offset;
        const value = Number(component.token);
        if (!Number.isInteger(value) || value < 0 || value > maxValue) throw new Error('Portable pixmap color component is out of range.');
        data[pixel * 4 + channel] = Math.round(value * 255 / maxValue);
      }
      data[pixel * 4 + 3] = 255;
    }
    return { width, height, data };
  }

  if (offset >= bytes.length || !isAsciiWhitespace(bytes[offset])) throw new Error('The binary portable pixmap header is missing its raster separator.');
  if (bytes[offset] === 13 && bytes[offset + 1] === 10) offset += 2;
  else offset += 1;
  const bytesPerSample = maxValue < 256 ? 1 : 2;
  const rasterLength = pixelCount * 3 * bytesPerSample;
  if (bytes.length - offset < rasterLength) throw new Error('The portable pixmap is truncated.');
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = bytesPerSample === 1 ? bytes[offset++] : bytes[offset++] << 8 | bytes[offset++];
      if (value > maxValue) throw new Error('Portable pixmap color component is out of range.');
      data[pixel * 4 + channel] = Math.round(value * 255 / maxValue);
    }
    data[pixel * 4 + 3] = 255;
  }
  return { width, height, data };
}

export function encodePortablePixmap(image: RasterPixels) {
  validateRaster(image);
  const lines = ['P3', `${image.width} ${image.height}`, '255'];
  for (let y = 0; y < image.height; y += 1) {
    const pixels: string[] = [];
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      pixels.push(
        String(image.data[offset]).padStart(3),
        String(image.data[offset + 1]).padStart(3),
        String(image.data[offset + 2]).padStart(3),
      );
    }
    lines.push(pixels.join(' '));
  }
  return encoder.encode(`${lines.join('\n')}\n`);
}

function readUint16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | bytes[offset + 1] << 8;
}

function writeUint16(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = value >> 8 & 0xff;
}

function decodeTargaColor(bytes: Uint8Array, offset: number, depth: number, alphaBits = 0) {
  if (depth === 15 || depth === 16) {
    const value = readUint16(bytes, offset);
    return [
      Math.round(((value >> 10) & 0x1f) * 255 / 31),
      Math.round(((value >> 5) & 0x1f) * 255 / 31),
      Math.round((value & 0x1f) * 255 / 31),
      depth === 16 && alphaBits > 0 ? (value & 0x8000 ? 255 : 0) : 255,
    ] as const;
  }
  if (depth === 24) return [bytes[offset + 2], bytes[offset + 1], bytes[offset], 255] as const;
  if (depth === 32) return [bytes[offset + 2], bytes[offset + 1], bytes[offset], bytes[offset + 3]] as const;
  throw new Error(`Unsupported TGA color depth: ${depth}.`);
}

export function decodeTarga(bytes: Uint8Array): DecodedRaster {
  if (bytes.length < 18) throw new Error('The TGA file is truncated.');
  const idLength = bytes[0];
  const colorMapType = bytes[1];
  const imageType = bytes[2];
  const colorMapFirst = readUint16(bytes, 3);
  const colorMapLength = readUint16(bytes, 5);
  const colorMapDepth = bytes[7];
  const width = readUint16(bytes, 12);
  const height = readUint16(bytes, 14);
  const depth = bytes[16];
  const descriptor = bytes[17];
  if (!width || !height) throw new Error('Invalid TGA dimensions.');
  const isColorMapped = imageType === 1 || imageType === 9;
  const isTrueColor = imageType === 2 || imageType === 10;
  const isGrayscale = imageType === 3 || imageType === 11;
  const isRle = imageType === 9 || imageType === 10 || imageType === 11;
  if (!isColorMapped && !isTrueColor && !isGrayscale) throw new Error(`Unsupported TGA image type: ${imageType}.`);
  if (isColorMapped !== (colorMapType === 1)) throw new Error('The TGA color map header does not match its image type.');
  if (isTrueColor && ![15, 16, 24, 32].includes(depth)) throw new Error(`Unsupported TGA true-color depth: ${depth}.`);
  if (isGrayscale && depth !== 8 && depth !== 16) throw new Error(`Unsupported TGA grayscale depth: ${depth}.`);
  if (isColorMapped && depth !== 8 && depth !== 16) throw new Error(`Unsupported TGA color-map index depth: ${depth}.`);
  if (isColorMapped && ![15, 16, 24, 32].includes(colorMapDepth)) throw new Error(`Unsupported TGA color-map depth: ${colorMapDepth}.`);

  const colorMapBytesPerEntry = Math.ceil(colorMapDepth / 8);
  let offset = 18 + idLength;
  const colorMapBytes = colorMapLength * colorMapBytesPerEntry;
  if (bytes.length < offset + colorMapBytes) throw new Error('The TGA color map is truncated.');
  const colorMapOffset = offset;
  offset += colorMapBytes;
  const bytesPerPixel = Math.ceil(depth / 8);
  const topOrigin = Boolean(descriptor & 0x20);
  const rightOrigin = Boolean(descriptor & 0x10);
  const alphaBits = descriptor & 0x0f;
  const pixelCount = width * height;
  const data = new Uint8ClampedArray(width * height * 4);

  const readPixel = () => {
    if (bytes.length < offset + bytesPerPixel) throw new Error('The TGA pixel data is truncated.');
    let color: readonly [number, number, number, number];
    if (isColorMapped) {
      const index = depth === 8 ? bytes[offset] : readUint16(bytes, offset);
      const paletteIndex = index - colorMapFirst;
      if (paletteIndex < 0 || paletteIndex >= colorMapLength) throw new Error('TGA color-map index is out of range.');
      color = decodeTargaColor(bytes, colorMapOffset + paletteIndex * colorMapBytesPerEntry, colorMapDepth, alphaBits);
    } else if (isGrayscale) {
      color = [bytes[offset], bytes[offset], bytes[offset], depth === 16 ? bytes[offset + 1] : 255];
    } else {
      color = decodeTargaColor(bytes, offset, depth, alphaBits);
    }
    offset += bytesPerPixel;
    return color;
  };

  const writePixel = (sourceIndex: number, color: readonly [number, number, number, number]) => {
    const sourceX = sourceIndex % width;
    const sourceY = Math.floor(sourceIndex / width);
    const x = rightOrigin ? width - 1 - sourceX : sourceX;
    const y = topOrigin ? sourceY : height - 1 - sourceY;
    data.set(color, (y * width + x) * 4);
  };

  let pixel = 0;
  while (pixel < pixelCount) {
    if (!isRle) {
      writePixel(pixel++, readPixel());
      continue;
    }
    if (offset >= bytes.length) throw new Error('The TGA RLE stream is truncated.');
    const packet = bytes[offset++];
    const runLength = (packet & 0x7f) + 1;
    if (pixel + runLength > pixelCount) throw new Error('The TGA RLE packet exceeds the image bounds.');
    if (packet & 0x80) {
      const color = readPixel();
      for (let repeat = 0; repeat < runLength; repeat += 1) writePixel(pixel++, color);
    } else {
      for (let repeat = 0; repeat < runLength; repeat += 1) writePixel(pixel++, readPixel());
    }
  }
  return { width, height, data };
}

export function encodeTarga(image: RasterPixels) {
  validateRaster(image);
  if (image.width > 65535 || image.height > 65535) throw new Error('TGA dimensions cannot exceed 65535 pixels.');
  const imageId = encoder.encode('Created by Pinta\0');
  const output = new Uint8Array(18 + imageId.length + image.width * image.height * 4);
  output[0] = imageId.length;
  output[2] = 2;
  writeUint16(output, 12, image.width);
  writeUint16(output, 14, image.height);
  output[16] = 32;
  output[17] = 8;
  output.set(imageId, 18);
  let target = 18 + imageId.length;
  for (let y = image.height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 4;
      output[target++] = image.data[source + 2];
      output[target++] = image.data[source + 1];
      output[target++] = image.data[source];
      output[target++] = image.data[source + 3];
    }
  }
  return output;
}
