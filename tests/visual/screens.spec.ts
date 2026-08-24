import { expect, test, type Locator, type Page } from '@playwright/test';
import { TOOLS } from '../../src/editor/tools';
import { EFFECT_DEFINITIONS, type EffectDefinition } from '../../src/effects/types';

async function settle(page: Page) {
  await page.waitForFunction(async () => {
    await document.fonts.ready;
    return [...document.images].every((image) => image.complete && image.naturalWidth > 0);
  });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function expectPageScreenshot(page: Page, name: string) {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
}

async function expectLocatorScreenshot(page: Page, locator: Locator, name: string) {
  await expect(locator).toBeVisible();
  await settle(page);
  await expect(locator).toHaveScreenshot(`${name}.png`);
}

async function expectDialogScreenshots(page: Page, name: string) {
  const dialog = page.locator('.pinta-dialog').last();
  await expectLocatorScreenshot(page, dialog, name);

  const content = dialog.locator('.dialog-content').last();
  if (await content.count() === 0) return;
  const scrollable = await content.evaluate((element) => element.scrollHeight > element.clientHeight + 1);
  if (!scrollable) return;

  await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expectLocatorScreenshot(page, dialog, `${name}-bottom`);
}

async function openHeaderMenu(page: Page, name: 'View' | 'Image' | 'Adjustments' | 'Effects' | 'Main Menu') {
  await page.locator('.header-cluster-end').getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.header-cluster-end .popover')).toBeVisible();
}

async function clickPopoverItem(page: Page, label: string) {
  const item = page.locator('.header-cluster-end .popover .menu-item').filter({ hasText: new RegExp(`^${escapeRegex(label)}`) });
  await item.scrollIntoViewIfNeeded();
  await item.click();
}

async function openTopLevelMenu(page: Page, name: string) {
  await page.locator('.macos-menu-bar').getByRole('menuitem', { name, exact: true }).click();
  await expect(page.locator('.macos-menu-anchor.active .macos-menu-popover')).toBeVisible();
}

async function clickTopLevelMenuItem(page: Page, label: string) {
  const item = page.locator('.macos-menu-anchor.active .macos-menu-popover .menu-item').filter({
    hasText: new RegExp(`^${escapeRegex(label)}`),
  });
  await item.scrollIntoViewIfNeeded();
  await item.click();
}

async function clickMainMenuItem(page: Page, label: string) {
  await openHeaderMenu(page, 'Main Menu');
  await clickPopoverItem(page, label);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.canvas-stack canvas').first()).toBeVisible();
  await settle(page);
});

test.describe('workspaces', () => {
  test('default dark workspace', async ({ page }) => {
    await expectPageScreenshot(page, 'workspace-default-dark');
  });

  test('light workspace', async ({ page }) => {
    await openHeaderMenu(page, 'View');
    await clickPopoverItem(page, 'Light');
    await expect(page.locator('.app-shell')).toHaveClass(/theme-light/);
    await expectPageScreenshot(page, 'workspace-default-light');
  });

  test('workspace with toolbar hidden', async ({ page }) => {
    await openTopLevelMenu(page, 'View');
    await clickTopLevelMenuItem(page, 'Tool Bar');
    await expect(page.locator('.header-bar')).toBeHidden();
    await expectPageScreenshot(page, 'workspace-toolbar-hidden');
  });

  test('rulers and canvas grid', async ({ page }) => {
    await openHeaderMenu(page, 'View');
    await clickPopoverItem(page, 'Rulers');
    await openHeaderMenu(page, 'View');
    await clickPopoverItem(page, 'Canvas Grid');
    await page.getByLabel('Show Grid').check();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expectPageScreenshot(page, 'workspace-rulers-and-grid');
  });

  test('selection', async ({ page }) => {
    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).click();
    await page.keyboard.press('Control+A');
    await expectPageScreenshot(page, 'workspace-selection');
  });

  test('text editor', async ({ page }) => {
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.locator('.canvas-stack').click({ position: { x: 140, y: 120 } });
    await page.getByRole('textbox', { name: 'Text editor' }).fill('Pinta Online\nVisual comparison');
    await expectPageScreenshot(page, 'workspace-text-editor');
  });

  test('distraction-free workspace', async ({ page }) => {
    for (const label of ['Tool Box', 'Tool Windows', 'Status Bar', 'Image Tabs']) {
      await openHeaderMenu(page, 'View');
      await clickPopoverItem(page, label);
    }
    await expectPageScreenshot(page, 'workspace-distraction-free');
  });

  test('responsive workspace', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 720 });
    await expectPageScreenshot(page, 'workspace-responsive-800x720');
  });

  test('file drop overlay', async ({ page }) => {
    await page.locator('.app-shell').dispatchEvent('dragover');
    await expect(page.locator('.drop-overlay')).toBeVisible();
    await expectPageScreenshot(page, 'workspace-file-drop');
  });
});

test.describe('localization', () => {
  test('French LTR workspace and menu', async ({ page }) => {
    await page.goto('/?lang=fr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.locator('[data-menu-name="file"]').click();
    await expect(page.locator('.macos-menu-anchor.active .macos-menu-popover')).toBeVisible();
    await expectPageScreenshot(page, 'locale-fr-ltr');
  });

  test('Arabic RTL workspace and menu', async ({ page }) => {
    await page.goto('/?lang=ar');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.locator('[data-menu-name="file"]').click();
    await expect(page.locator('.macos-menu-anchor.active .macos-menu-popover')).toBeVisible();
    await expectPageScreenshot(page, 'locale-ar-rtl');
  });
});

test.describe('tool options', () => {
  for (const tool of TOOLS) {
    test(tool.name, async ({ page }) => {
      await page.getByRole('button', { name: tool.name, exact: true }).click();
      await expect(page.locator('.tool-options-bar')).toContainText('Tool:');
      await expectLocatorScreenshot(page, page.locator('.tool-options-bar'), `tool-${tool.id}`);
    });
  }
});

test.describe('menus', () => {
  for (const menu of ['View', 'Image', 'Adjustments'] as const) {
    test(menu, async ({ page }) => {
      await openHeaderMenu(page, menu);
      await expectPageScreenshot(page, `menu-${menu.toLowerCase()}`);
    });
  }

  test('Effects top and bottom', async ({ page }) => {
    await openHeaderMenu(page, 'Effects');
    await expectPageScreenshot(page, 'menu-effects-top');
    await page.locator('.effect-menu-popover').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expectPageScreenshot(page, 'menu-effects-bottom');
  });

  test('Main menu top and bottom', async ({ page }) => {
    await openHeaderMenu(page, 'Main Menu');
    await expectPageScreenshot(page, 'menu-main-top');
    await page.locator('.main-menu-popover').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expectPageScreenshot(page, 'menu-main-bottom');
  });

  test('Layer menu', async ({ page }) => {
    await page.getByRole('button', { name: 'Layer menu' }).click();
    await expectPageScreenshot(page, 'menu-layer');
  });
});

test.describe('desktop application menus', () => {
  for (const menu of ['Pinta', 'File', 'Edit', 'View', 'Image', 'Adjustments', 'Add-ins', 'Window', 'Help']) {
    test(menu, async ({ page }) => {
      await openTopLevelMenu(page, menu);
      await expectPageScreenshot(page, `menubar-${menu.toLowerCase().replace(/[^a-z]+/g, '-')}`);
    });
  }

  test('Effects top and bottom', async ({ page }) => {
    await openTopLevelMenu(page, 'Effects');
    await expectPageScreenshot(page, 'menubar-effects-top');
    await page.locator('.macos-menu-anchor.active .macos-menu-popover').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expectPageScreenshot(page, 'menubar-effects-bottom');
  });

  test('keyboard traversal and dismissal', async ({ page }) => {
    await openTopLevelMenu(page, 'File');
    await page.locator('.macos-menu-bar').getByRole('menuitem', { name: 'File', exact: true }).press('ArrowRight');
    await expect(page.locator('.macos-menu-anchor.active .macos-menu-button')).toHaveText('Edit');
    await page.keyboard.press('Escape');
    await expect(page.locator('.macos-menu-anchor.active')).toHaveCount(0);
  });
});

interface DialogScenario {
  name: string;
  open: (page: Page) => Promise<void>;
}

const dialogScenarios: DialogScenario[] = [
  {
    name: 'dialog-new-image',
    open: async (page) => { await page.getByRole('button', { name: 'New Image (Ctrl+N)', exact: true }).click(); },
  },
  {
    name: 'dialog-resize-image',
    open: async (page) => { await openHeaderMenu(page, 'Image'); await clickPopoverItem(page, 'Resize Image'); },
  },
  {
    name: 'dialog-resize-canvas',
    open: async (page) => { await openHeaderMenu(page, 'Image'); await clickPopoverItem(page, 'Resize Canvas'); },
  },
  {
    name: 'dialog-save-image-as',
    open: async (page) => { await clickMainMenuItem(page, 'Save As'); },
  },
  {
    name: 'dialog-print-image',
    open: async (page) => { await clickMainMenuItem(page, 'Print'); },
  },
  {
    name: 'dialog-new-screenshot',
    open: async (page) => { await clickMainMenuItem(page, 'New Screenshot'); },
  },
  {
    name: 'dialog-canvas-grid',
    open: async (page) => { await openHeaderMenu(page, 'View'); await clickPopoverItem(page, 'Canvas Grid'); },
  },
  {
    name: 'dialog-layer-properties',
    open: async (page) => { await page.getByRole('button', { name: /^Layer Properties/ }).click(); },
  },
  {
    name: 'dialog-rotate-zoom-layer',
    open: async (page) => {
      await page.getByRole('button', { name: 'Layer menu' }).click();
      await page.locator('.layer-menu-popover .menu-item').filter({ hasText: /^Rotate \/ Zoom Layer/ }).click();
    },
  },
  {
    name: 'dialog-save-palette',
    open: async (page) => { await clickMainMenuItem(page, 'Save Palette As'); },
  },
  {
    name: 'dialog-resize-palette',
    open: async (page) => { await clickMainMenuItem(page, 'Set Number of Colors'); },
  },
  {
    name: 'dialog-edit-palette-color',
    open: async (page) => { await page.locator('.swatch').first().dblclick(); },
  },
  {
    name: 'dialog-keyboard-shortcuts',
    open: async (page) => { await clickMainMenuItem(page, 'Keyboard Shortcuts'); },
  },
  {
    name: 'dialog-language',
    open: async (page) => { await clickMainMenuItem(page, 'Language'); },
  },
  {
    name: 'dialog-about',
    open: async (page) => { await clickMainMenuItem(page, 'About'); },
  },
  {
    name: 'dialog-offset-selection',
    open: async (page) => {
      await page.keyboard.press('Control+A');
      await clickMainMenuItem(page, 'Offset Selection');
    },
  },
  {
    name: 'dialog-close-document',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add New Layer' }).click();
      await openHeaderMenu(page, 'Main Menu');
      await page.getByRole('menuitem', { name: /^Close Ctrl\+W$/ }).click();
    },
  },
  {
    name: 'dialog-close-all',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add New Layer' }).click();
      await page.getByRole('button', { name: 'New Image (Ctrl+N)', exact: true }).click();
      await page.getByRole('button', { name: 'OK' }).click();
      await page.getByRole('button', { name: 'Add New Layer' }).click();
      await clickMainMenuItem(page, 'Close All');
    },
  },
];

test.describe('dialogs', () => {
  for (const scenario of dialogScenarios) {
    test(scenario.name, async ({ page }) => {
      await scenario.open(page);
      await expectDialogScreenshots(page, scenario.name);
    });
  }
});

function isDialogEffect(effect: EffectDefinition) {
  return effect.parameters.length > 0 || effect.dialog !== undefined;
}

test.describe('adjustment and effect dialogs', () => {
  for (const effect of EFFECT_DEFINITIONS.filter(isDialogEffect)) {
    test(`${effect.category}: ${effect.name}`, async ({ page }) => {
      await openHeaderMenu(page, effect.category === 'adjustment' ? 'Adjustments' : 'Effects');
      const item = page.locator('.effect-menu-popover .menu-item').filter({
        hasText: new RegExp(`^${escapeRegex(effect.name)}(?:…|$)`),
      });
      await item.scrollIntoViewIfNeeded();
      await item.click();
      await expect(page.getByRole('dialog', { name: effect.name })).toBeVisible();
      await expectDialogScreenshots(page, `${effect.category}-${effect.id}`);
    });
  }
});
