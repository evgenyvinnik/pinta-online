import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const packageMetadata = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
const localePages = [
  { locale: 'en', direction: 'ltr', editor: '/', about: '/about/', title: /Pinta Online Features/, heading: /ready in your browser/i },
  { locale: 'fr', direction: 'ltr', editor: '/fr/', about: '/fr/about/', title: /Fonctionnalités de Pinta Online/, heading: /prête dans votre navigateur/i },
  { locale: 'de', direction: 'ltr', editor: '/de/', about: '/de/about/', title: /Pinta-Online-Funktionen/, heading: /bereit in deinem Browser/i },
  { locale: 'ar', direction: 'rtl', editor: '/ar/', about: '/ar/about/', title: /ميزات بِنْتا أونلاين/, heading: /جاهزة في متصفحك/i },
  { locale: 'he', direction: 'rtl', editor: '/he/', about: '/he/about/', title: /תכונות Pinta Online/, heading: /מוכנה בדפדפן שלכם/i },
] as const;

function absolute(path: string) {
  return `https://paint.rip${path}`;
}

async function alternateMap(page: import('@playwright/test').Page) {
  return page.locator('link[rel="alternate"][hreflang]').evaluateAll((links) => Object.fromEntries(links.map((link) => [
    link.getAttribute('hreflang'),
    link.getAttribute('href'),
  ])));
}

test.describe('search and sharing metadata', () => {
  test('publishes complete editor metadata and structured software data', async ({ page, request }) => {
    const source = await request.get('/');
    expect(source.ok()).toBe(true);
    expect(await source.text()).toContain('<title>Pinta Online – Free Browser Image Editor | Paint.rip</title>');

    await page.goto('/');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://paint.rip/');
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute('href', 'https://paint.rip/');
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
    await expect(page.locator('.about-port-credit a')).toHaveText('Evgeny Vinnik');
    await expect(page.locator('.about-port-credit a')).toHaveAttribute('href', 'https://github.com/evgenyvinnik/pinta-online');
  });

  test('publishes reciprocal editor alternates with English as x-default', async ({ page }) => {
    const expected = Object.fromEntries([
      ...localePages.map(({ locale, editor }) => [locale, absolute(editor)]),
      ['x-default', absolute('/')],
    ]);

    for (const localePage of localePages) {
      const response = await page.goto(localePage.editor);
      expect(response?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', localePage.locale);
      await expect(page.locator('html')).toHaveAttribute('dir', localePage.direction);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', absolute(localePage.editor));
      expect(await alternateMap(page)).toEqual(expected);

      if (localePage.locale !== 'en') {
        const pageEntity = await page.locator('script[type="application/ld+json"]').evaluate((script) => {
          const value = JSON.parse(script.textContent ?? '{}') as { '@graph': Array<{ '@type': string; [key: string]: unknown }> };
          return value['@graph'].find((entry) => entry['@type'] === 'WebPage');
        });
        expect(pageEntity).toMatchObject({ url: absolute(localePage.editor), inLanguage: localePage.locale });
      }
    }
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

  test('serves fully translated About pages with reciprocal alternates', async ({ page }) => {
    const expected = Object.fromEntries([
      ...localePages.map(({ locale, about }) => [locale, absolute(about)]),
      ['x-default', absolute('/about/')],
    ]);

    for (const localePage of localePages) {
      await page.goto(localePage.about);
      await expect(page.locator('html')).toHaveAttribute('lang', localePage.locale);
      await expect(page.locator('html')).toHaveAttribute('dir', localePage.direction);
      await expect(page).toHaveTitle(localePage.title);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(localePage.heading);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', absolute(localePage.about));
      expect(await alternateMap(page)).toEqual(expected);
      await expect(page.locator('.language-menu a')).toHaveCount(5);
      await expect(page.locator('.language-menu a[aria-current="page"]')).toHaveAttribute('hreflang', localePage.locale);
      await expect(page.locator('main img[src^="/about/assets/"]')).toHaveCount(9);
      await expect(page.locator('.site-footer').getByRole('link', { name: 'Evgeny Vinnik' })).toHaveAttribute('href', 'https://github.com/evgenyvinnik/pinta-online');

      const pageEntity = await page.locator('script[type="application/ld+json"]').evaluate((script) => {
        const value = JSON.parse(script.textContent ?? '{}') as { '@graph': Array<{ '@type': string; [key: string]: unknown }> };
        return value['@graph'].find((entry) => entry['@type'] === 'WebPage');
      });
      expect(pageEntity).toMatchObject({ url: absolute(localePage.about), inLanguage: localePage.locale });
    }
  });

  test('advertises every localized canonical page to crawlers', async ({ request }) => {
    const [robots, sitemap] = await Promise.all([
      request.get('/robots.txt'),
      request.get('/sitemap.xml'),
    ]);
    expect(robots.ok()).toBe(true);
    expect(await robots.text()).toContain('Sitemap: https://paint.rip/sitemap.xml');
    expect(sitemap.ok()).toBe(true);
    expect(sitemap.headers()['content-type']).toContain('xml');
    const sitemapText = await sitemap.text();
    for (const localePage of localePages) {
      expect(sitemapText).toContain(`<loc>${absolute(localePage.editor)}</loc>`);
      expect(sitemapText).toContain(`<loc>${absolute(localePage.about)}</loc>`);
    }
    expect(sitemapText.match(/<url>/g)).toHaveLength(10);
  });
});
