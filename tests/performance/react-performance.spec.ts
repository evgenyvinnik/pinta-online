import { expect, test, type Page } from '@playwright/test';

const POINTER_MOVES = 120;
const SCRIPT_BUDGET_MS_PER_MOVE = 5;

async function waitForWorkspace(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-ready', 'true');
  await expect(page.locator('.canvas-stack canvas').first()).toBeVisible();
}

async function createSixLayerFixture(page: Page) {
  await page.goto('/');
  await waitForWorkspace(page);
  await page.getByRole('button', { name: 'New Image (Ctrl+N)', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('2000');
  await page.getByRole('spinbutton', { name: 'Height', exact: true }).fill('1500');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  for (let index = 1; index < 6; index += 1) {
    await page.locator('.layers-panel .dock-toolbar').getByRole('button', { name: 'Add New Layer', exact: true }).click();
  }
  await expect(page.locator('.layer-row')).toHaveCount(6);
  await expect(page.locator('.layer-thumbnail canvas')).toHaveCount(6);
  await expect(page.locator('.layer-thumbnail img')).toHaveCount(0);
}

function metric(metrics: Array<{ name: string; value: number }>, name: string) {
  const value = metrics.find((candidate) => candidate.name === name)?.value;
  if (value === undefined) throw new Error(`Chromium did not expose the ${name} performance metric.`);
  return value;
}

test('six-layer canvas hover stays within the production scripting budget', async ({ page }) => {
  await createSixLayerFixture(page);
  const canvas = page.locator('.canvas-stack');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas did not have measurable bounds.');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  for (let index = 0; index < 20; index += 1) {
    await page.mouse.move(box.x + 40 + index * 3, box.y + 80 + (index % 5) * 4);
  }
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  const before = await cdp.send('Performance.getMetrics');
  for (let index = 0; index < POINTER_MOVES; index += 1) {
    const x = box.x + 40 + (index % 60) * Math.max(1, (box.width - 80) / 60);
    const y = box.y + 70 + (index % 7) * 8;
    await page.mouse.move(x, y);
  }
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const after = await cdp.send('Performance.getMetrics');

  const scriptMs = (metric(after.metrics, 'ScriptDuration') - metric(before.metrics, 'ScriptDuration')) * 1000;
  const layoutCount = metric(after.metrics, 'LayoutCount') - metric(before.metrics, 'LayoutCount');
  const scriptMsPerMove = scriptMs / POINTER_MOVES;
  await test.info().attach('performance-metrics.json', {
    body: JSON.stringify({ pointerMoves: POINTER_MOVES, scriptMs, scriptMsPerMove, layoutCount }, null, 2),
    contentType: 'application/json',
  });
  console.info(`pointer budget: ${scriptMsPerMove.toFixed(3)} ms/move, ${layoutCount} layouts across ${POINTER_MOVES} moves`);

  expect(scriptMsPerMove, `${scriptMs.toFixed(2)} ms scripting across ${POINTER_MOVES} pointer moves`).toBeLessThan(SCRIPT_BUDGET_MS_PER_MOVE);
});
