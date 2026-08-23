import { expect, test, type Page } from '@playwright/test';

function ppm(name: string, width: number, height: number, color: [number, number, number]) {
  const pixels = Array.from({ length: width * height }, () => color.join(' ')).join(' ');
  return {
    name,
    mimeType: 'image/x-portable-pixmap',
    buffer: Buffer.from(`P3\n${width} ${height}\n255\n${pixels}\n`),
  };
}

async function openTopMenu(page: Page, name: string) {
  await page.locator(`.macos-menu-button[data-menu-name="${name.toLowerCase()}"]`).click();
  await expect(page.locator('.macos-menu-anchor.active .macos-menu-popover')).toBeVisible();
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

async function storedWorkspaceSummary(page: Page) {
  return page.evaluate(() => new Promise<{ count: number; activeFile: string; activeLayers: number; activeHasSelection: boolean } | null>((resolve, reject) => {
    const request = indexedDB.open('pinta-online', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('workspace', 'readonly');
      const get = transaction.objectStore('workspace').get('current');
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const workspace = get.result as {
          activeDocumentId: string;
          documents: Array<{ id: string; fileName: string; layers: unknown[]; selection: unknown | null }>;
        } | undefined;
        const active = workspace?.documents.find((document) => document.id === workspace.activeDocumentId);
        resolve(workspace && active ? {
          count: workspace.documents.length,
          activeFile: active.fileName,
          activeLayers: active.layers.length,
          activeHasSelection: active.selection !== null,
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

test.describe('documents and image ingress', () => {
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
    await page.getByLabel('Maintain aspect ratio').uncheck();
    await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('160');
    await page.getByRole('spinbutton', { name: 'Height', exact: true }).fill('90');
    await page.getByRole('button', { name: 'Resize', exact: true }).click();
    await expect(activeTab).toHaveAttribute('title', /160 × 90/);

    await openTopMenu(page, 'Image');
    await clickTopMenuItem(page, 'Resize Canvas');
    await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('200');
    await page.getByRole('spinbutton', { name: 'Height', exact: true }).fill('120');
    await page.getByLabel('north-west anchor').click();
    await page.getByRole('button', { name: 'Resize', exact: true }).click();
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
});

test.describe('editing state', () => {
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
    await expect(page).toHaveTitle('Unsaved Image 1* — Pinta');

    await page.keyboard.press('Control+A');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'true');
    await page.keyboard.press('Control+Shift+A');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'false');
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
  test('loads every rendered icon from Pinta or its native GTK icon contract', async ({ page }) => {
    const verifyRenderedIcons = async () => {
      const icons = await page.locator('img.pinta-icon').evaluateAll((elements: HTMLImageElement[]) => elements.map((icon) => ({
        source: new URL(icon.src).pathname,
        loaded: icon.complete && icon.naturalWidth > 0 && icon.naturalHeight > 0,
      })));
      expect(icons.length).toBeGreaterThan(20);
      expect(icons.filter((icon) => !icon.loaded)).toEqual([]);
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

  test('restores tabs, pixels, layers, selection, active document, and UI preferences', async ({ page }) => {
    await page.locator('input[type="file"][multiple]').setInputFiles([
      ppm('session-one.ppm', 9, 7, [200, 40, 20]),
      ppm('session-two.ppm', 6, 8, [20, 80, 220]),
    ]);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'session-two.ppm');
    await page.getByRole('button', { name: 'Add New Layer' }).click();
    await page.keyboard.press('Control+A');

    await openTopMenu(page, 'View');
    await clickTopMenuItem(page, 'Light');
    await openTopMenu(page, 'View');
    await clickTopMenuItem(page, 'Tool Box');
    await expect(page.locator('.app-shell')).toHaveClass(/theme-light/);
    await expect(page.locator('.tools-panel')).toHaveCount(0);
    await expect.poll(() => storedWorkspaceSummary(page), { timeout: 20_000 }).toEqual({
      count: 3,
      activeFile: 'session-two.ppm',
      activeLayers: 2,
      activeHasSelection: true,
    });

    await page.reload();
    await waitForWorkspace(page);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-document-count', '3');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'session-two.ppm');
    await expect(page.getByRole('tab', { name: /session-one\.ppm/ })).toHaveAttribute('title', /9 × 7/);
    await expect(page.getByRole('tab', { name: /session-two\.ppm/ })).toHaveAttribute('title', /6 × 8/);
    await expect(page.locator('.layer-row')).toHaveCount(2);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'true');
    await expect(page.locator('.app-shell')).toHaveClass(/theme-light/);
    await expect(page.locator('.tools-panel')).toHaveCount(0);
    await expect(page.locator('.history-row.active')).toContainText('Restored Session');
    const restoredPixel = await page.locator('.canvas-stack canvas').first().evaluate((canvas: HTMLCanvasElement) => (
      [...canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data]
    ));
    expect(restoredPixel).toEqual([20, 80, 220, 255]);
  });

  test('persists canvas grid and rulers without leaking transient dialogs', async ({ page }) => {
    await openTopMenu(page, 'View');
    await clickTopMenuItem(page, 'Rulers');
    await openTopMenu(page, 'View');
    await clickTopMenuItem(page, 'Canvas Grid');
    await page.getByLabel('Show Grid').check();
    await page.getByLabel('Grid cell width').fill('24');
    await page.getByLabel('Grid cell height').fill('18');
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
    expect(manifest.body.file_handlers[0].accept['image/openraster']).toContain('.ora');

    const assets = await page.evaluate(async () => Promise.all(['/icons/pinta-192.png', '/icons/pinta-512.png', '/apps/com.github.PintaProject.Pinta.svg', '/sw.js'].map(async (url) => {
      const response = await fetch(url);
      return { url, ok: response.ok, length: (await response.arrayBuffer()).byteLength };
    })));
    expect(assets.every((asset) => asset.ok && asset.length > 100)).toBe(true);
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)).toBe('activated');
  });
});
