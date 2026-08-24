import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const packageMetadata = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

test.describe('search and sharing metadata', () => {
  test('publishes complete editor metadata and structured software data', async ({ page, request }) => {
    const source = await request.get('/');
    expect(source.ok()).toBe(true);
    expect(await source.text()).toContain('<title>Pinta Online – Free Browser Image Editor | Paint.rip</title>');

    await page.goto('/');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://paint.rip/');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /edit images online with Pinta/i);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /max-image-preview:large/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://paint.rip/about/assets/pinta-online-og.jpg');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('free browser-based paint and image editor');

    const graph = await page.locator('script[type="application/ld+json"]').evaluateAll((scripts) => (
      scripts.flatMap((script) => {
        const value = JSON.parse(script.textContent ?? '{}') as { '@graph'?: unknown[] };
        return value['@graph'] ?? [];
      })
    ));
    expect(graph).toEqual(expect.arrayContaining([
      expect.objectContaining({ '@type': 'WebSite', url: 'https://paint.rip/' }),
      expect.objectContaining({
        '@type': 'SoftwareApplication',
        name: 'Pinta Online',
        applicationCategory: 'DesignApplication',
        isAccessibleForFree: true,
        softwareVersion: packageMetadata.version,
        offers: expect.objectContaining({ price: '0' }),
      }),
    ]));

    await page.getByRole('button', { name: 'Main Menu', exact: true }).click();
    await page.locator('.main-menu-popover .menu-item').filter({ hasText: /^About/ }).click();
    await expect(page.locator('.about-version')).toHaveText(`Pinta Online ${packageMetadata.version} · based on Pinta 3.2`);
  });

  test('serves a crawlable visual feature page at its canonical URL', async ({ page, request }) => {
    const response = await page.goto('/about/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Pinta Online Features – Free Web Image Editor | Paint.rip');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://paint.rip/about/');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /drawing tools, layers, selections, text, 46 effects/i);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ready in your browser');
    await expect(page.getByRole('link', { name: /start painting now/i })).toHaveAttribute('href', '/');

    const screenshots = page.locator('main img[src^="/about/assets/"]');
    expect(await screenshots.count()).toBeGreaterThanOrEqual(9);
    const screenshotUrls = await screenshots.evaluateAll((images) => images.map((image) => (
      (image as HTMLImageElement).getAttribute('src') ?? ''
    )));
    const screenshotResponses = await Promise.all(screenshotUrls.map((url) => request.get(url)));
    expect(screenshotResponses.every((asset) => asset.ok() && Number(asset.headers()['content-length']) > 1_000)).toBe(true);

    const software = await page.locator('script[type="application/ld+json"]').evaluate((script) => {
      const value = JSON.parse(script.textContent ?? '{}') as { '@graph': Array<{ '@type': string; [key: string]: unknown }> };
      return value['@graph'].find((entry) => entry['@type'] === 'SoftwareApplication');
    });
    expect(software).toMatchObject({
      name: 'Pinta Online',
      url: 'https://paint.rip/',
      softwareVersion: packageMetadata.version,
      featureList: expect.arrayContaining(['22 drawing and editing tools', '46 adjustments and effects']),
    });
    await expect(page.locator('[data-app-version]')).toHaveText(packageMetadata.version);
  });

  test('advertises both canonical pages to crawlers', async ({ request }) => {
    const [robots, sitemap] = await Promise.all([
      request.get('/robots.txt'),
      request.get('/sitemap.xml'),
    ]);
    expect(robots.ok()).toBe(true);
    expect(await robots.text()).toContain('Sitemap: https://paint.rip/sitemap.xml');
    expect(sitemap.ok()).toBe(true);
    expect(sitemap.headers()['content-type']).toContain('xml');
    expect(await sitemap.text()).toEqual(expect.stringContaining('<loc>https://paint.rip/about/</loc>'));
  });
});
