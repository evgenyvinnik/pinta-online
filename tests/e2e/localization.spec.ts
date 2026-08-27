import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const localeManifest = JSON.parse(readFileSync(new URL('../../src/i18n/locales.generated.json', import.meta.url), 'utf8')) as {
  threshold: number;
  templateMessages: number;
  upstreamCatalogs: number;
  qualifyingCatalogs: number;
  locales: Array<{ code: string; coverage: number; preserved: boolean }>;
};

async function waitForWorkspace(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-ready', 'true');
  await expect(page.locator('.canvas-stack canvas').first()).toBeVisible();
}

test.describe('localization', () => {
  test('ships every high-coverage upstream catalog in the language chooser', async ({ page }) => {
    expect(localeManifest).toMatchObject({
      threshold: 90,
      templateMessages: 621,
      upstreamCatalogs: 73,
      qualifyingCatalogs: 28,
    });
    expect(localeManifest.locales).toHaveLength(30);
    expect(localeManifest.locales.filter(({ coverage }) => coverage >= 90)).toHaveLength(29);
    expect(localeManifest.locales.find(({ code }) => code === 'he')).toMatchObject({ coverage: 70.2, preserved: true });

    await page.goto('/');
    await waitForWorkspace(page);
    await page.locator('[data-menu-name="pinta"]').click();
    await page.getByRole('menuitem', { name: 'Language…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose language' });
    await expect(dialog.getByRole('radio')).toHaveCount(30);
    await expect(dialog.getByRole('radio', { name: /English \(United Kingdom\)/ })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /português \(Brasil\)/ })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /繁體中文/ })).toBeVisible();
  });

  test('selects and persists an RTL locale while mirroring editor chrome', async ({ page }) => {
    await page.goto('/');
    await waitForWorkspace(page);
    await page.locator('[data-menu-name="pinta"]').click();
    await page.getByRole('menuitem', { name: 'Language…' }).click();
    await expect(page.getByRole('dialog', { name: 'Choose language' })).toBeVisible();
    await page.getByRole('radio', { name: /العربية/ }).check();
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page).toHaveURL(/\/ar\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-locale', 'ar');
    await expect(page.locator('[data-menu-name="file"]')).toContainText('ملف');
    await expect(page.locator('.dock-header').first()).toContainText('الطبقات');

    const toolbox = await page.locator('.toolbox').boundingBox();
    const sidebar = await page.locator('.dock-sidebar').boundingBox();
    expect(toolbox).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(toolbox!.x).toBeGreaterThan(sidebar!.x);

    await page.reload();
    await waitForWorkspace(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('[data-menu-name="file"]')).toContainText('ملف');
  });

  test('honors an LTR locale from a shareable URL', async ({ page }) => {
    await page.goto('/fr/');
    await waitForWorkspace(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('[data-menu-name="file"]')).toContainText('Fichier');
    await expect(page.locator('[data-menu-name="edit"]')).toContainText('Édition');
    await expect(page.locator('.dock-header').first()).toContainText('Calques');
  });

  test('preserves regional BCP 47 locales instead of collapsing them', async ({ page }) => {
    await page.goto('/pt-BR/');
    await waitForWorkspace(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('[data-menu-name="file"]')).toContainText('Arquivo');
    await expect(page.locator('[data-menu-name="edit"]')).toContainText('Editar');
    await expect(page.locator('.dock-header').first()).toContainText('Camadas');

    await page.goto('/en-GB/');
    await waitForWorkspace(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
    await page.getByRole('button', { name: 'Click to select primary colour.' }).click();
    await expect(page.getByRole('dialog', { name: 'Choose Colours' })).toBeVisible();
  });

  test('keeps the canonical root English after another locale was selected', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pinta-online-language', 'ar'));
    await page.goto('/');
    await waitForWorkspace(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('[data-menu-name="file"]')).toContainText('File');
  });

  test('translates native empty-workspace and save dialogs while retaining RTL flow', async ({ page }) => {
    await page.goto('/ar/');
    await waitForWorkspace(page);

    await page.keyboard.press('Control+W');
    await expect(page.getByRole('main', { name: 'لا توجد صورة مفتوحة' })).toBeVisible();
    await expect(page.getByText('أنشئ صورة جديدة أو افتح صورة موجودة لبدء التحرير.')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await page.keyboard.press('Control+N');
    const newImage = page.getByRole('dialog', { name: 'صورة جديدة' });
    await expect(newImage).toBeVisible();
    await newImage.getByRole('button', { name: 'حسنًا' }).click();

    await page.keyboard.press('Control+Shift+S');
    const saveAs = page.getByRole('dialog', { name: 'حفظ الصورة باسم' });
    await expect(saveAs).toBeVisible();
    await saveAs.getByLabel('تنسيق الملف').selectOption('jpeg');
    await saveAs.getByRole('button', { name: 'حفظ', exact: true }).click();

    const jpegQuality = page.getByRole('dialog', { name: 'جودة JPEG' });
    await expect(jpegQuality).toBeVisible();
    await expect(jpegQuality).toContainText('الجودة:');
    await jpegQuality.getByRole('button', { name: 'إلغاء' }).click();
    await expect(saveAs).toBeVisible();
  });
});
