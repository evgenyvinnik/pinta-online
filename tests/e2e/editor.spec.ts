import type { Page } from '@playwright/test';
import { expect, test } from '../pageErrors';
import { strToU8, zipSync } from 'fflate';
import { encodeBitmap, encodeTiff } from '../../src/editor/imageCodecs';
import { REGISTERED_SHORTCUT_SECTIONS } from '../../src/editor/shortcuts';
import { TOOLS } from '../../src/editor/tools';

function ppm(name: string, width: number, height: number, color: [number, number, number]) {
  const pixels = Array.from({ length: width * height }, () => color.join(' ')).join(' ');
  return {
    name,
    mimeType: 'image/x-portable-pixmap',
    buffer: Buffer.from(`P3\n${width} ${height}\n255\n${pixels}\n`),
  };
}

function objectPpm(name: string) {
  const width = 80;
  const height = 60;
  const pixels = Array.from({ length: width * height }, (_, pixel) => {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    return x >= 20 && x < 45 && y >= 15 && y < 40 ? '220 40 30' : '255 255 255';
  }).join(' ');
  return {
    name,
    mimeType: 'image/x-portable-pixmap',
    buffer: Buffer.from(`P3\n${width} ${height}\n255\n${pixels}\n`),
  };
}

function levelsPpm(name: string) {
  const width = 32;
  const height = 16;
  const pixels = Array.from({ length: width * height }, (_, pixel) => {
    const step = pixel % 16;
    return `${20 + step * 6} ${50 + step * 6} ${80 + step * 6}`;
  }).join(' ');
  return {
    name,
    mimeType: 'image/x-portable-pixmap',
    buffer: Buffer.from(`P3\n${width} ${height}\n255\n${pixels}\n`),
  };
}

function tolerancePpm(name: string) {
  const width = 80;
  const height = 60;
  const pixels = Array.from({ length: width * height }, (_, pixel) =>
    pixel % width < width / 2 ? '0 0 0' : '100 100 0',
  ).join(' ');
  return {
    name,
    mimeType: 'image/x-portable-pixmap',
    buffer: Buffer.from(`P3\n${width} ${height}\n255\n${pixels}\n`),
  };
}

function autoLevelsPpm(name: string) {
  const pixels = [
    ...Array.from({ length: 89 }, () => '50 50 50'),
    ...Array.from({ length: 10 }, () => '100 100 100'),
    '150 150 150',
  ].join(' ');
  return {
    name,
    mimeType: 'image/x-portable-pixmap',
    buffer: Buffer.from(`P3\n10 10\n255\n${pixels}\n`),
  };
}

async function openTopMenu(page: Page, name: string) {
  await page.keyboard.press('Escape');
  const button = page.locator(`.macos-menu-button[data-menu-name="${name.toLowerCase()}"]`);
  const anchor = button.locator('..');
  await button.click();
  await expect(anchor).toHaveClass(/active/);
  await expect(anchor.locator('.macos-menu-popover')).toBeVisible();
}

async function clickTopMenuItem(page: Page, label: string) {
  const item = page.locator('.macos-menu-anchor.active .menu-item').filter({ hasText: new RegExp(`^${label}`) });
  await item.scrollIntoViewIfNeeded();
  await item.click();
}

async function setZoomLevel(page: Page, percent: string) {
  const entry = page.getByRole('textbox', { name: 'Zoom level' });
  await entry.fill(percent);
  await entry.press('Enter');
  await expect(entry).toHaveValue(`${percent}%`);
}

async function waitForWorkspace(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-ready', 'true');
  await expect(page.locator('.canvas-stack canvas, .empty-workspace').first()).toBeVisible();
}

async function selectionOverlaySummary(page: Page) {
  return page.locator('.selection-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let black = 0;
    let white = 0;
    let blueFill = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      if (alpha > 200 && red < 40 && green < 40 && blue < 40) black += 1;
      if (alpha > 200 && red > 215 && green > 215 && blue > 215) white += 1;
      if (alpha >= 40 && alpha <= 65 && blue > green && green > red) blueFill += 1;
    }
    return { black, white, blueFill, frame: canvas.toDataURL() };
  });
}

interface ShortcutEventInit {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

async function dispatchShortcut(page: Page, init: ShortcutEventInit, selector = '.app-shell') {
  return page.locator(selector).evaluate((element, eventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...eventInit });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, init);
}

async function storedWorkspaceSummary(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        version: number;
        count: number;
        activeFile: string;
        activeLayers: number;
        activeHasSelection: boolean;
        activeSelectionTool: string | null;
        activeSelectionHasMask: boolean;
        activeHistoryLabels: string[];
        activeHistoryIndex: number;
        activeCleanHistoryIndex: number;
      } | null>((resolve, reject) => {
        const request = indexedDB.open('pinta-online', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('workspace', 'readonly');
          const get = transaction.objectStore('workspace').get('current');
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            const workspace = get.result as
              | {
                  version: number;
                  activeDocumentId: string;
                  documents: Array<{
                    id: string;
                    fileName: string;
                    layers: unknown[];
                    selection: { tool: string; mask?: Blob | { bytes: ArrayBuffer } } | null;
                    history: Array<{ label: string }>;
                    historyIndex: number;
                    cleanHistoryIndex: number;
                  }>;
                }
              | undefined;
            const active = workspace?.documents.find((document) => document.id === workspace.activeDocumentId);
            resolve(
              workspace && active
                ? {
                    version: workspace.version,
                    count: workspace.documents.length,
                    activeFile: active.fileName,
                    activeLayers: active.layers.length,
                    activeHasSelection: active.selection !== null,
                    activeSelectionTool: active.selection?.tool ?? null,
                    // Masks are stored as bytes rather than a Blob, because WebKit cannot put a
                    // Blob in IndexedDB. This reads the record directly, so it has to know both
                    // shapes: records written by an older build still hold a Blob.
                    activeSelectionHasMask: (() => {
                      const mask = active.selection?.mask;
                      if (!mask) return false;
                      return mask instanceof Blob ? mask.size > 0 : mask.bytes.byteLength > 0;
                    })(),
                    activeHistoryLabels: active.history.map((entry) => entry.label),
                    activeHistoryIndex: active.historyIndex,
                    activeCleanHistoryIndex: active.cleanHistoryIndex,
                  }
                : null,
            );
            database.close();
          };
        };
      }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForWorkspace(page);
});

test.describe('web support links', () => {
  test('routes source and bug reports to the Pinta Online repository', async ({ page }) => {
    await page.evaluate(() => {
      const target = window as typeof window & { __pintaOpenedUrls?: string[] };
      target.__pintaOpenedUrls = [];
      window.open = ((url?: string | URL) => {
        target.__pintaOpenedUrls?.push(String(url));
        return null;
      }) as typeof window.open;
    });

    await openTopMenu(page, 'Help');
    await clickTopMenuItem(page, 'File a Bug');
    await page.getByRole('button', { name: 'Main Menu', exact: true }).click();
    await page
      .locator('.main-menu-popover .menu-item')
      .filter({ hasText: /^File a Bug/ })
      .click();
    expect(
      await page.evaluate(() => (window as typeof window & { __pintaOpenedUrls?: string[] }).__pintaOpenedUrls),
    ).toEqual([
      'https://github.com/evgenyvinnik/pinta-online/issues/new?template=bug.md',
      'https://github.com/evgenyvinnik/pinta-online/issues/new?template=bug.md',
    ]);

    await page.getByRole('button', { name: 'Main Menu', exact: true }).click();
    await page
      .locator('.main-menu-popover .menu-item')
      .filter({ hasText: /^About/ })
      .click();
    const about = page.getByRole('dialog', { name: 'About Pinta' });
    await expect(about.getByRole('link', { name: 'Report an Issue' })).toHaveAttribute(
      'href',
      'https://github.com/evgenyvinnik/pinta-online/issues/new?template=bug.md',
    );
    await about.getByRole('button', { name: 'Details' }).click();
    const details = page.getByRole('dialog', { name: 'Details' });
    await expect(details.getByRole('link', { name: 'Source Code' })).toHaveAttribute(
      'href',
      'https://github.com/evgenyvinnik/pinta-online',
    );
    await expect(details.getByRole('link', { name: 'Evgeny Vinnik' })).toHaveAttribute(
      'href',
      'https://github.com/evgenyvinnik/pinta-online',
    );
    await details.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('dialog', { name: 'About Pinta' }).getByRole('button', { name: 'Credits' }).click();
    await expect(page.getByRole('dialog', { name: 'Credits' })).toContainText('Cameron White (@cameronwhite)');
    await page.getByRole('dialog', { name: 'Credits' }).getByRole('button', { name: 'Back' }).click();
    await page.getByRole('dialog', { name: 'About Pinta' }).getByRole('button', { name: 'Legal' }).click();
    await expect(page.getByRole('dialog', { name: 'Legal' })).toContainText('Released under the MIT X11 License.');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'About Pinta' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.about-dialog')).toHaveCount(0);
  });
});

test.describe('documents and image ingress', () => {
  test('enters, persists, and exits the native empty-workspace state', async ({ page }) => {
    const shell = page.locator('.app-shell');
    await page.keyboard.press('Control+W');
    await expect(shell).toHaveAttribute('data-document-count', '0');
    await expect(page.getByRole('main', { name: 'No image open' })).toBeVisible();
    await expect(page.locator('.canvas-stack')).toHaveCount(0);
    await expect(page).toHaveTitle('Pinta Online Image Editor');
    await openTopMenu(page, 'File');
    await expect(
      page.locator('.macos-menu-anchor.active .menu-item').filter({ hasText: /^Save\s*⌘S$/ }),
    ).toBeDisabled();
    await expect(
      page.locator('.macos-menu-anchor.active .menu-item').filter({ hasText: /^Close\s*⌘W$/ }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(shell).toHaveAttribute('data-workspace-save-state', 'saved', { timeout: 20_000 });

    await page.reload();
    await waitForWorkspace(page);
    await expect(shell).toHaveAttribute('data-document-count', '0');
    await expect(page.getByRole('main', { name: 'No image open' })).toBeVisible();
    await expect(page.locator('.history-row')).toHaveCount(0);

    await page.keyboard.press('Control+N');
    const dialog = page.getByRole('dialog', { name: 'New Image' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(shell).toHaveAttribute('data-document-count', '1');
    await expect(shell).toHaveAttribute('data-active-document', 'Unsaved Image 2');
    await expect(page.locator('.canvas-stack')).toBeVisible();
  });

  test('opens and saves deterministic alpha-aware BMP images', async ({ page }) => {
    const encoded = encodeBitmap({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([250, 10, 20, 255, 20, 240, 30, 128, 30, 40, 230, 64, 90, 80, 70, 0]),
    });
    await page.locator('input[type="file"][multiple]').setInputFiles({
      name: 'alpha-v4.bmp',
      mimeType: 'image/bmp',
      buffer: Buffer.from(encoded),
    });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'alpha-v4.bmp');
    const display = page.locator('.canvas-stack canvas').first();
    // The first pixel is opaque, so its alpha landing is the signal the decode finished.
    await expect
      .poll(() =>
        display.evaluate((canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[3]),
      )
      .toBe(255);
    const shown = await display.evaluate((canvas: HTMLCanvasElement) => [
      ...canvas.getContext('2d')!.getImageData(0, 0, 2, 2).data,
    ]);

    // A canvas stores colour premultiplied by alpha, so reading a semi-transparent pixel back
    // divides by that alpha and cannot recover the original byte exactly. Browsers round the
    // division differently -- Chromium returned 20,239,30 for the 50%-alpha pixel and Firefox
    // 21,241,31 -- so asserting exact bytes pinned one browser's arithmetic rather than the
    // codec. What the codec actually guarantees is checked instead: alpha survives exactly,
    // an opaque pixel survives exactly, a fully transparent one clears to zero, and colour
    // survives to the precision the canvas can hold at that alpha.
    const source = [250, 10, 20, 255, 20, 240, 30, 128, 30, 40, 230, 64, 90, 80, 70, 0];
    for (let index = 0; index < source.length; index += 4) {
      const alpha = source[index + 3];
      expect(shown[index + 3], `alpha of pixel ${index / 4}`).toBe(alpha);
      // One step of the 255/alpha quantum, either side, covers both browsers' rounding.
      const tolerance = alpha === 0 ? 0 : Math.ceil(255 / alpha);
      for (let channel = 0; channel < 3; channel += 1) {
        const expected = alpha === 0 ? 0 : source[index + channel];
        expect(
          Math.abs(shown[index + channel] - expected),
          `channel ${channel} of pixel ${index / 4}`,
        ).toBeLessThanOrEqual(tolerance);
      }
    }

    await page.evaluate(() => {
      const target = window as typeof window & {
        showSaveFilePicker?: (options: {
          suggestedName?: string;
          types?: Array<{ accept: Record<string, string[]> }>;
        }) => Promise<FileSystemFileHandle>;
        __pintaBmpWrite?: { type: string; bytes: number[]; closed: boolean };
        __pintaBmpPicker?: { suggestedName?: string; accept?: Record<string, string[]> };
      };
      target.showSaveFilePicker = async (options) => {
        target.__pintaBmpPicker = { suggestedName: options.suggestedName, accept: options.types?.[0]?.accept };
        return {
          kind: 'file',
          name: 'round-trip.bmp',
          createWritable: async () => ({
            write: async (blob: Blob) => {
              target.__pintaBmpWrite = {
                type: blob.type,
                bytes: [...new Uint8Array(await blob.arrayBuffer())],
                closed: false,
              };
            },
            close: async () => {
              target.__pintaBmpWrite!.closed = true;
            },
          }),
        } as unknown as FileSystemFileHandle;
      };
    });
    await page.keyboard.press('Control+Shift+S');
    const saveAs = page.getByRole('dialog', { name: 'Save Image As' });
    await saveAs.getByLabel('File format').selectOption('bmp');
    await saveAs.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as typeof window & { __pintaBmpWrite?: { type: string } }).__pintaBmpWrite?.type),
      )
      .toBe('image/bmp');
    expect(
      await page.evaluate(() => (window as typeof window & { __pintaBmpPicker?: unknown }).__pintaBmpPicker),
    ).toEqual({
      suggestedName: 'alpha-v4.bmp',
      accept: { 'image/bmp': ['.bmp'] },
    });
    expect(
      await page.evaluate(() => {
        const result = (window as typeof window & { __pintaBmpWrite?: { bytes: number[]; closed: boolean } })
          .__pintaBmpWrite!;
        return { signature: String.fromCharCode(result.bytes[0], result.bytes[1]), closed: result.closed };
      }),
    ).toEqual({ signature: 'BM', closed: true });
  });

  test("uses Pinta's separate JPEG quality step and a JPEG-only platform picker", async ({ page }) => {
    await page.evaluate(() => {
      const target = window as typeof window & {
        showSaveFilePicker?: (options: {
          suggestedName?: string;
          types?: Array<{ accept: Record<string, string[]> }>;
        }) => Promise<FileSystemFileHandle>;
        __pintaJpegPicker?: { calls: number; suggestedName?: string; accept?: Record<string, string[]> };
        __pintaJpegWrite?: { type: string; signature: number[]; closed: boolean };
      };
      target.__pintaJpegPicker = { calls: 0 };
      target.showSaveFilePicker = async (options) => {
        target.__pintaJpegPicker = {
          calls: (target.__pintaJpegPicker?.calls ?? 0) + 1,
          suggestedName: options.suggestedName,
          accept: options.types?.[0]?.accept,
        };
        return {
          kind: 'file',
          name: 'quality-check.jpg',
          createWritable: async () => ({
            write: async (blob: Blob) => {
              target.__pintaJpegWrite = {
                type: blob.type,
                signature: [...new Uint8Array(await blob.slice(0, 2).arrayBuffer())],
                closed: false,
              };
            },
            close: async () => {
              target.__pintaJpegWrite!.closed = true;
            },
          }),
        } as unknown as FileSystemFileHandle;
      };
    });

    await page.keyboard.press('Control+Shift+S');
    const saveAs = page.getByRole('dialog', { name: 'Save Image As' });
    await saveAs.getByLabel('File name').fill('quality-check');
    await saveAs.getByLabel('File format').selectOption('jpeg');
    await expect(saveAs.getByLabel('JPEG quality')).toHaveCount(0);
    await saveAs.getByRole('button', { name: 'Save', exact: true }).click();

    const quality = page.getByRole('dialog', { name: 'JPEG Quality' });
    await expect(quality).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as typeof window & { __pintaJpegPicker?: { calls: number } }).__pintaJpegPicker?.calls,
        ),
      )
      .toBe(0);
    await quality.getByLabel('JPEG quality').fill('73');
    await expect(quality.locator('output')).toHaveText('73');
    await quality.getByRole('button', { name: 'OK' }).click();

    await expect
      .poll(() =>
        page.evaluate(() => (window as typeof window & { __pintaJpegWrite?: { type: string } }).__pintaJpegWrite?.type),
      )
      .toBe('image/jpeg');
    expect(
      await page.evaluate(() => (window as typeof window & { __pintaJpegPicker?: unknown }).__pintaJpegPicker),
    ).toEqual({
      calls: 1,
      suggestedName: 'quality-check.jpg',
      accept: { 'image/jpeg': ['.jpg', '.jpeg'] },
    });
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __pintaJpegWrite?: { type: string; signature: number[]; closed: boolean } })
            .__pintaJpegWrite,
      ),
    ).toEqual({
      type: 'image/jpeg',
      signature: [0xff, 0xd8],
      closed: true,
    });
  });

  test('opens and saves TIFF through the deterministic codec bridge', async ({ page }) => {
    const encoded = encodeTiff({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([220, 30, 40, 255, 10, 160, 230, 255]),
    });
    await page.locator('input[type="file"][multiple]').setInputFiles({
      name: 'codec-bridge.tiff',
      mimeType: 'image/tiff',
      buffer: Buffer.from(encoded),
    });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'codec-bridge.tiff');
    await expect
      .poll(() =>
        page
          .locator('.canvas-stack canvas')
          .first()
          .evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(0, 0, 2, 1).data]),
      )
      .toEqual([220, 30, 40, 255, 10, 160, 230, 255]);

    await page.evaluate(() => {
      const target = window as typeof window & {
        showSaveFilePicker?: (options: {
          suggestedName?: string;
          types?: Array<{ accept: Record<string, string[]> }>;
        }) => Promise<FileSystemFileHandle>;
        __pintaTiffPicker?: { suggestedName?: string; accept?: Record<string, string[]> };
        __pintaTiffWrite?: { type: string; signature: number[]; closed: boolean };
      };
      target.showSaveFilePicker = async (options) => {
        target.__pintaTiffPicker = { suggestedName: options.suggestedName, accept: options.types?.[0]?.accept };
        return {
          kind: 'file',
          name: 'codec-bridge.tif',
          createWritable: async () => ({
            write: async (blob: Blob) => {
              target.__pintaTiffWrite = {
                type: blob.type,
                signature: [...new Uint8Array(await blob.slice(0, 4).arrayBuffer())],
                closed: false,
              };
            },
            close: async () => {
              target.__pintaTiffWrite!.closed = true;
            },
          }),
        } as unknown as FileSystemFileHandle;
      };
    });
    await page.keyboard.press('Control+Shift+S');
    const saveAs = page.getByRole('dialog', { name: 'Save Image As' });
    await saveAs.getByLabel('File name').fill('codec-bridge');
    await saveAs.getByLabel('File format').selectOption('tiff');
    await saveAs.getByRole('button', { name: 'Save', exact: true }).click();

    await expect
      .poll(() =>
        page.evaluate(() => (window as typeof window & { __pintaTiffWrite?: { type: string } }).__pintaTiffWrite?.type),
      )
      .toBe('image/tiff');
    expect(
      await page.evaluate(() => (window as typeof window & { __pintaTiffPicker?: unknown }).__pintaTiffPicker),
    ).toEqual({
      suggestedName: 'codec-bridge.tif',
      accept: { 'image/tiff': ['.tif', '.tiff'] },
    });
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __pintaTiffWrite?: { type: string; signature: number[]; closed: boolean } })
            .__pintaTiffWrite,
      ),
    ).toEqual({
      type: 'image/tiff',
      signature: [0x4d, 0x4d, 0x00, 0x2a],
      closed: true,
    });
  });

  test('captures Pinta accelerators before the browser, including from focused controls', async ({ page, context }) => {
    await page.evaluate(() => {
      (window as typeof window & { __pintaShortcutPrevented?: boolean }).__pintaShortcutPrevented = false;
      window.addEventListener('keydown', (event) => {
        if (event.key.toLowerCase() === 'n' && event.ctrlKey) {
          (window as typeof window & { __pintaShortcutPrevented?: boolean }).__pintaShortcutPrevented =
            event.defaultPrevented;
        }
      });
    });

    const browserPageCount = context.pages().length;
    await page.getByRole('spinbutton', { name: 'Brush width' }).focus();
    await page.keyboard.press('Control+N');
    await expect(page.getByRole('dialog', { name: 'New Image' })).toBeVisible();
    expect(context.pages()).toHaveLength(browserPageCount);
    expect(
      await page.evaluate(
        () => (window as typeof window & { __pintaShortcutPrevented?: boolean }).__pintaShortcutPrevented,
      ),
    ).toBe(true);

    const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
    await expect(width).toBeFocused();
    expect(await dispatchShortcut(page, { key: 'r', code: 'KeyR', ctrlKey: true }, 'input[aria-label="Width"]')).toBe(
      true,
    );
    await expect(page.getByRole('dialog', { name: 'New Image' })).toBeVisible();
    expect(
      await dispatchShortcut(
        page,
        { key: 'r', code: 'KeyR', ctrlKey: true, altKey: true },
        'input[aria-label="Width"]',
      ),
    ).toBe(false);
    await page.keyboard.press('Escape');

    const brushWidth = page.getByRole('spinbutton', { name: 'Brush width' });
    await brushWidth.focus();
    expect(
      await dispatchShortcut(page, { key: 'a', code: 'KeyA', ctrlKey: true }, 'input[aria-label="Brush width"]'),
    ).toBe(false);
    await brushWidth.fill('9');
    await expect(brushWidth).toHaveValue('9');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'false');

    await page.keyboard.press('Control+R');
    await expect(page.getByRole('dialog', { name: 'Resize Image' })).toBeVisible();
    await page.keyboard.press('Escape');

    expect(await dispatchShortcut(page, { key: 'n', code: 'KeyN', metaKey: true })).toBe(true);
    await expect(page.getByRole('dialog', { name: 'New Image' })).toBeVisible();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-document-count', '2');
    await page.keyboard.press('Control+W');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-document-count', '1');
    expect(context.pages()).toHaveLength(browserPageCount);
  });

  test('previews configurable effects live and restores the canvas when cancelled', async ({ page }) => {
    await page.locator('input[type="file"][multiple]').setInputFiles(ppm('preview-source.ppm', 24, 18, [20, 80, 220]));
    const preview = page.locator('.preview-canvas');
    const historyBefore = await page.locator('.history-row').count();
    await openTopMenu(page, 'Adjustments');
    await clickTopMenuItem(page, 'Sepia');
    const dialog = page.getByRole('dialog', { name: 'Sepia' });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() =>
        preview.evaluate((canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(10, 8, 1, 1).data[3]),
      )
      .toBe(255);
    const previewPixel = await preview.evaluate((canvas: HTMLCanvasElement) => [
      ...canvas.getContext('2d')!.getImageData(10, 8, 1, 1).data,
    ]);
    expect(previewPixel).not.toEqual([20, 80, 220, 255]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect
      .poll(() =>
        preview.evaluate((canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(10, 8, 1, 1).data[3]),
      )
      .toBe(0);
    await expect(page.locator('.history-row')).toHaveCount(historyBefore);
  });

  test('contains a preview worker failure once and keeps later effects usable', async ({ page }) => {
    await page.addInitScript(() => {
      const target = window as typeof window & { __pintaInjectedEffectFailure?: boolean };
      class FailingEffectWorker {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        onmessageerror: ((event: MessageEvent) => void) | null = null;

        postMessage(message: { id: number; width: number; height: number; buffer: ArrayBuffer }) {
          queueMicrotask(() => {
            if (!target.__pintaInjectedEffectFailure) {
              target.__pintaInjectedEffectFailure = true;
              this.onmessage?.({
                data: { id: message.id, type: 'error', error: 'Injected preview worker failure.' },
              });
              return;
            }
            this.onmessage?.({
              data: {
                id: message.id,
                type: 'complete',
                width: message.width,
                height: message.height,
                buffer: message.buffer.slice(0),
              },
            });
          });
        }

        terminate() {}
      }
      Object.defineProperty(window, 'Worker', {
        configurable: true,
        writable: true,
        value: FailingEffectWorker,
      });
    });
    await page.reload();
    await waitForWorkspace(page);
    await page.locator('input[type="file"][multiple]').setInputFiles(ppm('worker-error.ppm', 8, 6, [20, 80, 220]));

    await openTopMenu(page, 'Adjustments');
    await clickTopMenuItem(page, 'Sepia');
    const errorDialog = page.getByRole('alertdialog', { name: 'Effect preview failed' });
    await expect(errorDialog).toContainText('The effect preview could not be rendered.');
    await errorDialog.getByText('Details').click();
    await expect(errorDialog.locator('pre')).toContainText('Injected preview worker failure.');
    await errorDialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Sepia' })).toBeHidden();
    await page.waitForTimeout(250);
    await expect(page.getByRole('alertdialog', { name: 'Effect preview failed' })).toBeHidden();

    await openTopMenu(page, 'Adjustments');
    await clickTopMenuItem(page, 'Invert Colors');
    await expect(page.locator('.history-row.active')).toContainText('Invert Colors');
  });

  test('falls back without a page crash when a worker returns malformed pixels', async ({ page }) => {
    await page.addInitScript(() => {
      const target = window as typeof window & { __pintaEffectWorkerTerminations?: number };
      target.__pintaEffectWorkerTerminations = 0;
      class MalformedEffectWorker {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        onmessageerror: ((event: MessageEvent) => void) | null = null;

        postMessage(message: { id: number; width: number; height: number }) {
          queueMicrotask(() =>
            this.onmessage?.({
              data: {
                id: message.id,
                type: 'complete',
                width: message.width,
                height: message.height,
                buffer: new ArrayBuffer(1),
              },
            }),
          );
        }

        terminate() {
          target.__pintaEffectWorkerTerminations = (target.__pintaEffectWorkerTerminations ?? 0) + 1;
        }
      }
      Object.defineProperty(window, 'Worker', {
        configurable: true,
        writable: true,
        value: MalformedEffectWorker,
      });
    });
    await page.reload();
    await waitForWorkspace(page);
    await page.locator('input[type="file"][multiple]').setInputFiles(ppm('malformed-worker.ppm', 8, 6, [20, 80, 220]));
    const preview = page.locator('.preview-canvas');

    await openTopMenu(page, 'Adjustments');
    await clickTopMenuItem(page, 'Sepia');
    const dialog = page.getByRole('dialog', { name: 'Sepia' });
    await expect
      .poll(() =>
        preview.evaluate((canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(3, 2, 1, 1).data[3]),
      )
      .toBe(255);
    expect(
      await preview.evaluate((canvas: HTMLCanvasElement) => [
        ...canvas.getContext('2d')!.getImageData(3, 2, 1, 1).data,
      ]),
    ).not.toEqual([20, 80, 220, 255]);
    await expect(page.getByRole('alertdialog', { name: 'Effect preview failed' })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as typeof window & { __pintaEffectWorkerTerminations?: number }).__pintaEffectWorkerTerminations,
      ),
    ).toBe(1);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('previews Rotate / Zoom Layer live and clears or commits the transform exactly once', async ({ page }) => {
    await page
      .locator('input[type="file"][multiple]')
      .setInputFiles(ppm('transform-source.ppm', 24, 18, [20, 80, 220]));
    const display = page.locator('.canvas-stack canvas').first();
    const preview = page.locator('.preview-canvas');
    const originalDisplay = await display.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    const historyBefore = await page.locator('.history-row').count();

    const openDialog = async () => {
      await page.getByRole('button', { name: 'Layer menu' }).click();
      await page
        .locator('.layer-menu-popover .menu-item')
        .filter({ hasText: /^Rotate \/ Zoom Layer/ })
        .click();
      return page.getByRole('dialog', { name: 'Rotate / Zoom Layer' });
    };

    let dialog = await openDialog();
    await expect(dialog.getByRole('spinbutton', { name: 'Layer horizontal pan' })).toHaveValue('12');
    await expect(dialog.getByRole('spinbutton', { name: 'Layer vertical pan' })).toHaveValue('9');
    await dialog.getByRole('spinbutton', { name: 'Layer horizontal pan' }).fill('18');
    await expect
      .poll(() =>
        preview.evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(0, 9, 1, 1).data]),
      )
      .toEqual([0, 0, 0, 0]);
    await expect
      .poll(() =>
        preview.evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(7, 9, 1, 1).data]),
      )
      .toEqual([20, 80, 220, 255]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect
      .poll(() =>
        preview.evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(7, 9, 1, 1).data]),
      )
      .toEqual([0, 0, 0, 0]);
    expect(await display.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(originalDisplay);
    await expect(page.locator('.history-row')).toHaveCount(historyBefore);

    dialog = await openDialog();
    await dialog.getByRole('spinbutton', { name: 'Layer horizontal pan' }).fill('18');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.locator('.history-row')).toHaveCount(historyBefore + 1);
    await expect(page.locator('.history-row.active')).toContainText('Rotate / Zoom Layer');
    expect(
      await display.evaluate((canvas: HTMLCanvasElement) => [
        ...canvas.getContext('2d')!.getImageData(0, 9, 1, 1).data,
      ]),
    ).toEqual([0, 0, 0, 0]);
  });

  test('keeps an odd-sized layer centered when Rotate / Zoom first opens', async ({ page }) => {
    await page
      .locator('input[type="file"][multiple]')
      .setInputFiles(ppm('odd-transform-source.ppm', 25, 19, [20, 80, 220]));
    await page.getByRole('button', { name: 'Layer menu' }).click();
    await page
      .locator('.layer-menu-popover .menu-item')
      .filter({ hasText: /^Rotate \/ Zoom Layer/ })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Rotate / Zoom Layer' });
    await expect(dialog.getByRole('spinbutton', { name: 'Layer horizontal pan' })).toHaveValue('12');
    await expect(dialog.getByRole('spinbutton', { name: 'Layer vertical pan' })).toHaveValue('9');
    await expect
      .poll(() =>
        page
          .locator('.preview-canvas')
          .evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data]),
      )
      .toEqual([20, 80, 220, 255]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('drives Levels histograms, automatic correction, and endpoint colors from the active layer', async ({
    page,
  }) => {
    await page.locator('input[type="file"][multiple]').setInputFiles(levelsPpm('levels-source.ppm'));
    await openTopMenu(page, 'Adjustments');
    await clickTopMenuItem(page, 'Levels');

    const dialog = page.getByRole('dialog', { name: 'Levels' });
    const inputHistogram = dialog.locator('.levels-histogram[data-output="false"]');
    const outputHistogram = dialog.locator('.levels-histogram[data-output="true"]');
    await expect(inputHistogram).toHaveAttribute('data-total', String(32 * 16 * 3));
    await expect(inputHistogram.locator('polyline')).toHaveCount(3);
    const outputBefore = await outputHistogram.locator('.channel-red').getAttribute('points');

    await dialog.getByRole('button', { name: 'Auto', exact: true }).click();
    await expect(dialog.getByRole('spinbutton', { name: 'Input low value' })).toHaveValue('50');
    await expect(dialog.getByRole('spinbutton', { name: 'Input high value' })).toHaveValue('140');
    await expect.poll(() => outputHistogram.locator('.channel-red').getAttribute('points')).not.toBe(outputBefore);

    await dialog.getByRole('button', { name: 'Choose input low color' }).click();
    const colorDialog = page.getByRole('dialog', { name: 'Choose Color' });
    await colorDialog.getByLabel('Hex').fill('#102030');
    await colorDialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Choose input low color' })).toHaveCSS(
      'background-color',
      'rgb(16, 32, 48)',
    );

    await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(dialog.getByRole('spinbutton', { name: 'Input low value' })).toHaveValue('0');
    await expect(dialog.getByRole('spinbutton', { name: 'Input high value' })).toHaveValue('255');
    const outputGradient = dialog.getByRole('application', { name: 'Output levels gradient' });
    const gradientBounds = await outputGradient.boundingBox();
    expect(gradientBounds).not.toBeNull();
    await page.mouse.move(
      gradientBounds!.x + gradientBounds!.width / 2,
      gradientBounds!.y + gradientBounds!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      gradientBounds!.x + gradientBounds!.width / 2,
      gradientBounds!.y + gradientBounds!.height / 4,
      { steps: 4 },
    );
    await page.mouse.up();
    await expect(dialog.getByRole('spinbutton', { name: 'Gamma value' })).toHaveValue('0.4');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('uses Pinta percentile and mean gamma correction for Auto Level', async ({ page }) => {
    await page.locator('input[type="file"][multiple]').setInputFiles(autoLevelsPpm('auto-level.ppm'));
    await openTopMenu(page, 'Adjustments');
    await clickTopMenuItem(page, 'Auto Level');
    await expect(page.locator('.history-row.active')).toContainText('Auto Level');
    const corrected = await page
      .locator('.canvas-stack canvas')
      .first()
      .evaluate((display: HTMLCanvasElement) => [...display.getContext('2d')!.getImageData(0, 9, 1, 1).data]);
    expect(corrected).toEqual([214, 214, 214, 255]);
  });

  test('supports direct pointer and keyboard input on native point and angle pickers', async ({ page }) => {
    await openTopMenu(page, 'Effects');
    await clickTopMenuItem(page, 'Bulge');
    const pointPicker = page.getByRole('application', { name: /Point picker/ });
    await expect(page.getByRole('spinbutton', { name: 'Offset X', exact: true })).toHaveValue('400');
    await expect(page.getByRole('spinbutton', { name: 'Offset Y', exact: true })).toHaveValue('300');
    const pointBounds = await pointPicker.boundingBox();
    expect(pointBounds).not.toBeNull();
    // Click a whole screen pixel. The picker maps roughly a hundred pixels onto eight hundred
    // image units, so a sub-pixel difference in where the click lands moves the result by about
    // five -- and browsers disagree there, Chromium honouring fractional coordinates where
    // Firefox truncates them. Rounding makes the pixel, and therefore the value, the same in both.
    await page.mouse.click(
      Math.round(pointBounds!.x + pointBounds!.width * 0.8),
      Math.round(pointBounds!.y + pointBounds!.height * 0.25),
    );
    await expect(page.getByRole('spinbutton', { name: 'Offset X', exact: true })).toHaveValue('635');
    await expect(page.getByRole('spinbutton', { name: 'Offset Y', exact: true })).toHaveValue('150');
    await pointPicker.press('ArrowRight');
    await expect(page.getByRole('spinbutton', { name: 'Offset X', exact: true })).toHaveValue('636');
    await page.getByRole('dialog', { name: 'Bulge' }).getByRole('button', { name: 'Cancel' }).click();

    await openTopMenu(page, 'Effects');
    await clickTopMenuItem(page, 'Motion Blur');
    const angleDial = page.getByRole('slider', { name: 'Angle dial' });
    await expect(angleDial).toHaveAttribute('aria-valuemin', '-360');
    await expect(angleDial).toHaveAttribute('aria-valuemax', '360');
    await angleDial.focus();
    await angleDial.press('ArrowRight');
    await expect(page.getByRole('spinbutton', { name: 'Angle', exact: true })).toHaveValue('26');
    const angleBounds = await angleDial.boundingBox();
    expect(angleBounds).not.toBeNull();
    // Clicking a dial reads an angle off atan2, so landing half a pixel from the centre line is
    // worth about a degree at this radius. Whole-pixel clicks are the same in both browsers but
    // cannot sit exactly on a centre that falls between pixels, so these check the angle the
    // click points at rather than an exact integer.
    const angleValue = async () =>
      Number(await page.getByRole('spinbutton', { name: 'Angle', exact: true }).inputValue());
    await page.mouse.click(
      Math.round(angleBounds!.x + angleBounds!.width - 3),
      Math.round(angleBounds!.y + angleBounds!.height / 2),
    );
    expect(Math.abs(await angleValue()), 'clicking the right edge points at 0°').toBeLessThanOrEqual(1);
    await page.mouse.click(Math.round(angleBounds!.x + angleBounds!.width / 2), Math.round(angleBounds!.y + 3));
    expect(Math.abs((await angleValue()) - 90), 'clicking the top points at 90°').toBeLessThanOrEqual(1);
    await page.keyboard.down('Shift');
    await page.mouse.click(
      Math.round(angleBounds!.x + angleBounds!.width * 0.8),
      Math.round(angleBounds!.y + angleBounds!.height * 0.2),
    );
    await page.keyboard.up('Shift');
    await expect(page.getByRole('spinbutton', { name: 'Angle', exact: true })).toHaveValue('45');
  });

  test('preserves native effect hints and raw dithering palette names', async ({ page }) => {
    await openTopMenu(page, 'Effects');
    await clickTopMenuItem(page, 'Radial Blur');
    let dialog = page.getByRole('dialog', { name: 'Radial Blur' });
    await expect(dialog).toContainText(
      'Use low quality for previews, small images, and small angles. Use high quality for final quality, large images, and large angles.',
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await openTopMenu(page, 'Effects');
    await clickTopMenuItem(page, 'Red Eye Removal');
    dialog = page.getByRole('dialog', { name: 'Red Eye Removal' });
    await expect(dialog).toContainText('Hint: For best results, first use selection tools to select each eye.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await openTopMenu(page, 'Effects');
    await clickTopMenuItem(page, 'Dithering');
    dialog = page.getByRole('dialog', { name: 'Dithering' });
    await expect(dialog.getByRole('combobox').nth(2).locator('option')).toHaveText([
      'BlackWhite',
      'OldMsPaint',
      'OldWindows16',
      'OldWindows20',
      'Rgb3Bit',
      'Rgb666',
      'Rgb6Bit',
      'Rgb12Bit',
    ]);
  });

  test('keeps tall native effect dialogs usable in a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.locator('.header-cluster-end').getByRole('button', { name: 'Effects', exact: true }).click();
    const cellsItem = page.locator('.header-cluster-end .effect-menu-popover .menu-item').filter({ hasText: /^Cells/ });
    await cellsItem.scrollIntoViewIfNeeded();
    await cellsItem.click();
    const dialog = page.getByRole('dialog', { name: 'Cells' });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'OK' })).toBeVisible();
    expect(
      await dialog.locator('.native-effect-content').evaluate((element) => element.scrollHeight > element.clientHeight),
    ).toBe(true);
  });

  test('cancels native effect rendering without changing pixels or history', async ({ page }) => {
    const canvas = page.locator('.canvas-stack canvas').first();
    const pixelsBefore = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
    const historyBefore = await page.locator('.history-row').count();

    await openTopMenu(page, 'Effects');
    await clickTopMenuItem(page, 'Gaussian Blur');
    const configuration = page.getByRole('dialog', { name: 'Gaussian Blur' });
    await configuration.getByRole('spinbutton', { name: 'Radius', exact: true }).fill('200');
    await configuration.getByRole('button', { name: 'OK', exact: true }).click();

    const progress = page.getByRole('dialog', { name: 'Rendering Effect' });
    await expect(progress).toBeVisible();
    await expect(progress).toContainText('Gaussian Blur');
    const progressbar = progress.getByRole('progressbar', { name: 'Rendering progress' });
    await expect(progressbar).toBeVisible();
    await expect.poll(async () => Number(await progressbar.getAttribute('value'))).toBeGreaterThan(0);
    await expect(progress).not.toContainText('0%');
    await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(progress).toBeHidden();
    await expect(page.locator('.history-row')).toHaveCount(historyBefore);
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(pixelsBefore);

    // Cancellation terminates the synchronous worker. A later effect must
    // transparently start a fresh worker rather than leaving effects broken.
    await openTopMenu(page, 'Adjustments');
    await clickTopMenuItem(page, 'Invert Colors');
    await expect(page.locator('.history-row.active')).toContainText('Invert Colors');
  });

  test('creates, resizes, and canvas-resizes an independent document', async ({ page }) => {
    await page.getByRole('button', { name: 'New Image (Ctrl+N)', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('320');
    await page.getByRole('spinbutton', { name: 'Height', exact: true }).fill('200');
    await page.getByRole('button', { name: 'OK', exact: true }).click();

    const activeTab = page.getByRole('tab', { name: /Unsaved Image 2/ });
    await expect(activeTab).toHaveAttribute('title', /320 × 200/);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-document-count', '2');

    await openTopMenu(page, 'Image');
    await clickTopMenuItem(page, 'Resize Image');
    await page.getByRole('radio', { name: 'By absolute size:' }).check();
    await page.getByLabel('Maintain aspect ratio').uncheck();
    await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('160');
    await page.getByRole('spinbutton', { name: 'Height', exact: true }).fill('90');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(activeTab).toHaveAttribute('title', /160 × 90/);

    await openTopMenu(page, 'Image');
    await clickTopMenuItem(page, 'Resize Canvas');
    await page.getByRole('radio', { name: 'By absolute size:' }).check();
    await expect(page.getByLabel('Maintain aspect ratio')).toBeChecked();
    await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('200');
    await expect(page.getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue('113');
    await page.getByLabel('Maintain aspect ratio').uncheck();
    await page.getByRole('spinbutton', { name: 'Height', exact: true }).fill('120');
    await page.getByLabel('north-west anchor').click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(activeTab).toHaveAttribute('title', /200 × 120/);

    await openTopMenu(page, 'Image');
    await clickTopMenuItem(page, 'Resize Canvas');
    await expect(page.getByRole('radio', { name: 'By absolute size:' })).toBeChecked();
    await expect(page.getByLabel('Maintain aspect ratio')).not.toBeChecked();
    await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('200');
    await expect(page.getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue('120');
    await expect(page.getByLabel('north-west anchor')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  test('opens multiple picker files as ordered, independent tabs', async ({ page }) => {
    const input = page.locator('input[type="file"][multiple]');
    await input.setInputFiles([ppm('red-wide.ppm', 3, 2, [255, 0, 0]), ppm('green-tall.ppm', 2, 4, [0, 255, 0])]);

    await expect(page.locator('.app-shell')).toHaveAttribute('data-document-count', '3');
    await expect(page.getByRole('tab', { name: /red-wide\.ppm/ })).toHaveAttribute('title', /3 × 2/);
    await expect(page.getByRole('tab', { name: /green-tall\.ppm/ })).toHaveAttribute('title', /2 × 4/);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'green-tall.ppm');

    await page.getByRole('tab', { name: /red-wide\.ppm/ }).click();
    await page.getByRole('button', { name: 'Add New Layer' }).click();
    await expect(page.locator('.layer-row')).toHaveCount(2);
    await page.getByRole('tab', { name: /green-tall\.ppm/ }).click();
    await expect(page.locator('.layer-row')).toHaveCount(1);
  });

  test('opens every image from a multi-file drag and drop', async ({ page }) => {
    const files = [ppm('drop-one.ppm', 5, 3, [20, 40, 60]), ppm('drop-two.ppm', 4, 6, [80, 100, 120])].map((file) => ({
      name: file.name,
      type: file.mimeType,
      bytes: [...file.buffer],
    }));

    await page.locator('.app-shell').dispatchEvent('dragover');
    await expect(page.locator('.drop-overlay')).toContainText('Open images in Pinta');
    await page.evaluate((droppedFiles) => {
      const transfer = new DataTransfer();
      for (const file of droppedFiles)
        transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
      document
        .querySelector('.app-shell')!
        .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, files);

    await expect(page.locator('.app-shell')).toHaveAttribute('data-document-count', '3');
    await expect(page.getByRole('tab', { name: /drop-one\.ppm/ })).toHaveAttribute('title', /5 × 3/);
    await expect(page.getByRole('tab', { name: /drop-two\.ppm/ })).toHaveAttribute('title', /4 × 6/);
  });

  test('keeps native file handles attached to their tabs and saves back in place', async ({ page }) => {
    const source = ppm('picker-image.ppm', 3, 2, [25, 90, 180]);
    await page.evaluate(
      ({ bytes }) => {
        const target = window as typeof window & {
          showOpenFilePicker?: () => Promise<FileSystemFileHandle[]>;
          __pintaFileWrites?: Array<{ size: number; type: string; closed: boolean }>;
        };
        target.__pintaFileWrites = [];
        const handle = {
          kind: 'file',
          name: 'picker-image.ppm',
          getFile: async () =>
            new File([new Uint8Array(bytes)], 'picker-image.ppm', { type: 'image/x-portable-pixmap' }),
          createWritable: async () => ({
            write: async (blob: Blob) =>
              target.__pintaFileWrites!.push({ size: blob.size, type: blob.type, closed: false }),
            close: async () => {
              target.__pintaFileWrites!.at(-1)!.closed = true;
            },
          }),
        };
        target.showOpenFilePicker = async () => [handle as unknown as FileSystemFileHandle];
      },
      { bytes: [...source.buffer] },
    );

    await page.getByRole('button', { name: 'Open Image (Ctrl+O)', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'picker-image.ppm');
    await page.getByRole('button', { name: 'Add New Layer' }).click();
    await expect(page).toHaveTitle('picker-image.ppm* — Pinta Online Image Editor');
    await page.keyboard.press('Control+S');
    const flatten = page.getByRole('alertdialog', { name: 'This format does not support layers. Flatten image?' });
    await expect(flatten).toBeVisible();
    await flatten.getByRole('button', { name: 'Flatten' }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as typeof window & { __pintaFileWrites?: unknown[] }).__pintaFileWrites?.length ?? 0,
        ),
      )
      .toBe(1);
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __pintaFileWrites?: Array<{ size: number; type: string; closed: boolean }> })
            .__pintaFileWrites![0],
      ),
    ).toEqual({
      size: expect.any(Number),
      type: 'image/x-portable-pixmap',
      closed: true,
    });
    await expect(page).toHaveTitle('picker-image.ppm — Pinta Online Image Editor');
  });

  test('reports native file-handle save failures with diagnostics and preserves the dirty document', async ({
    page,
  }) => {
    const source = ppm('read-only.ppm', 3, 2, [25, 90, 180]);
    await page.evaluate(
      ({ bytes }) => {
        const target = window as typeof window & { showOpenFilePicker?: () => Promise<FileSystemFileHandle[]> };
        target.showOpenFilePicker = async () => [
          {
            kind: 'file',
            name: 'read-only.ppm',
            getFile: async () =>
              new File([new Uint8Array(bytes)], 'read-only.ppm', { type: 'image/x-portable-pixmap' }),
            createWritable: async () => {
              throw new DOMException('The file is read-only.', 'NotAllowedError');
            },
          } as unknown as FileSystemFileHandle,
        ];
      },
      { bytes: [...source.buffer] },
    );

    await page.getByRole('button', { name: 'Open Image (Ctrl+O)', exact: true }).click();
    await openTopMenu(page, 'Adjustments');
    await clickTopMenuItem(page, 'Invert Colors');
    await expect(page).toHaveTitle('read-only.ppm* — Pinta Online Image Editor');
    await page.keyboard.press('Control+S');

    const errorDialog = page.getByRole('alertdialog', { name: 'Failed to save image' });
    await expect(errorDialog).toContainText('The file is read-only.');
    await errorDialog.getByText('Details').click();
    await expect(errorDialog.locator('pre')).toContainText('NotAllowedError');
    await errorDialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page).toHaveTitle('read-only.ppm* — Pinta Online Image Editor');
  });

  test('rejects a browser encoder fallback instead of saving PNG bytes with a WebP name', async ({ page }) => {
    await page.evaluate(() => {
      const target = window as typeof window & {
        showSaveFilePicker?: () => Promise<FileSystemFileHandle>;
        __pintaUnexpectedWebpWrites?: number;
      };
      target.__pintaUnexpectedWebpWrites = 0;
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        if (type === 'image/webp') {
          callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
          return;
        }
        originalToBlob.call(this, callback, type, quality);
      };
      target.showSaveFilePicker = async () =>
        ({
          kind: 'file',
          name: 'unsupported.webp',
          getFile: async () => new File([], 'unsupported.webp', { type: 'image/webp' }),
          createWritable: async () => ({
            write: async () => {
              target.__pintaUnexpectedWebpWrites! += 1;
            },
            close: async () => undefined,
          }),
        }) as unknown as FileSystemFileHandle;
    });

    await page.locator('.canvas-stack').click({ position: { x: 100, y: 100 } });
    await expect(page).toHaveTitle(/\* — Pinta Online Image Editor$/);
    await page.keyboard.press('Control+Shift+S');
    const saveAs = page.getByRole('dialog', { name: 'Save Image As' });
    await saveAs.getByLabel('File format').selectOption('webp');
    await saveAs.getByRole('button', { name: 'Save', exact: true }).click();

    const errorDialog = page.getByRole('alertdialog', { name: 'Failed to save image' });
    await expect(errorDialog).toContainText('Pinta does not support saving images in this file format.');
    expect(
      await page.evaluate(
        () => (window as typeof window & { __pintaUnexpectedWebpWrites?: number }).__pintaUnexpectedWebpWrites,
      ),
    ).toBe(0);
    await errorDialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page).toHaveTitle(/\* — Pinta Online Image Editor$/);
  });

  test('treats browser file-picker cancellation as a no-op and restores command focus', async ({ page }) => {
    await page.evaluate(() => {
      const target = window as typeof window & { showOpenFilePicker?: () => Promise<FileSystemFileHandle[]> };
      target.showOpenFilePicker = async () => {
        throw new DOMException('Canceled', 'AbortError');
      };
    });
    const openButton = page.getByRole('button', { name: 'Open Image (Ctrl+O)', exact: true });
    await openButton.click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-document-count', '1');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The command keeps focus where the platform put it. Clicking a button focuses it on Windows
    // and Linux, so it stays focused; WebKit follows the macOS convention of not focusing buttons
    // on click, and focus is on the body both before and after. Either way a cancelled picker must
    // not move focus somewhere unrelated, which is what this actually guarantees.
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? 'body');
    expect(['Open Image (Ctrl+O)', 'body'], 'a cancelled picker leaves focus where it was').toContain(focused);
  });

  test('opens every valid installed-PWA launch file after workspace restoration', async ({ page }) => {
    await page.addInitScript(() => {
      const target = window as typeof window & {
        __pintaLaunchConsumer?: (parameters: { files: FileSystemFileHandle[] }) => void;
      };
      Object.defineProperty(window, 'launchQueue', {
        configurable: true,
        value: {
          setConsumer: (consumer: (parameters: { files: FileSystemFileHandle[] }) => void) => {
            target.__pintaLaunchConsumer = consumer;
          },
        },
      });
    });
    await page.reload();
    await waitForWorkspace(page);
    await expect
      .poll(() =>
        page.evaluate(
          () => typeof (window as typeof window & { __pintaLaunchConsumer?: unknown }).__pintaLaunchConsumer,
        ),
      )
      .toBe('function');

    const first = ppm('launch-first.ppm', 7, 3, [180, 30, 20]);
    const last = ppm('launch-last.ppm', 4, 8, [20, 80, 190]);
    await page.evaluate(
      ({ firstBytes, lastBytes }) => {
        const handle = (name: string, type: string, bytes: number[]) =>
          ({
            kind: 'file',
            name,
            getFile: async () => new File([new Uint8Array(bytes)], name, { type }),
          }) as unknown as FileSystemFileHandle;
        const consumer = (
          window as typeof window & {
            __pintaLaunchConsumer?: (parameters: { files: FileSystemFileHandle[] }) => void;
          }
        ).__pintaLaunchConsumer!;
        consumer({
          files: [
            handle('launch-first.ppm', 'image/x-portable-pixmap', firstBytes),
            handle('launch-broken.ppm', 'image/x-portable-pixmap', [1, 2, 3]),
            handle('launch-last.ppm', 'image/x-portable-pixmap', lastBytes),
          ],
        });
      },
      { firstBytes: [...first.buffer], lastBytes: [...last.buffer] },
    );

    await expect(page.getByRole('tab', { name: /launch-first\.ppm/ })).toHaveAttribute('title', /7 × 3/);
    await expect(page.getByRole('tab', { name: /launch-last\.ppm/ })).toHaveAttribute('title', /4 × 8/);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'launch-last.ppm');
    const errorDialog = page.getByRole('alertdialog', { name: 'Unsupported file format' });
    await expect(errorDialog).toContainText('Opened 2 images, but could not open: launch-broken.ppm');
    await errorDialog.getByText('Details').click();
    await expect(errorDialog.locator('pre')).toContainText('launch-broken.ppm');
    await page.evaluate(() => {
      const target = window as typeof window & { __pintaErrorReportUrl?: string };
      window.open = ((url?: string | URL) => {
        target.__pintaErrorReportUrl = String(url);
        return null;
      }) as typeof window.open;
    });
    await errorDialog.getByRole('button', { name: /Report Bug/ }).click();
    expect(
      await page.evaluate(() => (window as typeof window & { __pintaErrorReportUrl?: string }).__pintaErrorReportUrl),
    ).toBe('https://github.com/evgenyvinnik/pinta-online/issues/new?template=bug.md');
  });

  test('routes an unsaved close through Save As and flatten confirmation before closing', async ({ page }) => {
    await page.evaluate(() => {
      const target = window as typeof window & {
        showSaveFilePicker?: () => Promise<FileSystemFileHandle>;
        __pintaCloseSave?: { writes: number; closed: boolean };
      };
      target.__pintaCloseSave = { writes: 0, closed: false };
      target.showSaveFilePicker = async () =>
        ({
          kind: 'file',
          name: 'closed-image.png',
          getFile: async () => new File([], 'closed-image.png', { type: 'image/png' }),
          createWritable: async () => ({
            write: async () => {
              target.__pintaCloseSave!.writes += 1;
            },
            close: async () => {
              target.__pintaCloseSave!.closed = true;
            },
          }),
        }) as unknown as FileSystemFileHandle;
    });
    await page.getByRole('button', { name: 'Add New Layer' }).click();
    await page.keyboard.press('Control+W');
    const closeDialog = page.getByRole('alertdialog', { name: /Save changes to image/ });
    await closeDialog.getByRole('button', { name: 'Save' }).click();
    const saveAs = page.getByRole('dialog', { name: 'Save Image As' });
    await expect(saveAs).toBeVisible();
    await saveAs.getByRole('button', { name: 'Save' }).click();
    await page
      .getByRole('alertdialog', { name: /format does not support layers/ })
      .getByRole('button', { name: 'Flatten' })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as typeof window & { __pintaCloseSave?: { writes: number } }).__pintaCloseSave?.writes,
        ),
      )
      .toBe(1);
    expect(
      await page.evaluate(
        () => (window as typeof window & { __pintaCloseSave?: { closed: boolean } }).__pintaCloseSave?.closed,
      ),
    ).toBe(true);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-document-count', '0');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', '');
    await expect(page.getByRole('main', { name: 'No image open' })).toBeVisible();
    await expect(closeDialog).toBeHidden();
  });

  test('requires and performs a real document flatten for layered flat-format saves', async ({ page }) => {
    await page.locator('input[type="file"][multiple]').setInputFiles(ppm('layered-save.ppm', 24, 18, [20, 80, 160]));
    await page.getByRole('button', { name: 'Add New Layer' }).click();
    await expect(page.locator('.layer-row')).toHaveCount(2);

    await page.keyboard.press('Control+S');
    let flatten = page.getByRole('alertdialog', { name: /format does not support layers/ });
    await expect(flatten).toBeVisible();
    await flatten.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.layer-row')).toHaveCount(2);
    await expect(page).toHaveTitle(/\* — Pinta Online/);

    await page.keyboard.press('Control+S');
    flatten = page.getByRole('alertdialog', { name: /format does not support layers/ });
    await flatten.getByRole('button', { name: 'Flatten' }).click();
    await expect(page.locator('.layer-row')).toHaveCount(1);
    await expect(page.locator('.history-row.active')).toContainText('Flatten');
    await expect(page).toHaveTitle('layered-save.ppm — Pinta Online Image Editor');

    await page.keyboard.press('Control+N');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.getByRole('button', { name: 'Add New Layer' }).click();
    await page.evaluate(() => {
      (window as unknown as { showSaveFilePicker: () => Promise<never> }).showSaveFilePicker = async () => {
        throw new DOMException('Cancelled', 'AbortError');
      };
    });
    await page.keyboard.press('Control+Shift+S');
    const saveAs = page.getByRole('dialog', { name: 'Save Image As' });
    await saveAs.getByLabel('File format').selectOption('png');
    await saveAs.getByRole('button', { name: 'Save' }).click();
    await page
      .getByRole('alertdialog', { name: /format does not support layers/ })
      .getByRole('button', { name: 'Flatten' })
      .click();
    await expect(saveAs).toBeVisible();
    await expect(page.locator('.layer-row')).toHaveCount(2);
    await expect(page.locator('.history-row.active')).not.toContainText('Flatten');
  });

  test('Save All walks dirty documents through flattening and Save As instead of auto-naming them', async ({
    page,
  }) => {
    await page
      .locator('input[type="file"][multiple]')
      .setInputFiles(ppm('save-all-layered.ppm', 24, 18, [20, 80, 160]));
    await page.getByRole('button', { name: 'Add New Layer' }).click();
    await page.keyboard.press('Control+N');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    const canvas = page.locator('.canvas-stack');
    await canvas.click({ position: { x: 20, y: 20 } });

    await page.evaluate(() => {
      const target = window as typeof window & { __pintaSaveAllWrites?: number };
      target.__pintaSaveAllWrites = 0;
      (window as unknown as { showSaveFilePicker: () => Promise<unknown> }).showSaveFilePicker = async () => ({
        name: 'save-all-new.png',
        getFile: async () => new File([], 'save-all-new.png'),
        createWritable: async () => ({
          write: async () => {
            target.__pintaSaveAllWrites = (target.__pintaSaveAllWrites ?? 0) + 1;
          },
          close: async () => undefined,
        }),
      });
    });

    await page.keyboard.press('Control+Alt+A');
    const flatten = page.getByRole('alertdialog', { name: /format does not support layers/ });
    await expect(flatten).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'save-all-layered.ppm');
    await flatten.getByRole('button', { name: 'Flatten' }).click();

    const saveAs = page.getByRole('dialog', { name: 'Save Image As' });
    await expect(saveAs).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', /Unsaved Image/);
    await saveAs.getByLabel('File name').fill('save-all-new');
    await saveAs.getByLabel('File format').selectOption('png');
    await saveAs.getByRole('button', { name: 'Save' }).click();
    await expect(saveAs).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() => (window as typeof window & { __pintaSaveAllWrites?: number }).__pintaSaveAllWrites),
      )
      .toBe(1);
    await expect(page.getByRole('status')).toContainText('Saved 2 images');

    await page.getByRole('tab', { name: /save-all-layered\.ppm/ }).click();
    await expect(page.locator('.layer-row')).toHaveCount(1);
    await expect(page.locator('.history-row.active')).toContainText('Flatten');
  });

  test('places OpenRaster layers at their declared offsets and skips missing layers', async ({ page }) => {
    const png = new Uint8Array(
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#dc281e';
        context.fillRect(0, 0, 2, 2);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG failed'))), 'image/png'),
        );
        return [...new Uint8Array(await blob.arrayBuffer())];
      }),
    );
    const stack = `<?xml version="1.0"?><image version="0.0.5" w="20" h="15"><stack><layer name="Missing" src="data/missing.png" x="0" y="0"/><layer name="Offset red" src="data/red.png" x="7" y="5"/></stack></image>`;
    const archive = zipSync({
      mimetype: [strToU8('image/openraster'), { level: 0 }],
      'stack.xml': strToU8(stack),
      'data/red.png': png,
    });
    await page.locator('input[type="file"][multiple]').setInputFiles({
      name: 'offset-layer.ora',
      mimeType: 'image/openraster',
      buffer: Buffer.from(archive),
    });
    await expect(page.locator('.layer-row')).toHaveCount(1);
    await expect(page.locator('.layer-row')).toContainText('Offset red');
    const pixels = await page
      .locator('.canvas-stack canvas')
      .first()
      .evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext('2d')!;
        return {
          origin: [...context.getImageData(0, 0, 1, 1).data],
          offset: [...context.getImageData(7, 5, 1, 1).data],
        };
      });
    expect(pixels).toEqual({ origin: [0, 0, 0, 0], offset: [220, 40, 30, 255] });
  });

  test('imports and exports PNG images through the operating-system clipboard bridge', async ({
    page,
    browserName,
  }) => {
    // Firefox builds a ClipboardEvent with a clipboardData that is present but empty: constructing
    // one with a populated DataTransfer yields files.length 0, where Chromium yields 1. The paste
    // path itself is fine there -- a real Ctrl+V delivers a real event -- but it cannot be
    // synthesized, so there is nothing for this test to drive.
    test.skip(browserName === 'firefox', 'Firefox drops DataTransfer contents from a constructed ClipboardEvent');
    await page.locator('.app-shell').evaluate(async (shell) => {
      const canvas = document.createElement('canvas');
      canvas.width = 12;
      canvas.height = 8;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#e03020';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('PNG encoding failed'))), 'image/png'),
      );
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'clipboard.png', { type: 'image/png' }));
      shell.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-selection-bounds', '394,296,12,8');
    await expect(page.locator('.history-row.active')).toContainText('Paste');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-floating-pixels', 'true');
    await expect(page.getByRole('button', { name: 'Move Selected Pixels', exact: true })).toHaveClass(/active/);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Control+ArrowDown');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-selection-bounds', '395,306,12,8');
    await expect(page.locator('.history-row.active')).toContainText('Move Selected Pixels');
    await expect
      .poll(() =>
        page
          .locator('.preview-canvas')
          .evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(396, 307, 1, 1).data]),
      )
      .toEqual([224, 48, 32, 255]);

    await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-save-state', 'saved', { timeout: 20_000 });
    await page.reload();
    await waitForWorkspace(page);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-selection-bounds', '395,306,12,8');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-floating-pixels', 'true');
    await expect
      .poll(() =>
        page
          .locator('.preview-canvas')
          .evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(396, 307, 1, 1).data]),
      )
      .toEqual([224, 48, 32, 255]);

    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-floating-pixels', 'false');
    await expect
      .poll(() =>
        page
          .locator('.canvas-stack canvas')
          .first()
          .evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(396, 307, 1, 1).data]),
      )
      .toEqual([224, 48, 32, 255]);

    await page.evaluate(() => {
      const target = window as typeof window & { __pintaClipboardTypes?: string[] };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          read: async () => {
            throw new DOMException('Not allowed', 'NotAllowedError');
          },
          write: async (items: ClipboardItem[]) => {
            target.__pintaClipboardTypes = [...items[0].types];
          },
        },
      });
    });
    await page.keyboard.press('Control+C');
    await expect
      .poll(() =>
        page.evaluate(() => (window as typeof window & { __pintaClipboardTypes?: string[] }).__pintaClipboardTypes),
      )
      .toEqual(['image/png']);
  });

  test('escapes a workspace that cannot be restored without overwriting it', async ({ page }) => {
    // Draw something and let it reach IndexedDB.
    await page.getByRole('button', { name: 'Pencil', exact: true }).click();
    const canvas = page.locator('.canvas-stack');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + 60, bounds!.y + 60);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 240, bounds!.y + 180, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-save-state', 'saved', { timeout: 20_000 });

    const drawnPixels = () =>
      page
        .locator('.canvas-stack canvas')
        .first()
        .evaluate((element: HTMLCanvasElement) => {
          const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
          let dark = 0;
          for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 200) dark += 1;
          return dark;
        });
    const drawn = await drawnPixels();
    expect(drawn).toBeGreaterThan(0);

    // The boundary's escape hatch: start without replaying the stored workspace.
    await page.evaluate(() => sessionStorage.setItem('pinta-online-skip-restore', '1'));
    await page.reload();
    await waitForWorkspace(page);

    await expect(page.locator('.persistence-suspended-banner')).toBeVisible();
    expect(await drawnPixels()).toBe(0);
    // One-shot: the next reload restores normally rather than staying stuck.
    expect(await page.evaluate(() => sessionStorage.getItem('pinta-online-skip-restore'))).toBeNull();

    // Editing in the skipped session must not persist over the work it declined to load.
    await page.getByRole('button', { name: 'Pencil', exact: true }).click();
    const skipped = await page.locator('.canvas-stack').boundingBox();
    await page.mouse.move(skipped!.x + 40, skipped!.y + 40);
    await page.mouse.down();
    await page.mouse.move(skipped!.x + 120, skipped!.y + 90, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(1500);
    await expect(page.locator('.persistence-suspended-banner')).toBeVisible();

    await page.reload();
    await waitForWorkspace(page);
    await expect(page.locator('.persistence-suspended-banner')).toHaveCount(0);
    await expect.poll(drawnPixels).toBe(drawn);
  });

  test('explains an empty clipboard instead of silently ignoring paste', async ({ page }) => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { read: async () => [], write: async () => undefined },
      });
    });
    await page.keyboard.press('Control+V');
    const dialog = page.getByRole('alertdialog', { name: 'Image cannot be pasted' });
    await expect(dialog).toContainText('The clipboard does not contain an image.');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(dialog).toBeHidden();
  });

  test('copies without mutating the document and pastes when the platform clipboard refuses images', async ({
    page,
  }) => {
    // Safari and permission-restricted contexts reject the image write while still
    // answering reads with unrelated content. Pinta's own clipboard must survive that.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          read: async () => [
            { types: ['text/plain'], getType: async () => new Blob(['unrelated'], { type: 'text/plain' }) },
          ],
          write: async () => {
            throw new DOMException('Not allowed', 'NotAllowedError');
          },
        },
      });
    });

    await page.getByRole('button', { name: 'Pencil', exact: true }).click();
    const canvas = page.locator('.canvas-stack');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + 100, bounds!.y + 100);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 300, bounds!.y + 220, { steps: 20 });
    await page.mouse.up();

    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
    await page.mouse.move(bounds!.x + 80, bounds!.y + 80);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 320, bounds!.y + 240, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('.history-row.active')).toContainText('Select');

    const layerPixels = () =>
      page
        .locator('.canvas-stack canvas')
        .first()
        .evaluate((element: HTMLCanvasElement) =>
          [...element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data].join(','),
        );
    const beforeCopy = await layerPixels();
    const historyBefore = await page.locator('.history-row').count();
    const selectionBefore = await page.locator('.app-shell').getAttribute('data-selection-bounds');

    // Copy is non-destructive: no pixels, selection, history entry, or tool change.
    await page.keyboard.press('Control+C');
    await expect(page.locator('[role="status"]')).toContainText('Copied selection');
    expect(await layerPixels()).toBe(beforeCopy);
    await expect(page.locator('.history-row')).toHaveCount(historyBefore);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-selection-bounds', selectionBefore!);
    await expect(page.getByRole('button', { name: 'Rectangle Select', exact: true })).toHaveClass(/active/);
    await expect(page.getByRole('alertdialog', { name: 'Image cannot be pasted' })).toBeHidden();

    // Paste falls back to Pinta's clipboard and lands in the movable float.
    await page.keyboard.press('Control+V');
    await expect(page.getByRole('alertdialog', { name: 'Image cannot be pasted' })).toBeHidden();
    await expect(page.locator('.history-row.active')).toContainText('Paste');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-floating-pixels', 'true');
    await expect(page.getByRole('button', { name: 'Move Selected Pixels', exact: true })).toHaveClass(/active/);
  });
});

test.describe('editing state', () => {
  test('lists every production command and tool in the keyboard shortcuts dialog', async ({ page }) => {
    await page.keyboard.press('Control+,');
    const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    const expectedRows =
      TOOLS.filter((tool) => tool.shortcut).length +
      REGISTERED_SHORTCUT_SECTIONS.reduce((total, section) => total + section.entries.length, 0);
    await expect(dialog.locator('.shortcut-row')).toHaveCount(expectedRows);
    await expect(dialog).toContainText('Next Image');
    await expect(dialog).toContainText('Paste Into New Image');
    await expect(dialog).toContainText('Rotate Counter-Clockwise');
    await expect(dialog.locator('.shortcut-section h3')).toHaveText([
      'Tools',
      'Layers',
      'File',
      'Edit',
      'View',
      'Image',
      'Adjustments',
      'Help',
    ]);
    await dialog.getByRole('button', { name: 'Search shortcuts' }).click();
    await dialog.getByRole('searchbox', { name: 'Search shortcuts' }).fill('counter-clockwise');
    await expect(dialog.locator('.shortcut-row')).toHaveCount(1);
    await expect(dialog.locator('.shortcut-row')).toContainText('Rotate Counter-Clockwise');
    await dialog.getByRole('searchbox', { name: 'Search shortcuts' }).fill('no such shortcut');
    await expect(dialog).toContainText('No shortcuts found');
  });

  test('cycles every tool group using the original Pinta shortcut keys', async ({ page }) => {
    for (const [key, tools] of [
      ['m', ['Move Selected Pixels', 'Move Selection', 'Move Selected Pixels']],
      ['s', ['Rectangle Select', 'Ellipse Select', 'Lasso Select', 'Magic Wand Select', 'Rectangle Select']],
      ['o', ['Line / Curve', 'Rectangle', 'Rounded Rectangle', 'Ellipse', 'Freeform Shape', 'Line / Curve']],
    ] as const) {
      for (const tool of tools) {
        await page.keyboard.press(key);
        await expect(page.getByRole('button', { name: tool, exact: true })).toHaveClass(/active/);
      }
    }
  });

  test('supports native text sizing, tab input, bidirectional content, and IME-safe commits', async ({ page }) => {
    await page.locator('.toolbox').getByRole('button', { name: 'Text', exact: true }).click();
    const fontSize = page.getByRole('spinbutton', { name: 'Font size' });
    const initialSize = Number(await fontSize.inputValue());
    await page.keyboard.press(']');
    await expect(fontSize).toHaveValue(String(initialSize + 1));

    await page.locator('.canvas-stack').click({ position: { x: 120, y: 100 } });
    const textEditor = page.getByRole('textbox', { name: 'Text editor' });
    await expect(textEditor).toHaveAttribute('dir', 'auto');
    await expect(textEditor).toBeFocused();
    const textMetrics = await textEditor.evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: Number.parseFloat(style.fontSize), lineHeight: Number.parseFloat(style.lineHeight) };
    });
    expect(textMetrics.lineHeight).toBe(textMetrics.fontSize);

    // Font controls can temporarily own focus. Placing text again reuses the mounted textarea,
    // so native HTML autofocus alone cannot return the caret to it.
    await fontSize.focus();
    await expect(fontSize).toBeFocused();
    await page.locator('.canvas-stack').click({ position: { x: 125, y: 105 } });
    await expect(textEditor).toBeFocused();

    await textEditor.fill('مرحبا Pinta');
    await textEditor.press('End');
    await textEditor.press('Tab');
    await expect(textEditor).toHaveValue('مرحبا Pinta\t');
    await expect(textEditor).toBeFocused();

    await textEditor.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Enter',
          ctrlKey: true,
          isComposing: true,
        }),
      );
    });
    await expect(textEditor).toBeVisible();
    await textEditor.press('Control+Enter');
    await expect(textEditor).toHaveValue('مرحبا Pinta\t\n');
    const editorBounds = await textEditor.boundingBox();
    expect(editorBounds).not.toBeNull();
    const editorPosition = async () =>
      (await page.locator('.app-shell').getAttribute('data-text-editor-position'))!.split(',').map(Number);
    // Where the editor starts depends on the sub-pixel offset of the canvas and on whether the
    // browser reports fractional pointer coordinates -- Chromium placed it at 120.00 and Firefox
    // at 119.50 from the same click. What a right-drag promises is the movement, so that is what
    // is checked: thirty across and twenty down, from wherever it began.
    const before = await editorPosition();
    await page.mouse.move(Math.round(editorBounds!.x + 20), Math.round(editorBounds!.y + 20));
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(Math.round(editorBounds!.x + 50), Math.round(editorBounds!.y + 40), { steps: 4 });
    await page.mouse.up({ button: 'right' });
    await expect.poll(async () => (await editorPosition())[0] - before[0]).toBe(30);
    expect((await editorPosition())[1] - before[1]).toBe(20);
    await textEditor.press('Escape');
    await expect(textEditor).toBeHidden();
    await expect(page.locator('.history-row.active')).toContainText('Text');

    const historyAfterFirstCommit = await page.locator('.history-row').count();
    await page.locator('.canvas-stack').click({ position: { x: 160, y: 130 }, modifiers: ['Control'] });
    await expect(textEditor).toHaveValue('مرحبا Pinta\t\n');
    await textEditor.fill('temporary edit');
    await page.getByRole('button', { name: 'Cancel text' }).click();
    await expect(page.locator('.history-row')).toHaveCount(historyAfterFirstCommit);

    await page.locator('.canvas-stack').click({ position: { x: 160, y: 130 }, modifiers: ['Control'] });
    await textEditor.fill('Re-edited text');
    await textEditor.press('Escape');
    await expect(page.locator('.history-row')).toHaveCount(historyAfterFirstCommit + 1);
    await expect(page.locator('.history-row.active')).toContainText('Text');
  });

  test('enumerates installed font families when the browser exposes local font access', async ({ page }) => {
    await page.evaluate(() => {
      Object.defineProperty(window, 'queryLocalFonts', {
        configurable: true,
        value: async () => [
          { family: 'Pinta Test Sans', fullName: 'Pinta Test Sans Regular' },
          { family: 'Pinta Test Serif', fullName: 'Pinta Test Serif Regular' },
          { family: 'Pinta Test Sans', fullName: 'Pinta Test Sans Bold' },
        ],
      });
    });
    await page.locator('.toolbox').getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByRole('button', { name: 'Font family', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose Font Family' });
    await expect(dialog.getByRole('option')).toHaveCount(3);
    await dialog.getByLabel('Search fonts').fill('Serif');
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await dialog.getByRole('option', { name: 'Pinta Test Serif' }).click();
    await dialog.getByRole('button', { name: 'Select' }).click();
    await expect(page.getByRole('button', { name: 'Font family', exact: true })).toHaveText('Pinta Test Serif');
  });

  test('restores an active text edit and its cancelable re-edit state without inventing history', async ({ page }) => {
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.locator('.canvas-stack').click({ position: { x: 120, y: 100 } });
    const textEditor = page.getByRole('textbox', { name: 'Text editor' });
    await textEditor.fill('Uncommitted browser session');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-save-state', 'saved', { timeout: 20_000 });
    await page.reload();
    await waitForWorkspace(page);
    await expect(textEditor).toHaveValue('Uncommitted browser session');
    await expect(page.locator('.history-row')).toHaveCount(1);

    await page.getByRole('button', { name: 'Commit text' }).click();
    await expect(page.locator('.history-row.active')).toContainText('Text');
    const committedHistoryCount = await page.locator('.history-row').count();
    await page.locator('.canvas-stack').click({ position: { x: 130, y: 110 }, modifiers: ['Control'] });
    await expect(textEditor).toBeVisible();
    await textEditor.fill('Temporary restored re-edit');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-save-state', 'saved', { timeout: 20_000 });
    await page.reload();
    await waitForWorkspace(page);
    await expect(textEditor).toHaveValue('Temporary restored re-edit');
    await page.getByRole('button', { name: 'Cancel text' }).click();
    await expect(textEditor).toBeHidden();
    await expect(page.locator('.history-row')).toHaveCount(committedHistoryCount);
    await expect(page.locator('.history-row.active')).toContainText('Text');
  });

  test('keeps one native re-editable text engine per layer across switches and reloads', async ({ page }) => {
    await page.keyboard.press('Control+W');
    await page.keyboard.press('Control+N');
    const newImage = page.getByRole('dialog', { name: 'New Image' });
    await newImage.getByRole('spinbutton', { name: 'Width', exact: true }).fill('400');
    await newImage.getByRole('spinbutton', { name: 'Height', exact: true }).fill('260');
    await newImage.getByRole('button', { name: 'OK', exact: true }).click();
    await page.locator('.toolbox').getByRole('button', { name: 'Text', exact: true }).click();
    const canvas = page.locator('.canvas-stack');
    const textEditor = page.getByRole('textbox', { name: 'Text editor' });

    await canvas.click({ position: { x: 120, y: 100 } });
    await textEditor.fill('Background text');
    await page.getByRole('button', { name: 'Commit text' }).click();

    await page.getByRole('button', { name: 'Add New Layer' }).click();
    await canvas.click({ position: { x: 300, y: 190 } });
    await textEditor.fill('Layer two text');

    // Switching layers must commit into the layer where editing began before
    // changing the active target.
    await page.locator('.layer-row').filter({ hasText: 'Background' }).click();
    await expect(textEditor).toBeHidden();
    await expect(page.locator('.layer-row').filter({ hasText: 'Background' })).toHaveClass(/active/);

    // A history entry on another layer must not finalize this layer's text.
    await canvas.click({ position: { x: 130, y: 110 }, modifiers: ['Control'] });
    await expect(textEditor).toHaveValue('Background text');
    await textEditor.fill('Background edited');
    await page.getByRole('button', { name: 'Commit text' }).click();

    await page.locator('.layer-row').filter({ hasText: 'Layer 2' }).click();
    await canvas.click({ position: { x: 310, y: 200 }, modifiers: ['Control'] });
    await expect(textEditor).toHaveValue('Layer two text');
    await page.getByRole('button', { name: 'Cancel text' }).click();

    await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-save-state', 'saved', { timeout: 20_000 });
    await page.reload();
    await waitForWorkspace(page);
    await page.locator('.toolbox').getByRole('button', { name: 'Text', exact: true }).click();

    await page.locator('.layer-row').filter({ hasText: 'Background' }).click();
    await canvas.click({ position: { x: 130, y: 110 }, modifiers: ['Control'] });
    await expect(textEditor).toHaveValue('Background edited');
    await page.getByRole('button', { name: 'Cancel text' }).click();

    await page.locator('.layer-row').filter({ hasText: 'Layer 2' }).click();
    await canvas.click({ position: { x: 310, y: 200 }, modifiers: ['Control'] });
    await expect(textEditor).toHaveValue('Layer two text');
  });

  test('applies page setup to the isolated browser print surface', async ({ page }) => {
    await page.evaluate(() => {
      const target = window as typeof window & { __pintaPrintCalls?: number };
      target.__pintaPrintCalls = 0;
      window.print = () => {
        target.__pintaPrintCalls! += 1;
      };
    });
    await openTopMenu(page, 'File');
    await clickTopMenuItem(page, 'Print');
    const dialog = page.getByRole('dialog', { name: 'Print Image' });
    await dialog.getByLabel('Print orientation').selectOption('portrait');
    await dialog.getByLabel('Print scaling').selectOption('custom');
    await dialog.getByLabel('Custom print scale').fill('125');
    await dialog.getByLabel('Print margins').fill('5');
    await dialog.getByLabel('Center image on page').uncheck();
    await dialog.getByRole('button', { name: 'Print' }).click();

    const surface = page.locator('.print-surface');
    await expect(surface).toHaveAttribute('data-print-orientation', 'portrait');
    await expect(surface).toHaveAttribute('data-print-scale', '125');
    await expect(surface).toHaveAttribute('data-print-margin', '5');
    await expect(surface).not.toHaveClass(/print-centered/);
    expect(await surface.locator('img').evaluate((image) => Number.parseFloat(image.style.width))).toBeCloseTo(
      10.4167,
      3,
    );
    expect(
      await page.locator('style').evaluateAll((styles) => styles.map((style) => style.textContent).join('\n')),
    ).toContain('size: portrait; margin: 5mm');
    expect(
      await page.evaluate(() => (window as typeof window & { __pintaPrintCalls?: number }).__pintaPrintCalls),
    ).toBe(1);

    // The OS/browser owns both the final Print and Cancel outcomes. In either
    // case `afterprint` returns control to Pinta and disposes the frozen print
    // surface so later edits cannot accidentally print stale pixels.
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(dialog).toBeHidden();
    await expect(surface).toHaveCount(0);

    await openTopMenu(page, 'File');
    await clickTopMenuItem(page, 'Print');
    await page.getByRole('dialog', { name: 'Print Image' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.print-surface')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as typeof window & { __pintaPrintCalls?: number }).__pintaPrintCalls),
    ).toBe(1);
  });

  test('tracks layer operations through undo and redo', async ({ page }) => {
    await page.getByRole('button', { name: 'Add New Layer' }).click();
    await page.getByRole('button', { name: 'Duplicate Layer' }).click();
    await expect(page.locator('.layer-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'Delete Layer' }).click();
    await expect(page.locator('.layer-row')).toHaveCount(2);

    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
    await expect(page.locator('.layer-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'Redo (Ctrl+Y)' }).click();
    await expect(page.locator('.layer-row')).toHaveCount(2);
    await expect(page.locator('.history-row.active')).toContainText('Delete Layer');
  });

  test('edits layer properties and applies a non-dialog adjustment', async ({ page }) => {
    const historyBefore = await page.locator('.history-row').count();
    const preview = page.locator('.preview-canvas');
    await page.getByRole('button', { name: /^Layer Properties/ }).click();
    let properties = page.getByRole('dialog', { name: 'Layer Properties' });
    await page.getByLabel('Layer name').fill('Painted Background');
    await page.getByLabel('Opacity value').fill('65');
    await page.getByLabel('Blend mode').selectOption('multiply');
    await expect(page.locator('.layer-row')).toContainText('Painted Background');
    await expect(page.locator('.layer-row')).toHaveAttribute('title', /Multiply · 65%/);
    // 65% of 255 is 166, and that alpha must be exact. The colour cannot be: a canvas stores it
    // premultiplied, so reading a semi-transparent pixel back divides by alpha and rounds.
    // Chromium returns 255 where Firefox returns 254 for the same white layer.
    const previewPixel = () =>
      preview.evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(10, 10, 1, 1).data]);
    await expect.poll(async () => (await previewPixel())[3]).toBe(166);
    const shown = await previewPixel();
    for (const channel of shown.slice(0, 3)) {
      expect(Math.abs(channel - 255), 'a white layer at 65% opacity').toBeLessThanOrEqual(Math.ceil(255 / 166));
    }
    await properties.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.layer-row')).toContainText('Background');
    await expect(page.locator('.layer-row')).toHaveAttribute('title', /Normal · 100%/);
    await expect
      .poll(() =>
        preview.evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(10, 10, 1, 1).data]),
      )
      .toEqual([0, 0, 0, 0]);
    await expect(page.locator('.history-row')).toHaveCount(historyBefore);

    await page.getByRole('button', { name: /^Layer Properties/ }).click();
    properties = page.getByRole('dialog', { name: 'Layer Properties' });
    await properties.getByLabel('Layer name').fill('Painted Background');
    await properties.getByLabel('Opacity value').fill('65');
    await properties.getByLabel('Blend mode').selectOption('multiply');
    await properties.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.locator('.layer-row')).toContainText('Painted Background');
    await expect(page.locator('.layer-row')).toHaveAttribute('title', /Multiply · 65%/);
    await expect(page.locator('.history-row')).toHaveCount(historyBefore + 1);

    await openTopMenu(page, 'Adjustments');
    await clickTopMenuItem(page, 'Invert Colors');
    await expect(page.locator('.history-row.active')).toContainText('Invert Colors');
  });

  test('draws pixels, creates selections, and deselects with shortcuts', async ({ page }) => {
    const canvas = page.locator('.canvas-stack');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + 80, bounds!.y + 80);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 180, bounds!.y + 140, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.history-row.active')).toContainText('Paintbrush');
    await expect(page).toHaveTitle('Unsaved Image 1* — Pinta Online Image Editor');

    await page.keyboard.press('Control+A');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'true');
    await page.keyboard.press('Control+Shift+A');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'false');
  });

  test('clips destructive raster tools to rectangle and magic-wand selections', async ({ page }) => {
    const display = page.locator('.canvas-stack canvas').first();
    const sample = (points: Array<[number, number]>) =>
      display.evaluate((canvas: HTMLCanvasElement, coordinates) => {
        const context = canvas.getContext('2d')!;
        return coordinates.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
      }, points);
    const selectRectangle = async () => {
      await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
      const bounds = await page.locator('.canvas-stack').boundingBox();
      expect(bounds).not.toBeNull();
      await page.mouse.move(bounds!.x + 20, bounds!.y + 10);
      await page.mouse.down();
      await page.mouse.move(bounds!.x + 60, bounds!.y + 50, { steps: 4 });
      await page.mouse.up();
      await expect(page.locator('.app-shell')).toHaveAttribute('data-selection-bounds', '20,10,40,40');
      return bounds!;
    };

    await page
      .locator('input[type="file"][multiple]')
      .setInputFiles(ppm('selection-brush.ppm', 80, 60, [255, 255, 255]));
    let bounds = await selectRectangle();
    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Brush width' }).fill('8');
    await page.mouse.move(bounds.x + 5, bounds.y + 30);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 75, bounds.y + 30, { steps: 8 });
    await page.mouse.up();
    expect(
      await sample([
        [10, 30],
        [30, 30],
        [70, 30],
      ]),
    ).toEqual([
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]);

    await page
      .locator('input[type="file"][multiple]')
      .setInputFiles(ppm('selection-eraser.ppm', 80, 60, [40, 80, 160]));
    bounds = await selectRectangle();
    await page.getByRole('button', { name: 'Eraser', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Brush width' }).fill('8');
    await page.mouse.move(bounds.x + 5, bounds.y + 30);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 75, bounds.y + 30, { steps: 8 });
    await page.mouse.up();
    expect(
      await sample([
        [10, 30],
        [30, 30],
        [70, 30],
      ]),
    ).toEqual([
      [40, 80, 160, 255],
      [0, 0, 0, 0],
      [40, 80, 160, 255],
    ]);

    await page
      .locator('input[type="file"][multiple]')
      .setInputFiles(ppm('selection-bucket.ppm', 80, 60, [255, 255, 255]));
    bounds = await selectRectangle();
    await page.getByRole('button', { name: 'Paint Bucket', exact: true }).click();
    await page.mouse.click(bounds.x + 30, bounds.y + 30);
    expect(
      await sample([
        [5, 5],
        [30, 30],
        [70, 55],
      ]),
    ).toEqual([
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]);

    await page.locator('input[type="file"][multiple]').setInputFiles(objectPpm('selection-mask.ppm'));
    await page.getByRole('button', { name: 'Magic Wand Select', exact: true }).click();
    bounds = (await page.locator('.canvas-stack').boundingBox())!;
    await page.mouse.click(bounds.x + 30, bounds.y + 25);
    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    await page.mouse.move(bounds.x + 5, bounds.y + 25);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 70, bounds.y + 25, { steps: 8 });
    await page.mouse.up();
    expect(
      await sample([
        [10, 25],
        [30, 25],
        [60, 25],
      ]),
    ).toEqual([
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
  });

  test('uses Pinta color-distance tolerance for flood tools', async ({ page }) => {
    await page.locator('input[type="file"][multiple]').setInputFiles(tolerancePpm('tolerance.ppm'));
    await page.getByRole('button', { name: 'Click to select primary color.', exact: true }).click();
    const colorDialog = page.getByRole('dialog', { name: 'Choose Colors' });
    await colorDialog.getByLabel('Hex').fill('#ff0000');
    await colorDialog.getByRole('button', { name: 'OK', exact: true }).click();
    await page.getByRole('button', { name: 'Paint Bucket', exact: true }).click();
    await page.getByLabel('Flood Mode').selectOption('global');
    await page.getByRole('slider', { name: 'Tolerance', exact: true }).fill('50');

    const canvas = page.locator('.canvas-stack');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + 10, bounds!.y + 20);
    const display = page.locator('.canvas-stack canvas').first();
    const pixelsAtFifty = await display.evaluate((displayCanvas: HTMLCanvasElement) => {
      const context = displayCanvas.getContext('2d')!;
      return [[...context.getImageData(10, 20, 1, 1).data], [...context.getImageData(60, 20, 1, 1).data]];
    });
    expect(pixelsAtFifty).toEqual([
      [255, 0, 0, 255],
      [100, 100, 0, 255],
    ]);

    await page.keyboard.press('Control+Z');
    await page.getByRole('slider', { name: 'Tolerance', exact: true }).fill('55');
    await page.mouse.click(bounds!.x + 10, bounds!.y + 20);
    const pixelsAtFiftyFive = await display.evaluate((displayCanvas: HTMLCanvasElement) => [
      [...displayCanvas.getContext('2d')!.getImageData(10, 20, 1, 1).data],
      [...displayCanvas.getContext('2d')!.getImageData(60, 20, 1, 1).data],
    ]);
    expect(pixelsAtFiftyFive).toEqual([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ]);
  });

  test('applies the antialiasing toggle to raster brush coverage', async ({ page }) => {
    await page.locator('input[type="file"][multiple]').setInputFiles(ppm('antialias.ppm', 80, 60, [255, 255, 255]));
    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Brush width' }).fill('7');
    const canvas = page.locator('.canvas-stack');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const drawDiagonal = async () => {
      await page.mouse.move(bounds!.x + 10, bounds!.y + 10);
      await page.mouse.down();
      await page.mouse.move(bounds!.x + 65, bounds!.y + 45, { steps: 12 });
      await page.mouse.up();
    };
    const countIntermediatePixels = () =>
      page
        .locator('.canvas-stack canvas')
        .first()
        .evaluate((display: HTMLCanvasElement) => {
          const pixels = display.getContext('2d')!.getImageData(0, 0, display.width, display.height).data;
          let intermediate = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index] > 0 && pixels[index] < 255) intermediate += 1;
          }
          return intermediate;
        });

    await drawDiagonal();
    expect(await countIntermediatePixels()).toBeGreaterThan(0);
    await page.keyboard.press('Control+Z');
    await page.getByLabel('Antialiasing', { exact: true }).selectOption('off');
    await drawDiagonal();
    expect(await countIntermediatePixels()).toBe(0);
  });

  test('scales, rotates, nudges, and moves selected pixels beyond the canvas', async ({ page }) => {
    await page.locator('input[type="file"][multiple]').setInputFiles(objectPpm('transform-object.ppm'));
    const shell = page.locator('.app-shell');
    const canvas = page.locator('.canvas-stack');
    const canvasBounds = await canvas.boundingBox();
    expect(canvasBounds).not.toBeNull();
    const selectionBounds = async () => (await shell.getAttribute('data-selection-bounds'))!.split(',').map(Number);

    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
    await page.mouse.move(canvasBounds!.x + 20, canvasBounds!.y + 15);
    await page.mouse.down();
    await page.mouse.move(canvasBounds!.x + 45, canvasBounds!.y + 30, { steps: 4 });
    await page.mouse.up();
    expect(await selectionBounds()).toEqual([20, 15, 25, 15]);

    await page.getByRole('button', { name: 'Move Selected Pixels', exact: true }).click();
    await page.keyboard.press('Control+ArrowRight');
    expect(await selectionBounds()).toEqual([30, 15, 25, 15]);
    await expect(shell).toHaveAttribute('data-has-floating-pixels', 'true');

    await page.keyboard.down('Control');
    await page.mouse.move(canvasBounds!.x + 54, canvasBounds!.y + 29);
    await page.mouse.down();
    await page.mouse.move(canvasBounds!.x + 64, canvasBounds!.y + 35, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    const scaled = await selectionBounds();
    expect(scaled[2]).toBeGreaterThan(35);
    expect(scaled[3]).toBeGreaterThan(20);

    const scaledCenter = { x: scaled[0] + scaled[2] / 2, y: scaled[1] + scaled[3] / 2 };
    await page.mouse.move(canvasBounds!.x + scaled[0] + scaled[2] - 2, canvasBounds!.y + scaledCenter.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(canvasBounds!.x + scaledCenter.x, canvasBounds!.y + scaled[1] + scaled[3] - 2, { steps: 6 });
    await page.mouse.up({ button: 'right' });
    const rotated = await selectionBounds();
    expect(rotated[3]).toBeGreaterThan(rotated[2]);

    const rotatedCenter = { x: rotated[0] + rotated[2] / 2, y: rotated[1] + rotated[3] / 2 };
    await page.mouse.move(canvasBounds!.x + rotatedCenter.x, canvasBounds!.y + rotatedCenter.y);
    await page.mouse.down();
    await page.mouse.move(canvasBounds!.x, canvasBounds!.y + rotatedCenter.y, { steps: 6 });
    await page.mouse.up();
    expect((await selectionBounds())[0]).toBeLessThan(0);

    await page.getByRole('button', { name: 'Pencil', exact: true }).click();
    await expect(shell).toHaveAttribute('data-has-floating-pixels', 'false');
    await expect(page.locator('.history-row.active')).toContainText('Finish Selected Pixels');
  });

  test('renders distinct native gradient algorithms and keeps handles editable until finalized', async ({ page }) => {
    await page.locator('input[type="file"][multiple]').setInputFiles(ppm('gradient-source.ppm', 64, 48, [40, 80, 160]));
    await page.getByRole('button', { name: 'Gradient', exact: true }).click();
    const shell = page.locator('.app-shell');
    const canvas = page.locator('.canvas-stack');
    const display = page.locator('.canvas-stack canvas').first();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const pixel = (x: number, y: number) =>
      display.evaluate(
        (element: HTMLCanvasElement, point) => [...element.getContext('2d')!.getImageData(point.x, point.y, 1, 1).data],
        { x, y },
      );

    await page.mouse.move(Math.round(bounds!.x + 16), Math.round(bounds!.y + 16));
    await page.mouse.down();
    await page.mouse.move(Math.round(bounds!.x + 32), Math.round(bounds!.y + 16), { steps: 4 });
    await page.mouse.up();
    await expect(shell).toHaveAttribute('data-has-gradient-draft', 'true');
    await expect(page.locator('.history-row.active')).toContainText('Gradient Created');
    expect((await pixel(16, 32))[0]).toBeLessThan(5);

    const gradientType = page.locator('select[aria-label="Gradient"]');
    await gradientType.selectOption('diamond');
    await expect.poll(async () => (await pixel(16, 32))[0]).toBeGreaterThan(245);

    await gradientType.selectOption('radial');
    await expect.poll(async () => (await pixel(16, 24))[0]).toBeGreaterThan(115);
    expect((await pixel(16, 24))[0]).toBeLessThan(140);

    await gradientType.selectOption('conical');
    await expect.poll(async () => (await pixel(16, 8))[0]).toBeGreaterThan(115);
    expect((await pixel(16, 8))[0]).toBeLessThan(140);

    await gradientType.selectOption('reflected');
    await expect.poll(async () => (await pixel(0, 16))[0]).toBeGreaterThan(245);
    expect((await pixel(16, 16))[0]).toBeLessThan(5);

    await page.mouse.move(Math.round(bounds!.x + 32), Math.round(bounds!.y + 16));
    await page.mouse.down();
    await page.mouse.move(Math.round(bounds!.x + 48), Math.round(bounds!.y + 16), { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.history-row.active')).toContainText('Gradient Modified');
    const modifiedMidpoint = (await pixel(32, 16))[0];
    expect(modifiedMidpoint).toBeGreaterThan(120);
    expect(modifiedMidpoint).toBeLessThan(140);

    await page.locator('select[aria-label="Gradient mode"]').selectOption('transparency');
    await expect.poll(async () => (await pixel(32, 16))[3]).toBeLessThan(150);
    const transparentMidpoint = await pixel(32, 16);
    expect(Math.abs(transparentMidpoint[0] - 40)).toBeLessThanOrEqual(1);
    expect(Math.abs(transparentMidpoint[1] - 80)).toBeLessThanOrEqual(1);
    expect(Math.abs(transparentMidpoint[2] - 160)).toBeLessThanOrEqual(1);
    expect(transparentMidpoint[3]).toBeGreaterThan(115);

    await expect(shell).toHaveAttribute('data-workspace-save-state', 'saved', { timeout: 20_000 });
    await page.reload();
    await waitForWorkspace(page);
    await expect(page.getByRole('button', { name: 'Gradient', exact: true })).toHaveClass(/active/);
    await expect(shell).toHaveAttribute('data-has-gradient-draft', 'true');
    expect((await pixel(32, 16))[3]).toBeLessThan(150);
    const restoredBounds = await canvas.boundingBox();
    expect(restoredBounds).not.toBeNull();
    await page.mouse.move(restoredBounds!.x + 48, restoredBounds!.y + 16);
    await page.mouse.down();
    await page.mouse.move(restoredBounds!.x + 40, restoredBounds!.y + 16, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator('.history-row.active')).toContainText('Gradient Modified');

    await page.keyboard.press('Enter');
    await expect(shell).toHaveAttribute('data-has-gradient-draft', 'false');
    await expect(page.locator('.history-row.active')).toContainText('Gradient Finalized');
  });

  test('restores editable line and shape drafts instead of burning them into the layer', async ({ page }) => {
    const shell = page.locator('.app-shell');
    const canvas = page.locator('.canvas-stack');

    await page.getByRole('button', { name: 'Line / Curve', exact: true }).click();
    let bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + 45, bounds!.y + 35);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 145, bounds!.y + 95, { steps: 5 });
    await page.mouse.up();
    await expect(shell).toHaveAttribute('data-has-line-draft', 'true');
    await expect(shell).toHaveAttribute('data-workspace-save-state', 'saved', { timeout: 20_000 });

    await page.reload();
    await waitForWorkspace(page);
    await expect(page.getByRole('button', { name: 'Line / Curve', exact: true })).toHaveClass(/active/);
    await expect(shell).toHaveAttribute('data-has-line-draft', 'true');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(shell).toHaveAttribute('data-has-line-draft', 'false');
    await expect(page.locator('.history-row.active')).toContainText('Finalize Shapes');

    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + 65, bounds!.y + 55);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 175, bounds!.y + 125, { steps: 5 });
    await page.mouse.up();
    await expect(shell).toHaveAttribute('data-has-shape-draft', 'true');
    await expect(shell).toHaveAttribute('data-workspace-save-state', 'saved', { timeout: 20_000 });

    await page.reload();
    await waitForWorkspace(page);
    await expect(page.getByRole('button', { name: 'Rectangle', exact: true })).toHaveClass(/active/);
    await expect(shell).toHaveAttribute('data-has-shape-draft', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(shell).toHaveAttribute('data-has-shape-draft', 'false');
    await expect(page.locator('.history-row.active')).toContainText('Finalize Shapes');
  });

  test('creates, constrains, resizes, and click-deselects selections like Pinta', async ({ page }) => {
    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
    const shell = page.locator('.app-shell');
    const canvas = page.locator('.canvas-stack');
    const canvasBounds = await canvas.boundingBox();
    expect(canvasBounds).not.toBeNull();

    await page.keyboard.down('Shift');
    await page.mouse.move(canvasBounds!.x + 100, canvasBounds!.y + 90);
    await page.mouse.down();
    await page.mouse.move(canvasBounds!.x + 220, canvasBounds!.y + 150, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    await expect(shell).toHaveAttribute('data-selection-bounds', '100,90,120,120');
    await expect(shell).toHaveAttribute('data-selection-resizable', 'true');
    await page.mouse.move(canvasBounds!.x + 220, canvasBounds!.y + 210);
    await expect(canvas).toHaveCSS('cursor', 'nwse-resize');

    await page.mouse.down();
    await page.mouse.move(canvasBounds!.x + 280, canvasBounds!.y + 245, { steps: 6 });
    await page.mouse.up();
    await expect(shell).toHaveAttribute('data-selection-bounds', '100,90,180,155');
    await expect(page.locator('.history-row.active')).toContainText('Resize Selection');

    await page.mouse.click(canvasBounds!.x + 150, canvasBounds!.y + 140);
    await expect(shell).toHaveAttribute('data-has-selection', 'false');
    await expect(page.locator('.history-row.active')).toContainText('Deselect');
  });

  test('renders live native marching ants for every area selector', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const shell = page.locator('.app-shell');
    const canvas = page.locator('.canvas-stack');

    const expectLiveAnts = async () => {
      await expect(shell).toHaveAttribute('data-has-selection', 'true');
      const firstSummary = await selectionOverlaySummary(page);
      expect(firstSummary.black).toBeGreaterThan(8);
      expect(firstSummary.white).toBeGreaterThan(8);
      expect(firstSummary.blueFill).toBeGreaterThan(100);
      const firstFrame = firstSummary.frame;
      await expect
        .poll(async () => (await selectionOverlaySummary(page)).frame !== firstFrame, { timeout: 2_000 })
        .toBe(true);
    };

    for (const tool of ['Rectangle Select', 'Ellipse Select'] as const) {
      await page.getByRole('button', { name: tool, exact: true }).click();
      const bounds = await canvas.boundingBox();
      expect(bounds).not.toBeNull();
      await page.mouse.move(bounds!.x + 80, bounds!.y + 70);
      await page.mouse.down();
      await page.mouse.move(bounds!.x + 260, bounds!.y + 210, { steps: 6 });
      await page.mouse.up();
      await expectLiveAnts();
      await page.keyboard.press('Control+Shift+A');
    }

    await page.getByRole('button', { name: 'Lasso Select', exact: true }).click();
    const lassoBounds = await canvas.boundingBox();
    expect(lassoBounds).not.toBeNull();
    await page.mouse.move(lassoBounds!.x + 90, lassoBounds!.y + 80);
    await page.mouse.down();
    for (const [x, y] of [
      [240, 80],
      [270, 190],
      [150, 230],
      [90, 80],
    ]) {
      await page.mouse.move(lassoBounds!.x + x, lassoBounds!.y + y, { steps: 3 });
    }
    await page.mouse.up();
    await expectLiveAnts();

    await page.locator('input[type="file"][multiple]').setInputFiles(objectPpm('marching-ants.ppm'));
    await expect(shell).toHaveAttribute('data-active-document', 'marching-ants.ppm');
    await page.getByRole('button', { name: 'Magic Wand Select', exact: true }).click();
    const wandBounds = await canvas.boundingBox();
    expect(wandBounds).not.toBeNull();
    await page.mouse.click(wandBounds!.x + 30, wandBounds!.y + 25);
    await expectLiveAnts();
  });

  test('pinch-zooms cumulatively around the trackpad gesture point', async ({ page }) => {
    const shell = page.locator('.app-shell');
    const viewport = page.locator('.canvas-viewport');
    const canvas = page.locator('.canvas-stack');
    const viewportBounds = await viewport.boundingBox();
    expect(viewportBounds).not.toBeNull();
    const clientX = viewportBounds!.x + viewportBounds!.width / 2;
    const clientY = viewportBounds!.y + viewportBounds!.height / 2;

    const pinchResult = await viewport.evaluate(
      (element, point) => {
        const results: boolean[] = [];
        for (let index = 0; index < 3; index += 1) {
          const event = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            clientX: point.x,
            clientY: point.y,
            deltaY: -80,
          });
          element.dispatchEvent(event);
          results.push(event.defaultPrevented);
        }
        return results;
      },
      { x: clientX, y: clientY },
    );
    expect(pinchResult).toEqual([true, true, true]);
    await expect.poll(async () => Number(await shell.getAttribute('data-zoom'))).toBeGreaterThan(1.75);

    const beforeZoom = Number(await shell.getAttribute('data-zoom'));
    const beforeCanvasBounds = await canvas.boundingBox();
    expect(beforeCanvasBounds).not.toBeNull();
    const imagePointBefore = {
      x: (clientX - beforeCanvasBounds!.x) / beforeZoom,
      y: (clientY - beforeCanvasBounds!.y) / beforeZoom,
    };
    await viewport.evaluate(
      (element, point) => {
        element.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            clientX: point.x,
            clientY: point.y,
            deltaY: -40,
          }),
        );
      },
      { x: clientX, y: clientY },
    );
    await expect.poll(async () => Number(await shell.getAttribute('data-zoom'))).toBeGreaterThan(beforeZoom);
    const afterZoom = Number(await shell.getAttribute('data-zoom'));
    const afterCanvasBounds = await canvas.boundingBox();
    expect(afterCanvasBounds).not.toBeNull();
    expect((clientX - afterCanvasBounds!.x) / afterZoom).toBeCloseTo(imagePointBefore.x, 0);
    expect((clientY - afterCanvasBounds!.y) / afterZoom).toBeCloseTo(imagePointBefore.y, 0);

    const ordinaryWheel = await viewport.evaluate(
      (element, point) => {
        const event = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          deltaY: 20,
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      },
      { x: clientX, y: clientY },
    );
    expect(ordinaryWheel).toBe(false);
    await expect(shell).toHaveAttribute('data-zoom', afterZoom.toFixed(4));

    const safariGesturePrevented = await viewport.evaluate(
      (element, point) => {
        const gestureEvent = (type: string, scale: number) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            scale: { value: scale },
            clientX: { value: point.x },
            clientY: { value: point.y },
          });
          element.dispatchEvent(event);
          return event.defaultPrevented;
        };
        return [gestureEvent('gesturestart', 1), gestureEvent('gesturechange', 0.8), gestureEvent('gestureend', 0.8)];
      },
      { x: clientX, y: clientY },
    );
    expect(safariGesturePrevented).toEqual([true, true, true]);
    await expect.poll(async () => Number(await shell.getAttribute('data-zoom'))).toBeLessThan(afterZoom);
  });

  test('uses native Zoom gestures and middle-button panning without painting', async ({ page }) => {
    const shell = page.locator('.app-shell');
    const viewport = page.locator('.canvas-viewport');
    const canvas = page.locator('.canvas-stack');
    await page.getByRole('button', { name: 'Zoom', exact: true }).click();

    await canvas.click({ position: { x: 220, y: 160 } });
    await expect(shell).toHaveAttribute('data-zoom', '1.2500');
    await canvas.click({ position: { x: 220, y: 160 }, button: 'right' });
    await expect(shell).toHaveAttribute('data-zoom', '1.0000');

    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + 100, bounds!.y + 90);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 320, bounds!.y + 240, { steps: 6 });
    await expect(page.locator('.zoom-marquee')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('.zoom-marquee')).toHaveCount(0);
    await expect.poll(async () => Number(await shell.getAttribute('data-zoom'))).toBeGreaterThan(1.5);

    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    const historyBefore = await page.locator('.history-row').count();
    const viewportBounds = await viewport.boundingBox();
    expect(viewportBounds).not.toBeNull();
    const scrollBefore = await viewport.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));
    await page.mouse.move(
      viewportBounds!.x + viewportBounds!.width / 2,
      viewportBounds!.y + viewportBounds!.height / 2,
    );
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(
      viewportBounds!.x + viewportBounds!.width / 2 - 120,
      viewportBounds!.y + viewportBounds!.height / 2 - 90,
      { steps: 5 },
    );
    await page.mouse.up({ button: 'middle' });
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(scrollBefore.left);
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(scrollBefore.top);
    await expect(page.locator('.history-row')).toHaveCount(historyBefore);
  });

  test('steps the native zoom collection and renders zoomed-in pixels without smoothing', async ({ page }) => {
    const shell = page.locator('.app-shell');
    const entry = page.getByRole('textbox', { name: 'Zoom level' });
    const canvas = page.locator('.canvas-stack');
    await expect(entry).toHaveValue('100%');

    // ViewActions' zoom collection, not a fixed multiplier: 100 -> 125 -> 150 -> 175 -> 200.
    for (const expected of ['125%', '150%', '175%', '200%']) {
      await page.keyboard.press('Control+=');
      await expect(entry).toHaveValue(expected);
    }
    for (const expected of ['175%', '150%', '125%', '100%']) {
      await page.keyboard.press('Control+-');
      await expect(entry).toHaveValue(expected);
    }

    // Pinta reaches 3600% and 5%, far beyond the browser edition's former 400% ceiling.
    for (let step = 0; step < 30; step += 1) await page.keyboard.press('Control+=');
    await expect(entry).toHaveValue('3600%');
    await expect(shell).toHaveAttribute('data-zoom', '36.0000');
    await expect(canvas).toHaveCSS('image-rendering', 'pixelated');

    for (let step = 0; step < 40; step += 1) await page.keyboard.press('Control+-');
    await expect(entry).toHaveValue('5%');
    await expect(shell).toHaveAttribute('data-zoom', '0.0500');
    await expect(canvas).toHaveCSS('image-rendering', 'auto');

    // A hand-typed percentage is accepted and snaps to the next preset when stepped.
    await setZoomLevel(page, '750');
    await expect(shell).toHaveAttribute('data-zoom', '7.5000');
    await page.keyboard.press('Control+=');
    await expect(entry).toHaveValue('800%');
  });

  test('keeps Window zoom fitted to the viewport until an explicit level replaces it', async ({ page }) => {
    const entry = page.getByRole('textbox', { name: 'Zoom level' });
    await page.getByRole('button', { name: 'Choose zoom level' }).click();
    const list = page.locator('.zoom-level-popover .menu-item');
    await expect(list).toHaveCount(24);
    await list.filter({ hasText: 'Window' }).click();
    await expect(entry).toHaveValue('Window');

    const fitted = Number(await page.locator('.app-shell').getAttribute('data-zoom'));
    await page.setViewportSize({ width: 900, height: 700 });
    await expect(entry).toHaveValue('Window');
    await expect
      .poll(async () => Number(await page.locator('.app-shell').getAttribute('data-zoom')))
      .toBeLessThan(fitted);

    // Choosing any level leaves Window mode, matching ZoomToWindowActivated = false.
    await setZoomLevel(page, '100');
    const pinned = await page.locator('.app-shell').getAttribute('data-zoom');
    await page.setViewportSize({ width: 1440, height: 960 });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-zoom', pinned!);
  });

  test('reflows the toolbox with the window instead of clipping tools', async ({ page }) => {
    const toolbox = page.locator('.toolbox');
    const columnsAndClipping = () =>
      toolbox.evaluate((box: HTMLElement) => {
        const bounds = box.getBoundingClientRect();
        const buttons = [...box.querySelectorAll('.tool-button')];
        return {
          tools: buttons.length,
          columns: new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().left))).size,
          clipped: buttons.filter((button) => {
            const rect = button.getBoundingClientRect();
            return rect.bottom > bounds.bottom + 0.5 || rect.top < bounds.top - 0.5;
          }).length,
        };
      });

    // 1440x960 used to clip the last tool behind the status bar.
    expect(await columnsAndClipping()).toEqual({ tools: 22, columns: 2, clipped: 0 });

    // ToolBoxWidget collapses to one column when the window is tall enough.
    await page.setViewportSize({ width: 1024, height: 1366 });
    await expect.poll(async () => (await columnsAndClipping()).columns).toBe(1);
    expect((await columnsAndClipping()).clipped).toBe(0);

    // MinChildrenPerLine = 8 caps 22 tools at three columns.
    await page.setViewportSize({ width: 1440, height: 620 });
    await expect.poll(async () => (await columnsAndClipping()).columns).toBe(3);
    expect((await columnsAndClipping()).clipped).toBe(0);
  });

  test('resizes, minimizes, and restores the docked tool windows', async ({ page }) => {
    const sidebar = page.locator('.dock-sidebar');
    const padHeights = () =>
      sidebar.evaluate((element: HTMLElement) => ({
        width: Math.round(element.getBoundingClientRect().width),
        layers: Math.round(element.querySelector('.layers-panel')!.getBoundingClientRect().height),
        history: Math.round(element.querySelector('.history-panel')!.getBoundingClientRect().height),
      }));
    const before = await padHeights();
    expect(before.width).toBe(277);

    const widthHandle = page.getByRole('separator', { name: 'Resize tool windows' });
    const widthBounds = await widthHandle.boundingBox();
    expect(widthBounds).not.toBeNull();
    await page.mouse.move(widthBounds!.x + widthBounds!.width / 2, widthBounds!.y + 200);
    await page.mouse.down();
    await page.mouse.move(widthBounds!.x + widthBounds!.width / 2 - 60, widthBounds!.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await padHeights()).width).toBe(337);

    const padHandle = page.getByRole('separator', { name: 'Resize Layers and History' });
    const padBounds = await padHandle.boundingBox();
    expect(padBounds).not.toBeNull();
    await page.mouse.move(padBounds!.x + padBounds!.width / 2, padBounds!.y + padBounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(padBounds!.x + padBounds!.width / 2, padBounds!.y + padBounds!.height / 2 + 100, {
      steps: 8,
    });
    await page.mouse.up();
    await expect.poll(async () => (await padHeights()).layers).toBeGreaterThan(before.layers);

    await page.getByRole('button', { name: 'Minimize History' }).click();
    await expect.poll(async () => (await padHeights()).history).toBe(34);

    // Pinta.Docking persists the split positions and each pad's minimized flag.
    await page.reload();
    await waitForWorkspace(page);
    const restored = await padHeights();
    expect(restored.width).toBe(337);
    expect(restored.history).toBe(34);
    await page.getByRole('button', { name: 'Restore History' }).click();
    await expect.poll(async () => (await padHeights()).history).toBeGreaterThan(34);
  });

  test('reports the selection size and recently used colors in the status bar', async ({ page }) => {
    // ActionManager.CreateStatusBar shows the selection bounds, falling back to the canvas.
    const readout = page.getByLabel('Selection size');
    await expect(readout).toContainText('800, 600');

    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
    const canvas = page.locator('.canvas-stack');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + 40, bounds!.y + 30);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 140, bounds!.y + 90, { steps: 10 });
    await page.mouse.up();
    await expect(readout).toContainText('100, 60');

    // StatusBarColorPaletteWidget draws MAX_RECENT_COLORS (10) swatches over two rows.
    const recent = page.getByLabel('Recently Used Colors').locator('.recent-swatch');
    await expect(recent).toHaveCount(10);
    await page.getByRole('button', { name: 'Set color #ff0000', exact: true }).click();
    await expect(recent.first()).toHaveAttribute('title', /^#ff0000/);
    await recent.first().click();
    await expect(page.locator('.color-well.primary')).toHaveAttribute('style', /#ff0000/);
  });

  test('auto-scrolls the viewport while a selection extends beyond the visible canvas', async ({ page }) => {
    const shell = page.locator('.app-shell');
    await setZoomLevel(page, '400');
    await expect(shell).toHaveAttribute('data-zoom', '4.0000');
    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
    const viewport = page.locator('.canvas-viewport');
    const viewportBounds = await viewport.boundingBox();
    expect(viewportBounds).not.toBeNull();

    await page.mouse.move(viewportBounds!.x + 100, viewportBounds!.y + 100);
    await page.mouse.down();
    await page.mouse.move(viewportBounds!.x + viewportBounds!.width + 40, viewportBounds!.y + 180, { steps: 12 });
    await page.mouse.up();

    expect(await viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(shell).toHaveAttribute('data-has-selection', 'true');
  });

  test('matches native selection mode labels and operates icon flyouts from the keyboard', async ({ page }) => {
    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();

    const selectionMode = page.getByLabel('Selection mode');
    const usesMacModifiers = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));
    const primaryModifier = usesMacModifiers ? 'Command' : 'Ctrl';
    const alternateModifier = usesMacModifiers ? 'Option' : 'Alt';
    await expect(selectionMode.locator('option')).toHaveText([
      'Replace',
      `Union (+) (${primaryModifier} + Left Click)`,
      'Exclude (-) (Right Click)',
      `Xor (${primaryModifier} + Right Click)`,
      `Intersect (${alternateModifier} + Left Click)`,
    ]);

    const autoScroll = page.getByLabel('Auto-scroll');
    await expect(autoScroll.locator('option')).toHaveText(['Autoscroll On', 'Autoscroll Off']);
    const trigger = autoScroll.locator('..').getByRole('button');
    await expect(trigger).toHaveAccessibleName('Choose Autoscroll On');
    await expect(trigger.locator('img')).toHaveAttribute('src', '/actions/effects-blurs-zoomblur-symbolic.svg');

    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const choices = page.getByRole('listbox', { name: 'Auto-scroll choices' });
    await expect(choices).toBeVisible();
    await expect(choices.getByRole('option', { name: 'Autoscroll On' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(choices.getByRole('option', { name: 'Autoscroll Off' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(autoScroll).toHaveValue('off');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAccessibleName('Choose Autoscroll Off');
    await expect(trigger.locator('img')).toHaveAttribute('src', '/actions/effects-blurs-unfocus-symbolic.svg');

    await page.keyboard.press('ArrowUp');
    await expect(choices).toBeVisible();
    await expect(choices.getByRole('option', { name: 'Autoscroll Off' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(choices).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('uses native icon-and-label choosers for every Color Picker option', async ({ page }) => {
    await page.getByRole('button', { name: 'Color Picker', exact: true }).click();

    const samplingSize = page.getByLabel('Sampling size');
    await expect(samplingSize.locator('option')).toHaveText([
      'Single Pixel',
      '3 x 3 Region',
      '5 x 5 Region',
      '7 x 7 Region',
      '9 x 9 Region',
    ]);
    const samplingTrigger = samplingSize.locator('..').getByRole('button');
    await expect(samplingTrigger).toContainText('Single Pixel');
    await expect(samplingTrigger.locator('img')).toHaveAttribute(
      'src',
      '/actions/tool-colorpicker-sampling-1x1-symbolic.svg',
    );
    await samplingTrigger.click();
    const samplingChoices = page.getByRole('listbox', { name: 'Sampling size choices' });
    const singlePixel = samplingChoices.getByRole('option', { name: 'Single Pixel' });
    await expect(singlePixel).toHaveAttribute('aria-selected', 'true');
    expect(
      await singlePixel.locator(':scope > *').evaluateAll((children) => children.map((child) => child.tagName)),
    ).toEqual(['IMG', 'SPAN', 'SPAN']);
    await expect(singlePixel.locator(':scope > *').last()).toHaveClass('native-toolbar-option-check');
    await samplingChoices.getByRole('option', { name: '3 x 3 Region' }).click();
    await expect(samplingSize).toHaveValue('3');
    await expect(samplingTrigger).toContainText('3 x 3 Region');

    const source = page.getByLabel('Sample source');
    await expect(source.locator('option')).toHaveText(['Layer', 'Image']);
    await expect(source.locator('..').getByRole('button')).toContainText('Layer');

    const afterSelect = page.getByLabel('After select');
    const afterSelectTrigger = afterSelect.locator('..').getByRole('button');
    await expect(afterSelectTrigger).toContainText('Do not switch tool');
    await afterSelectTrigger.click();
    const afterSelectChoices = page.getByRole('listbox', { name: 'After select choices' });
    await expect(afterSelectChoices.getByRole('option', { name: 'Do not switch tool' }).locator('img')).toHaveAttribute(
      'src',
      '/actions/tool-colorpicker-symbolic.svg',
    );
    await expect(
      afterSelectChoices.getByRole('option', { name: 'Switch to previous tool' }).locator('img'),
    ).toHaveAttribute('src', '/standard-icons/go-previous-symbolic.svg');
    await expect(
      afterSelectChoices.getByRole('option', { name: 'Switch to Pencil tool' }).locator('img'),
    ).toHaveAttribute('src', '/actions/tool-pencil-symbolic.svg');
    await afterSelectChoices.getByRole('option', { name: 'Switch to previous tool' }).click();
    await expect(afterSelect).toHaveValue('previous');
  });

  test('uses native text choosers for selection, brush, eraser, and text join options', async ({ page }) => {
    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
    const selectionMode = page.getByLabel('Selection mode');
    const selectionTrigger = selectionMode.locator('..').getByRole('button');
    await expect(selectionTrigger).toContainText('Replace');
    await selectionTrigger.click();
    const selectionChoices = page.getByRole('listbox', { name: 'Selection mode choices' });
    await expect(selectionChoices.getByRole('option')).toHaveCount(5);
    const replace = selectionChoices.getByRole('option', { name: 'Replace' });
    await expect(replace).toHaveAttribute('aria-selected', 'true');
    expect(
      await replace.locator(':scope > *').evaluateAll((children) => children.map((child) => child.className)),
    ).toEqual(['', 'native-toolbar-option-check']);
    await selectionChoices.getByRole('option').nth(1).click();
    await expect(selectionMode).toHaveValue('union');

    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    const paintbrushType = page.getByLabel('Paintbrush type');
    const paintbrushTrigger = paintbrushType.locator('..').getByRole('button');
    await paintbrushTrigger.click();
    const paintbrushChoices = page.getByRole('listbox', { name: 'Paintbrush type choices' });
    await expect(paintbrushChoices.getByRole('option')).toHaveText([
      'Normal',
      'Circles',
      'Grid',
      'Slash',
      'Splatter',
      'Squares',
    ]);
    await paintbrushChoices.getByRole('option', { name: 'Slash' }).click();
    await expect(paintbrushType).toHaveValue('slash');
    await expect(page.getByRole('spinbutton', { name: 'Slash angle' })).toBeVisible();

    await page.getByRole('button', { name: 'Eraser', exact: true }).click();
    const eraserType = page.getByLabel('Eraser type');
    await eraserType.locator('..').getByRole('button').click();
    const eraserChoices = page.getByRole('listbox', { name: 'Eraser type choices' });
    await expect(eraserChoices.getByRole('option')).toHaveText(['Normal', 'Smooth']);
    await eraserChoices.getByRole('option', { name: 'Smooth' }).click();
    await expect(eraserType).toHaveValue('smooth');

    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByLabel('Text style').selectOption('outline');
    const textJoin = page.getByLabel('Text outline join');
    const textJoinTrigger = textJoin.locator('..').getByRole('button');
    await expect(textJoinTrigger).toContainText('Miter Join');
    await textJoinTrigger.click();
    const textJoinChoices = page.getByRole('listbox', { name: 'Text outline join choices' });
    await expect(textJoinChoices.getByRole('option')).toHaveText(['Miter Join', 'Round Join', 'Bevel Join']);
    await textJoinChoices.getByRole('option', { name: 'Round Join' }).click();
    await expect(textJoin).toHaveValue('round');
  });

  test('maps Chromatic Aberration PointI controls to native image coordinates', async ({ page }) => {
    await openTopMenu(page, 'Addins');
    await clickTopMenuItem(page, 'Ars Kali: Glitches');
    await openTopMenu(page, 'Effects');
    await clickTopMenuItem(page, 'Chromatic Aberration');

    const dialog = page.getByRole('dialog', { name: 'Chromatic Aberration' });
    const xCoordinates = dialog.getByRole('spinbutton', { name: 'Offset X' });
    const yCoordinates = dialog.getByRole('spinbutton', { name: 'Offset Y' });
    await expect(xCoordinates).toHaveCount(3);
    await expect(yCoordinates).toHaveCount(3);
    expect(await xCoordinates.evaluateAll((inputs: HTMLInputElement[]) => inputs.map((input) => input.value))).toEqual([
      '400',
      '400',
      '400',
    ]);
    expect(await yCoordinates.evaluateAll((inputs: HTMLInputElement[]) => inputs.map((input) => input.value))).toEqual([
      '300',
      '300',
      '300',
    ]);
    await expect(xCoordinates.first()).toHaveAttribute('min', '0');
    await expect(xCoordinates.first()).toHaveAttribute('max', '800');
    await xCoordinates.first().fill('401');
    await expect(xCoordinates.first()).toHaveValue('401');
    await dialog.getByRole('button', { name: 'Reset Offset X' }).first().click();
    await expect(xCoordinates.first()).toHaveValue('400');
  });

  test('builds and edits a polygon lasso before committing it', async ({ page }) => {
    await page.getByRole('button', { name: 'Lasso Select', exact: true }).click();
    await page.getByLabel('Lasso Mode').selectOption('polygon');
    const canvas = page.locator('.canvas-stack');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    for (const [x, y] of [
      [100, 90],
      [220, 90],
      [240, 190],
      [120, 210],
    ]) {
      await page.mouse.click(bounds!.x + x, bounds!.y + y);
    }
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'true');
    await expect(page.locator('.history-row.active')).toContainText('Select');
  });

  test('offers a full Pinta color picker and discoverable palette editing', async ({ page }) => {
    const swatches = page.locator('.palette .swatch');
    const primaryWell = page.locator('.color-well.primary');
    const secondaryWell = page.locator('.color-well.secondary');
    const initialCount = await swatches.count();

    await page.getByRole('button', { name: 'Click to select primary color.', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose Colors' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('button', { name: 'Hue & Sat' })).toHaveClass(/active/);
    await expect(picker.getByRole('button', { name: 'Sat & Value' })).toBeVisible();
    await expect(picker.getByRole('slider', { name: 'Alpha' })).toBeVisible();
    await expect(picker.locator('.color-picker-palette')).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'Collapse color picker' })).toBeVisible();

    await picker.getByLabel('Red Value').fill('18');
    await picker.getByLabel('Green Value').fill('52');
    await picker.getByLabel('Blue Value').fill('86');
    await picker.getByLabel('Alpha Value').fill('128');
    await expect(picker.getByLabel('Hex')).toHaveValue('#12345680');
    await expect(primaryWell).toHaveAttribute('style', /#12345680/);
    await picker.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(primaryWell).toHaveAttribute('style', /#12345680/);

    await page.getByRole('button', { name: 'Add Primary Color', exact: true }).click();
    const addPicker = page.getByRole('dialog', { name: 'Add Palette Color' });
    await expect(addPicker.getByLabel('Hex')).toHaveValue('#12345680');
    await expect(swatches).toHaveCount(initialCount);
    await addPicker.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(swatches).toHaveCount(initialCount);

    await page.getByRole('button', { name: 'Add Primary Color', exact: true }).click();
    await addPicker.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(swatches).toHaveCount(initialCount + 1);
    await expect(swatches.last()).toHaveAttribute('title', /^#12345680/);

    await swatches.last().click({ modifiers: ['Meta'] });
    const palettePicker = page.getByRole('dialog', { name: 'Choose Palette Color' });
    await expect(palettePicker.locator('.color-picker-palette')).toBeVisible();
    await expect(palettePicker.locator('.color-picker-palette > strong')).toHaveText(['Recently Used', 'Palette']);
    await expect(
      palettePicker
        .locator('.color-picker-palette > div')
        .first()
        .locator('.color-picker-palette-swatch[title="#12345680"]'),
    ).toBeVisible();
    await palettePicker.getByRole('button', { name: 'Collapse color picker' }).click();
    await expect(palettePicker).toHaveClass(/small-mode/);
    await expect(palettePicker.locator('.color-picker-palette')).toHaveCount(0);
    await palettePicker.getByRole('button', { name: 'Expand color picker' }).click();
    await expect(palettePicker.locator('.color-picker-palette')).toBeVisible();
    await palettePicker.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.reload();
    await waitForWorkspace(page);
    await expect(page.locator('.palette .swatch').last()).toHaveAttribute('title', /^#12345680/);

    await page.getByRole('button', { name: 'Click to select secondary color.', exact: true }).click();
    let secondaryPicker = page.getByRole('dialog', { name: 'Choose Colors' });
    await expect(secondaryPicker.locator('.color-picker-target.active')).toContainText('Secondary');
    await secondaryPicker.getByLabel('Hex').fill('#654321');
    await expect(secondaryWell).toHaveAttribute('style', /#654321/);
    await secondaryPicker.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(secondaryWell).toHaveAttribute('style', /#ffffff/);

    await page.getByRole('button', { name: 'Click to select secondary color.', exact: true }).click();
    secondaryPicker = page.getByRole('dialog', { name: 'Choose Colors' });
    await secondaryPicker.getByLabel('Hex').fill('#654321');
    await secondaryPicker.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(secondaryWell).toHaveAttribute('style', /#654321/);

    await page.getByRole('button', { name: /Click to switch between primary and secondary color/ }).click();
    await expect(primaryWell).toHaveAttribute('style', /#654321/);
    await expect(secondaryWell).toHaveAttribute('style', /#12345680/);
    await page.getByRole('button', { name: 'Click to reset primary and secondary color.', exact: true }).click();
    await expect(primaryWell).toHaveAttribute('style', /#000000/);
    await expect(secondaryWell).toHaveAttribute('style', /#ffffff/);

    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    await expect(page.locator('.canvas-stack')).toHaveCSS('cursor', /Cursor\.Paintbrush\.png/);
    await expect(page.locator('.status-readout img').first()).toHaveAttribute(
      'src',
      '/actions/ui-cursor-location-symbolic.svg',
    );
    await expect(page.locator('.swap-colors svg')).toBeVisible();
    await expect(page.locator('.reset-colors svg')).toBeVisible();
  });

  test('loads and retains a user palette', async ({ page }) => {
    await page.locator('input[type="file"][accept^=".txt"]').setInputFiles({
      name: 'compact.gpl',
      mimeType: 'text/plain',
      buffer: Buffer.from('GIMP Palette\nName: Compact\n#\n255 0 0 Red\n0 128 255 Blue\n'),
    });
    await expect(page.locator('.swatch')).toHaveCount(2);
    await page.reload();
    await waitForWorkspace(page);
    await expect(page.locator('.swatch')).toHaveCount(2);
  });
});

test.describe('restoration and preferences', () => {
  test('persists and restores the complete history beyond the former thirty-entry limit', async ({ page }) => {
    await page.locator('input[type="file"][multiple]').setInputFiles(ppm('long-history.ppm', 24, 18, [255, 255, 255]));
    await page.getByRole('button', { name: 'Pencil', exact: true }).click();
    const canvas = page.locator('.canvas-stack');
    for (let edit = 0; edit < 48; edit += 1) {
      // The canvas is deliberately tiny, and each edit replaces history state immediately.
      // WebKit can observe the stack during that render and restart its actionability check until
      // the whole test times out even though the pointer target never leaves the viewport. This
      // case measures persistence beyond 30 entries, not Playwright's stability heuristic.
      await canvas.click({
        force: true,
        position: { x: 2 + (edit % 20), y: 2 + Math.floor(edit / 20) * 4 },
      });
    }
    await expect(page.locator('.history-row')).toHaveCount(49);
    await expect
      .poll(async () => (await storedWorkspaceSummary(page))?.activeHistoryLabels.length, { timeout: 20_000 })
      .toBe(49);

    await page.reload();
    await waitForWorkspace(page);
    await expect(page.locator('.history-row')).toHaveCount(49);
    const restored = await storedWorkspaceSummary(page);
    expect(restored?.activeHistoryLabels).toHaveLength(49);
    expect(restored?.activeHistoryLabels.slice(1)).toEqual(Array.from({ length: 48 }, () => 'Pencil'));

    for (let undo = 0; undo < 40; undo += 1) await page.keyboard.press('Control+Z');
    await expect(page.locator('.history-row.active')).toHaveAttribute('data-history-index', '8');
    await expect
      .poll(async () => (await storedWorkspaceSummary(page))?.activeHistoryIndex, { timeout: 20_000 })
      .toBe(8);
  });

  test('restores a magic-wand mask as an animated, non-destructive active selection', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('input[type="file"][multiple]').setInputFiles(objectPpm('selected-object.ppm'));
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'selected-object.ppm');
    await page.getByRole('button', { name: 'Magic Wand Select', exact: true }).click();
    await page.locator('.canvas-stack').click({ position: { x: 30, y: 25 } });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'true');
    await expect(page.locator('.history-row.active')).toContainText('Magic Wand Selection');

    const display = page.locator('.canvas-stack canvas').first();
    const pixelsBeforeReload = await display.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await expect
      .poll(
        async () => {
          const summary = await storedWorkspaceSummary(page);
          return summary?.activeSelectionTool === 'magic-wand' && summary.activeSelectionHasMask;
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    await page.reload();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await waitForWorkspace(page);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'selected-object.ppm');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'true');
    await expect(page.getByRole('button', { name: 'Magic Wand Select', exact: true })).toHaveClass(/active/);
    expect(await display.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(pixelsBeforeReload);

    const selectionOverlay = page.locator('.selection-canvas');
    await expect
      .poll(() =>
        selectionOverlay.evaluate((canvas: HTMLCanvasElement) => {
          const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
          let visible = 0;
          for (let index = 3; index < pixels.length; index += 4) visible += pixels[index] > 0 ? 1 : 0;
          return visible;
        }),
      )
      .toBeGreaterThan(0);
    const firstSelectionFrame = await selectionOverlay.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await expect
      .poll(
        async () =>
          (await selectionOverlay.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())) !== firstSelectionFrame,
        { timeout: 2_000 },
      )
      .toBe(true);

    await page.keyboard.press('Delete');
    await expect
      .poll(() =>
        display.evaluate((canvas: HTMLCanvasElement) => {
          const context = canvas.getContext('2d')!;
          return {
            selected: [...context.getImageData(30, 25, 1, 1).data],
            background: [...context.getImageData(5, 5, 1, 1).data],
          };
        }),
      )
      .toEqual({ selected: [0, 0, 0, 0], background: [255, 255, 255, 255] });
  });

  test('manages bundled add-ins, exposes their tools and effects, and persists the choice', async ({ page }) => {
    await expect(page.locator('.toolbox').getByRole('button', { name: 'Block Brush', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    await expect(page.getByLabel('Paintbrush type').locator('option[value="block"]')).toHaveCount(0);

    await openTopMenu(page, 'Addins');
    await clickTopMenuItem(page, 'Add-in Manager');
    const manager = page.getByRole('dialog', { name: 'Add-in Manager' });
    await expect(manager).toBeVisible();
    await expect(manager.getByRole('checkbox')).toHaveCount(1);
    await expect(manager.getByRole('checkbox').first()).not.toBeChecked();
    await manager.getByRole('button', { name: 'Enable all' }).click();
    await expect(manager.getByRole('checkbox').first()).toBeChecked();
    await expect(manager.getByRole('checkbox')).toBeChecked();
    await expect(manager.getByRole('button', { name: /Installed/ })).toContainText('5');
    await manager.getByRole('button', { name: 'Done' }).click();

    await expect(page.locator('.toolbox').getByRole('button', { name: 'Block Brush', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    await page.getByLabel('Paintbrush type').selectOption('block');
    const canvas = page.locator('.canvas-stack');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + 120, bounds!.y + 100);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 210, bounds!.y + 150, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.history-row.active')).toContainText('Block Brush');

    await openTopMenu(page, 'Adjustments');
    await expect(page.locator('.macos-menu-anchor.active')).toContainText('Colored Grayscale');
    await page.keyboard.press('Escape');
    await openTopMenu(page, 'Effects');
    for (const effect of [
      'Chromatic Aberration',
      'Scanlines',
      'Colored Artifacts',
      'Pixel Drag',
      'Row Slice',
      'Adjustment Noise',
      'Hexagon Pixelate',
      'Night Vision',
    ]) {
      await expect(page.locator('.macos-menu-anchor.active')).toContainText(effect);
    }
    await page.keyboard.press('Escape');

    await page.reload();
    await waitForWorkspace(page);
    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    await expect(page.getByLabel('Paintbrush type').locator('option[value="block"]')).toHaveCount(1);
    await openTopMenu(page, 'Addins');
    await clickTopMenuItem(page, 'Add-in Manager');
    await page.getByRole('dialog', { name: 'Add-in Manager' }).getByRole('button', { name: 'Disable all' }).click();
    await expect(page.getByLabel('Paintbrush type')).toHaveValue('normal');
    await page.getByRole('dialog', { name: 'Add-in Manager' }).getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.toolbox').getByRole('button', { name: 'Block Brush', exact: true })).toHaveCount(0);
  });

  test('loads every rendered icon from Pinta or its native GTK icon contract', async ({ page }) => {
    const verifyRenderedIcons = async () => {
      await expect
        .poll(() =>
          page
            .locator('img.pinta-icon')
            .evaluateAll(
              (elements: HTMLImageElement[]) =>
                elements.length > 20 &&
                elements.every((icon) => icon.complete && icon.naturalWidth > 0 && icon.naturalHeight > 0),
            ),
        )
        .toBe(true);
      const icons = await page.locator('img.pinta-icon').evaluateAll((elements: HTMLImageElement[]) =>
        elements.map((icon) => ({
          source: new URL(icon.src).pathname,
        })),
      );
      expect(icons.length).toBeGreaterThan(20);
      expect(icons.filter((icon) => !/^\/(actions|standard-icons)\//.test(icon.source))).toEqual([]);
    };

    await verifyRenderedIcons();
    for (const menu of ['File', 'Edit', 'View', 'Image', 'Adjustments', 'Effects', 'Addins', 'Help']) {
      await openTopMenu(page, menu);
      await verifyRenderedIcons();
    }
    await page.getByRole('button', { name: 'Main Menu', exact: true }).click();
    await verifyRenderedIcons();
    await page.getByRole('button', { name: 'Layer menu', exact: true }).click();
    await verifyRenderedIcons();
    await page.keyboard.press('Escape');

    // Tool option bars and their flyouts render icons too, and a name that has no file
    // silently resolves to the SPA fallback instead of failing the request.
    for (const tool of TOOLS) {
      await page.getByRole('button', { name: tool.name, exact: true }).click();
      await verifyRenderedIcons();
      const choosers = page.locator('.tool-options-bar [aria-haspopup="listbox"]');
      for (let index = 0; index < (await choosers.count()); index += 1) {
        await choosers.nth(index).click();
        await verifyRenderedIcons();
        await page.keyboard.press('Escape');
      }
    }
  });

  test('scopes brush width, antialiasing, and shape style to each tool', async ({ page }) => {
    const brushWidth = page.getByRole('spinbutton', { name: 'Brush width' });
    const selectTool = async (name: string) => page.getByRole('button', { name, exact: true }).click();

    // Pinta.Tools/SettingNames.cs keys these by tool, so a wide paintbrush leaves the
    // eraser, the clone stamp, and a shape outline at their own widths.
    await selectTool('Paintbrush');
    await brushWidth.fill('30');
    await selectTool('Eraser');
    await expect(brushWidth).toHaveValue('2');
    await brushWidth.fill('12');
    await selectTool('Clone Stamp');
    await expect(brushWidth).toHaveValue('2');
    await selectTool('Rectangle');
    await expect(page.getByRole('spinbutton', { name: 'Outline width' })).toHaveValue('2');
    await selectTool('Paintbrush');
    await expect(brushWidth).toHaveValue('30');

    // Antialiasing and fill style are scoped the same way.
    await selectTool('Rectangle');
    await page.getByLabel('Antialiasing', { exact: true }).selectOption('off');
    await page.getByLabel('Fill style', { exact: true }).selectOption('fill');
    await selectTool('Ellipse');
    await expect(page.getByLabel('Antialiasing', { exact: true })).toHaveValue('on');
    await expect(page.getByLabel('Fill style', { exact: true })).toHaveValue('outline');

    await page.reload();
    await waitForWorkspace(page);
    await selectTool('Eraser');
    await expect(brushWidth).toHaveValue('12');
    await selectTool('Paintbrush');
    await expect(brushWidth).toHaveValue('30');
    await selectTool('Rectangle');
    await expect(page.getByLabel('Antialiasing', { exact: true })).toHaveValue('off');
    await expect(page.getByLabel('Fill style', { exact: true })).toHaveValue('fill');
  });

  test('uses native defaults and persists tool-specific settings', async ({ page }) => {
    await expect(page.getByRole('spinbutton', { name: 'Brush width' })).toHaveValue('2');
    await expect(page.getByLabel('Paintbrush type')).toHaveValue('normal');
    await expect(page.getByLabel('Selection size')).toContainText('800, 600');
    await expect(page.getByRole('textbox', { name: 'Zoom level' })).toHaveValue('100%');

    await page.getByRole('spinbutton', { name: 'Brush width' }).fill('7');
    await page.getByLabel('Paintbrush type').selectOption('slash');
    await page.getByRole('button', { name: 'Magic Wand Select', exact: true }).click();
    await page.getByLabel('Flood Mode').selectOption('global');
    await page.getByLabel('Tolerance', { exact: true }).fill('28');
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByLabel('Font variant').selectOption('all-petite-caps');
    await page.getByLabel('Font weight').selectOption('700');
    await page.getByRole('spinbutton', { name: 'Font size' }).fill('33');

    await page.reload();
    await waitForWorkspace(page);
    await expect(page.getByRole('button', { name: 'Text', exact: true })).toHaveClass(/active/);
    await expect(page.getByLabel('Font variant')).toHaveValue('all-petite-caps');
    await expect(page.getByLabel('Font weight')).toHaveValue('700');
    await expect(page.getByRole('spinbutton', { name: 'Font size' })).toHaveValue('33');

    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Brush width' })).toHaveValue('7');
    await expect(page.getByLabel('Paintbrush type')).toHaveValue('slash');
    await expect(page.getByRole('spinbutton', { name: 'Slash angle' })).toBeVisible();
    await page.getByLabel('Paintbrush type').selectOption('splatter');
    await expect(page.getByRole('spinbutton', { name: 'Splatter minimum size' })).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Splatter maximum size' })).toBeVisible();
    await page.getByRole('button', { name: 'Line / Curve', exact: true }).click();
    await page.getByLabel('Start arrow').check();
    await expect(page.getByRole('spinbutton', { name: 'Arrow size' })).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Arrow angle' })).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Arrow length' })).toBeVisible();
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByLabel('Text style').selectOption('outline');
    await expect(page.getByRole('spinbutton', { name: 'Text outline width' })).toBeVisible();
    await expect(page.getByLabel('Text outline join')).toBeVisible();
    await page.getByRole('button', { name: 'Magic Wand Select', exact: true }).click();
    await expect(page.getByLabel('Flood Mode')).toHaveValue('global');
    await expect(page.getByLabel('Tolerance', { exact: true })).toHaveValue('28');
  });

  test('uses Pinta libadwaita surface and accent tokens in both themes', async ({ page }) => {
    const tokens = () =>
      page.locator('.app-shell').evaluate((element) => {
        const style = getComputedStyle(element);
        return ['--bg', '--chrome', '--chrome-raised', '--workspace', '--panel', '--active-border', '--accent'].map(
          (name) => style.getPropertyValue(name).trim(),
        );
      });
    expect(await tokens()).toEqual(['#222226', '#2e2e32', '#36363a', '#1d1d20', '#2e2e32', '#3584e4', '#81d0ff']);
    await openTopMenu(page, 'View');
    await clickTopMenuItem(page, 'Light');
    expect(await tokens()).toEqual(['#fafafb', '#fff', '#fff', '#fafafb', '#ebebed', '#3584e4', '#0461be']);
  });

  test('restores tabs, pixels, layers, full history, active document, and UI preferences', async ({ page }) => {
    await page
      .locator('input[type="file"][multiple]')
      .setInputFiles([ppm('session-one.ppm', 9, 7, [200, 40, 20]), ppm('session-two.ppm', 6, 8, [20, 80, 220])]);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'session-two.ppm');
    await page.getByRole('button', { name: 'Add New Layer' }).click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+Z');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'false');
    await expect(page.locator('.history-row.active')).toContainText('Add New Layer');
    await expect(page.locator('.history-row.future')).toContainText('Select All');

    await openTopMenu(page, 'View');
    await clickTopMenuItem(page, 'Light');
    await openTopMenu(page, 'View');
    await clickTopMenuItem(page, 'Tool Box');
    await expect(page.locator('.app-shell')).toHaveClass(/theme-light/);
    await expect(page.locator('.tools-panel')).toHaveCount(0);
    await expect
      .poll(() => storedWorkspaceSummary(page), { timeout: 20_000 })
      .toEqual({
        version: 2,
        count: 3,
        activeFile: 'session-two.ppm',
        activeLayers: 2,
        activeHasSelection: false,
        activeSelectionTool: null,
        activeSelectionHasMask: false,
        activeHistoryLabels: ['Open Image', 'Add New Layer', 'Select All'],
        activeHistoryIndex: 1,
        activeCleanHistoryIndex: 0,
      });

    await page.reload();
    await waitForWorkspace(page);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-document-count', '3');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'session-two.ppm');
    await expect(page.getByRole('tab', { name: /session-one\.ppm/ })).toHaveAttribute('title', /9 × 7/);
    await expect(page.getByRole('tab', { name: /session-two\.ppm/ })).toHaveAttribute('title', /6 × 8/);
    await expect(page.locator('.layer-row')).toHaveCount(2);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'false');
    await expect(page.locator('.app-shell')).toHaveClass(/theme-light/);
    await expect(page.locator('.tools-panel')).toHaveCount(0);
    await expect(page.locator('.history-row')).toHaveText(['Open Image', 'Add New Layer', 'Select All']);
    await expect(page.locator('.history-row.active')).toContainText('Add New Layer');
    await expect(page.locator('.history-row.future')).toContainText('Select All');
    await expect(page).toHaveTitle('session-two.ppm* — Pinta Online Image Editor');
    const restoredPixel = await page
      .locator('.canvas-stack canvas')
      .first()
      .evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data]);
    expect(restoredPixel).toEqual([20, 80, 220, 255]);

    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
    await expect(page.locator('.history-row.active')).toContainText('Open Image');
    await expect(page.locator('.layer-row')).toHaveCount(1);
    await expect(page).toHaveTitle('session-two.ppm — Pinta Online Image Editor');

    await page.getByRole('button', { name: 'Redo (Ctrl+Y)' }).click();
    await expect(page.locator('.history-row.active')).toContainText('Add New Layer');
    await expect(page.locator('.layer-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Redo (Ctrl+Y)' }).click();
    await expect(page.locator('.history-row.active')).toContainText('Select All');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'true');
  });

  test('persists canvas grid and rulers without leaking transient dialogs', async ({ page }) => {
    await openTopMenu(page, 'View');
    await clickTopMenuItem(page, 'Rulers');
    await openTopMenu(page, 'View');
    await clickTopMenuItem(page, 'Canvas Grid');
    await page.getByLabel('Show Grid').check();
    await page.getByRole('spinbutton', { name: 'Grid cell width', exact: true }).fill('24');
    await page.getByRole('spinbutton', { name: 'Grid cell height', exact: true }).fill('18');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.locator('.canvas-grid-overlay.orthogonal-grid')).toBeVisible();
    await page.reload();
    await waitForWorkspace(page);
    await expect(page.locator('.canvas-ruler')).toHaveCount(2);
    await expect(page.locator('.canvas-grid-overlay.orthogonal-grid')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('reproduces every step exactly across a long chain of stored differences', async ({ page }) => {
    // History keeps only the newest entry whole; older ones store a difference against the
    // entry that replaced them, with a full copy every so often to anchor the chain. Undoing
    // the whole way and back exercises reconstruction across those anchors, and a drawing the
    // user cannot get back is the failure that matters here.
    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    const canvas = page.locator('.canvas-stack');
    const box = (await canvas.boundingBox())!;

    const signature = () =>
      page.evaluate(() => {
        const surface = document.querySelector('.canvas-stack canvas') as HTMLCanvasElement;
        const pixels = surface.getContext('2d')!.getImageData(0, 0, surface.width, surface.height).data;
        let hash = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          hash = (hash * 31 + pixels[index] + pixels[index + 3] * 7) % 4294967296;
        }
        return hash;
      });

    const signatures = [await signature()];
    // Comfortably more steps than the anchor interval, so several chains are built.
    for (let stroke = 0; stroke < 30; stroke += 1) {
      const y = box.y + 20 + stroke * 3;
      await page.mouse.move(box.x + 20, y);
      await page.mouse.down();
      await page.mouse.move(box.x + 90, y, { steps: 3 });
      await page.mouse.up();
      signatures.push(await signature());
    }
    await expect(page.locator('.history-row')).toHaveCount(31);

    for (let step = 29; step >= 0; step -= 1) {
      await page.keyboard.press('Control+z');
      expect(await signature(), `after undoing to step ${step}`).toBe(signatures[step]);
    }
    for (let step = 1; step <= 30; step += 1) {
      await page.keyboard.press('Control+y');
      expect(await signature(), `after redoing to step ${step}`).toBe(signatures[step]);
    }

    // Jumping straight to an old entry must rebuild it as faithfully as stepping there did.
    await page.locator('.history-row').nth(3).click();
    expect(await signature()).toBe(signatures[3]);
  });

  test('refuses to overwrite a workspace written by a newer build', async ({ page }) => {
    const storedVersion = () =>
      page.evaluate(
        () =>
          new Promise<number | undefined>((resolve, reject) => {
            const request = indexedDB.open('pinta-online', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const database = request.result;
              const read = database.transaction('workspace', 'readonly').objectStore('workspace').get('current');
              read.onsuccess = () => {
                resolve(read.result?.version);
                database.close();
              };
              read.onerror = () => {
                reject(read.error);
                database.close();
              };
            };
          }),
      );

    // A record from a build this bundle does not understand — a stale service worker, or a
    // second tab that updated first.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('pinta-online', 1);
          request.onerror = () => reject(request.error);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('workspace')) request.result.createObjectStore('workspace');
          };
          request.onsuccess = () => {
            const database = request.result;
            const write = database.transaction('workspace', 'readwrite');
            write.objectStore('workspace').put(
              {
                version: 99,
                activeDocumentId: 'from-the-future',
                untitledCounter: 2,
                savedAt: Date.now(),
                documents: [],
              },
              'current',
            );
            write.oncomplete = () => {
              resolve();
              database.close();
            };
            write.onerror = () => {
              reject(write.error);
              database.close();
            };
          };
        }),
    );

    await page.reload();
    await waitForWorkspace(page);
    await expect(page.getByText('A newer version of Pinta Online saved this work.')).toBeVisible();

    // The whole point is that it declines to read *and* declines to write. Editing must not
    // replace work this build cannot parse.
    await page.getByRole('button', { name: 'Pencil', exact: true }).click();
    const canvas = page.locator('.canvas-stack');
    await canvas.click({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(1500);
    expect(await storedVersion()).toBe(99);
  });

  test('warns before browser storage runs out and offers to persist less', async ({ page }) => {
    await page.addInitScript(() => {
      // Keep restoration below the pressure threshold, then explicitly make the next save report
      // the origin as nearly full. Slow hosts may otherwise sample the mocked estimate on restore.
      const realNow = Date.now.bind(Date);
      Date.now = () =>
        realNow() + ((window as typeof window & { __pintaStorageClockOffset?: number }).__pintaStorageClockOffset ?? 0);
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: {
          estimate: async () =>
            (window as typeof window & { __pintaStorageNearlyFull?: boolean }).__pintaStorageNearlyFull
              ? { usage: 920 * 1024 * 1024, quota: 1024 * 1024 * 1024 }
              : { usage: 100 * 1024 * 1024, quota: 1024 * 1024 * 1024 },
        },
      });
    });
    await page.reload();
    await waitForWorkspace(page);

    const banner = page.locator('.storage-pressure-banner');
    await expect(banner).toBeHidden();

    // Any edit schedules a save, and the save is what samples the estimate.
    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __pintaStorageClockOffset?: number;
        __pintaStorageNearlyFull?: boolean;
      };
      testWindow.__pintaStorageClockOffset = 61_000;
      testWindow.__pintaStorageNearlyFull = true;
    });
    await page.getByRole('button', { name: 'Pencil', exact: true }).click();
    await page.locator('.canvas-stack').click({ position: { x: 30, y: 30 } });

    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Browser storage is nearly full.');
    await expect(banner).toContainText('920 MB');

    await banner.getByRole('button', { name: 'Stop saving undo history' }).click();
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem('pinta-online-preferences-v1')!).state.persistHistory),
      )
      .toBe(false);
    // The offer is gone once taken, but the warning stays while the origin is still full.
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Stop saving undo history' })).toHaveCount(0);
  });

  test('treats a pagehide canvas failure as a best-effort save instead of an unhandled crash', async ({ page }) => {
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = () => {
        throw new DOMException('The canvas backing store is no longer usable.', 'InvalidStateError');
      };
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
    });

    // Let the rejected persistence promise reach the event loop. The shared page-error fixture
    // fails this test if it escapes as the InvalidStateError observed on Firefox CI and WebKit.
    await page.waitForTimeout(100);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-ready', 'true');
  });

  test('grows and shrinks a selection through the Offset Selection dialog', async ({ page }) => {
    const offsetSelectionBy = async (pixels: number) => {
      // Not openTopMenu: it presses Escape first, which deselects, and this item is disabled
      // without a selection.
      await page.locator('.macos-menu-button[data-menu-name="edit"]').click();
      await clickTopMenuItem(page, 'Offset Selection…');
      const dialog = page.getByRole('dialog', { name: 'Offset Selection' });
      await dialog.getByLabel('Selection offset', { exact: true }).fill(String(pixels));
      await dialog.getByRole('button', { name: 'OK', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Offset Selection' })).toHaveCount(0);
    };

    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
    const canvas = page.locator('.canvas-stack');
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 220, box.y + 220, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'true');

    const original = await selectionOverlaySummary(page);
    expect(original.blueFill).toBeGreaterThan(100);

    // Nothing exercised this path before: the dialog had a screenshot but its offset was never
    // applied, so the grow/shrink mask ran in no test at all.
    await offsetSelectionBy(20);
    const grown = await selectionOverlaySummary(page);
    expect(grown.blueFill).toBeGreaterThan(original.blueFill);

    await offsetSelectionBy(-20);
    const shrunk = await selectionOverlaySummary(page);
    expect(shrunk.blueFill).toBeLessThan(grown.blueFill);
    // Growing then shrinking by the same amount returns to roughly the original area.
    expect(Math.abs(shrunk.blueFill - original.blueFill) / original.blueFill).toBeLessThan(0.1);
  });

  test('keeps the artwork when undo history is dropped to free browser storage', async ({ page }) => {
    const canvas = page.locator('.canvas-stack');
    const box = (await canvas.boundingBox())!;
    for (const offset of [40, 80, 120]) {
      await page.mouse.move(box.x + offset, box.y + 40);
      await page.mouse.down();
      await page.mouse.move(box.x + offset, box.y + 120, { steps: 6 });
      await page.mouse.up();
    }
    await expect(page.locator('.history-row')).toHaveCount(4);

    const darkPixels = async () =>
      page.evaluate(() => {
        const surface = document.querySelector('.canvas-stack canvas') as HTMLCanvasElement;
        const pixels = surface.getContext('2d')!.getImageData(0, 0, surface.width, surface.height).data;
        let dark = 0;
        for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 128) dark += 1;
        return dark;
      });
    const painted = await darkPixels();
    expect(painted).toBeGreaterThan(100);

    await openTopMenu(page, 'File');
    await clickTopMenuItem(page, 'Restore Undo History');
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem('pinta-online-preferences-v1')!).state.persistHistory),
      )
      .toBe(false);
    await page.waitForTimeout(1500);

    await page.reload();
    await waitForWorkspace(page);

    // Turning history persistence off must cost the undo steps and nothing else — the whole
    // point of offering it under storage pressure is that the artwork still comes back.
    expect(await darkPixels()).toBe(painted);
    await expect(page.locator('.history-row')).toHaveCount(1);
  });
});

test.describe('PWA delivery', () => {
  test('publishes install metadata, icons, offline worker, and an active registration', async ({ page }) => {
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!link) throw new Error('Manifest link missing');
      const response = await fetch(link.href);
      return { contentType: response.headers.get('content-type'), body: await response.json() };
    });
    expect(manifest.contentType).toContain('application/manifest+json');
    expect(manifest.body).toMatchObject({ name: 'Pinta Online', short_name: 'Pinta', display: 'standalone', id: '/' });
    expect(manifest.body.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icons/pinta-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/icons/pinta-512.png', sizes: '512x512' }),
      ]),
    );
    expect(manifest.body.screenshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/about/assets/editor-dark.webp', sizes: '1200x800' }),
        expect.objectContaining({ src: '/about/assets/text-editor.webp', sizes: '960x640' }),
      ]),
    );
    expect(manifest.body.file_handlers[0].accept['image/openraster']).toContain('.ora');

    const assets = await page.evaluate(async () =>
      Promise.all(
        ['/icons/pinta-192.png', '/icons/pinta-512.png', '/apps/com.github.PintaProject.Pinta.svg', '/sw.js'].map(
          async (url) => {
            const response = await fetch(url);
            return { url, ok: response.ok, length: (await response.arrayBuffer()).byteLength };
          },
        ),
      ),
    );
    expect(assets.every((asset) => asset.ok && asset.length > 100)).toBe(true);

    const iconDifferences = await page.evaluate(async () => {
      const pixels = async (url: string, size: number) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d')!.drawImage(image, 0, 0, size, size);
        return canvas.getContext('2d')!.getImageData(0, 0, size, size).data;
      };
      return Promise.all(
        [192, 512].map(async (size) => {
          const [native, generated] = await Promise.all([
            pixels('/apps/com.github.PintaProject.Pinta.svg', size),
            pixels(`/icons/pinta-${size}.png`, size),
          ]);
          let totalDifference = 0;
          for (let index = 0; index < native.length; index += 1) {
            totalDifference += Math.abs(native[index] - generated[index]);
          }
          return totalDifference / native.length;
        }),
      );
    });
    expect(iconDifferences.every((difference) => difference < 1)).toBe(true);
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
      .toBe('activated');
  });
});
