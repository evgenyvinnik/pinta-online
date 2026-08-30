import type { Page } from '@playwright/test';
import { expect, test } from '../pageErrors';
import { EFFECT_DEFINITIONS } from '../../src/effects/types';

/**
 * Every configurable effect dialog, in both writing directions and at both viewport sizes.
 *
 * Section 6 of docs/final_polish.md asks for the English/RTL and desktop/constrained cross-product
 * to be completed. Doing that with screenshots would mean roughly a hundred and seventy new
 * baselines to review and re-approve on every unrelated style change, which buys accuracy about
 * pixels at the cost of anyone actually looking. These assert the properties that make a dialog
 * usable instead — it fits on screen, its buttons can be reached, it does not push the page
 * sideways, and it lays out in the direction it was told to. The existing screenshots stay as the
 * pixel record for a representative sample.
 *
 * RTL at a narrow width is the combination worth having: direction bugs and overflow bugs both
 * hide there, and they compound.
 */

const CONSTRAINED = { width: 390, height: 700 };
const DESKTOP = { width: 1440, height: 960 };

/**
 * Effects that open a configurable dialog rather than applying straight away, excluding the ones
 * that arrive with an add-in: those are off in a default install and are not in the menus, and the
 * add-in samples in the visual suite already cover them.
 */
const CONFIGURABLE = EFFECT_DEFINITIONS.filter(
  (effect) => !effect.addinId && (effect.parameters.length > 0 || effect.dialog),
);

async function waitForWorkspace(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-ready', 'true');
  await expect(page.locator('.canvas-stack canvas, .empty-workspace').first()).toBeVisible();
}

async function openEffect(page: Page, effect: (typeof CONFIGURABLE)[number]) {
  const menu = effect.category === 'adjustment' ? 'Adjustments' : 'Effects';
  await page.locator('.header-cluster-end').getByRole('button', { name: menu, exact: true }).click();
  const item = page
    .locator('.header-cluster-end .popover .menu-item')
    .filter({ hasText: new RegExp(`^${effect.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
  await item.first().scrollIntoViewIfNeeded();
  await item.first().click();
  return page.getByRole('dialog', { name: effect.name });
}

/**
 * The four things that make a dialog usable, checked together so a failure names the dialog, the
 * direction and the viewport rather than leaving that to be worked out from a screenshot diff.
 */
async function expectUsable(
  page: Page,
  dialogName: string,
  direction: 'ltr' | 'rtl',
  viewport: { width: number; height: number },
) {
  const where = `${dialogName} · ${direction} · ${viewport.width}x${viewport.height}`;
  const dialog = page.getByRole('dialog', { name: dialogName });
  await expect(dialog, `${where}: opens`).toBeVisible();

  const box = await dialog.boundingBox();
  expect(box, `${where}: has measurable bounds`).not.toBeNull();
  expect(box!.y, `${where}: top edge is on screen`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${where}: bottom edge is on screen`).toBeLessThanOrEqual(viewport.height + 1);
  expect(box!.x, `${where}: left edge is on screen`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${where}: right edge is on screen`).toBeLessThanOrEqual(viewport.width + 1);

  // Both buttons must be reachable, or the dialog is a trap.
  await expect(dialog.getByRole('button', { name: 'Cancel' }), `${where}: Cancel is reachable`).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'OK', exact: true });
  if (await confirm.count()) await expect(confirm, `${where}: OK is reachable`).toBeVisible();

  // A dialog must never make the page itself scroll sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${where}: page does not scroll sideways`).toBeLessThanOrEqual(0);

  expect(await page.locator('html').getAttribute('dir'), `${where}: lays out in the requested direction`).toBe(
    direction,
  );
}

for (const direction of ['ltr', 'rtl'] as const) {
  for (const viewport of [DESKTOP, CONSTRAINED]) {
    const label = viewport === DESKTOP ? 'desktop' : 'constrained';
    test(`every effect dialog stays usable in ${direction} at ${label} width`, async ({ page }) => {
      test.slow(); // Forty-odd dialogs opened and closed one at a time.
      await page.setViewportSize(viewport);
      await page.goto('/');
      await waitForWorkspace(page);
      await page.evaluate((dir) => {
        document.documentElement.dir = dir;
      }, direction);

      // Without this the suite would pass silently if the filter above ever stopped matching, which
      // is the failure mode a generated loop is most likely to have.
      expect(CONFIGURABLE.length, 'configurable effect dialogs to sweep').toBeGreaterThan(35);

      for (const effect of CONFIGURABLE) {
        const dialog = await openEffect(page, effect);
        await expectUsable(page, effect.name, direction, viewport);
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
      }
    });
  }
}
