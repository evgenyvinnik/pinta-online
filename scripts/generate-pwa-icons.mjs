import { access, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'original/Pinta.Resources/icons/hicolor/scalable/apps/com.github.PintaProject.Pinta.svg');
const outputDirectory = resolve(root, 'public/icons');
const source = await readFile(sourcePath, 'utf8');

const dimension = (name) => {
  const match = source.match(new RegExp(`\\b${name}="([0-9.]+)(?:px)?"`));
  if (!match) throw new Error(`The original Pinta icon has no ${name} attribute.`);
  return Number(match[1]);
};

const width = dimension('width');
const height = dimension('height');
const svg = /<svg\b[^>]*\bviewBox=/.test(source)
  ? source
  : source.replace('<svg', `<svg viewBox="0 0 ${width} ${height}"`);
const browserCandidates = [
  process.env.PINTA_CHROMIUM_PATH,
  chromium.executablePath(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  process.env.PROGRAMFILES ? resolve(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe') : undefined,
].filter(Boolean);
let executablePath;
for (const candidate of browserCandidates) {
  try {
    await access(candidate);
    executablePath = candidate;
    break;
  } catch {
    // Try the next known browser location.
  }
}
if (!executablePath) {
  throw new Error('No Chromium browser found. Run `npx playwright install chromium` or set PINTA_CHROMIUM_PATH.');
}
const browser = await chromium.launch({
  headless: true,
  executablePath,
});

await mkdir(outputDirectory, { recursive: true });
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`
      <style>
        html, body { width: ${size}px; height: ${size}px; margin: 0; overflow: hidden; background: transparent; }
        svg { display: block; width: ${size}px; height: ${size}px; }
      </style>
      ${svg}
    `);
    await page.screenshot({
      path: resolve(outputDirectory, `pinta-${size}.png`),
      omitBackground: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log('Generated PWA icons from the original Pinta SVG.');
