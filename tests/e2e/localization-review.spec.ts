import { expect, test } from '../pageErrors';
import { readFileSync } from 'node:fs';

// Technical/context coverage only. These checks cannot certify a translator's fluency.
const previouslyReviewed = new Set(['en', 'fr', 'de', 'ar', 'he']);
const inventory = JSON.parse(
  readFileSync(new URL('../../src/i18n/locales.generated.json', import.meta.url), 'utf8'),
) as { locales: Array<{ code: string }> };
const locales = inventory.locales.map(({ code }) => code).filter((code) => !previouslyReviewed.has(code));

test.describe('translation review context', () => {
  for (const locale of locales) {
    test(`${locale}: localized add-in controls fit desktop and phone viewports`, async ({ page }, testInfo) => {
      const messages = JSON.parse(
        readFileSync(new URL(`../../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'),
      ) as Record<string, string>;
      await page.goto(`/${locale}/`);
      await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-ready', 'true');
      await expect(page.locator('.app-shell')).toHaveAttribute('data-locale', locale);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('.canvas-stack canvas').first()).toBeVisible();
      await testInfo.attach(`${locale}-workspace`, { body: await page.screenshot(), contentType: 'image/png' });

      await page.locator('[data-menu-name="addins"]').click();
      await page
        .locator('.macos-menu-anchor.active .menu-item')
        // Native gettext may translate the ellipsis-bearing menu label differently from
        // the web-only dialog title. Exercise both real strings; don't assume they match.
        .filter({ hasText: messages['Add-in Manager…'] ?? messages['Add-in Manager'] })
        .click();
      const dialog = page.getByRole('dialog', { name: messages['Add-in Manager'], exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: messages['Enable all'], exact: true })).toBeVisible();
      const done = dialog.getByRole('button', { name: messages.Done, exact: true });

      for (const size of [
        { width: 1440, height: 960 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(size);
        await expect
          .poll(
            async () => {
              const box = await dialog.boundingBox();
              return Boolean(
                box &&
                box.x >= 0 &&
                box.y >= 0 &&
                box.x + box.width <= size.width + 1 &&
                box.y + box.height <= size.height + 1,
              );
            },
            { message: `${locale} dialog stays within ${size.width}×${size.height}` },
          )
          .toBe(true);
        await expect(done).toBeInViewport();
        await expect
          .poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
          .toBe(true);
        await testInfo.attach(`${locale}-addins-${size.width}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      }
      // Exercise the translated action, not just the presence of a text node.
      await done.click();
      await expect(dialog).toBeHidden();
    });
  }
});
