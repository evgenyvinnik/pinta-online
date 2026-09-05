import { chromium } from '@playwright/test';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Photograph a code-native layout containing an authentic editor capture, with no invented UI.
const source = new URL('../web-assets/social/github-preview.html', import.meta.url);
const output = fileURLToPath(new URL('../web-assets/social/github-preview.png', import.meta.url));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.goto(source.href);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
    for (const image of document.images) {
      const bounds = image.getBoundingClientRect();
      if (Math.abs(bounds.width / bounds.height - image.naturalWidth / image.naturalHeight) > 0.01) {
        throw new Error(`Distorted social-preview image: ${image.alt}`);
      }
    }
  });
  await page.screenshot({ path: output });
  const { size } = await stat(output);
  if (size >= 1_000_000) throw new Error(`GitHub preview must be under 1 MB, got ${size} bytes.`);
  console.log(`${output} · 1280×640 · ${size} bytes`);
} finally {
  await browser.close();
}
