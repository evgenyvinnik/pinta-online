import { expect, test, type Page } from '@playwright/test';

/**
 * Budgets for the work the pointer-hover test does not cover: drawing, selection dragging, effect
 * preview and cancellation, saving and restoring, tab switching, long-history reconstruction, and
 * the memory a large document costs.
 *
 * Every budget is on `ScriptDuration` or a heap figure rather than wall-clock time. This suite has
 * to survive a loaded machine — the same e2e suite here has measured 39 seconds and 17 minutes on
 * identical code — and CPU time attributed to scripting stays meaningful when the box is busy in a
 * way elapsed time does not. The numbers are set with real headroom over what the work actually
 * costs, because a budget that flakes gets raised until it means nothing.
 *
 * Measured on a quiet machine, 29 August 2026: drawing 2.1 ms/move, selection 3.6 ms/move, effect
 * preview 12.6 ms, cancel 3.4 ms, tab switch 5.7 ms, restore 53 ms, JS heap +2.6 MB, stored
 * 4.2 MB. Each budget sits several times above its measurement, because a shared CI runner is
 * slower than this and a budget is meant to catch a regression, not a busy afternoon.
 */

const BUDGETS = {
  /** Script time per pointer move while a brush stroke is in progress. */
  drawMsPerMove: 8,
  /** Script time per pointer move while dragging a selection marquee. */
  selectionMsPerMove: 12,
  /** Script time to open an effect dialog and render its first preview. */
  effectPreviewMs: 150,
  /** Script time to cancel that preview and put the canvas back. */
  effectCancelMs: 60,
  /** Script time to switch between two open documents. */
  tabSwitchMs: 80,
  /** Script time to rebuild the editor from a stored workspace with a long history. */
  restoreMs: 600,
  /**
   * JS heap growth for the same document, in MB. This is deliberately not the memory budget:
   * `JSHeapUsedSize` excludes canvas backing stores, which is where a 2000x1500 six-layer document
   * actually lives — 12 MB a layer before any history. It still catches a leak in the bookkeeping
   * around those canvases, which is a real failure mode and one nothing else here would see.
   */
  heapGrowthMb: 60,
  /**
   * What the origin has stored afterwards, in MB. This is the memory budget that matters: it is
   * what exhausts quota, and it is what deduplicating history pixels on write was about.
   */
  storedMb: 60,
};

async function waitForWorkspace(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-ready', 'true');
  await expect(page.locator('.canvas-stack canvas, .empty-workspace').first()).toBeVisible();
}

function metric(metrics: Array<{ name: string; value: number }>, name: string) {
  const value = metrics.find((candidate) => candidate.name === name)?.value;
  if (value === undefined) throw new Error(`Chromium did not expose the ${name} performance metric.`);
  return value;
}

/** Two frames, so work React scheduled has actually run before the meter is read. */
async function settle(page: Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

type Meter = { scriptMs: () => Promise<number>; heapMb: () => Promise<number> };

async function meter(page: Page): Promise<Meter> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const read = async (name: string) => metric((await cdp.send('Performance.getMetrics')).metrics, name);
  let mark = await read('ScriptDuration');
  return {
    async scriptMs() {
      await settle(page);
      const now = await read('ScriptDuration');
      const elapsed = (now - mark) * 1000;
      mark = now;
      return elapsed;
    },
    async heapMb() {
      return (await read('JSHeapUsedSize')) / (1024 * 1024);
    },
  };
}

async function report(name: string, measured: number, budget: number, unit: string) {
  const line = `${name}: ${measured.toFixed(2)}${unit} (budget ${budget}${unit})`;
  console.info(line);
  await test.info().attach(`${name}.json`, {
    body: JSON.stringify({ measured, budget, unit }, null, 2),
    contentType: 'application/json',
  });
}

async function newDocument(page: Page, width: number, height: number) {
  await page.getByRole('button', { name: 'New Image (Ctrl+N)', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill(String(width));
  await page.getByRole('spinbutton', { name: 'Height', exact: true }).fill(String(height));
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await waitForWorkspace(page);
}

test('continuous drawing stays within the scripting budget', async ({ page }) => {
  await page.goto('/');
  await waitForWorkspace(page);
  await newDocument(page, 2000, 1500);
  await page.locator('.toolbox').getByRole('button', { name: 'Paintbrush', exact: true }).click();

  const box = (await page.locator('.canvas-stack').boundingBox())!;
  const gauge = await meter(page);

  // A warm pass first: the first stroke pays for lazily created buffers, which is a real cost but
  // not the one this budget is about.
  await page.mouse.move(Math.round(box.x + 20), Math.round(box.y + 20));
  await page.mouse.down();
  for (let index = 0; index < 20; index += 1) {
    await page.mouse.move(Math.round(box.x + 20 + index * 2), Math.round(box.y + 20 + (index % 5)));
  }
  await page.mouse.up();
  await gauge.scriptMs();

  const moves = 80;
  await page.mouse.move(Math.round(box.x + 30), Math.round(box.y + 60));
  await page.mouse.down();
  for (let index = 0; index < moves; index += 1) {
    await page.mouse.move(Math.round(box.x + 30 + (index % 40) * 4), Math.round(box.y + 60 + (index % 9) * 3));
  }
  await page.mouse.up();

  const perMove = (await gauge.scriptMs()) / moves;
  await report('draw', perMove, BUDGETS.drawMsPerMove, 'ms/move');
  expect(perMove, `${moves} pointer moves with the brush down`).toBeLessThan(BUDGETS.drawMsPerMove);
});

test('dragging a selection stays within the scripting budget', async ({ page }) => {
  await page.goto('/');
  await waitForWorkspace(page);
  await newDocument(page, 2000, 1500);
  await page.locator('.toolbox').getByRole('button', { name: 'Rectangle Select', exact: true }).click();

  const box = (await page.locator('.canvas-stack').boundingBox())!;
  const gauge = await meter(page);
  await gauge.scriptMs();

  const moves = 80;
  await page.mouse.move(Math.round(box.x + 20), Math.round(box.y + 20));
  await page.mouse.down();
  for (let index = 0; index < moves; index += 1) {
    await page.mouse.move(Math.round(box.x + 20 + index * 3), Math.round(box.y + 20 + index * 2));
  }
  await page.mouse.up();

  const perMove = (await gauge.scriptMs()) / moves;
  await report('selection-drag', perMove, BUDGETS.selectionMsPerMove, 'ms/move');
  expect(perMove, `${moves} pointer moves while sizing a marquee`).toBeLessThan(BUDGETS.selectionMsPerMove);
});

test('effect preview and cancellation stay within budget', async ({ page }) => {
  await page.goto('/');
  await waitForWorkspace(page);
  await newDocument(page, 1200, 900);

  const gauge = await meter(page);
  await gauge.scriptMs();

  await page.locator('.header-cluster-end').getByRole('button', { name: 'Effects', exact: true }).click();
  const item = page
    .locator('.header-cluster-end .effect-menu-popover .menu-item')
    .filter({ hasText: /^Gaussian Blur/ });
  await item.scrollIntoViewIfNeeded();
  await item.click();
  const dialog = page.getByRole('dialog', { name: 'Gaussian Blur' });
  await expect(dialog).toBeVisible();
  // The preview is what costs; waiting for the busy state to clear is what makes this a
  // measurement of finished work rather than of scheduling.
  await expect(dialog.locator('.busy-spinner')).toHaveCount(0);

  const previewMs = await gauge.scriptMs();
  await report('effect-preview', previewMs, BUDGETS.effectPreviewMs, 'ms');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  const cancelMs = await gauge.scriptMs();
  await report('effect-cancel', cancelMs, BUDGETS.effectCancelMs, 'ms');

  expect(previewMs, 'opening Gaussian Blur and rendering its first preview').toBeLessThan(BUDGETS.effectPreviewMs);
  expect(cancelMs, 'cancelling the preview and restoring the canvas').toBeLessThan(BUDGETS.effectCancelMs);
});

test('switching documents stays within budget', async ({ page }) => {
  await page.goto('/');
  await waitForWorkspace(page);
  await newDocument(page, 1600, 1200);
  await newDocument(page, 1600, 1200);
  const tabs = page.locator('.document-tab');
  await expect(tabs).toHaveCount(3);

  const gauge = await meter(page);
  await gauge.scriptMs();

  const switches = 6;
  for (let index = 0; index < switches; index += 1) {
    await tabs.nth(index % 2).click();
    await expect(tabs.nth(index % 2)).toHaveClass(/active/);
  }

  const perSwitch = (await gauge.scriptMs()) / switches;
  await report('tab-switch', perSwitch, BUDGETS.tabSwitchMs, 'ms');
  expect(perSwitch, `${switches} document switches`).toBeLessThan(BUDGETS.tabSwitchMs);
});

test('restoring a long history stays within budget, and its memory is bounded', async ({ page }) => {
  await page.goto('/');
  await waitForWorkspace(page);

  const gauge = await meter(page);
  const heapBefore = await gauge.heapMb();

  await newDocument(page, 2000, 1500);
  for (let index = 1; index < 6; index += 1) {
    await page
      .locator('.layers-panel .dock-toolbar')
      .getByRole('button', { name: 'Add New Layer', exact: true })
      .click();
  }
  await expect(page.locator('.layer-row')).toHaveCount(6);

  // Forty separate undoable steps, which is what makes the stored history worth measuring.
  await page.locator('.toolbox').getByRole('button', { name: 'Paintbrush', exact: true }).click();
  const box = (await page.locator('.canvas-stack').boundingBox())!;
  for (let index = 0; index < 40; index += 1) {
    await page.mouse.move(Math.round(box.x + 20 + (index % 20) * 5), Math.round(box.y + 20 + (index % 10) * 5));
    await page.mouse.down();
    await page.mouse.move(Math.round(box.x + 30 + (index % 20) * 5), Math.round(box.y + 30 + (index % 10) * 5));
    await page.mouse.up();
  }
  // The opening state, the five added layers, and the forty strokes are all history entries.
  const historyRows = 1 + 5 + 40;
  await expect(page.locator('.history-row')).toHaveCount(historyRows);

  const heapAfter = await gauge.heapMb();
  const growth = heapAfter - heapBefore;
  await report('heap-growth', growth, BUDGETS.heapGrowthMb, 'MB');

  // What the origin actually stores is the number section 5 cares about, because that is what
  // exhausts quota. It is also the one this suite can move: history used to be written once per
  // step per layer regardless of whether the pixels had changed.
  const storageMb = await page.evaluate(
    async () => ((await navigator.storage?.estimate?.())?.usage ?? 0) / (1024 * 1024),
  );
  await report('stored-bytes', storageMb, BUDGETS.storedMb, 'MB');

  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-save-state', 'saved');

  const restoreGauge = await meter(page);
  await restoreGauge.scriptMs();
  await page.reload();
  await waitForWorkspace(page);
  await expect(page.locator('.history-row')).toHaveCount(historyRows);
  const restoreMs = await restoreGauge.scriptMs();
  await report('restore', restoreMs, BUDGETS.restoreMs, 'ms');

  expect(growth, 'heap after a six-layer 2000x1500 document with 40 history steps').toBeLessThan(BUDGETS.heapGrowthMb);
  expect(restoreMs, 'rebuilding the editor from the stored workspace').toBeLessThan(BUDGETS.restoreMs);
});
