import { chromium } from '@playwright/test';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { copy } from './seo-copy.mjs';

// Renders one 1200×630 share card per public page from web-assets/social/card.html.
//
// The card is a code-native layout around a real editor capture, like the GitHub preview beside
// it. Nothing here invents UI: every screenshot comes from the about, promo or visual suites.
//
// The manifest it writes is the contract the pages are held to — tests/e2e/seo.spec.ts asserts
// that each page's og:image and og:image:alt match the card built for it, so a card cannot be
// renamed, re-described or dropped without the pages failing.
const source = new URL('../web-assets/social/card.html', import.meta.url);
const outputDirectory = new URL('../web-assets/social/cards/', import.meta.url);
const width = 1200;
const height = 630;
// Facebook and LinkedIn refuse images above 8 MB and X above 5 MB; a card that trips one of those
// silently shows no preview at all. These are ~200 KB, so the check is a tripwire, not a budget.
const maximumBytes = 1_000_000;

const direction = { fr: 'ltr', de: 'ltr', ar: 'rtl', he: 'rtl' };

/**
 * The editor and About cards for a fully localized page, built from that page's own reviewed copy.
 *
 * Nothing here is newly translated: the headline is the page's `<h1>`, the description its
 * Open Graph description, and the alt text the one it already publishes. A translation change
 * therefore cannot leave a stale card behind — regenerate and the card follows the page.
 *
 * Only the five SEO locales get cards. The UI-only shells have no reviewed marketing copy, and
 * inventing it to fill a card would be inventing a translation.
 */
function localizedCards(locale) {
  const text = copy[locale];
  const shared = { lang: locale, dir: direction[locale], alt: text.editorImageAlt };
  return {
    [`editor-${locale}`]: {
      ...shared,
      eyebrow: text.hero.eyebrow,
      headline: text.hero.title,
      description: text.editorOgDescription,
      features: text.hero.trust,
      screenshot: '../promo/workspace-dark.webp',
    },
    [`about-${locale}`]: {
      ...shared,
      eyebrow: text.features.eyebrow,
      headline: [text.features.title],
      description: text.aboutOgDescription,
      features: [text.formats.eyebrow, text.local.eyebrow],
      screenshot: '../about/editor-dark.webp',
    },
  };
}

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch();
const manifest = {};
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(source.href);
  const englishIds = await page.evaluate(() => Object.keys(window.socialCards));
  const localized = Object.assign({}, ...Object.keys(copy).map(localizedCards));
  const cards = [...englishIds.map((id) => [id, null]), ...Object.entries(localized).map(([id, card]) => [id, card])];

  for (const [id, localizedCard] of cards) {
    if (localizedCard) {
      // The page must not render its English default first, or the fonts and layout settle to the
      // wrong script before the real copy arrives.
      await page.addInitScript(() => {
        window.__deferCardRender = true;
      });
      await page.goto(source.href);
      await page.evaluate((card) => window.renderCard(card), localizedCard);
    } else {
      await page.goto(`${source.href}?card=${id}`);
    }
    const alt = localizedCard?.alt ?? (await page.evaluate((card) => window.socialCards[card].alt, id));
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
      for (const image of document.images) {
        const bounds = image.getBoundingClientRect();
        if (!bounds.width) continue;
        if (Math.abs(bounds.width / bounds.height - image.naturalWidth / image.naturalHeight) > 0.01) {
          throw new Error(`Distorted social-card image: ${image.src}`);
        }
      }
      // A card is read at thumbnail size, so anything that spills out of the frame is lost rather
      // than clipped politely.
      if (document.body.scrollWidth > window.innerWidth || document.body.scrollHeight > window.innerHeight) {
        throw new Error('Card content overflows the 1200×630 frame');
      }
    });

    const file = `${id}.jpg`;
    const output = fileURLToPath(new URL(file, outputDirectory));
    // JPEG, not PNG: these are photographic screenshots, and every platform re-encodes them anyway.
    await page.screenshot({ path: output, type: 'jpeg', quality: 88 });
    const { size } = await stat(output);
    if (size >= maximumBytes) throw new Error(`${file} must stay under 1 MB, got ${size} bytes.`);
    manifest[id] = { file, alt, width, height };
    console.log(`${file} · ${width}×${height} · ${size} bytes`);
  }
} finally {
  await browser.close();
}

await writeFile(fileURLToPath(new URL('manifest.json', outputDirectory)), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${Object.keys(manifest).length} cards written to web-assets/social/cards/`);
