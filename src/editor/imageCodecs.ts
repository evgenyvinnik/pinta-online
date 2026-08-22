export interface DecodedRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface RasterPixels extends DecodedRaster {}

const encoder = new TextEncoder();
const decoder = new TextDecoder('ascii');

function validateRaster(image: RasterPixels) {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1) {
    throw new Error('Invalid image dimensions.');
  }
  if (image.data.length !== image.width * image.height * 4) throw new Error('Invalid image pixel buffer.');
}

function ppmTokens(bytes: Uint8Array) {
  return decoder.decode(bytes)
    .replace(/#[^\r\n]*/g, ' ')
    .trim()
    .split(/\s+/);
}

export function decodePortablePixmap(bytes: Uint8Array): DecodedRaster {
  const tokens = ppmTokens(bytes);
  let index = 0;
  if (tokens[index++] !== 'P3') throw new Error("Expected 'P3' portable pixmap magic sequence.");
  const width = Number(tokens[index++]);
  const height = Number(tokens[index++]);
  const maxValue = Number(tokens[index++]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Invalid portable pixmap dimensions.');
  if (!Number.isInteger(maxValue) || maxValue < 1 || maxValue > 65535) throw new Error('Invalid portable pixmap maximum color value.');
  const pixelCount = width * height;
  if (tokens.length - index < pixelCount * 3) throw new Error('The portable pixmap is truncated.');
  const data = new Uint8ClampedArray(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = Number(tokens[index++]);
      if (!Number.isInteger(value) || value < 0 || value > maxValue) throw new Error('Portable pixmap color component is out of range.');
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

export function decodeTarga(bytes: Uint8Array): DecodedRaster {
  if (bytes.length < 18) throw new Error('The TGA file is truncated.');
  const idLength = bytes[0];
  const colorMapType = bytes[1];
  const imageType = bytes[2];
  const width = readUint16(bytes, 12);
  const height = readUint16(bytes, 14);
  const depth = bytes[16];
  const descriptor = bytes[17];
  if (colorMapType !== 0 || imageType !== 2 || (depth !== 24 && depth !== 32)) {
    throw new Error('Only uncompressed 24-bit and 32-bit true-color TGA images are supported.');
  }
  if (!width || !height) throw new Error('Invalid TGA dimensions.');
  const bytesPerPixel = depth / 8;
  const pixelOffset = 18 + idLength;
  if (bytes.length < pixelOffset + width * height * bytesPerPixel) throw new Error('The TGA file is truncated.');
  const topOrigin = Boolean(descriptor & 0x20);
  const rightOrigin = Boolean(descriptor & 0x10);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let sourceY = 0; sourceY < height; sourceY += 1) {
    for (let sourceX = 0; sourceX < width; sourceX += 1) {
      const source = pixelOffset + (sourceY * width + sourceX) * bytesPerPixel;
      const x = rightOrigin ? width - 1 - sourceX : sourceX;
      const y = topOrigin ? sourceY : height - 1 - sourceY;
      const target = (y * width + x) * 4;
      data[target] = bytes[source + 2];
      data[target + 1] = bytes[source + 1];
      data[target + 2] = bytes[source];
      data[target + 3] = bytesPerPixel === 4 ? bytes[source + 3] : 255;
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
