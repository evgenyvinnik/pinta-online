import { describe, expect, it } from 'vitest';
import { exportExtension, exportFormatFromFileName, exportMimeType } from '../../src/editor/exportFormats';
import type { ExportFormat } from '../../src/editor/types';

// The encode/decode members need a canvas and stay with Playwright. Format identification is
// pure, and it decides what a user's file is saved as — a wrong answer silently writes the
// wrong bytes under the right extension.

const FORMATS: ExportFormat[] = ['png', 'jpeg', 'webp', 'bmp', 'tiff', 'ora', 'ppm', 'tga'];

describe('exportFormatFromFileName', () => {
  it('identifies every supported extension', () => {
    expect(exportFormatFromFileName('a.png')).toBe('png');
    expect(exportFormatFromFileName('a.jpg')).toBe('jpeg');
    expect(exportFormatFromFileName('a.jpeg')).toBe('jpeg');
    expect(exportFormatFromFileName('a.webp')).toBe('webp');
    expect(exportFormatFromFileName('a.bmp')).toBe('bmp');
    expect(exportFormatFromFileName('a.tif')).toBe('tiff');
    expect(exportFormatFromFileName('a.tiff')).toBe('tiff');
    expect(exportFormatFromFileName('a.ora')).toBe('ora');
    expect(exportFormatFromFileName('a.ppm')).toBe('ppm');
    expect(exportFormatFromFileName('a.tga')).toBe('tga');
  });

  it('ignores case, because file pickers do not normalise it', () => {
    expect(exportFormatFromFileName('HOLIDAY.PNG')).toBe('png');
    expect(exportFormatFromFileName('Scan.TIFF')).toBe('tiff');
  });

  it('reads the last extension of a multi-dot name', () => {
    expect(exportFormatFromFileName('my.photo.backup.png')).toBe('png');
  });

  it('returns null for anything it does not write, so the caller decides the fallback', () => {
    for (const name of ['a.xcf', 'noextension', '', '.', 'a.']) {
      expect(exportFormatFromFileName(name), name).toBeNull();
    }
  });

  it('does not claim GIF, which the editor opens but cannot write', () => {
    // The PWA manifest registers image/gif as a file handler, so a GIF can be opened; there is
    // no GIF encoder, and ExportFormat has no 'gif' member. Returning null is correct.
    expect(exportFormatFromFileName('animation.gif')).toBeNull();
  });
});

describe('exportExtension and exportMimeType', () => {
  it('gives every format an extension and a MIME type', () => {
    for (const format of FORMATS) {
      expect(exportExtension(format), format).toMatch(/^[a-z]+$/);
      expect(exportMimeType(format), format).toMatch(/^image\/[a-z-]+$/);
    }
  });

  it('round-trips: an extension identifies the format it came from', () => {
    for (const format of FORMATS) {
      expect(exportFormatFromFileName(`file.${exportExtension(format)}`), format).toBe(format);
    }
  });

  it('maps the formats whose MIME type is not the obvious guess', () => {
    expect(exportMimeType('ora')).toBe('image/openraster');
    expect(exportMimeType('ppm')).toBe('image/x-portable-pixmap');
    expect(exportMimeType('tga')).toBe('image/x-tga');
  });
});
