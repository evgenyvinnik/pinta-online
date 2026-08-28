import UTIF from 'utif';

export interface DecodedRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type RasterPixels = DecodedRaster;

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

function readUint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function readInt32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, true);
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function writeInt32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt32(offset, value, true);
}

/** Decode the first displayable page of a baseline or compressed TIFF file. */
export function decodeTiff(bytes: Uint8Array): DecodedRaster {
  const littleEndian = bytes.length >= 4 && bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0;
  const bigEndian = bytes.length >= 4 && bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a;
  if (!littleEndian && !bigEndian) throw new Error('Expected a TIFF file header.');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const directories = UTIF.decode(buffer);
  if (!directories.length) throw new Error('The TIFF file does not contain an image directory.');
  for (const directory of directories) {
    try {
      UTIF.decodeImage(buffer, directory);
      const width = Number(directory.width);
      const height = Number(directory.height);
      const pixelCount = width * height;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !Number.isSafeInteger(pixelCount) || pixelCount > 268_435_455) continue;
      const rgba = UTIF.toRGBA8(directory);
      if (rgba.length !== pixelCount * 4) continue;
      return { width, height, data: new Uint8ClampedArray(rgba) };
    } catch {
      // Multi-page TIFFs may include thumbnail or metadata IFDs before the
      // first displayable raster. Desktop Pinta similarly opens one page.
    }
  }
  throw new Error('The TIFF file does not contain a readable image page.');
}

/** Encode an interoperable, uncompressed RGBA TIFF with an explicit alpha channel. */
export function encodeTiff(image: RasterPixels) {
  validateRaster(image);
  const rgba = new Uint8Array(image.data);
  return new Uint8Array(UTIF.encodeImage(rgba, image.width, image.height));
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

function bitmapMaskChannel(value: number, mask: number, fallback: number) {
  if (!mask) return fallback;
  let shift = 0;
  let shiftedMask = mask >>> 0;
  while ((shiftedMask & 1) === 0) {
    shiftedMask >>>= 1;
    shift += 1;
  }
  return Math.round((((value & mask) >>> shift) / shiftedMask) * 255);
}

function decodeBitmapRle(
  bytes: Uint8Array,
  pixelOffset: number,
  width: number,
  height: number,
  topDown: boolean,
  depth: 4 | 8,
  palette: Array<readonly [number, number, number, number]>,
) {
  const data = new Uint8ClampedArray(width * height * 4);
  const background = palette[0] ?? [0, 0, 0, 255];
  for (let pixel = 0; pixel < width * height; pixel += 1) data.set(background, pixel * 4);

  let offset = pixelOffset;
  let x = 0;
  let encodedY = 0;
  let ended = false;
  const writeIndex = (paletteIndex: number) => {
    if (x >= width || encodedY >= height) throw new Error('The BMP RLE stream writes beyond the image bounds.');
    const y = topDown ? encodedY : height - 1 - encodedY;
    data.set(palette[paletteIndex] ?? [0, 0, 0, 255], (y * width + x) * 4);
    x += 1;
  };

  while (offset < bytes.length) {
    if (offset + 2 > bytes.length) throw new Error('The BMP RLE stream is truncated.');
    const count = bytes[offset++];
    const command = bytes[offset++];
    if (count > 0) {
      for (let pixel = 0; pixel < count; pixel += 1) {
        writeIndex(depth === 8 ? command : pixel % 2 === 0 ? command >>> 4 : command & 0x0f);
      }
      continue;
    }

    if (command === 0) {
      x = 0;
      encodedY += 1;
      if (encodedY > height) throw new Error('The BMP RLE stream has too many rows.');
      continue;
    }
    if (command === 1) {
      ended = true;
      break;
    }
    if (command === 2) {
      if (offset + 2 > bytes.length) throw new Error('The BMP RLE delta is truncated.');
      x += bytes[offset++];
      encodedY += bytes[offset++];
      if (x > width || encodedY >= height) throw new Error('The BMP RLE delta moves beyond the image bounds.');
      continue;
    }

    const literalPixels = command;
    const literalBytes = depth === 8 ? literalPixels : Math.ceil(literalPixels / 2);
    if (offset + literalBytes > bytes.length) throw new Error('The BMP RLE literal run is truncated.');
    for (let pixel = 0; pixel < literalPixels; pixel += 1) {
      const packed = bytes[offset + (depth === 8 ? pixel : Math.floor(pixel / 2))];
      writeIndex(depth === 8 ? packed : pixel % 2 === 0 ? packed >>> 4 : packed & 0x0f);
    }
    offset += literalBytes;
    if (literalBytes % 2 !== 0) {
      if (offset >= bytes.length) throw new Error('The BMP RLE literal padding is truncated.');
      offset += 1;
    }
  }
  if (!ended) throw new Error('The BMP RLE stream is missing its end marker.');
  return data;
}

/** Decode palette, RLE, uncompressed, and bitfield BMP variants accepted by Pinta/GdkPixbuf. */
export function decodeBitmap(bytes: Uint8Array): DecodedRaster {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error('Expected a BMP file header.');
  const pixelOffset = readUint32(bytes, 10);
  const dibSize = readUint32(bytes, 14);
  if (dibSize < 40 || bytes.length < 14 + dibSize || pixelOffset > bytes.length) throw new Error('The BMP header is truncated or unsupported.');
  const signedWidth = readInt32(bytes, 18);
  const signedHeight = readInt32(bytes, 22);
  const planes = readUint16(bytes, 26);
  const depth = readUint16(bytes, 28);
  const compression = readUint32(bytes, 30);
  if (planes !== 1 || signedWidth <= 0 || signedHeight === 0) throw new Error('Invalid BMP dimensions or plane count.');
  const width = signedWidth;
  const height = Math.abs(signedHeight);
  const topDown = signedHeight < 0;
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > 268_435_455) throw new Error('BMP dimensions are too large.');
  if (![1, 4, 8, 16, 24, 32].includes(depth)) throw new Error(`Unsupported BMP color depth: ${depth}.`);
  if (![0, 1, 2, 3, 6].includes(compression)) throw new Error(`Unsupported BMP compression: ${compression}.`);
  if ((compression === 1 && depth !== 8) || (compression === 2 && depth !== 4)) throw new Error('BMP RLE compression does not match the indexed color depth.');
  if ((compression === 3 || compression === 6) && depth !== 16 && depth !== 32) throw new Error('BMP bitfields require 16-bit or 32-bit pixels.');
  if ((compression === 3 || compression === 6) && dibSize !== 40 && dibSize < (compression === 6 ? 56 : 52)) {
    throw new Error('The BMP bitfield masks are missing or truncated.');
  }
  if ((compression === 3 || compression === 6) && dibSize === 40 && pixelOffset < (compression === 6 ? 70 : 66)) {
    throw new Error('The BMP bitfield masks are missing or truncated.');
  }

  const rowStride = Math.floor((depth * width + 31) / 32) * 4;
  if ((compression === 0 || compression === 3 || compression === 6) && pixelOffset + rowStride * height > bytes.length) throw new Error('The BMP pixel data is truncated.');

  const palette: Array<readonly [number, number, number, number]> = [];
  if (depth <= 8) {
    const colorsUsed = readUint32(bytes, 46) || 2 ** depth;
    const paletteOffset = 14 + dibSize;
    if (colorsUsed > 2 ** depth || paletteOffset + colorsUsed * 4 > pixelOffset) throw new Error('The BMP palette is invalid or truncated.');
    for (let index = 0; index < colorsUsed; index += 1) {
      const offset = paletteOffset + index * 4;
      palette.push([bytes[offset + 2], bytes[offset + 1], bytes[offset], 255]);
    }
  }

  if (compression === 1 || compression === 2) {
    return {
      width,
      height,
      data: decodeBitmapRle(bytes, pixelOffset, width, height, topDown, depth as 4 | 8, palette),
    };
  }

  const data = new Uint8ClampedArray(pixelCount * 4);

  let redMask = 0;
  let greenMask = 0;
  let blueMask = 0;
  let alphaMask = 0;
  if (depth === 16 || depth === 32) {
    if (compression === 3 || compression === 6) {
      redMask = readUint32(bytes, 54);
      greenMask = readUint32(bytes, 58);
      blueMask = readUint32(bytes, 62);
      if (compression === 6 || dibSize >= 56) alphaMask = readUint32(bytes, 66);
    } else if (depth === 16) {
      redMask = 0x7c00;
      greenMask = 0x03e0;
      blueMask = 0x001f;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const row = pixelOffset + sourceY * rowStride;
    for (let x = 0; x < width; x += 1) {
      let color: readonly [number, number, number, number];
      if (depth <= 8) {
        const packed = bytes[row + Math.floor(x * depth / 8)];
        const shift = 8 - depth - (x * depth % 8);
        const paletteIndex = packed >>> shift & (1 << depth) - 1;
        color = palette[paletteIndex] ?? [0, 0, 0, 255];
      } else if (depth === 24) {
        const offset = row + x * 3;
        color = [bytes[offset + 2], bytes[offset + 1], bytes[offset], 255];
      } else {
        const offset = row + x * (depth / 8);
        const value = depth === 16 ? readUint16(bytes, offset) : readUint32(bytes, offset);
        if (compression === 0 && depth === 32) color = [bytes[offset + 2], bytes[offset + 1], bytes[offset], 255];
        else color = [
          bitmapMaskChannel(value, redMask, 0),
          bitmapMaskChannel(value, greenMask, 0),
          bitmapMaskChannel(value, blueMask, 0),
          bitmapMaskChannel(value, alphaMask, 255),
        ];
      }
      data.set(color, (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Encode a V4 bitfield BMP so alpha is explicit instead of an ambiguous unused byte. */
export function encodeBitmap(image: RasterPixels) {
  validateRaster(image);
  const dibSize = 108;
  const pixelOffset = 14 + dibSize;
  const pixelBytes = image.width * image.height * 4;
  const output = new Uint8Array(pixelOffset + pixelBytes);
  output[0] = 0x42;
  output[1] = 0x4d;
  writeUint32(output, 2, output.length);
  writeUint32(output, 10, pixelOffset);
  writeUint32(output, 14, dibSize);
  writeInt32(output, 18, image.width);
  writeInt32(output, 22, image.height);
  writeUint16(output, 26, 1);
  writeUint16(output, 28, 32);
  writeUint32(output, 30, 3);
  writeUint32(output, 34, pixelBytes);
  writeInt32(output, 38, 2835);
  writeInt32(output, 42, 2835);
  writeUint32(output, 54, 0x00ff0000);
  writeUint32(output, 58, 0x0000ff00);
  writeUint32(output, 62, 0x000000ff);
  writeUint32(output, 66, 0xff000000);
  writeUint32(output, 70, 0x73524742);
  let target = pixelOffset;
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
