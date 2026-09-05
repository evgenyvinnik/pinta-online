import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '../pageErrors';

let output: string;
test.beforeAll(() => {
  output = mkdtempSync(path.join(tmpdir(), 'pinta-review-browser-'));
  for (const script of ['scripts/build-visual-review.mjs', 'scripts/build-translation-review.mjs']) {
    execFileSync(process.execPath, [script], { env: { ...process.env, PINTA_REVIEW_OUTPUT: output } });
  }
});
test.afterAll(() => {
  if (output) rmSync(output, { recursive: true, force: true });
});

test('filters native evidence and preserves screenshot proportions at fit and actual size', async ({
  page,
  browserName,
}) => {
  // The report is written to a temp directory and points at screenshots that live in the repo, so
  // every img src climbs out of the document's own directory. WebKit refuses to load a file://
  // subresource from outside that directory, and the images reject with EncodingError before any
  // of the geometry below can be measured. The report renders correctly there when it is served
  // over HTTP; it is only the file:// path this cannot exercise.
  test.skip(browserName === 'webkit', 'WebKit blocks file:// subresources outside the document directory');
  await page.goto(pathToFileURL(path.join(output, 'manual-comparison.html')).href);
  await page.getByRole('searchbox').fill('workspace-default-dark');
  const card = page.locator('article:not(.hidden)');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-missing', 'false');
  for (const actual of [false, true]) {
    await page.getByLabel('Actual pixels (scroll)').setChecked(actual);
    const images = await card.locator('img').all();
    expect(images).toHaveLength(2);
    for (const image of images) {
      const dimensions = await image.evaluate(async (element: HTMLImageElement) => {
        await element.decode();
        const box = element.getBoundingClientRect();
        return {
          rendered: box.width / box.height,
          original: element.naturalWidth / element.naturalHeight,
          width: box.width,
          naturalWidth: element.naturalWidth,
        };
      });
      expect(dimensions.rendered).toBeCloseTo(dimensions.original, 3);
      if (actual) expect(dimensions.width).toBe(dimensions.naturalWidth);
    }
  }
  await page.getByLabel('Missing references only').check();
  await expect(card).toHaveCount(0);
});

test('exports revision-bound translation corrections without claiming fluent approval', async ({ page }) => {
  await page.goto(pathToFileURL(path.join(output, 'ru.html')).href);
  await page.getByLabel('Reviewer name').fill('Automated test, not a reviewer');
  await page.getByLabel('Review message 1', { exact: true }).selectOption('change');
  await page.getByLabel('Notes for message 1', { exact: true }).fill('Test correction');
  await expect(page.getByRole('status')).toContainText('1 / 98 examined');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download review JSON' }).click(),
  ]);
  const result = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(result.status).toBe('incomplete');
  expect(result.fluent).toBe(false);
  expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
  expect(result.entries[0]).toMatchObject({ decision: 'change', notes: 'Test correction' });
  expect(result.entries[1].decision).toBe('pending');
});
