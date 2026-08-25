import { expect, test, type Page } from '@playwright/test';

async function openAbout(page: Page) {
  await page.goto('/about/');
  await page.waitForFunction(async () => {
    await document.fonts.ready;
    return [...document.images].every((image) => image.complete && image.naturalWidth > 0);
  });
}

async function openGuide(page: Page) {
  await page.goto('/user-guide/');
  await page.waitForFunction(async () => {
    await document.fonts.ready;
    const hero = document.querySelector<HTMLImageElement>('.hero-shot img');
    return Boolean(hero?.complete && hero.naturalWidth > 0);
  });
}

test.describe('about page', () => {
  test('desktop hero', async ({ page }) => {
    await openAbout(page);
    await expect(page).toHaveScreenshot('about-desktop-hero.png');
  });

  test('feature screenshot gallery', async ({ page }) => {
    await openAbout(page);
    await expect(page.locator('.detail-gallery')).toHaveScreenshot('about-feature-gallery.png');
  });

  test('mobile hero', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAbout(page);
    await expect(page).toHaveScreenshot('about-mobile-hero.png');
  });

  test('Arabic RTL localized hero', async ({ page }) => {
    await page.goto('/ar/about/');
    await page.waitForFunction(async () => {
      await document.fonts.ready;
      return [...document.images].every((image) => image.complete && image.naturalWidth > 0);
    });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('جاهزة في متصفحك');
    await expect(page).toHaveScreenshot('about-ar-rtl-hero.png');
  });
});

test.describe('user guide', () => {
  test('desktop hero', async ({ page }) => {
    await openGuide(page);
    await expect(page).toHaveScreenshot('guide-desktop-hero.png');
  });

  test('magic-wand selection chapter', async ({ page }) => {
    await openGuide(page);
    const chapter = page.locator('#selections');
    await chapter.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>('#selections img');
      return Boolean(image?.complete && image.naturalWidth > 0);
    });
    // Chromium's high-quality downsampling of the 1440 px embedded editor image can
    // vary by a few pixels between raster passes. Keep the chapter layout strict
    // while allowing only that sub-percent resampling noise.
    await expect(chapter).toHaveScreenshot('guide-selection-chapter.png', { maxDiffPixelRatio: 0.005 });
  });

  test('mobile hero and contents', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGuide(page);
    await page.locator('.mobile-contents').evaluate((details: HTMLDetailsElement) => { details.open = true; });
    await expect(page).toHaveScreenshot('guide-mobile-hero.png');
  });
});
