import type { Locator, Page } from '@playwright/test';
import { allowPageErrors, expect, test } from '../pageErrors';
import { TOOLS } from '../../src/editor/tools';
import { EFFECT_BY_ID, EFFECT_DEFINITIONS, type EffectDefinition, type EffectId } from '../../src/effects/types';
import { ADDIN_DEFINITIONS, type AddinId } from '../../src/addins/registry';

async function settle(page: Page) {
  await page.waitForFunction(async () => {
    await document.fonts.ready;
    return [...document.images].every((image) => image.complete && image.naturalWidth > 0);
  });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function expectPageScreenshot(page: Page, name: string) {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
}

async function expectLocatorScreenshot(page: Page, locator: Locator, name: string, options?: { maxDiffPixels?: number; maxDiffPixelRatio?: number }) {
  await expect(locator).toBeVisible();
  await settle(page);
  await expect(locator).toHaveScreenshot(`${name}.png`, options);
}

/**
 * A dialog is centred by the backdrop's grid, so one whose height is odd lands on a half-pixel —
 * `render: Clouds` sits at y=301.5 in a 960px viewport. Its 1px `rgba(255, 255, 255, 0.15)` border
 * then straddles two device pixels and rasterises to either value between runs, which made that
 * test fail roughly one run in eight with ~94 differing pixels, all on the perimeter.
 *
 * The allowance covers that border and nothing more: these captures are around 400x360, so 150
 * pixels is a tenth of the perimeter and far below what any real change to a dialog would move.
 * Both limits have to be relaxed together, because Playwright fails when either is exceeded and
 * the global ratio alone permits only about 29 pixels here. The strict global setting still
 * applies to every full-page screenshot.
 */
const DIALOG_ANTIALIAS_ALLOWANCE = { maxDiffPixels: 150, maxDiffPixelRatio: 0.002 };

async function expectDialogScreenshots(page: Page, name: string) {
  const dialog = page.locator('.pinta-dialog').last();
  await expectLocatorScreenshot(page, dialog, name, DIALOG_ANTIALIAS_ALLOWANCE);

  const content = dialog.locator('.dialog-content').last();
  if (await content.count() === 0) return;
  const scrollable = await content.evaluate((element) => element.scrollHeight > element.clientHeight + 1);
  if (!scrollable) return;

  await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expectLocatorScreenshot(page, dialog, `${name}-bottom`, DIALOG_ANTIALIAS_ALLOWANCE);
}

async function openHeaderMenu(page: Page, name: 'View' | 'Image' | 'Adjustments' | 'Effects' | 'Main Menu') {
  await page.locator('.header-cluster-end').getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.header-cluster-end .popover')).toBeVisible();
}

async function clickPopoverItem(page: Page, label: string) {
  const item = page.locator('.header-cluster-end .popover .menu-item').filter({ hasText: new RegExp(`^${escapeRegex(label)}`) });
  await item.scrollIntoViewIfNeeded();
  await item.click();
}

async function openTopLevelMenu(page: Page, name: string) {
  await page.locator('.macos-menu-bar').getByRole('menuitem', { name, exact: true }).click();
  await expect(page.locator('.macos-menu-anchor.active .macos-menu-popover')).toBeVisible();
}

async function clickTopLevelMenuItem(page: Page, label: string) {
  const item = page.locator('.macos-menu-anchor.active .macos-menu-popover .menu-item').filter({
    hasText: new RegExp(`^${escapeRegex(label)}`),
  });
  await item.scrollIntoViewIfNeeded();
  await item.click();
}

async function enableAddin(page: Page, addinId: AddinId) {
  const addin = ADDIN_DEFINITIONS.find((candidate) => candidate.id === addinId)!;
  await openTopLevelMenu(page, 'Add-ins');
  const item = page.locator('.macos-menu-anchor.active .macos-menu-popover .menu-item').filter({
    hasText: new RegExp(`^${escapeRegex(addin.name)}$`),
  });
  await item.click();
}

async function clickMainMenuItem(page: Page, label: string) {
  await openHeaderMenu(page, 'Main Menu');
  await clickPopoverItem(page, label);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function magicWandFixture() {
  const width = 360;
  const height = 260;
  const pixels = Array.from({ length: width * height }, (_, pixel) => {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const inside = ((x - 180) / 82) ** 2 + ((y - 130) / 62) ** 2 <= 1;
    return inside ? '220 40 30' : '255 255 255';
  }).join(' ');
  return {
    name: 'restored-selection.ppm',
    mimeType: 'image/x-portable-pixmap',
    buffer: Buffer.from(`P3\n${width} ${height}\n255\n${pixels}\n`),
  };
}

function addinSampleFixture() {
  const width = 520;
  const height = 360;
  const pixels = Array.from({ length: width * height }, (_, pixel) => {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const checker = (Math.floor(x / 40) + Math.floor(y / 40)) % 2;
    let red = 28 + Math.round(205 * x / (width - 1));
    let green = 34 + Math.round(172 * y / (height - 1));
    let blue = 218 - Math.round(145 * x / (width - 1)) + checker * 24;

    const circle = ((x - 365) / 88) ** 2 + ((y - 112) / 78) ** 2;
    if (circle <= 1) {
      red = 246;
      green = Math.round(54 + 172 * circle);
      blue = Math.round(68 + 130 * (1 - circle));
    }
    if (x >= 48 && x < 206 && y >= 72 && y < 188) {
      const stripe = Math.floor((x - 48) / 16) % 3;
      [red, green, blue] = stripe === 0 ? [24, 211, 255] : stripe === 1 ? [255, 218, 37] : [255, 32, 118];
    }
    if (Math.abs(y - (0.48 * x + 72)) < 8) [red, green, blue] = [246, 248, 252];
    if (y >= 284 && x >= 58 && x < 458) {
      const swatches = [
        [14, 23, 42], [0, 148, 255], [0, 255, 144], [255, 216, 0],
        [255, 106, 0], [255, 0, 110], [178, 0, 255], [255, 255, 255],
      ];
      [red, green, blue] = swatches[Math.floor((x - 58) / 50)];
    }
    return `${Math.max(0, Math.min(255, red))} ${Math.max(0, Math.min(255, green))} ${Math.max(0, Math.min(255, blue))}`;
  }).join(' ');
  return {
    name: 'add-in-sample.ppm',
    mimeType: 'image/x-portable-pixmap',
    buffer: Buffer.from(`P3\n${width} ${height}\n255\n${pixels}\n`),
  };
}

async function prepareAddinSample(page: Page, addinId: AddinId) {
  await page.locator('input[type="file"][multiple]').setInputFiles(addinSampleFixture());
  await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'add-in-sample.ppm');
  const zoomEntry = page.getByRole('textbox', { name: 'Zoom level' });
  await zoomEntry.fill('125');
  await zoomEntry.press('Enter');
  await expect(zoomEntry).toHaveValue('125%');
  await enableAddin(page, addinId);
}

async function openAddinEffect(page: Page, effectId: EffectId) {
  const effect = EFFECT_BY_ID[effectId];
  await openHeaderMenu(page, effect.category === 'adjustment' ? 'Adjustments' : 'Effects');
  const item = page.locator('.effect-menu-popover .menu-item').filter({
    hasText: new RegExp(`^${escapeRegex(effect.name)}(?:…|$)`),
  });
  await item.scrollIntoViewIfNeeded();
  await item.click();
  return effect;
}

async function setDialogNumber(dialog: Locator, label: string, value: number) {
  const input = dialog.getByRole('spinbutton', { name: label, exact: true });
  await input.fill(String(value));
  await expect(input).toHaveValue(String(value));
}

async function applyAddinEffect(
  page: Page,
  effectId: EffectId,
  configure?: (dialog: Locator) => Promise<void>,
) {
  const effect = await openAddinEffect(page, effectId);
  if (effect.parameters.length || effect.dialog) {
    const dialog = page.getByRole('dialog', { name: effect.name });
    await expect(dialog).toBeVisible();
    await configure?.(dialog);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(page.locator('.history-row.active')).toContainText(effect.name);
}

async function captureAddinSample(page: Page, name: string) {
  await page.locator('.toast').waitFor({ state: 'hidden', timeout: 4_000 });
  await openTopLevelMenu(page, 'Add-ins');
  await expectPageScreenshot(page, name);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.canvas-stack canvas').first()).toBeVisible();
  await settle(page);
});

test.describe('workspaces', () => {
  test('default dark workspace', async ({ page }) => {
    await expectPageScreenshot(page, 'workspace-default-dark');
  });

  test('light workspace', async ({ page }) => {
    await openHeaderMenu(page, 'View');
    await clickPopoverItem(page, 'Light');
    await expect(page.locator('.app-shell')).toHaveClass(/theme-light/);
    await expectPageScreenshot(page, 'workspace-default-light');
  });

  test('workspace with toolbar hidden', async ({ page }) => {
    await openTopLevelMenu(page, 'View');
    await clickTopLevelMenuItem(page, 'Tool Bar');
    await expect(page.locator('.header-bar')).toBeHidden();
    await expectPageScreenshot(page, 'workspace-toolbar-hidden');
  });

  test('rulers and canvas grid', async ({ page }) => {
    await openHeaderMenu(page, 'View');
    await clickPopoverItem(page, 'Rulers');
    await openHeaderMenu(page, 'View');
    await clickPopoverItem(page, 'Canvas Grid');
    await page.getByLabel('Show Grid').check();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expectPageScreenshot(page, 'workspace-rulers-and-grid');
  });

  test('selection', async ({ page }) => {
    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
    await page.keyboard.press('Control+A');
    await expectPageScreenshot(page, 'workspace-selection');
  });

  test('restored magic-wand selection', async ({ page }) => {
    await page.locator('input[type="file"][multiple]').setInputFiles(magicWandFixture());
    await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'restored-selection.ppm');
    await page.getByRole('button', { name: 'Magic Wand Select', exact: true }).click();
    await page.locator('.canvas-stack').click({ position: { x: 180, y: 130 } });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'true');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-save-state', 'saving');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-save-state', 'saved', { timeout: 20_000 });
    await page.reload();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-ready', 'true');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-has-selection', 'true');
    await expect(page.getByRole('button', { name: 'Magic Wand Select', exact: true })).toHaveClass(/active/);
    await expectPageScreenshot(page, 'workspace-restored-magic-wand-selection');
  });

  test('text editor', async ({ page }) => {
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.locator('.canvas-stack').click({ position: { x: 140, y: 120 } });
    await page.getByRole('textbox', { name: 'Text editor' }).fill('Pinta Online\nVisual comparison');
    await expectPageScreenshot(page, 'workspace-text-editor');
  });

  test('distraction-free workspace', async ({ page }) => {
    for (const label of ['Tool Box', 'Tool Windows', 'Status Bar', 'Image Tabs']) {
      await openHeaderMenu(page, 'View');
      await clickPopoverItem(page, label);
    }
    await expectPageScreenshot(page, 'workspace-distraction-free');
  });

  test('responsive workspace', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 720 });
    await expectPageScreenshot(page, 'workspace-responsive-800x720');
  });

  test('file drop overlay', async ({ page }) => {
    await page.locator('.app-shell').dispatchEvent('dragover');
    await expect(page.locator('.drop-overlay')).toBeVisible();
    await expectPageScreenshot(page, 'workspace-file-drop');
  });
});

test.describe('localization', () => {
  test('French LTR workspace and menu', async ({ page }) => {
    await page.goto('/fr/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.locator('[data-menu-name="file"]').click();
    await expect(page.locator('.macos-menu-anchor.active .macos-menu-popover')).toBeVisible();
    await expectPageScreenshot(page, 'locale-fr-ltr');
  });

  test('Portuguese (Brazil) regional LTR workspace and menu', async ({ page }) => {
    await page.goto('/pt-BR/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.locator('[data-menu-name="file"]').click();
    await expect(page.locator('.macos-menu-anchor.active .macos-menu-popover')).toBeVisible();
    await expectPageScreenshot(page, 'locale-pt-br-ltr');
  });

  test('Arabic RTL workspace and menu', async ({ page }) => {
    await page.goto('/ar/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.locator('[data-menu-name="file"]').click();
    await expect(page.locator('.macos-menu-anchor.active .macos-menu-popover')).toBeVisible();
    await expectPageScreenshot(page, 'locale-ar-rtl');
  });

  test('Arabic RTL empty workspace and JPEG quality dialog', async ({ page }) => {
    await page.goto('/ar/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('.canvas-stack canvas').first()).toBeVisible();
    await settle(page);
    await page.keyboard.press('Control+W');
    await expect(page.getByRole('main', { name: 'لا توجد صورة مفتوحة' })).toBeVisible();
    await expectPageScreenshot(page, 'locale-ar-rtl-empty-workspace');

    await page.keyboard.press('Control+N');
    await page.getByRole('dialog', { name: 'صورة جديدة' }).getByRole('button', { name: 'حسنًا' }).click();
    await page.keyboard.press('Control+Shift+S');
    const saveAs = page.getByRole('dialog', { name: 'حفظ الصورة باسم' });
    await saveAs.getByLabel('تنسيق الملف').selectOption('jpeg');
    await saveAs.getByRole('button', { name: 'حفظ', exact: true }).click();
    await expectLocatorScreenshot(page, page.getByRole('dialog', { name: 'جودة JPEG' }), 'dialog-jpeg-quality-ar-rtl');
  });
});

/**
 * The tool-options captures only cover the options strip, so nothing notices when a tool
 * stops marking the canvas. These helpers drive each tool with a fixed gesture over a
 * deterministic fixture and capture what it actually produced.
 */
async function prepareToolCanvas(page: Page) {
  await page.locator('input[type="file"][multiple]').setInputFiles(addinSampleFixture());
  await expect(page.locator('.app-shell')).toHaveAttribute('data-active-document', 'add-in-sample.ppm');
  const zoomEntry = page.getByRole('textbox', { name: 'Zoom level' });
  await zoomEntry.fill('100');
  await zoomEntry.press('Enter');
  await expect(zoomEntry).toHaveValue('100%');
  return page.locator('.canvas-stack');
}

async function useTool(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true })).toHaveClass(/active/);
}

async function setPrimary(page: Page, color: string) {
  await page.getByRole('button', { name: `Set color ${color}`, exact: true }).click();
}

/** Drags through the given canvas-relative points with a single pointer. */
async function dragPath(page: Page, canvas: Locator, points: ReadonlyArray<readonly [number, number]>, button?: 'right') {
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const at = ([x, y]: readonly [number, number]) => [bounds!.x + x, bounds!.y + y] as const;
  const [startX, startY] = at(points[0]);
  await page.mouse.move(startX, startY);
  await page.mouse.down(button ? { button } : undefined);
  for (const point of points.slice(1)) {
    const [x, y] = at(point);
    await page.mouse.move(x, y, { steps: 10 });
  }
  await page.mouse.up(button ? { button } : undefined);
}

async function captureToolCanvas(page: Page, canvas: Locator, name: string) {
  await page.locator('.toast').waitFor({ state: 'hidden', timeout: 4_000 }).catch(() => undefined);
  await expectLocatorScreenshot(page, canvas, name);
}

test.describe('tool output', () => {
  const brushStrokes = [
    ['paintbrush', 'Paintbrush', '#ff006e'],
    ['pencil', 'Pencil', '#0026ff'],
    ['eraser', 'Eraser', '#ffffff'],
    ['clone-stamp', 'Clone Stamp', '#ffffff'],
    ['recolor', 'Recolor', '#00ff21'],
  ] as const;

  for (const [id, name, color] of brushStrokes) {
    test(`${name} strokes`, async ({ page }) => {
      const canvas = await prepareToolCanvas(page);
      await useTool(page, name);
      await setPrimary(page, color);
      if (id !== 'pencil') await page.getByRole('spinbutton', { name: 'Brush width' }).fill('26');
      if (id === 'clone-stamp') {
        // Ctrl/Command-click sets the clone source before the first stroke.
        const bounds = await canvas.boundingBox();
        await page.mouse.move(bounds!.x + 380, bounds!.y + 110);
        await page.keyboard.down('Control');
        await page.mouse.down();
        await page.mouse.up();
        await page.keyboard.up('Control');
      }
      await dragPath(page, canvas, [[70, 90], [220, 160], [330, 90], [450, 240]]);
      await captureToolCanvas(page, canvas, `tool-${id}-canvas`);
    });
  }

  // CircleBrush, GridBrush, and SplatterBrush draw through Random in native Pinta too, so
  // only the deterministic types get a pinned image; the random ones are checked for
  // having marked the layer at all.
  const paintbrushTypes = [
    ['normal', true],
    ['circles', false],
    ['grid', false],
    ['slash', true],
    ['splatter', false],
    ['squares', true],
  ] as const;

  for (const [type, deterministic] of paintbrushTypes) {
    test(`Paintbrush type ${type}`, async ({ page }) => {
      const canvas = await prepareToolCanvas(page);
      await useTool(page, 'Paintbrush');
      await setPrimary(page, '#000000');
      await page.getByRole('spinbutton', { name: 'Brush width' }).fill('30');
      await page.getByLabel('Paintbrush type').selectOption(type, { force: true });

      // CircleBrush and GridBrush paint at 5% alpha, so the check is "the layer changed"
      // rather than any particular ink density.
      const layerBytes = () => page.locator('.canvas-stack canvas').first().evaluate((element: HTMLCanvasElement) => (
        [...element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data].join(',')
      ));
      const before = await layerBytes();

      await dragPath(page, canvas, [[80, 120], [250, 200], [440, 120]]);
      await expect(page.locator('.history-row.active')).toContainText('Paintbrush');
      expect(await layerBytes()).not.toBe(before);

      if (deterministic) await captureToolCanvas(page, canvas, `tool-paintbrush-${type}-canvas`);
    });
  }

  const shapes = [
    ['rectangle', 'Rectangle'],
    ['rounded-rectangle', 'Rounded Rectangle'],
    ['ellipse', 'Ellipse'],
  ] as const;

  for (const [id, name] of shapes) {
    test(`${name} shape`, async ({ page }) => {
      const canvas = await prepareToolCanvas(page);
      await useTool(page, name);
      await setPrimary(page, '#000000');
      await page.getByLabel('Fill style', { exact: true }).selectOption('fill-outline', { force: true });
      await page.getByRole('spinbutton', { name: 'Outline width' }).fill('6');
      await dragPath(page, canvas, [[90, 80], [400, 270]]);
      await page.keyboard.press('Enter');
      await captureToolCanvas(page, canvas, `tool-${id}-canvas`);
    });
  }

  test('Line / Curve with arrows', async ({ page }) => {
    const canvas = await prepareToolCanvas(page);
    await useTool(page, 'Line / Curve');
    await setPrimary(page, '#000000');
    await page.getByRole('spinbutton', { name: 'Outline width' }).fill('5');
    await page.getByLabel('Start arrow').check();
    await page.getByLabel('End arrow').check();
    await dragPath(page, canvas, [[80, 260], [430, 90]]);
    await page.keyboard.press('Enter');
    await captureToolCanvas(page, canvas, 'tool-line-canvas');
  });

  test('Freeform Shape', async ({ page }) => {
    const canvas = await prepareToolCanvas(page);
    await useTool(page, 'Freeform Shape');
    await setPrimary(page, '#000000');
    await page.getByLabel('Fill style', { exact: true }).selectOption('fill-outline', { force: true });
    await page.getByRole('spinbutton', { name: 'Brush width' }).fill('5');
    await dragPath(page, canvas, [[110, 90], [300, 70], [420, 200], [250, 280], [120, 210]]);
    await page.keyboard.press('Enter');
    await captureToolCanvas(page, canvas, 'tool-freeform-canvas');
  });

  test('Paint Bucket fill', async ({ page }) => {
    const canvas = await prepareToolCanvas(page);
    await useTool(page, 'Paint Bucket');
    await setPrimary(page, '#b200ff');
    await page.getByLabel('Tolerance', { exact: true }).fill('40');
    await dragPath(page, canvas, [[120, 300]]);
    await captureToolCanvas(page, canvas, 'tool-paint-bucket-canvas');
  });

  for (const gradient of ['linear', 'reflected', 'diamond', 'radial', 'conical'] as const) {
    test(`Gradient ${gradient}`, async ({ page }) => {
      const canvas = await prepareToolCanvas(page);
      await useTool(page, 'Gradient');
      await setPrimary(page, '#ffd800');
      await page.locator('.tool-options-bar').getByLabel('Gradient', { exact: true }).selectOption(gradient, { force: true });
      await dragPath(page, canvas, [[180, 180], [400, 260]]);
      await captureToolCanvas(page, canvas, `tool-gradient-${gradient}-canvas`);
    });
  }

  const selections = [
    ['rectangle-select', 'Rectangle Select', [[90, 80], [380, 250]]],
    ['ellipse-select', 'Ellipse Select', [[90, 80], [380, 250]]],
    ['lasso-select', 'Lasso Select', [[110, 90], [320, 70], [430, 210], [240, 290], [120, 220]]],
  ] as const;

  for (const [id, name, path] of selections) {
    test(`${name} filled`, async ({ page }) => {
      const canvas = await prepareToolCanvas(page);
      await useTool(page, name);
      await setPrimary(page, '#4800ff');
      await dragPath(page, canvas, path);
      // Filling and deselecting shows the mask without the animated marquee.
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Control+Shift+A');
      await captureToolCanvas(page, canvas, `tool-${id}-canvas`);
    });
  }

  test('Magic Wand Select filled', async ({ page }) => {
    const canvas = await prepareToolCanvas(page);
    await useTool(page, 'Magic Wand Select');
    await page.getByLabel('Tolerance', { exact: true }).fill('45');
    await setPrimary(page, '#4800ff');
    await dragPath(page, canvas, [[120, 300]]);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Control+Shift+A');
    await captureToolCanvas(page, canvas, 'tool-magic-wand-canvas');
  });

  test('Text placement', async ({ page }) => {
    const canvas = await prepareToolCanvas(page);
    await useTool(page, 'Text');
    await setPrimary(page, '#000000');
    await page.getByRole('spinbutton', { name: 'Font size' }).fill('48');
    await page.getByLabel('Text style').selectOption('fill-outline', { force: true });
    const bounds = await canvas.boundingBox();
    await page.mouse.click(bounds!.x + 70, bounds!.y + 150);
    const editor = page.locator('.canvas-text-editor');
    await expect(editor).toBeVisible();
    await editor.pressSequentially('Pinta');
    await expect(editor).toHaveValue('Pinta');
    await page.getByRole('button', { name: 'Commit text' }).click();
    await captureToolCanvas(page, canvas, 'tool-text-canvas');
  });

  test('Move Selected Pixels', async ({ page }) => {
    const canvas = await prepareToolCanvas(page);
    await useTool(page, 'Rectangle Select');
    await dragPath(page, canvas, [[90, 80], [300, 220]]);
    await useTool(page, 'Move Selected Pixels');
    await dragPath(page, canvas, [[180, 150], [330, 250]]);
    await page.keyboard.press('Control+Shift+A');
    await captureToolCanvas(page, canvas, 'tool-move-pixels-canvas');
  });

  test('Color Picker sampling', async ({ page }) => {
    const canvas = await prepareToolCanvas(page);
    await useTool(page, 'Color Picker');
    await dragPath(page, canvas, [[380, 110]]);
    await expectLocatorScreenshot(page, page.locator('.color-wells'), 'tool-color-picker-canvas');
  });

  test('Zoom and Pan viewport', async ({ page }) => {
    await prepareToolCanvas(page);
    await useTool(page, 'Zoom');
    const canvas = page.locator('.canvas-stack');
    await dragPath(page, canvas, [[260, 180]]);
    await expect(page.getByRole('textbox', { name: 'Zoom level' })).toHaveValue('125%');
    await useTool(page, 'Pan');
    await dragPath(page, canvas, [[300, 200], [180, 120]]);
    await page.locator('.toast').waitFor({ state: 'hidden', timeout: 4_000 });
    await expectPageScreenshot(page, 'tool-zoom-pan-viewport');
  });
});

test.describe('tool options', () => {
  for (const tool of TOOLS) {
    test(tool.name, async ({ page }) => {
      if (tool.addinId) await enableAddin(page, tool.addinId);
      await page.getByRole('button', { name: tool.name, exact: true }).click();
      await expect(page.locator('.tool-options-bar')).toContainText('Tool:');
      await expectLocatorScreenshot(page, page.locator('.tool-options-bar'), `tool-${tool.id}`);
    });
  }

  test('native icon chooser flyout', async ({ page }) => {
    await page.getByRole('button', { name: 'Line / Curve', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Outline Shape' }).click();
    await expect(page.getByRole('listbox', { name: 'Fill style choices' })).toBeVisible();
    await expectPageScreenshot(page, 'tool-line-fill-style-flyout');
  });

  test('native autoscroll chooser reuses the Pinta effect icons', async ({ page }) => {
    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Autoscroll On' }).click();
    await expect(page.getByRole('listbox', { name: 'Auto-scroll choices' })).toBeVisible();
    await expectPageScreenshot(page, 'tool-selection-autoscroll-flyout');
  });

  test('native Color Picker sampling chooser includes icons, labels, and trailing check state', async ({ page }) => {
    await page.getByRole('button', { name: 'Color Picker', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Single Pixel' }).click();
    await expect(page.getByRole('listbox', { name: 'Sampling size choices' })).toBeVisible();
    await expectPageScreenshot(page, 'tool-color-picker-sampling-flyout');
  });

  test('native Color Picker after-select chooser uses original Pinta icons', async ({ page }) => {
    await page.getByRole('button', { name: 'Color Picker', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Do not switch tool' }).click();
    await expect(page.getByRole('listbox', { name: 'After select choices' })).toBeVisible();
    await expectPageScreenshot(page, 'tool-color-picker-after-select-flyout');
  });

  test('native Selection Mode text chooser preserves exact command rows', async ({ page }) => {
    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
    await page.getByLabel('Selection mode').locator('..').getByRole('button').click();
    await expect(page.getByRole('listbox', { name: 'Selection mode choices' })).toBeVisible();
    await expectPageScreenshot(page, 'tool-selection-mode-flyout');
  });

  test('native Paintbrush Type chooser preserves built-in brush order', async ({ page }) => {
    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    await page.getByLabel('Paintbrush type').locator('..').getByRole('button').click();
    await expect(page.getByRole('listbox', { name: 'Paintbrush type choices' })).toBeVisible();
    await expectPageScreenshot(page, 'tool-paintbrush-type-flyout');
  });

  test('native Eraser Type chooser preserves the two native modes', async ({ page }) => {
    await page.getByRole('button', { name: 'Eraser', exact: true }).click();
    await page.getByLabel('Eraser type').locator('..').getByRole('button').click();
    await expect(page.getByRole('listbox', { name: 'Eraser type choices' })).toBeVisible();
    await expectPageScreenshot(page, 'tool-eraser-type-flyout');
  });

  test('native Text Join chooser appears with outline text modes', async ({ page }) => {
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByLabel('Text style').selectOption('outline');
    await page.getByLabel('Text outline join').locator('..').getByRole('button').click();
    await expect(page.getByRole('listbox', { name: 'Text outline join choices' })).toBeVisible();
    await expectPageScreenshot(page, 'tool-text-join-flyout');
  });
});

test.describe('menus', () => {
  for (const menu of ['View', 'Image', 'Adjustments'] as const) {
    test(menu, async ({ page }) => {
      await openHeaderMenu(page, menu);
      await expectPageScreenshot(page, `menu-${menu.toLowerCase()}`);
    });
  }

  test('Effects top and bottom', async ({ page }) => {
    await openHeaderMenu(page, 'Effects');
    await expectPageScreenshot(page, 'menu-effects-top');
    await page.locator('.effect-menu-popover').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expectPageScreenshot(page, 'menu-effects-bottom');
  });

  test('Main menu top and bottom', async ({ page }) => {
    await openHeaderMenu(page, 'Main Menu');
    await expectPageScreenshot(page, 'menu-main-top');
    await page.locator('.main-menu-popover').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expectPageScreenshot(page, 'menu-main-bottom');
  });

  test('Layer menu', async ({ page }) => {
    await page.getByRole('button', { name: 'Layer menu' }).click();
    await expectPageScreenshot(page, 'menu-layer');
  });
});

test.describe('desktop application menus', () => {
  for (const menu of ['Pinta', 'File', 'Edit', 'View', 'Image', 'Adjustments', 'Add-ins', 'Window', 'Help']) {
    test(menu, async ({ page }) => {
      await openTopLevelMenu(page, menu);
      await expectPageScreenshot(page, `menubar-${menu.toLowerCase().replace(/[^a-z]+/g, '-')}`);
    });
  }

  test('Effects top and bottom', async ({ page }) => {
    await openTopLevelMenu(page, 'Effects');
    await expectPageScreenshot(page, 'menubar-effects-top');
    await page.locator('.macos-menu-anchor.active .macos-menu-popover').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expectPageScreenshot(page, 'menubar-effects-bottom');
  });

  test('keyboard traversal and dismissal', async ({ page }) => {
    await openTopLevelMenu(page, 'File');
    await page.locator('.macos-menu-bar').getByRole('menuitem', { name: 'File', exact: true }).press('ArrowRight');
    await expect(page.locator('.macos-menu-anchor.active .macos-menu-button')).toHaveText('Edit');
    await page.keyboard.press('Escape');
    await expect(page.locator('.macos-menu-anchor.active')).toHaveCount(0);
  });
});

interface DialogScenario {
  name: string;
  open: (page: Page) => Promise<void>;
}

const dialogScenarios: DialogScenario[] = [
  {
    name: 'dialog-new-image',
    open: async (page) => { await page.getByRole('button', { name: 'New Image (Ctrl+N)', exact: true }).click(); },
  },
  {
    name: 'dialog-resize-image',
    open: async (page) => { await openHeaderMenu(page, 'Image'); await clickPopoverItem(page, 'Resize Image'); },
  },
  {
    name: 'dialog-resize-canvas',
    open: async (page) => { await openHeaderMenu(page, 'Image'); await clickPopoverItem(page, 'Resize Canvas'); },
  },
  {
    name: 'dialog-save-image-as',
    open: async (page) => { await clickMainMenuItem(page, 'Save As'); },
  },
  {
    name: 'dialog-print-image',
    open: async (page) => { await clickMainMenuItem(page, 'Print'); },
  },
  {
    name: 'dialog-new-screenshot',
    open: async (page) => { await clickMainMenuItem(page, 'New Screenshot'); },
  },
  {
    name: 'dialog-canvas-grid',
    open: async (page) => { await openHeaderMenu(page, 'View'); await clickPopoverItem(page, 'Canvas Grid'); },
  },
  {
    name: 'dialog-layer-properties',
    open: async (page) => { await page.getByRole('button', { name: /^Layer Properties/ }).click(); },
  },
  {
    name: 'dialog-rotate-zoom-layer',
    open: async (page) => {
      await page.getByRole('button', { name: 'Layer menu' }).click();
      await page.locator('.layer-menu-popover .menu-item').filter({ hasText: /^Rotate \/ Zoom Layer/ }).click();
    },
  },
  {
    name: 'dialog-save-palette',
    open: async (page) => { await clickMainMenuItem(page, 'Save Palette As'); },
  },
  {
    name: 'dialog-resize-palette',
    open: async (page) => { await clickMainMenuItem(page, 'Set Number of Colors'); },
  },
  {
    name: 'dialog-edit-palette-color',
    open: async (page) => { await page.locator('.swatch').first().click({ modifiers: ['Meta'] }); },
  },
  {
    name: 'dialog-primary-secondary-color',
    open: async (page) => { await page.getByRole('button', { name: 'Click to select primary color.', exact: true }).click(); },
  },
  {
    name: 'dialog-keyboard-shortcuts',
    open: async (page) => { await clickMainMenuItem(page, 'Keyboard Shortcuts'); },
  },
  {
    name: 'dialog-language',
    open: async (page) => { await clickMainMenuItem(page, 'Language'); },
  },
  {
    name: 'dialog-about',
    open: async (page) => { await clickMainMenuItem(page, 'About'); },
  },
  {
    name: 'dialog-about-details',
    open: async (page) => {
      await clickMainMenuItem(page, 'About');
      const dialog = page.getByRole('dialog', { name: 'About Pinta' });
      await dialog.getByRole('button', { name: 'Details' }).click();
      await page.locator('.pinta-dialog').last().locator('dd').first().evaluate((node) => {
        node.textContent = 'Pinta Online 1.0.260827.24';
      });
    },
  },
  {
    name: 'dialog-about-credits',
    open: async (page) => {
      await clickMainMenuItem(page, 'About');
      await page.getByRole('dialog', { name: 'About Pinta' }).getByRole('button', { name: 'Credits' }).click();
    },
  },
  {
    name: 'dialog-about-legal',
    open: async (page) => {
      await clickMainMenuItem(page, 'About');
      await page.getByRole('dialog', { name: 'About Pinta' }).getByRole('button', { name: 'Legal' }).click();
    },
  },
  {
    name: 'dialog-error-report',
    open: async (page) => {
      await page.locator('input[type="file"][multiple]').setInputFiles({
        name: 'broken-image.ppm',
        mimeType: 'image/x-portable-pixmap',
        buffer: Buffer.from([1, 2, 3]),
      });
    },
  },
  {
    name: 'dialog-error-report-details',
    open: async (page) => {
      await page.locator('input[type="file"][multiple]').setInputFiles({
        name: 'broken-image.ppm',
        mimeType: 'image/x-portable-pixmap',
        buffer: Buffer.from([1, 2, 3]),
      });
      await page.getByRole('alertdialog', { name: 'Unsupported file format' }).getByText('Details').click();
    },
  },
  {
    name: 'dialog-offset-selection',
    open: async (page) => {
      await page.keyboard.press('Control+A');
      await clickMainMenuItem(page, 'Offset Selection');
    },
  },
  {
    name: 'dialog-close-document',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add New Layer' }).click();
      await openHeaderMenu(page, 'Main Menu');
      await page.getByRole('menuitem', { name: /^Close Ctrl\+W$/ }).click();
    },
  },
  {
    name: 'dialog-close-all',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add New Layer' }).click();
      await page.getByRole('button', { name: 'New Image (Ctrl+N)', exact: true }).click();
      await page.getByRole('button', { name: 'OK' }).click();
      await page.getByRole('button', { name: 'Add New Layer' }).click();
      await clickMainMenuItem(page, 'Close All');
    },
  },
];

test.describe('dialogs', () => {
  test('dialog-cells-narrow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await openHeaderMenu(page, 'Effects');
    await clickPopoverItem(page, 'Cells');
    const dialog = page.getByRole('dialog', { name: 'Cells' });
    await expectLocatorScreenshot(page, dialog, 'dialog-cells-narrow');
    await dialog.locator('.native-effect-content').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expectLocatorScreenshot(page, dialog, 'dialog-cells-narrow-bottom');
  });

  test('dialog-cells-rtl', async ({ page }) => {
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    await openHeaderMenu(page, 'Effects');
    await clickPopoverItem(page, 'Cells');
    await expectLocatorScreenshot(page, page.getByRole('dialog', { name: 'Cells' }), 'dialog-cells-rtl');
  });

  test('dialog-addin-manager', async ({ page }) => {
    await openTopLevelMenu(page, 'Add-ins');
    await clickTopLevelMenuItem(page, 'Add-in Manager');
    await expectDialogScreenshots(page, 'dialog-addin-manager');
    await page.locator('.addin-list').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expectLocatorScreenshot(page, page.getByRole('dialog', { name: 'Add-in Manager' }), 'dialog-addin-manager-bottom');
  });

  test('dialog-addin-manager-enabled-rtl', async ({ page }) => {
    await page.goto('/ar/');
    await page.locator('.macos-menu-button[data-menu-name="addins"]').click();
    await page.locator('.macos-menu-anchor.active .macos-menu-popover .menu-item').first().click();
    await page.locator('.addin-manager-actions button').first().click();
    await expectDialogScreenshots(page, 'dialog-addin-manager-enabled-rtl');
    await page.locator('.addin-list').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expectLocatorScreenshot(page, page.locator('.addin-manager-dialog'), 'dialog-addin-manager-enabled-rtl-bottom');
  });

  test('dialog-primary-secondary-color-rtl', async ({ page }) => {
    await page.goto('/ar/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.locator('.color-well.primary').click();
    await expectDialogScreenshots(page, 'dialog-primary-secondary-color-rtl');
  });

  test('dialog-language-bottom', async ({ page }) => {
    await clickMainMenuItem(page, 'Language');
    const dialog = page.getByRole('dialog', { name: 'Choose language' });
    await dialog.locator('fieldset').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expectLocatorScreenshot(page, dialog, 'dialog-language-bottom');
  });

  for (const scenario of dialogScenarios) {
    test(scenario.name, async ({ page }) => {
      await scenario.open(page);
      await expectDialogScreenshots(page, scenario.name);
    });
  }
});

function isDialogEffect(effect: EffectDefinition) {
  return effect.parameters.length > 0 || effect.dialog !== undefined;
}

test.describe('adjustment and effect dialogs', () => {
  for (const effect of EFFECT_DEFINITIONS.filter(isDialogEffect)) {
    test(`${effect.category}: ${effect.name}`, async ({ page }) => {
      if (effect.addinId) await enableAddin(page, effect.addinId);
      await openHeaderMenu(page, effect.category === 'adjustment' ? 'Adjustments' : 'Effects');
      const item = page.locator('.effect-menu-popover .menu-item').filter({
        hasText: new RegExp(`^${escapeRegex(effect.name)}(?:…|$)`),
      });
      await item.scrollIntoViewIfNeeded();
      await item.click();
      await expect(page.getByRole('dialog', { name: effect.name })).toBeVisible();
      await expectDialogScreenshots(page, `${effect.category}-${effect.id}`);
    });
  }
});

test.describe('add-in output samples', () => {
  const arsKaliSamples: Array<{
    effectId: EffectId;
    screenshot: string;
    configure?: (dialog: Locator) => Promise<void>;
  }> = [
    {
      effectId: 'chromatic-aberration',
      screenshot: 'addin-ars-kali-glitches-chromatic-aberration-sample',
      configure: async (dialog) => {
        // PointI pickers are image-absolute like PointPickerWidget, so a shift is written
        // as a coordinate relative to the 520 x 360 fixture's centre, not as a signed
        // offset. Red shifts (+12, +3), green (-4, +8), blue (-13, -5).
        const centreX = 260;
        const centreY = 180;
        const points = dialog.locator('.native-effect-point');
        await setDialogNumber(points.nth(0), 'Offset X', centreX + 12);
        await setDialogNumber(points.nth(0), 'Offset Y', centreY + 3);
        await setDialogNumber(points.nth(1), 'Offset X', centreX - 4);
        await setDialogNumber(points.nth(1), 'Offset Y', centreY + 8);
        await setDialogNumber(points.nth(2), 'Offset X', centreX - 13);
        await setDialogNumber(points.nth(2), 'Offset Y', centreY - 5);
      },
    },
    {
      effectId: 'scanlines',
      screenshot: 'addin-ars-kali-glitches-scanlines-sample',
    },
    {
      effectId: 'colored-artifacts',
      screenshot: 'addin-ars-kali-glitches-colored-artifacts-sample',
      configure: async (dialog) => {
        await setDialogNumber(dialog, 'Number of artifacts', 42);
        await setDialogNumber(dialog, 'Minimum artifact alpha', 120);
        await setDialogNumber(dialog, 'Maximum artifact alpha', 240);
        await setDialogNumber(dialog, 'Maximum artifact height', 0.12);
        await setDialogNumber(dialog, 'Minimum artifact height', 0.03);
        await setDialogNumber(dialog, 'Maximum artifact width', 0.28);
        await setDialogNumber(dialog, 'Minimum artifact width', 0.06);
        await setDialogNumber(dialog, 'Random seed', 31415);
      },
    },
    {
      effectId: 'pixel-drag',
      screenshot: 'addin-ars-kali-glitches-pixel-drag-sample',
      configure: async (dialog) => {
        await setDialogNumber(dialog, 'Minimum drag length', 0.04);
        await setDialogNumber(dialog, 'Maximum drag length', 0.3);
        await setDialogNumber(dialog, '# of pixels to drag', 1200);
        await setDialogNumber(dialog, 'Random seed', 31415);
      },
    },
    {
      effectId: 'row-slice',
      screenshot: 'addin-ars-kali-glitches-row-slice-sample',
      configure: async (dialog) => {
        await setDialogNumber(dialog, 'Number of slices', 18);
        await setDialogNumber(dialog, 'Left shift', 0.45);
        await setDialogNumber(dialog, 'Right shift', 0.3);
        await setDialogNumber(dialog, 'Random seed', 31415);
      },
    },
    {
      effectId: 'adjustment-noise',
      screenshot: 'addin-ars-kali-glitches-adjustment-noise-sample',
      configure: async (dialog) => {
        await setDialogNumber(dialog, 'Random seed', 31415);
      },
    },
  ];

  for (const sample of arsKaliSamples) {
    test(`Ars Kali: ${sample.effectId}`, async ({ page }) => {
      await prepareAddinSample(page, 'ars-kali-glitches');
      await applyAddinEffect(page, sample.effectId, sample.configure);
      await captureAddinSample(page, sample.screenshot);
    });
  }

  test('Block Brush strokes', async ({ page }) => {
    await prepareAddinSample(page, 'block-brush');
    await page.getByRole('button', { name: 'Paintbrush', exact: true }).click();
    await page.getByLabel('Paintbrush type').selectOption('block');
    await page.getByRole('spinbutton', { name: 'Brush width' }).fill('30');

    const canvas = page.locator('.canvas-stack');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const strokes = [
      { color: '#ff006e', from: [90, 80], to: [275, 150] },
      { color: '#00ffff', from: [185, 245], to: [490, 195] },
      { color: '#ffd800', from: [365, 80], to: [535, 285] },
    ] as const;
    for (const stroke of strokes) {
      await page.getByRole('button', { name: `Set color ${stroke.color}`, exact: true }).click();
      await page.mouse.move(bounds!.x + stroke.from[0], bounds!.y + stroke.from[1]);
      await page.mouse.down();
      await page.mouse.move(bounds!.x + stroke.to[0], bounds!.y + stroke.to[1], { steps: 12 });
      await page.mouse.up();
    }
    await expect(page.locator('.history-row.active')).toContainText('Block Brush');
    await captureAddinSample(page, 'addin-block-brush-sample');
  });

  test('Colored Grayscale adjustment', async ({ page }) => {
    await prepareAddinSample(page, 'colored-grayscale');
    await page.getByRole('button', { name: 'Set color #0094ff', exact: true }).click();
    await applyAddinEffect(page, 'colored-grayscale');
    await captureAddinSample(page, 'addin-colored-grayscale-sample');
  });

  test('More Pixelates hexagons', async ({ page }) => {
    await prepareAddinSample(page, 'more-pixelates');
    await applyAddinEffect(page, 'hexagon-pixelate', async (dialog) => {
      await setDialogNumber(dialog, 'Radius', 24);
      await dialog.getByRole('combobox', { name: 'Sample mode' }).selectOption('1');
      await setDialogNumber(dialog, 'Border Width', 3);
    });
    await captureAddinSample(page, 'addin-more-pixelates-hexagon-sample');
  });

  test('Night Vision output', async ({ page }) => {
    await prepareAddinSample(page, 'night-vision');
    await applyAddinEffect(page, 'night-vision', async (dialog) => {
      await setDialogNumber(dialog, 'Brightness', 0.82);
      await dialog.getByRole('checkbox', { name: 'Noise' }).check();
    });
    await captureAddinSample(page, 'addin-night-vision-sample');
  });
});
