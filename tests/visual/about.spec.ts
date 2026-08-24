import { expect, test, type Page } from '@playwright/test';

async function openAbout(page: Page) {
  await page.goto('/about/');
  await page.waitForFunction(async () => {
    await document.fonts.ready;
    return [...document.images].every((image) => image.complete && image.naturalWidth > 0);
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
