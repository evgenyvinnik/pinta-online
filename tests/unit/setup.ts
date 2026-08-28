/**
 * jsdom implements ImageData only when node-canvas is installed, which this project does not
 * need — Playwright owns everything that requires real rasterisation. The editor's pure logic
 * still passes ImageData around, so provide the constructor jsdom leaves out. It matches the
 * spec's shape and validation; it deliberately does not try to be a drawing surface.
 */
if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace = 'srgb' as PredefinedColorSpace;

    constructor(data: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
      if (typeof data === 'number') {
        this.width = data;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
        return;
      }
      this.width = widthOrHeight;
      this.height = height ?? data.length / 4 / widthOrHeight;
      if (data.length !== this.width * this.height * 4) {
        throw new RangeError('ImageData data length does not match the given dimensions.');
      }
      this.data = data;
    }
  }

  globalThis.ImageData = ImageDataPolyfill as unknown as typeof ImageData;
}
