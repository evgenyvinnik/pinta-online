import { expect, test, type Page } from '@playwright/test';

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

async function waitForWorkspace(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-ready', 'true');
  await expect(page.locator('.canvas-stack canvas').first()).toBeVisible();
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
  return page.evaluate(() => new Promise<{
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
        const workspace = get.result as {
          version: number;
          activeDocumentId: string;
          documents: Array<{
            id: string;
            fileName: string;
            layers: unknown[];
            selection: { tool: string; mask?: Blob } | null;
            history: Array<{ label: string }>;
            historyIndex: number;
            cleanHistoryIndex: number;
          }>;
        } | undefined;
        const active = workspace?.documents.find((document) => document.id === workspace.activeDocumentId);
        resolve(workspace && active ? {
          version: workspace.version,
          count: workspace.documents.length,
          activeFile: active.fileName,
          activeLayers: active.layers.length,
          activeHasSelection: active.selection !== null,
          activeSelectionTool: active.selection?.tool ?? null,
          activeSelectionHasMask: Boolean(active.selection?.mask?.size),
          activeHistoryLabels: active.history.map((entry) => entry.label),
          activeHistoryIndex: active.historyIndex,
          activeCleanHistoryIndex: active.cleanHistoryIndex,
        } : null);
        database.close();
      };
    };
  }));
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
    await page.locator('.main-menu-popover .menu-item').filter({ hasText: /^File a Bug/ }).click();
    expect(await page.evaluate(() => (window as typeof window & { __pintaOpenedUrls?: string[] }).__pintaOpenedUrls)).toEqual([
      'https://github.com/evgenyvinnik/pinta-online/issues/new?template=bug.md',
      'https://github.com/evgenyvinnik/pinta-online/issues/new?template=bug.md',
    ]);

    await page.getByRole('button', { name: 'Main Menu', exact: true }).click();
    await page.locator('.main-menu-popover .menu-item').filter({ hasText: /^About/ }).click();
    const about = page.getByRole('dialog', { name: 'About Pinta' });
    await expect(about.getByRole('link', { name: 'Source Code' })).toHaveAttribute('href', 'https://github.com/evgenyvinnik/pinta-online');
    await expect(about.getByRole('link', { name: 'Report an Issue' })).toHaveAttribute('href', 'https://github.com/evgenyvinnik/pinta-online/issues/new?template=bug.md');
  });
});

test.describe('documents and image ingress', () => {
  test('captures Pinta accelerators before the browser, including from focused controls', async ({ page, context }) => {
    await page.evaluate(() => {
      (window as typeof window & { __pintaShortcutPrevented?: boolean }).__pintaShortcutPrevented = false;
      window.addEventListener('keydown', (event) => {
        if (event.key.toLowerCase() === 'n' && event.ctrlKey) {
          (window as typeof window & { __pintaShortcutPrevented?: boolean }).__pintaShortcutPrevented = event.defaultPrevented;
        }
      });
    });

    const browserPageCount = context.pages().length;
    await page.getByRole('spinbutton', { name: 'Brush width' }).focus();
    await page.keyboard.press('Control+N');
    await expect(page.getByRole('dialog', { name: 'New Image' })).toBeVisible();
    expect(context.pages()).toHaveLength(browserPageCount);
    expect(await page.evaluate(() => (window as typeof window & { __pintaShortcutPrevented?: boolean }).__pintaShortcutPrevented)).toBe(true);

    const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
    await expect(width).toBeFocused();
    expect(await dispatchShortcut(page, { key: 'r', code: 'KeyR', ctrlKey: true }, 'input[aria-label="Width"]')).toBe(true);
    await expect(page.getByRole('dialog', { name: 'New Image' })).toBeVisible();
    expect(await dispatchShortcut(page, { key: 'r', code: 'KeyR', ctrlKey: true, altKey: true }, 'input[aria-label="Width"]')).toBe(false);
    await page.keyboard.press('Escape');

    const brushWidth = page.getByRole('spinbutton', { name: 'Brush width' });
    await brushWidth.focus();
    expect(await dispatchShortcut(page, { key: 'a', code: 'KeyA', ctrlKey: true }, 'input[aria-label="Brush width"]')).toBe(false);
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
    await expect.poll(() => preview.evaluate((canvas: HTMLCanvasElement) => (
      canvas.getContext('2d')!.getImageData(10, 8, 1, 1).data[3]
    ))).toBe(255);
    const previewPixel = await preview.evaluate((canvas: HTMLCanvasElement) => (
      [...canvas.getContext('2d')!.getImageData(10, 8, 1, 1).data]
    ));
    expect(previewPixel).not.toEqual([20, 80, 220, 255]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => preview.evaluate((canvas: HTMLCanvasElement) => (
      canvas.getContext('2d')!.getImageData(10, 8, 1, 1).data[3]
    ))).toBe(0);
    await expect(page.locator('.history-row')).toHaveCount(historyBefore);
  });

  test('supports direct pointer and keyboard input on native point and angle pickers', async ({ page }) => {
    await openTopMenu(page, 'Effects');
    await clickTopMenuItem(page, 'Bulge');
    const pointPicker = page.getByRole('application', { name: /Point picker/ });
    const pointBounds = await pointPicker.boundingBox();
    expect(pointBounds).not.toBeNull();
    await page.mouse.click(pointBounds!.x + pointBounds!.width * 0.8, pointBounds!.y + pointBounds!.height * 0.25);
    await expect(page.getByRole('spinbutton', { name: 'Offset X', exact: true })).toHaveValue('0.6');
    await expect(page.getByRole('spinbutton', { name: 'Offset Y', exact: true })).toHaveValue('-0.5');
    await pointPicker.press('ArrowRight');
    await expect(page.getByRole('spinbutton', { name: 'Offset X', exact: true })).toHaveValue('0.62');
    await page.getByRole('dialog', { name: 'Bulge' }).getByRole('button', { name: 'Cancel' }).click();

    await openTopMenu(page, 'Effects');
    await clickTopMenuItem(page, 'Motion Blur');
    const angleDial = page.getByRole('slider', { name: 'Angle dial' });
    await angleDial.focus();
    await angleDial.press('ArrowRight');
    await expect(page.getByRole('spinbutton', { name: 'Angle', exact: true })).toHaveValue('26');
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
    expect(await dialog.locator('.native-effect-content').evaluate((element) => (
      element.scrollHeight > element.clientHeight
    ))).toBe(true);
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
    await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('200');
    await page.getByRole('spinbutton', { name: 'Height', exact: true }).fill('120');
    await page.getByLabel('north-west anchor').click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(activeTab).toHaveAttribute('title', /200 × 120/);
  });

  test('opens multiple picker files as ordered, independent tabs', async ({ page }) => {
    const input = page.locator('input[type="file"][multiple]');
    await input.setInputFiles([
      ppm('red-wide.ppm', 3, 2, [255, 0, 0]),
      ppm('green-tall.ppm', 2, 4, [0, 255, 0]),
    ]);

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
    const files = [
      ppm('drop-one.ppm', 5, 3, [20, 40, 60]),
      ppm('drop-two.ppm', 4, 6, [80, 100, 120]),
    ].map((file) => ({ name: file.name, type: file.mimeType, bytes: [...file.buffer] }));

    await page.locator('.app-shell').dispatchEvent('dragover');
    await expect(page.locator('.drop-overlay')).toContainText('Open images in Pinta');
    await page.evaluate((droppedFiles) => {
      const transfer = new DataTransfer();
      for (const file of droppedFiles) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
      document.querySelector('.app-shell')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, files);

    await expect(page.locator('.app-shell')).toHaveAttribute('data-document-count', '3');
    await expect(page.getByRole('tab', { name: /drop-one\.ppm/ })).toHaveAttribute('title', /5 × 3/);
    await expect(page.getByRole('tab', { name: /drop-two\.ppm/ })).toHaveAttribute('title', /4 × 6/);
  });

  test('keeps native file handles attached to their tabs and saves back in place', async ({ page }) => {
    const source = ppm('picker-image.ppm', 3, 2, [25, 90, 180]);
    await page.evaluate(({ bytes }) => {
      const target = window as typeof window & {
        showOpenFilePicker?: () => Promise<FileSystemFileHandle[]>;
        __pintaFileWrites?: Array<{ size: number; type: string; closed: boolean }>;
      };
      target.__pintaFileWrites = [];
      const handle = {
        kind: 'file',
        name: 'picker-image.ppm',
        getFile: async () => new File([new Uint8Array(bytes)], 'picker-image.ppm', { type: 'image/x-portable-pixmap' }),
        createWritable: async () => ({
          write: async (blob: Blob) => target.__pintaFileWrites!.push({ size: blob.size, type: blob.type, closed: false }),
          close: async () => { target.__pintaFileWrites!.at(-1)!.closed = true; },
        }),
      };
      target.showOpenFilePicker = async () => [handle as unknown as FileSystemFileHandle];
    }, { bytes: [...source.buffer] });

    await page.getByRole('button', { name: 'Open Image (Ctrl+O)', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'picker-image.ppm');
    await page.getByRole('button', { name: 'Add New Layer' }).click();
    await expect(page).toHaveTitle('picker-image.ppm* — Pinta Online Image Editor');
    await page.keyboard.press('Control+S');
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __pintaFileWrites?: unknown[] }).__pintaFileWrites?.length ?? 0)).toBe(1);
    expect(await page.evaluate(() => (window as typeof window & { __pintaFileWrites?: Array<{ size: number; type: string; closed: boolean }> }).__pintaFileWrites![0])).toEqual({
      size: expect.any(Number),
      type: 'image/x-portable-pixmap',
      closed: true,
    });
    await expect(page).toHaveTitle('picker-image.ppm — Pinta Online Image Editor');
  });

  test('routes an unsaved close through Save As and flatten confirmation before closing', async ({ page }) => {
    await page.evaluate(() => {
      const target = window as typeof window & {
        showSaveFilePicker?: () => Promise<FileSystemFileHandle>;
        __pintaCloseSave?: { writes: number; closed: boolean };
      };
      target.__pintaCloseSave = { writes: 0, closed: false };
      target.showSaveFilePicker = async () => ({
        kind: 'file',
        name: 'closed-image.png',
        getFile: async () => new File([], 'closed-image.png', { type: 'image/png' }),
        createWritable: async () => ({
          write: async () => { target.__pintaCloseSave!.writes += 1; },
          close: async () => { target.__pintaCloseSave!.closed = true; },
        }),
      } as unknown as FileSystemFileHandle);
    });
    await page.getByRole('button', { name: 'Add New Layer' }).click();
    await page.keyboard.press('Control+W');
    const closeDialog = page.getByRole('alertdialog', { name: /Save changes to image/ });
    await closeDialog.getByRole('button', { name: 'Save' }).click();
    const saveAs = page.getByRole('dialog', { name: 'Save Image As' });
    await expect(saveAs).toBeVisible();
    await saveAs.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('alertdialog', { name: /format does not support layers/ }).getByRole('button', { name: 'Flatten' }).click();
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __pintaCloseSave?: { writes: number } }).__pintaCloseSave?.writes)).toBe(1);
    expect(await page.evaluate(() => (window as typeof window & { __pintaCloseSave?: { closed: boolean } }).__pintaCloseSave?.closed)).toBe(true);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'Unsaved Image 2');
    await expect(closeDialog).toBeHidden();
  });

  test('imports and exports PNG images through the operating-system clipboard bridge', async ({ page }) => {
    await page.locator('.app-shell').evaluate(async (shell) => {
      const canvas = document.createElement('canvas');
      canvas.width = 12;
      canvas.height = 8;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#e03020';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG encoding failed')), 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'clipboard.png', { type: 'image/png' }));
      shell.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-selection-bounds', '394,296,12,8');
    await expect(page.locator('.history-row.active')).toContainText('Paste');

    await page.evaluate(() => {
      const target = window as typeof window & { __pintaClipboardTypes?: string[] };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          read: async () => { throw new DOMException('Not allowed', 'NotAllowedError'); },
          write: async (items: ClipboardItem[]) => { target.__pintaClipboardTypes = [...items[0].types]; },
        },
      });
    });
    await page.keyboard.press('Control+C');
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __pintaClipboardTypes?: string[] }).__pintaClipboardTypes)).toEqual(['image/png']);
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
});

test.describe('editing state', () => {
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
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    const fontSize = page.getByRole('spinbutton', { name: 'Font size' });
    const initialSize = Number(await fontSize.inputValue());
    await page.keyboard.press(']');
    await expect(fontSize).toHaveValue(String(initialSize + 1));

    await page.locator('.canvas-stack').click({ position: { x: 120, y: 100 } });
    const textEditor = page.getByRole('textbox', { name: 'Text editor' });
    await expect(textEditor).toHaveAttribute('dir', 'auto');
    await textEditor.fill('مرحبا Pinta');
    await textEditor.press('End');
    await textEditor.press('Tab');
    await expect(textEditor).toHaveValue('مرحبا Pinta\t');
    await expect(textEditor).toBeFocused();

    await textEditor.evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', ctrlKey: true, isComposing: true }));
    });
    await expect(textEditor).toBeVisible();
    await textEditor.press('Control+Enter');
    await expect(textEditor).toBeHidden();
    await expect(page.locator('.history-row.active')).toContainText('Text');

    const historyAfterFirstCommit = await page.locator('.history-row').count();
    await page.locator('.canvas-stack').click({ position: { x: 130, y: 110 }, modifiers: ['Control'] });
    await expect(textEditor).toHaveValue('مرحبا Pinta\t');
    await textEditor.fill('temporary edit');
    await textEditor.press('Escape');
    await expect(page.locator('.history-row')).toHaveCount(historyAfterFirstCommit);

    await page.locator('.canvas-stack').click({ position: { x: 130, y: 110 }, modifiers: ['Control'] });
    await textEditor.fill('Re-edited text');
    await textEditor.press('Control+Enter');
    await expect(page.locator('.history-row')).toHaveCount(historyAfterFirstCommit + 1);
    await expect(page.locator('.history-row.active')).toContainText('Text');
  });

  test('applies page setup to the isolated browser print surface', async ({ page }) => {
    await page.evaluate(() => {
      const target = window as typeof window & { __pintaPrintCalls?: number };
      target.__pintaPrintCalls = 0;
      window.print = () => { target.__pintaPrintCalls! += 1; };
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
    expect(await surface.locator('img').evaluate((image) => Number.parseFloat(image.style.width))).toBeCloseTo(10.4167, 3);
    expect(await page.locator('style').evaluateAll((styles) => styles.map((style) => style.textContent).join('\n'))).toContain('size: portrait; margin: 5mm');
    expect(await page.evaluate(() => (window as typeof window & { __pintaPrintCalls?: number }).__pintaPrintCalls)).toBe(1);
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
    await page.getByRole('button', { name: /^Layer Properties/ }).click();
    await page.getByLabel('Layer name').fill('Painted Background');
    await page.getByLabel('Opacity value').fill('65');
    await page.getByLabel('Blend mode').selectOption('multiply');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.locator('.layer-row')).toContainText('Painted Background');
    await expect(page.locator('.layer-row')).toHaveAttribute('title', /Multiply · 65%/);

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
      await expect.poll(async () => (await selectionOverlaySummary(page)).frame !== firstFrame, { timeout: 2_000 }).toBe(true);
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
    for (const [x, y] of [[240, 80], [270, 190], [150, 230], [90, 80]]) {
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

    const pinchResult = await viewport.evaluate((element, point) => {
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
    }, { x: clientX, y: clientY });
    expect(pinchResult).toEqual([true, true, true]);
    await expect.poll(async () => Number(await shell.getAttribute('data-zoom'))).toBeGreaterThan(1.75);

    const beforeZoom = Number(await shell.getAttribute('data-zoom'));
    const beforeCanvasBounds = await canvas.boundingBox();
    expect(beforeCanvasBounds).not.toBeNull();
    const imagePointBefore = {
      x: (clientX - beforeCanvasBounds!.x) / beforeZoom,
      y: (clientY - beforeCanvasBounds!.y) / beforeZoom,
    };
    await viewport.evaluate((element, point) => {
      element.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        clientX: point.x,
        clientY: point.y,
        deltaY: -40,
      }));
    }, { x: clientX, y: clientY });
    await expect.poll(async () => Number(await shell.getAttribute('data-zoom'))).toBeGreaterThan(beforeZoom);
    const afterZoom = Number(await shell.getAttribute('data-zoom'));
    const afterCanvasBounds = await canvas.boundingBox();
    expect(afterCanvasBounds).not.toBeNull();
    expect((clientX - afterCanvasBounds!.x) / afterZoom).toBeCloseTo(imagePointBefore.x, 0);
    expect((clientY - afterCanvasBounds!.y) / afterZoom).toBeCloseTo(imagePointBefore.y, 0);

    const ordinaryWheel = await viewport.evaluate((element, point) => {
      const event = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        deltaY: 20,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }, { x: clientX, y: clientY });
    expect(ordinaryWheel).toBe(false);
    await expect(shell).toHaveAttribute('data-zoom', afterZoom.toFixed(4));

    const safariGesturePrevented = await viewport.evaluate((element, point) => {
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
    }, { x: clientX, y: clientY });
    expect(safariGesturePrevented).toEqual([true, true, true]);
    await expect.poll(async () => Number(await shell.getAttribute('data-zoom'))).toBeLessThan(afterZoom);
  });

  test('auto-scrolls the viewport while a selection extends beyond the visible canvas', async ({ page }) => {
    const shell = page.locator('.app-shell');
    await page.getByRole('slider', { name: 'Zoom' }).fill('400');
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

  test('builds and edits a polygon lasso before committing it', async ({ page }) => {
    await page.getByRole('button', { name: 'Lasso Select', exact: true }).click();
    await page.getByLabel('Lasso Mode').selectOption('polygon');
    const canvas = page.locator('.canvas-stack');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    for (const [x, y] of [[100, 90], [220, 90], [240, 190], [120, 210]]) {
      await page.mouse.click(bounds!.x + x, bounds!.y + y);
    }
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'true');
    await expect(page.locator('.history-row.active')).toContainText('Select');
  });

  test('offers a full Pinta color picker and discoverable palette editing', async ({ page }) => {
    const swatches = page.locator('.palette .swatch');
    const initialCount = await swatches.count();

    await page.getByRole('button', { name: 'Click to select primary color.', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Choose Palette Color' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('button', { name: 'Hue & Sat' })).toHaveClass(/active/);
    await expect(picker.getByRole('button', { name: 'Sat & Value' })).toBeVisible();
    await expect(picker.getByRole('slider', { name: 'Alpha' })).toBeVisible();

    await picker.getByLabel('Red Value').fill('18');
    await picker.getByLabel('Green Value').fill('52');
    await picker.getByLabel('Blue Value').fill('86');
    await picker.getByLabel('Alpha Value').fill('128');
    await expect(picker.getByLabel('Hex')).toHaveValue('#12345680');
    await picker.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Click to select primary color.', exact: true })).toHaveAttribute('style', /#12345680/);

    await page.getByRole('button', { name: 'Add Primary Color', exact: true }).click();
    await expect(swatches).toHaveCount(initialCount + 1);
    await expect(swatches.last()).toHaveAttribute('title', /^#12345680/);

    await swatches.last().click({ modifiers: ['Meta'] });
    await expect(page.getByRole('dialog', { name: 'Choose Palette Color' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.reload();
    await waitForWorkspace(page);
    await expect(page.locator('.palette .swatch').last()).toHaveAttribute('title', /^#12345680/);

    await page.getByRole('button', { name: 'Click to select secondary color.', exact: true }).click();
    const secondaryPicker = page.getByRole('dialog', { name: 'Choose Palette Color' });
    await expect(secondaryPicker.locator('.color-picker-target.active')).toContainText('Secondary');
    await secondaryPicker.getByLabel('Hex').fill('#654321');
    await secondaryPicker.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Click to select secondary color.', exact: true })).toHaveAttribute('style', /#654321/);

    await page.getByRole('button', { name: /Click to switch between primary and secondary color/ }).click();
    await expect(page.getByRole('button', { name: 'Click to select primary color.', exact: true })).toHaveAttribute('style', /#654321/);
    await expect(page.getByRole('button', { name: 'Click to select secondary color.', exact: true })).toHaveAttribute('style', /#12345680/);
    await page.getByRole('button', { name: 'Click to reset primary and secondary color.', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Click to select primary color.', exact: true })).toHaveAttribute('style', /#000000/);
    await expect(page.getByRole('button', { name: 'Click to select secondary color.', exact: true })).toHaveAttribute('style', /#ffffff/);

    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    await expect(page.locator('.canvas-stack')).toHaveCSS('cursor', /Cursor\.Paintbrush\.png/);
    await expect(page.locator('.status-readout img').first()).toHaveAttribute('src', '/actions/ui-cursor-location-symbolic.svg');
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
    await expect.poll(async () => {
      const summary = await storedWorkspaceSummary(page);
      return summary?.activeSelectionTool === 'magic-wand' && summary.activeSelectionHasMask;
    }, { timeout: 20_000 }).toBe(true);

    await page.reload();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await waitForWorkspace(page);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'selected-object.ppm');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'true');
    await expect(page.getByRole('button', { name: 'Magic Wand Select', exact: true })).toHaveClass(/active/);
    expect(await display.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(pixelsBeforeReload);

    const selectionOverlay = page.locator('.selection-canvas');
    await expect.poll(() => selectionOverlay.evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0;
      for (let index = 3; index < pixels.length; index += 4) visible += pixels[index] > 0 ? 1 : 0;
      return visible;
    })).toBeGreaterThan(0);
    const firstSelectionFrame = await selectionOverlay.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await expect.poll(async () => (
      await selectionOverlay.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
    ) !== firstSelectionFrame, { timeout: 2_000 }).toBe(true);

    await page.keyboard.press('Delete');
    await expect.poll(() => display.evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d')!;
      return {
        selected: [...context.getImageData(30, 25, 1, 1).data],
        background: [...context.getImageData(5, 5, 1, 1).data],
      };
    })).toEqual({ selected: [0, 0, 0, 0], background: [255, 255, 255, 255] });
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
    for (const effect of ['Chromatic Aberration', 'Scanlines', 'Colored Artifacts', 'Pixel Drag', 'Row Slice', 'Adjustment Noise', 'Hexagon Pixelate', 'Night Vision']) {
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
      await expect.poll(() => page.locator('img.pinta-icon').evaluateAll((elements: HTMLImageElement[]) => (
        elements.length > 20 && elements.every((icon) => icon.complete && icon.naturalWidth > 0 && icon.naturalHeight > 0)
      ))).toBe(true);
      const icons = await page.locator('img.pinta-icon').evaluateAll((elements: HTMLImageElement[]) => elements.map((icon) => ({
        source: new URL(icon.src).pathname,
      })));
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
  });

  test('uses native defaults and persists tool-specific settings', async ({ page }) => {
    await expect(page.getByRole('spinbutton', { name: 'Brush width' })).toHaveValue('2');
    await expect(page.getByLabel('Paintbrush type')).toHaveValue('normal');
    await expect(page.locator('.dimension-glyph').locator('..')).toContainText('800, 600');
    await expect(page.getByRole('button', { name: '100%', exact: true })).toBeVisible();

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
    const tokens = () => page.locator('.app-shell').evaluate((element) => {
      const style = getComputedStyle(element);
      return ['--bg', '--chrome', '--chrome-raised', '--workspace', '--panel', '--active-border', '--accent']
        .map((name) => style.getPropertyValue(name).trim());
    });
    expect(await tokens()).toEqual(['#222226', '#2e2e32', '#36363a', '#1d1d20', '#2e2e32', '#3584e4', '#81d0ff']);
    await openTopMenu(page, 'View');
    await clickTopMenuItem(page, 'Light');
    expect(await tokens()).toEqual(['#fafafb', '#fff', '#fff', '#fafafb', '#ebebed', '#3584e4', '#0461be']);
  });

  test('restores tabs, pixels, layers, full history, active document, and UI preferences', async ({ page }) => {
    await page.locator('input[type="file"][multiple]').setInputFiles([
      ppm('session-one.ppm', 9, 7, [200, 40, 20]),
      ppm('session-two.ppm', 6, 8, [20, 80, 220]),
    ]);
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
    await expect.poll(() => storedWorkspaceSummary(page), { timeout: 20_000 }).toEqual({
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
    const restoredPixel = await page.locator('.canvas-stack canvas').first().evaluate((canvas: HTMLCanvasElement) => (
      [...canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data]
    ));
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
    expect(manifest.body.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/icons/pinta-192.png', sizes: '192x192' }),
      expect.objectContaining({ src: '/icons/pinta-512.png', sizes: '512x512' }),
    ]));
    expect(manifest.body.screenshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/about/assets/editor-dark.webp', sizes: '1200x800' }),
      expect.objectContaining({ src: '/about/assets/text-editor.webp', sizes: '960x640' }),
    ]));
    expect(manifest.body.file_handlers[0].accept['image/openraster']).toContain('.ora');

    const assets = await page.evaluate(async () => Promise.all(['/icons/pinta-192.png', '/icons/pinta-512.png', '/apps/com.github.PintaProject.Pinta.svg', '/sw.js'].map(async (url) => {
      const response = await fetch(url);
      return { url, ok: response.ok, length: (await response.arrayBuffer()).byteLength };
    })));
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
      return Promise.all([192, 512].map(async (size) => {
        const [native, generated] = await Promise.all([
          pixels('/apps/com.github.PintaProject.Pinta.svg', size),
          pixels(`/icons/pinta-${size}.png`, size),
        ]);
        let totalDifference = 0;
        for (let index = 0; index < native.length; index += 1) {
          totalDifference += Math.abs(native[index] - generated[index]);
        }
        return totalDifference / native.length;
      }));
    });
    expect(iconDifferences.every((difference) => difference < 1)).toBe(true);
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)).toBe('activated');
  });
});
