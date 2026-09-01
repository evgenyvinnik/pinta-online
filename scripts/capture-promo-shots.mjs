#!/usr/bin/env node
/**
 * Captures the marketing screenshots used by /promo/.
 *
 * The visual suite's screenshots exist to make pixel regressions obvious, so they are
 * deliberately synthetic: an empty white canvas, or a saturated test pattern. That is the
 * right choice for a diff and the wrong one for a landing page — it shows the UI without
 * showing what the UI is for.
 *
 * So this drives the real editor with an original "Cosmic Garden" illustration, then turns it
 * into a campaign inside Pinta Online: a precise portal halo, a graphic signal line, and live
 * typography on four named layers. Everything on screen is genuine application output; the UI
 * is never mocked or painted in afterwards.
 *
 * Usage: node scripts/capture-promo-shots.mjs [--base http://localhost:4173] [--out web-assets/promo]
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
const outDir = resolve(root, argOf('--out', 'web-assets/promo'));
const staging = mkdtempSync(join(tmpdir(), 'promo-shots-'));
const artwork = resolve(root, 'web-assets/source/cosmic-garden.png');

const VIEWPORT = { width: 1440, height: 960 };

/* ---------------------------------------------------------------- helpers */

const settle = async (page) => {
  await page
    .locator('.pinta-dialog')
    .filter({ hasText: 'Rendering Effect' })
    .waitFor({ state: 'hidden', timeout: 30_000 })
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

const openEffect = async (page, menu, name) => {
  await headerMenu(page, menu);
  const item = page.locator('.effect-menu-popover .menu-item').filter({ hasText: new RegExp(`^${name}(?:…|$)`) });
  await item.scrollIntoViewIfNeeded();
  await item.click();
  const dialog = page.getByRole('dialog', { name });
  await dialog.waitFor();
  return dialog;
};

const applyEffect = async (page, menu, name, configure) => {
  const dialog = await openEffect(page, menu, name);
  if (configure) await configure(dialog);
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.history-row.active').filter({ hasText: name }).waitFor();
  await settle(page);
};

const tool = async (page, name) => {
  await page.getByRole('button', { name, exact: true }).click();
  await settle(page);
};

// Scoped to <select>: several option labels ('Gradient') also name a tool button.
/** The width control is 'Outline width' on shapes and 'Brush width' on strokes. */
const setStrokeWidth = async (page, width) => {
  for (const label of ['Outline width', 'Brush width']) {
    const box = page.getByRole('spinbutton', { name: label, exact: true });
    if (await box.count()) {
      await box.fill(String(width));
      return;
    }
  }
};

const option = (page, label, value) => page.locator(`select[aria-label="${label}"]`).selectOption({ label: value });

/** Enter in the hex field submits the dialog, so it may already be gone by the time we look. */
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

const setSecondaryHex = async (page, value) => {
  await page.getByRole('button', { name: 'Click to select secondary color.', exact: true }).click();
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

/** Drags through canvas-element-relative points with one pointer. */
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
  // A live shape or text box keeps the dock busy; commit it before touching the layer stack.
  await page.keyboard.press('Escape');
  await settle(page);
  await page.getByRole('button', { name: 'Add New Layer', exact: true }).first().click();
  await settle(page);
};

const renameActiveLayer = async (page, name) => {
  // Two controls match /Layer Properties/: this is the dock's icon button, not the menu item.
  await page.getByRole('button', { name: 'Layer Properties (F4)', exact: true }).click();
  const dialog = page.locator('.pinta-dialog').last();
  await dialog.waitFor();
  const field = dialog.getByLabel('Layer name', { exact: true });
  await field.fill(name);
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await settle(page);
};

/* ------------------------------------------------------------ composition */

/**
 * Builds the campaign every later capture is photographed against. The illustration is an
 * original source asset, while its portal halo, signal line, and headline are created with the
 * real shape, line, and text tools. The Layers dock therefore tells the same story as the canvas.
 */
async function composeArtwork(page, step) {
  await page.keyboard.press('Control+W');
  await page.locator('input[type="file"][multiple]').setInputFiles(artwork);
  await page.locator('.app-shell[data-active-document="cosmic-garden.png"]').waitFor();
  await settle(page);
  await renameActiveLayer(page, 'Cosmic Garden');
  await step('step-backdrop');

  await addLayer(page);
  await tool(page, 'Ellipse');
  await option(page, 'Fill style', 'Outline Shape');
  await setStrokeWidth(page, 7);
  await setPrimaryHex(page, '#ffe0a3');
  await drag(page, [
    [310, 10],
    [600, 300],
  ]);
  await page.keyboard.press('Enter');
  await settle(page);
  await renameActiveLayer(page, 'Portal Halo');
  await step('step-circle');

  await addLayer(page);
  await tool(page, 'Line / Curve');
  await setStrokeWidth(page, 8);
  await setPrimaryHex(page, '#70e1bd');
  await drag(page, [
    [58, 236],
    [258, 236],
  ]);
  await page.keyboard.press('Enter');
  await settle(page);
  await renameActiveLayer(page, 'Signal Line');
  await step('step-shapes');

  await addLayer(page);
  await tool(page, 'Text');
  await page.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('36');
  await option(page, 'Font weight', 'Bold 700');
  await setPrimaryHex(page, '#fff0c9');
  const canvas = page.locator('.canvas-stack canvas').first();
  await canvas.click({ position: { x: 55, y: 76 } });
  await page.locator('.canvas-text-editor').waitFor();
  // insertText, not keyboard.type: the on-canvas editor does not receive synthesized keydowns.
  await page.keyboard.insertText('MAKE\nSOMETHING\nSTRANGE');
  await settle(page);
  await page.getByRole('button', { name: 'Commit text', exact: true }).click();
  await settle(page);
  await renameActiveLayer(page, 'Headline');
  await step('step-headline');
}

/* ---------------------------------------------------------------- capture */

const shots = [];
const capture = async (page, name, locator) => {
  await settle(page);
  const target = locator ?? page;
  await target.screenshot({ path: join(staging, `${name}.png`) });
  shots.push(name);
  console.log(`  captured ${name}`);
};

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewportSize: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'dark' });
  await page.goto(base);
  await page.locator('.app-shell').waitFor();
  await page.locator('.canvas-stack canvas').first().waitFor();
  await settle(page);

  const canvas = page.locator('.canvas-stack canvas').first();
  console.log('composing artwork…');
  await composeArtwork(page, (name) => capture(page, name, canvas));

  console.log('capturing…');
  await tool(page, 'Paintbrush');
  await capture(page, 'workspace-dark');

  // Selections, drawn over the finished artwork rather than a test pattern.
  await tool(page, 'Rectangle Select');
  await drag(page, [
    [405, 300],
    [635, 480],
  ]);
  await capture(page, 'select-rectangle', canvas);

  await tool(page, 'Ellipse Select');
  await drag(page, [
    [300, 5],
    [610, 320],
  ]);
  await capture(page, 'select-ellipse', canvas);

  await page.locator('.layer-row').filter({ hasText: 'Portal Halo' }).click();
  await tool(page, 'Magic Wand Select');
  await canvas.click({ position: { x: 310, y: 150 } });
  await capture(page, 'select-magic-wand', canvas);

  await page.keyboard.press('Control+Shift+A'); // deselect before drawing
  await settle(page);

  // Drawing tools, on a scratch layer above the picture so the artwork survives for the
  // effect captures below.
  await addLayer(page);
  await setPrimaryHex(page, '#ff6f91');
  await tool(page, 'Line / Curve');
  // Hairlines vanish at card size; these strokes are sized to read in a thumbnail.
  await setStrokeWidth(page, 9);
  await drag(page, [
    [80, 345],
    [285, 205],
    [520, 95],
  ]);
  await page.keyboard.press('Enter');
  await capture(page, 'draw-line', canvas);
  await page.keyboard.press('Control+z');
  await settle(page);

  await tool(page, 'Freeform Shape');
  await setPrimaryHex(page, '#70e1bd');
  await setStrokeWidth(page, 8);
  await drag(page, [
    [430, 320],
    [535, 290],
    [625, 360],
    [595, 455],
    [465, 470],
    [430, 320],
  ]);
  await page.keyboard.press('Enter');
  await capture(page, 'draw-freeform', canvas);
  await page.keyboard.press('Control+z');
  await settle(page);

  // A gradient fills its whole layer, which would bury the artwork. Confining it to a
  // selection shows the tool and the picture in the same frame.
  await tool(page, 'Rectangle Select');
  await drag(page, [
    [390, 285],
    [650, 490],
  ]);
  await tool(page, 'Gradient');
  await option(page, 'Gradient', 'Radial Gradient');
  await setPrimaryHex(page, '#ff6f91cc');
  await setSecondaryHex(page, '#ffcf6600');
  await drag(page, [
    [535, 385],
    [650, 490],
  ]);
  await capture(page, 'gradient-radial', canvas);
  await page.keyboard.press('Control+z');
  await settle(page);
  // Undo the gradient before deselecting. Reversing those operations restores the selection
  // from history and accidentally confines every later "whole picture" effect to this corner.
  await page.keyboard.press('Control+Shift+A');
  await settle(page);
  await page.getByRole('button', { name: 'Delete Layer', exact: true }).click();
  await settle(page);

  // Adjustments and effects are shown by what they do to the picture. A modal dims and
  // blurs whatever is behind it, so a whole-window shot of an open dialog sells the artwork
  // badly; the menu crops elsewhere on the page already prove the controls exist.
  //
  // Flatten first. An effect applies to the active layer, so on the layered document it
  // repaints the backdrop and leaves the shapes and headline crisp on top of it — which
  // reads as "nothing happened" at thumbnail size.
  await page.locator('.macos-menu-bar').getByRole('menuitem', { name: 'Image', exact: true }).click();
  await page
    .locator('.macos-menu-anchor.active .macos-menu-popover .menu-item')
    .filter({ hasText: /^Flatten/ })
    .click();
  await settle(page);

  for (const [name, menu, effect, configure] of [
    [
      'effect-oil-painting',
      'Effects',
      'Oil Painting',
      async (dialog) => {
        await dialog.getByRole('spinbutton', { name: 'Brush Size', exact: true }).fill('6');
      },
    ],
    [
      'effect-motion-blur',
      'Effects',
      'Motion Blur',
      async (dialog) => {
        await dialog.getByRole('spinbutton', { name: 'Distance', exact: true }).fill('45');
      },
    ],
    [
      'adjust-hue-saturation',
      'Adjustments',
      'Hue / Saturation',
      async (dialog) => {
        await dialog.getByRole('spinbutton', { name: 'Hue', exact: true }).fill('120');
      },
    ],
    ['effect-pencil-sketch', 'Effects', 'Pencil Sketch', undefined],
  ]) {
    await applyEffect(page, menu, effect, configure);
    await capture(page, name, canvas);
    await page.keyboard.press('Control+z');
    await settle(page);
  }

  // Light theme and a narrow window, both on the same artwork.
  await headerMenu(page, 'View');
  await page
    .locator('.header-cluster-end .popover .menu-item')
    .filter({ hasText: /^Light/ })
    .click();
  await page.locator('.app-shell.theme-light').waitFor();
  await capture(page, 'workspace-light');

  await headerMenu(page, 'View');
  await page.locator('.header-cluster-end .popover .menu-item').filter({ hasText: /^Dark/ }).click();
  await page.locator('.app-shell.theme-dark').waitFor();
  await page.setViewportSize({ width: 800, height: 720 });
  await capture(page, 'workspace-narrow');

  await browser.close();

  // q85, not lossless: these frames are photographic, and lossless triples the page weight
  // for a difference invisible even on the dock's 11px labels.
  console.log('converting to webp…');
  for (const name of shots) {
    execFileSync('cwebp', ['-quiet', '-q', '85', join(staging, `${name}.png`), '-o', join(outDir, `${name}.webp`)]);
  }
  rmSync(staging, { recursive: true, force: true });
  console.log(`wrote ${shots.length} files to ${outDir.slice(root.length + 1)}`);
}

await main();
