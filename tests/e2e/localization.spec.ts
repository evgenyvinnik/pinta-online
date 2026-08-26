import { expect, test, type Page } from '@playwright/test';

async function waitForWorkspace(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-workspace-ready', 'true');
  await expect(page.locator('.canvas-stack canvas').first()).toBeVisible();
}

test.describe('localization', () => {
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
