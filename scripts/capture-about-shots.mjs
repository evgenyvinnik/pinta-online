#!/usr/bin/env node
/**
 * Captures the pop-art gallery used by /about/.
 *
 * The promo captures show the editor doing ordinary work well. These exist for the opposite
 * reason: to show how far the toolbox goes when someone pushes it. So the script builds a
 * deliberately loud Lichtenstein-style panel out of nothing but the app's own tools — a flat
 * yellow ground, hard-edged primary shapes, a comic outline, and a bold caption — and then
 * photographs that one panel under a series of treatments.
 *
 * Repetition-with-variation is the point, and it is also the honest way to demonstrate an effect
 * library: the subject is held constant so every frame differs only by the thing being shown.
 * Warhol's silkscreen grids work the same way, which is why the gallery reads as pop art rather
 * than as a feature list with pictures.
 *
 * Every add-in is switched on first. The glitch pack, the hexagonal pixelator and the night-vision
 * pass are all off in a default install, and they are exactly the effects that make the set weird
 * rather than tasteful — so enabling them is both the point of the gallery and a demonstration of
 * the add-in system itself.
 *
 * Usage: node scripts/capture-about-shots.mjs [--base http://localhost:4173] [--out web-assets/about]
 * Requires a server already serving the built site (`npm run preview`).
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argOf = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const base = argOf('--base', 'http://localhost:4173');
const outDir = resolve(root, argOf('--out', 'web-assets/about'));
const staging = mkdtempSync(join(tmpdir(), 'about-shots-'));

const VIEWPORT = { width: 1440, height: 960 };

/* ---------------------------------------------------------------- helpers */

const settle = async (page) => {
  await page
    .locator('.pinta-dialog')
    .filter({ hasText: 'Rendering Effect' })
    .waitFor({ state: 'hidden', timeout: 60_000 })
    .catch(() => {});
  await page
    .locator('.toast')
    .waitFor({ state: 'hidden', timeout: 5_000 })
    .catch(() => {});
  await page.waitForFunction(async () => {
    await document.fonts.ready;
    return [...document.images].every((image) => image.complete && image.naturalWidth > 0);
  });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
};

const headerMenu = async (page, name) => {
  await page.locator('.header-cluster-end').getByRole('button', { name, exact: true }).click();
  await page.locator('.header-cluster-end .popover').waitFor({ state: 'visible' });
};

const applyEffect = async (page, menu, name, configure) => {
  await headerMenu(page, menu);
  // Match on the name as a prefix only. Items carry a trailing ellipsis when they open a dialog
  // and an accelerator when they have one — 'Invert Colors⌘⇧I' has no separator before it — so
  // anchoring the end of the label excludes exactly the entries that have a keyboard shortcut.
  const item = page
    .locator('.header-cluster-end .popover .menu-item')
    .filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
  await item.first().scrollIntoViewIfNeeded();
  await item.first().click();
  const dialog = page.getByRole('dialog', { name });
  // Several adjustments apply straight from the menu and never open a dialog.
  if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
    if (configure) await configure(dialog);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  await settle(page);
};

const tool = async (page, name) => {
  // The toolbox is a scrolling column: at the 960x640 viewport the page shots use, the lower
  // tools sit below the fold and a plain click never reaches them.
  const button = page.locator('.toolbox').getByRole('button', { name, exact: true });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await settle(page);
};

const option = (page, label, value) => page.locator(`select[aria-label="${label}"]`).selectOption({ label: value });

const setPrimaryHex = async (page, value) => {
  await page.getByRole('button', { name: 'Click to select primary color.', exact: true }).first().click();
  const dialog = page.locator('.pinta-dialog').last();
  await dialog.waitFor();
  const hex = dialog.getByLabel('Hex', { exact: true });
  await hex.fill(value);
  await hex.press('Enter');
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  }
  await dialog.waitFor({ state: 'hidden' });
};

const drag = async (page, points) => {
  const canvas = page.locator('.canvas-stack canvas').first();
  const box = await canvas.boundingBox();
  const at = ([x, y]) => [box.x + x, box.y + y];
  const [startX, startY] = at(points[0]);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    const [x, y] = at(point);
    await page.mouse.move(x, y, { steps: 12 });
  }
  await page.mouse.up();
};

const addLayer = async (page) => {
  await page.keyboard.press('Escape');
  await settle(page);
  await page.getByRole('button', { name: 'Add New Layer', exact: true }).first().click();
  await settle(page);
};

const renameActiveLayer = async (page, name) => {
  await page.getByRole('button', { name: 'Layer Properties (F4)', exact: true }).click();
  const dialog = page.locator('.pinta-dialog').last();
  await dialog.waitFor();
  await dialog.getByLabel('Layer name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await settle(page);
};

/** The glitch pack, hexagon pixelate and night vision are all opt-in; the gallery needs them. */
const enableAddins = async (page) => {
  await page.locator('.macos-menu-button[data-menu-name="addins"]').click();
  await page
    .locator('.macos-menu-anchor.active .menu-item')
    .filter({ hasText: /Add-in Manager/ })
    .click();
  const manager = page.getByRole('dialog', { name: 'Add-in Manager' });
  await manager.waitFor();
  await manager.getByRole('button', { name: 'Enable all' }).click();
  await manager.getByRole('button', { name: 'Done' }).click();
  await manager.waitFor({ state: 'hidden' });
  await settle(page);
};

/* ------------------------------------------------------------ composition */

/**
 * A flat comic panel: yellow ground, magenta disc, cyan bar, black caption, hard outline.
 *
 * Pop art is flat and hard-edged, so everything here is a filled shape rather than a gradient or
 * a render effect. Each element gets its own layer, which is what lets the later treatments be
 * applied to the flattened result while the Layers dock still shows a real stack.
 */
async function composePanel(page) {
  // Ground: the bucket over the whole canvas, not a shape, so the fill is genuinely flat.
  await tool(page, 'Paint Bucket');
  await setPrimaryHex(page, '#ffd500');
  await drag(page, [
    [40, 40],
    [40, 40],
  ]);
  await settle(page);
  await renameActiveLayer(page, 'Ground');

  await addLayer(page);
  await tool(page, 'Ellipse');
  await option(page, 'Fill style', 'Fill Shape');
  await setPrimaryHex(page, '#ff2d95');
  await drag(page, [
    [330, 70],
    [600, 340],
  ]);
  await page.keyboard.press('Enter');
  await settle(page);
  await renameActiveLayer(page, 'Disc');

  await addLayer(page);
  await tool(page, 'Rectangle');
  await option(page, 'Fill style', 'Fill Shape');
  await setPrimaryHex(page, '#00c2ff');
  await drag(page, [
    [70, 250],
    [430, 370],
  ]);
  await page.keyboard.press('Enter');
  await settle(page);
  await renameActiveLayer(page, 'Bar');

  await addLayer(page);
  await tool(page, 'Text');
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('52');
  await option(page, 'Font weight', 'Bold 700');
  await setPrimaryHex(page, '#12121a');
  await page
    .locator('.canvas-stack canvas')
    .first()
    .click({ position: { x: 84, y: 268 } });
  await page.locator('.canvas-text-editor').waitFor();
  await page.keyboard.insertText('POP!');
  await settle(page);
  await page.getByRole('button', { name: 'Commit text', exact: true }).click();
  await settle(page);
  await renameActiveLayer(page, 'Caption');
}

/* ---------------------------------------------------------------- capture */

const shots = [];
const capture = async (page, name, locator) => {
  await settle(page);
  await (locator ?? page).screenshot({ path: join(staging, `${name}.png`) });
  shots.push(name);
  console.log(`  captured ${name}`);
};

async function main() {
  const browser = await chromium.launch();
  // The app follows prefers-color-scheme, and a page created without one renders light. Every
  // existing About capture except editor-light is dark, so the context has to ask for dark the
  // way playwright.config.ts does — otherwise the hero comes back light under the name 'dark'.
  const page = await browser.newPage({ viewportSize: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'dark' });
  await page.goto(base);
  await page.locator('.app-shell').waitFor();
  await page.locator('.canvas-stack canvas').first().waitFor();
  await settle(page);

  console.log('enabling add-ins…');
  await enableAddins(page);

  console.log('composing the panel…');
  await composePanel(page);

  const canvas = page.locator('.canvas-stack canvas').first();
  await tool(page, 'Paintbrush');
  await capture(page, 'pop-workspace');
  await capture(page, 'pop-original', canvas);

  // Flatten before treating. Effects apply to the active layer, and with the four-layer stack
  // still live that was the caption alone — the first hexagon-pixelate pass turned the word POP
  // into hexagons and left the rest of the panel untouched. Warhol's variants treat the whole
  // picture, so the panel is merged down first and every frame below is a full-image treatment.
  await page.keyboard.press('Control+Shift+F');
  await settle(page);

  // One subject, many treatments. Each entry is undone before the next so every frame differs
  // from the original by exactly one effect.
  const treatments = [
    ['pop-halftone', 'Effects', 'Hexagon Pixelate', undefined],
    ['pop-scanlines', 'Effects', 'Scanlines', undefined],
    [
      // Every channel offset defaults to zero, so this effect is a no-op until it is driven —
      // the first capture came out byte-identical to the untreated panel. Splitting red and blue
      // in opposite directions gives the colour fringe the effect exists for.
      'pop-aberration',
      'Effects',
      'Chromatic Aberration',
      async (dialog) => {
        // The dialog groups the six controls by channel, so all three pairs are labelled just
        // 'Offset X' / 'Offset Y' and have to be reached positionally: red, green, then blue.
        const offsets = dialog.getByRole('spinbutton');
        await offsets.nth(0).fill('14');
        await offsets.nth(3).fill('6');
        await offsets.nth(4).fill('-14');
      },
    ],
    ['pop-artifacts', 'Effects', 'Colored Artifacts', undefined],
    [
      'pop-nightvision',
      'Effects',
      'Night Vision',
      async (dialog) => {
        const noise = dialog.getByRole('spinbutton', { name: 'Noise', exact: true });
        if (await noise.count()) await noise.fill('25');
      },
    ],
    ['pop-inksketch', 'Effects', 'Ink Sketch', undefined],
    ['pop-oilpaint', 'Effects', 'Oil Painting', undefined],
    [
      'pop-posterize',
      'Adjustments',
      'Posterize',
      async (dialog) => {
        const spin = dialog.getByRole('spinbutton').first();
        if (await spin.count()) await spin.fill('3');
      },
    ],
    ['pop-invert', 'Adjustments', 'Invert Colors', undefined],
  ];

  console.log('capturing treatments…');
  for (const [name, menu, effect, configure] of treatments) {
    await applyEffect(page, menu, effect, configure);
    await capture(page, name, canvas);
    await page.keyboard.press('Control+z');
    await settle(page);
  }

  // ---------------------------------------------------------------- page shots
  //
  // The nine screenshots the About page already had came from the visual-regression suite, which
  // photographs a blank white canvas on purpose: a synthetic subject is what makes a pixel diff
  // trustworthy. On a landing page it reads as an empty program. The hero was a white rectangle
  // and one 'Background' layer; the frame captioned as showing selections had no visible
  // selection in it at all. These retake them against the panel, at the sizes the markup already
  // declares so the dimensions keep matching.

  // Undo back to the flattened panel, then rebuild the stack view by undoing the flatten too.
  await page.keyboard.press('Control+z');
  await settle(page);

  console.log('retaking the page screenshots…');
  await tool(page, 'Paintbrush');
  await page.setViewportSize({ width: 1200, height: 800 });
  await capture(page, 'editor-dark');

  await page.setViewportSize({ width: 960, height: 640 });

  // A selection you can actually see: the ellipse marquee sits over the disc, not empty white.
  await tool(page, 'Ellipse Select');
  await drag(page, [
    [250, 60],
    [520, 300],
  ]);
  await capture(page, 'selections');
  await page.keyboard.press('Control+Shift+A');
  await settle(page);

  // The old text frame used 11px grey on white and was illegible at page scale.
  await tool(page, 'Text');
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('40');
  await option(page, 'Font weight', 'Bold 700');
  await setPrimaryHex(page, '#12121a');
  await page
    .locator('.canvas-stack canvas')
    .first()
    .click({ position: { x: 70, y: 120 } });
  await page.locator('.canvas-text-editor').waitFor();
  await page.keyboard.insertText('EDIT ME');
  await capture(page, 'text-editor');
  // Escape leaves the box committed rather than discarding it, so the word survived into every
  // later frame and the panel ended up carrying two captions. Undo drops it for good.
  await page.keyboard.press('Escape');
  await settle(page);
  await page.keyboard.press('Control+z');
  await settle(page);

  // The effects menu over real artwork rather than over white.
  await tool(page, 'Paintbrush');
  await headerMenu(page, 'Effects');
  await capture(page, 'effects-library');
  await page.keyboard.press('Escape');
  await settle(page);

  await headerMenu(page, 'View');
  await page
    .locator('.header-cluster-end .popover .menu-item')
    .filter({ hasText: /^Light/ })
    .click();
  await page.locator('.app-shell.theme-light').waitFor();
  // The class lands before the repaint, and a capture taken on that signal alone came back with
  // dark chrome. Wait for the shell to actually be light before photographing it.
  await page.waitForFunction(() => {
    const shell = document.querySelector('.app-shell');
    if (!shell) return false;
    const [r, g, b] = getComputedStyle(shell).backgroundColor.match(/\d+/g).map(Number);
    return (r + g + b) / 3 > 140;
  });
  await capture(page, 'editor-light');
  await headerMenu(page, 'View');
  await page.locator('.header-cluster-end .popover .menu-item').filter({ hasText: /^Dark/ }).click();
  await page.locator('.app-shell.theme-dark').waitFor();
  await settle(page);

  // Curves is deliberately not retaken. Its existing capture is the full dialog — title bar,
  // description, Apply button — and a retake at this viewport renders the compact variant, which
  // is a worse picture of the same feature. It was never one of the empty-canvas frames.

  await browser.close();

  console.log('converting to webp…');
  for (const name of shots) {
    execFileSync('cwebp', ['-quiet', '-q', '85', join(staging, `${name}.png`), '-o', join(outDir, `${name}.webp`)]);
  }
  rmSync(staging, { recursive: true, force: true });
  console.log(`wrote ${shots.length} files to ${outDir.slice(root.length + 1)}`);
}

await main();
