#!/usr/bin/env node
/**
 * Reports how each web screenshot compares with the native Pinta capture it was modelled on.
 *
 * Section 6 of docs/final_polish.md asks for automated perceptual native-versus-web comparisons.
 * This is the tool that was built for it, and it is **a report, not a gate** — because the gate was
 * attempted and does not work. That negative result is the useful part, so it is recorded here
 * rather than in a commit message nobody will find.
 *
 * The two cannot be compared pixel for pixel: GTK and a browser rasterise text, borders and
 * gradients differently. So the attempt was coarse layout — reduce both images to a grid of average
 * luminance and correlate them, on the theory that antialiasing vanishes at that scale while
 * structure survives. Across the 26 full-window pairs that share an exact size, genuine pairs
 * correlate 0.656 to 0.985, which looks like a usable band.
 *
 * It is not. Falsifying it by pointing the comparison at the *wrong* screen — native
 * `workspace-selection` against web `menubar-help`, both 1440x960 — scores **0.942**, higher than
 * the lowest genuine pair. Raising the grid from 16 to 32 to 64 makes it worse, not better: the
 * genuine floor falls to 0.420 while the wrong pairing stays near 0.944. A second design, comparing
 * each screen's *difference from the default workspace* so the shared chrome cancels, also fails:
 * genuine pairs spread from -0.123 to 0.956 and the wrong pairing lands at -0.019, mid-band.
 *
 * The reason is structural. Both images are a Pinta-shaped window, and the difference between GTK
 * and a browser rendering the same screen is larger than the difference between two screens. Any
 * threshold that passes the real pairs also passes the wrong one, so a check built on this would
 * report success for anything and be worse than no check at all.
 *
 * What it is good for is ranking, which is what a person actually wants when asking "does this still
 * look like Pinta": the table sorts every pair by agreement, so the ones that have moved come to the
 * top. Chromium decodes the PNGs, because it is already a dependency and nothing else here can read
 * one.
 *
 * A comparison that could gate would need to find corresponding features — toolbar, canvas, docks —
 * and check their arrangement, rather than treating the window as a bag of luminance.
 */
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const nativeDir = path.join(root, 'tests/visual/pinta-reference');
const webDir = path.join(root, 'tests/visual/__screenshots__/chromium');

/** Grid resolution. Coarse enough to erase rendering, fine enough to see structure. */
const GRID = 16;

/**
 * A pair is comparable when both images are the same full application window. Height matters as
 * much as width: the `tool-*` captures are 1440x48 option strips, full width but almost no
 * structure, and they correlate as low as 0.032 while being perfectly correct.
 */
const FULL_WINDOW = { width: 1000, height: 500 };

/** Average luminance per grid cell, plus the image's real dimensions. */
async function describe(page, file) {
  const data = readFileSync(file).toString('base64');
  return page.evaluate(
    async ({ data: base64, grid }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = grid;
      canvas.height = grid;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      // Scaling to the grid is the averaging step; the browser's own filtering does the work.
      context.drawImage(image, 0, 0, grid, grid);
      const { data: pixels } = context.getImageData(0, 0, grid, grid);
      const cells = [];
      for (let index = 0; index < pixels.length; index += 4) {
        cells.push(0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]);
      }
      return { width: image.naturalWidth, height: image.naturalHeight, cells };
    },
    { data, grid: GRID },
  );
}

function correlation(left, right) {
  const n = left.length;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / n;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (let index = 0; index < n; index += 1) {
    const a = left[index] - meanLeft;
    const b = right[index] - meanRight;
    covariance += a * b;
    varianceLeft += a * a;
    varianceRight += b * b;
  }
  const denominator = Math.sqrt(varianceLeft * varianceRight);
  // A flat image has no variance to correlate; two flat images agree.
  if (denominator === 0) return varianceLeft === varianceRight ? 1 : 0;
  return covariance / denominator;
}

const nativeFiles = new Set(readdirSync(nativeDir).filter((file) => file.endsWith('.png')));
const names = readdirSync(webDir)
  .filter((file) => file.endsWith('.png') && nativeFiles.has(file))
  .sort();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');

const rows = [];
for (const name of names) {
  const [native, web] = await Promise.all([
    describe(page, path.join(nativeDir, name)),
    describe(page, path.join(webDir, name)),
  ]);
  const sameSize = native.width === web.width && native.height === web.height;
  rows.push({
    name,
    native,
    web,
    sameSize,
    comparable: sameSize && native.width >= FULL_WINDOW.width && native.height >= FULL_WINDOW.height,
    layout: correlation(native.cells, web.cells),
  });
}
await browser.close();

rows.sort((a, b) => a.layout - b.layout);
console.log('layout  same-size  pair');
for (const row of rows) {
  console.log(
    `${row.layout.toFixed(3).padStart(6)}  ${(row.comparable ? 'yes' : 'no').padStart(9)}  ${row.name}` +
      `  (${row.native.width}x${row.native.height} vs ${row.web.width}x${row.web.height})`,
  );
}

const compared = rows.filter((row) => row.comparable);
console.log(`\n${compared.length} of ${rows.length} pairs are full-window captures at matching size.`);
if (compared.length) {
  const low = compared.reduce((least, row) => (row.layout < least.layout ? row : least));
  const high = compared.reduce((most, row) => (row.layout > most.layout ? row : most));
  console.log(
    `Their agreement runs ${low.layout.toFixed(3)} (${low.name}) to ${high.layout.toFixed(3)} (${high.name}).`,
  );
}
console.log(
  '\nRanking only. See the comment at the top of this file for why this cannot be turned into a\n' +
    'pass/fail check: a deliberately mismatched pair scores higher than the lowest genuine one.',
);
