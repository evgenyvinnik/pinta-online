import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../pageErrors';
import { TOOLS } from '../../src/editor/tools';

/**
 * The editor on a phone-sized touch device, at 390x844.
 *
 * Two things exist only for this shape and were previously unexercised: the `pointer: coarse`
 * block in styles.css that grows the controls people poke at, and the long-press gesture that
 * stands in for the right-click a touch screen has no way to send. Section 4 of
 * docs/final_polish.md asks for both to be proven.
 *
 * Gestures are dispatched as pointer events with `pointerType: 'touch'` because that is what the
 * editor listens to. Playwright's touchscreen API only taps, and driving `page.mouse` would send
 * `pointerType: 'mouse'` and silently miss every touch-only branch.
 */
async function waitForWorkspace(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-ready', 'true');
  await expect(page.locator('.canvas-stack canvas, .empty-workspace').first()).toBeVisible();
}

type Point = { x: number; y: number };

/**
 * Real touch events, sent through the DevTools protocol.
 *
 * Synthesized `PointerEvent`s are not enough here. `usePaintEditor.onPointerDown` calls
 * `setPointerCapture`, which throws for a pointer id the browser has no active pointer for, so a
 * dispatched event aborts the handler before anything is drawn. CDP generates genuine touch input
 * that becomes genuine pointer events, capture included.
 */
async function touchSession(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', point?: Point) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: point ? [{ x: point.x, y: point.y, id: 1 }] : [],
    });
  return {
    /** Element-relative whole-pixel coordinates, so both axes land on a real device pixel. */
    async pagepoint(target: Locator, offset: Point) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      expect(box, 'the element must be on screen to touch it').not.toBeNull();
      const point = { x: Math.round(box!.x + offset.x), y: Math.round(box!.y + offset.y) };
      // A touch outside the viewport lands on nothing and fails silently, which is far more
      // confusing than an assertion here.
      const size = page.viewportSize()!;
      expect(point.x, 'touch point is on screen horizontally').toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThan(size.width);
      expect(point.y, 'touch point is on screen vertically').toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThan(size.height);
      return point;
    },
    async drag(target: Locator, from: Point, to: Point, steps = 6) {
      const start = await this.pagepoint(target, from);
      const end = await this.pagepoint(target, to);
      await send('touchStart', start);
      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        await send('touchMove', {
          x: Math.round(start.x + (end.x - start.x) * ratio),
          y: Math.round(start.y + (end.y - start.y) * ratio),
        });
      }
      await send('touchEnd');
    },
    async hold(target: Locator, holdMs: number) {
      const box = (await target.boundingBox())!;
      const centre = await this.pagepoint(target, { x: box.width / 2, y: box.height / 2 });
      await send('touchStart', centre);
      await page.waitForTimeout(holdMs);
      await send('touchEnd');
    },
  };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForWorkspace(page);
});

test.describe('touch and coarse pointer', () => {
  test('reports itself as a coarse-pointer device so the touch rules apply', async ({ page }) => {
    // Everything below depends on this: if the media query does not match, the enlarged targets
    // and the callout suppression are not in play and the rest of the suite proves nothing.
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  });

  test('grows the controls people poke at to a usable size', async ({ page }) => {
    const button = await page.locator('.icon-button').first().boundingBox();
    expect(button).not.toBeNull();
    // styles.css sets a 34px minimum for icon buttons under pointer: coarse.
    expect(button!.width).toBeGreaterThanOrEqual(34);
    expect(button!.height).toBeGreaterThanOrEqual(34);

    // Menu rows are the other target the coarse rules grow, and unlike the layers dock they
    // are on screen at this width.
    await page.locator('.header-cluster-end').getByRole('button', { name: 'Effects', exact: true }).click();
    const menuRow = await page.locator('.header-cluster-end .menu-item').first().boundingBox();
    expect(menuRow).not.toBeNull();
    expect(menuRow!.height).toBeGreaterThanOrEqual(38);
    await page.keyboard.press('Escape');
  });

  test('suppresses the long-press callout where it would fight a gesture', async ({ page }) => {
    // A callout over the canvas or a swatch cancels the gesture underneath it. The property is
    // WebKit-only and Chromium reports nothing for it, so this reads the rule the stylesheet
    // actually ships rather than a computed value that is empty here by definition.
    const covered = await page.evaluate(async () => {
      const href = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
        .map((link) => link.href)
        .find((url) => url.includes('.css'));
      if (!href) return false;
      const css = await (await fetch(href)).text();
      const coarse = css
        .split('@media')
        .map((block) => block.trimStart())
        .find((block) => block.replace(/\s+/g, '').startsWith('(pointer:coarse)'));
      if (!coarse) return false;
      const rule = coarse.split('}').find((part) => part.includes('-webkit-touch-callout'));
      return Boolean(
        rule && ['.canvas-stack', '.swatch', '.recent-swatch'].every((selector) => rule.includes(selector)),
      );
    });
    expect(covered, 'a pointer: coarse rule sets -webkit-touch-callout on the canvas and swatches').toBe(true);
  });

  test('draws with a touch drag', async ({ page }) => {
    const touch = await touchSession(page);
    await page.locator('.toolbox').getByRole('button', { name: 'Paintbrush', exact: true }).click();
    const display = page.locator('.canvas-stack canvas').first();
    // At this width the canvas is zoomed to fit, so an element offset is not an image coordinate.
    // Counting non-background pixels across the whole layer avoids having to convert.
    const painted = () =>
      display.evaluate((element: HTMLCanvasElement) => {
        const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] !== 255 || pixels[index + 1] !== 255 || pixels[index + 2] !== 255) count += 1;
        }
        return count;
      });

    expect(await painted(), 'the new document starts blank').toBe(0);
    await touch.drag(page.locator('.canvas-stack'), { x: 20, y: 40 }, { x: 60, y: 40 });

    await expect.poll(painted, { message: 'a touch drag paints' }).toBeGreaterThan(0);
    // The history dock is off screen at this width, so the title's dirty marker is the
    // observable that the stroke became a real, undoable edit.
    await expect(page).toHaveTitle(/\*/);
  });

  test('long-presses a palette swatch for the secondary colour, standing in for a right-click', async ({ page }) => {
    const touch = await touchSession(page);
    // The wells paint a checkerboard under a --well-color custom property, so backgroundColor
    // reports the checkerboard rather than the colour.
    const wellColor = (which: 'primary' | 'secondary') =>
      page
        .locator(`.color-well.${which}`)
        .evaluate((element) => getComputedStyle(element).getPropertyValue('--well-color').trim());
    const swatch = page.locator('.palette .swatch').nth(4);
    const swatchColor = (await swatch.getAttribute('title'))!.split(' ')[0];
    const before = { primary: await wellColor('primary'), secondary: await wellColor('secondary') };
    expect(swatchColor, 'the swatch must differ from the current secondary to prove anything').not.toBe(
      before.secondary,
    );

    await touch.hold(swatch, 700);

    await expect.poll(() => wellColor('secondary')).toBe(swatchColor);
    // The same press must not also set the primary colour, or the gesture would be ambiguous.
    expect(await wellColor('primary')).toBe(before.primary);
  });

  test('pans the canvas with a touch drag on the pan tool', async ({ page }) => {
    const touch = await touchSession(page);
    const viewport = page.locator('.canvas-viewport');
    const scrollOf = () => viewport.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }));

    // Zoom in first, or a canvas that already fits has nothing to scroll.
    await page.locator('.toolbox').getByRole('button', { name: 'Zoom', exact: true }).click();
    await page.locator('.canvas-stack').click({ position: { x: 40, y: 40 } });
    await page.locator('.canvas-stack').click({ position: { x: 40, y: 40 } });
    await page.locator('.toolbox').getByRole('button', { name: 'Pan', exact: true }).click();

    const before = await scrollOf();
    await touch.drag(page.locator('.canvas-stack'), { x: 200, y: 200 }, { x: 60, y: 80 });
    const after = await scrollOf();

    expect(after.left !== before.left || after.top !== before.top, 'the pan tool moved the viewport').toBe(true);
  });

  test('keeps every tool reachable in the toolbox', async ({ page }) => {
    const toolbox = page.locator('.toolbox');
    await expect(toolbox.getByRole('button')).toHaveCount(TOOLS.length);

    // Reachable means on screen or scrollable to it, never clipped away with no way back.
    const clipped = await toolbox.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const scrollable = element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth;
      return [...element.querySelectorAll('button')].filter((button) => {
        const bounds = button.getBoundingClientRect();
        const inside = bounds.bottom <= box.bottom + 1 && bounds.right <= box.right + 1;
        return !inside && !scrollable;
      }).length;
    });
    expect(clipped, 'tools clipped out of reach').toBe(0);
  });

  test('opens a dialog that fits the screen and keeps its buttons reachable', async ({ page }) => {
    await page.locator('.header-cluster-end').getByRole('button', { name: 'Effects', exact: true }).click();
    const item = page.locator('.header-cluster-end .effect-menu-popover .menu-item').filter({ hasText: /^Cells/ });
    await item.scrollIntoViewIfNeeded();
    await item.click();

    const dialog = page.getByRole('dialog', { name: 'Cells' });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'OK' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });
});
