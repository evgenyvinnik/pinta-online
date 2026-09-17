import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocaleInventory, SEO_LOCALE_CODES } from './i18n-config.mjs';
import { copy } from './seo-copy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const origin = 'https://paint.rip';
const inventory = loadLocaleInventory(root);
const runtimeLocaleMeta = Object.fromEntries(inventory.locales.map((locale) => [locale.code, locale]));

// Share cards are built by scripts/capture-social-cards.mjs, which records each one here. Reading
// the manifest rather than restating the filename and its description keeps a regenerated card
// from silently disagreeing with the pages that publish it.
//
// Fully localized pages get a card in their own language, built from the copy in seo-copy.mjs.
// The UI-only shells get the English editor card: it is the one picture here with no page copy
// written on it, so it promises nothing the shell cannot deliver.
const socialCards = JSON.parse(readFileSync(resolve(root, 'web-assets/social/cards/manifest.json'), 'utf8'));
const editorCard = socialCards.editor;
const shellDescription =
  'A free browser image editor based on Pinta, with layers, selections, text, effects, open formats, and offline installation.';

function socialImageTags(card, kind = 'og') {
  const url = `${origin}/social/${card.file}`;
  if (kind === 'twitter') {
    return [
      `    <meta name="twitter:image" content="${url}" />`,
      `    <meta name="twitter:image:alt" content="${escapeHtml(card.alt)}" />`,
    ].join('\n');
  }
  return [
    `    <meta property="og:image" content="${url}" />`,
    `    <meta property="og:image:width" content="${card.width}" />`,
    `    <meta property="og:image:height" content="${card.height}" />`,
    `    <meta property="og:image:type" content="image/jpeg" />`,
    `    <meta property="og:image:alt" content="${escapeHtml(card.alt)}" />`,
  ].join('\n');
}

const localeMeta = {
  en: { name: 'English', direction: 'ltr', ogLocale: 'en_US' },
  fr: { name: 'Français', direction: 'ltr', ogLocale: 'fr_FR' },
  de: { name: 'Deutsch', direction: 'ltr', ogLocale: 'de_DE' },
  ar: { name: 'العربية', direction: 'rtl', ogLocale: 'ar_SA' },
  he: { name: 'עברית', direction: 'rtl', ogLocale: 'he_IL' },
};

const localizedCodes = Object.keys(copy);
const allCodes = Object.keys(localeMeta);
const runtimeCodes = inventory.locales.map(({ code }) => code);
if (allCodes.join(',') !== SEO_LOCALE_CODES.join(',')) {
  throw new Error('SEO locale metadata must match SEO_LOCALE_CODES in scripts/i18n-config.mjs.');
}
const editorPath = (locale) => (locale === 'en' ? '/' : `/${locale}/`);
const aboutPath = (locale) => (locale === 'en' ? '/about/' : `/${locale}/about/`);
const analyticsTags = `    <meta name="google-tag-id" content="GT-TNLLJZ63" />
    <meta name="google-analytics-id" content="G-BZKV3EDF46" />
    <meta name="google-ads-id" content="AW-998871174" />
    <meta name="google-ads-page-view-conversion-id" content="AW-998871174/TDzECNTY5-ocEIahptwD" />
    <script type="module" src="/web-assets/analytics.js"></script>`;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function alternateLinks(kind) {
  const pathFor = kind === 'editor' ? editorPath : aboutPath;
  return [
    ...allCodes.map((locale) => `    <link rel="alternate" hreflang="${locale}" href="${origin}${pathFor(locale)}" />`),
    `    <link rel="alternate" hreflang="x-default" href="${origin}${pathFor('en')}" />`,
  ].join('\n');
}

function openGraphLocales(locale) {
  return [
    `    <meta property="og:locale" content="${localeMeta[locale].ogLocale}" />`,
    ...allCodes
      .filter((code) => code !== locale)
      .map((code) => `    <meta property="og:locale:alternate" content="${localeMeta[code].ogLocale}" />`),
  ].join('\n');
}

function jsonLd(value) {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
}

function editorPage(locale, text) {
  const canonical = `${origin}${editorPath(locale)}`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${canonical}#page`,
        url: canonical,
        name: text.editorOgTitle,
        description: text.editorDescription,
        inLanguage: locale,
        isPartOf: { '@id': `${origin}/#website` },
        mainEntity: { '@id': `${origin}/#software` },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${origin}/#software`,
        name: 'Pinta Online',
        alternateName: 'Paint.rip',
        url: canonical,
        applicationCategory: 'DesignApplication',
        operatingSystem: 'Any operating system with a modern web browser',
        browserRequirements: 'Requires JavaScript, HTML5 Canvas, and a modern browser',
        softwareVersion: '__PINTA_ONLINE_VERSION__',
        isAccessibleForFree: true,
        inLanguage: locale,
        image: `${origin}/about/assets/pinta-online-og.jpg`,
        screenshot: `${origin}/about/assets/editor-dark.webp`,
        description: text.editorDescription,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: text.featureList,
      },
    ],
  };
  return `<!doctype html>
<html lang="${locale}" dir="${localeMeta[locale].direction}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#242424" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
    <meta name="description" content="${escapeHtml(text.editorDescription)}" />
    <link rel="canonical" href="${canonical}" />
${alternateLinks('editor')}
    <link rel="icon" href="/apps/com.github.PintaProject.Pinta.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/icons/pinta-192.png" />
${analyticsTags}

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Pinta Online" />
    <meta property="og:title" content="${escapeHtml(text.editorOgTitle)}" />
    <meta property="og:description" content="${escapeHtml(text.editorOgDescription)}" />
    <meta property="og:url" content="${canonical}" />
${openGraphLocales(locale)}
${socialImageTags(socialCards[`editor-${locale}`])}

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(text.editorOgTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(text.editorOgDescription)}" />
${socialImageTags(socialCards[`editor-${locale}`], 'twitter')}

    <script type="application/ld+json">
${jsonLd(graph)}
    </script>
    <title>${escapeHtml(text.editorTitle)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

// High-coverage Pinta catalogs can ship in the editor before the much larger,
// web-specific About copy has a reviewed translation. These route shells boot
// the localized app but deliberately stay out of search indexes and hreflang
// clusters until their SEO content is genuinely localized.
//
// Being out of the index is not a reason to be unshareable: a link pasted into a chat is not a
// search result. The share card carries no page copy, so it says nothing untranslated; the
// description is English until this locale's SEO copy is.
function editorLocaleShell(locale) {
  const metadata = runtimeLocaleMeta[locale];
  const title = `Pinta Online — ${metadata.name}`;
  return `<!doctype html>
<html lang="${locale}" dir="${metadata.direction}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#242424" />
    <meta name="robots" content="noindex, follow" />
    <link rel="canonical" href="${origin}/" />
    <link rel="icon" href="/apps/com.github.PintaProject.Pinta.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/icons/pinta-192.png" />
${analyticsTags}

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Pinta Online" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(shellDescription)}" />
    <meta property="og:url" content="${origin}${editorPath(locale)}" />
${socialImageTags(editorCard)}

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(shellDescription)}" />
${socialImageTags(editorCard, 'twitter')}
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function languageSwitcher(locale, kind, label) {
  const pathFor = kind === 'editor' ? editorPath : aboutPath;
  return `<details class="language-switcher">
        <summary aria-label="${escapeHtml(label)}"><span aria-hidden="true">◎</span> ${escapeHtml(localeMeta[locale].name)}</summary>
        <div class="language-menu">
${allCodes.map((code) => `          <a href="${pathFor(code)}" lang="${code}" dir="${localeMeta[code].direction}" hreflang="${code}"${code === locale ? ' aria-current="page"' : ''}>${escapeHtml(localeMeta[code].name)}</a>`).join('\n')}
        </div>
      </details>`;
}

function footerLanguageLinks(locale, label) {
  return `<div class="footer-languages">
        <span>${escapeHtml(label)}</span>
        <nav aria-label="${escapeHtml(label)}">
${allCodes.map((code) => `          <a href="${editorPath(code)}" lang="${code}" dir="${localeMeta[code].direction}" hreflang="${code}"${code === locale ? ' aria-current="true"' : ''}>${escapeHtml(localeMeta[code].name)}</a>`).join('\n')}
        </nav>
      </div>`;
}

function aboutPage(locale, text) {
  const canonical = `${origin}${aboutPath(locale)}`;
  const editorUrl = `${origin}${editorPath(locale)}`;
  const images = [
    ['text-editor.webp', text.screenshots.rows[0]],
    ['selections.webp', text.screenshots.rows[1]],
    ['effects-library.webp', text.screenshots.rows[2]],
  ];
  const details = [
    ['curves.webp', 520, 576],
    ['clouds.webp', 520, 414],
    ['oil-painting.webp', 520, 280],
    ['keyboard-shortcuts.webp', 760, 720],
  ];
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${canonical}#page`,
        url: canonical,
        name: text.aboutTitle.replace(' | Paint.rip', ''),
        description: text.aboutDescription,
        inLanguage: locale,
        isPartOf: { '@id': `${origin}/#website` },
        mainEntity: { '@id': `${origin}/#software` },
        primaryImageOfPage: { '@id': `${canonical}#hero-image` },
      },
      {
        '@type': 'ImageObject',
        '@id': `${canonical}#hero-image`,
        url: `${origin}/about/assets/pinta-online-og.jpg`,
        width: 1200,
        height: 630,
        caption: text.editorImageAlt,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: text.footer.editor, item: editorUrl },
          { '@type': 'ListItem', position: 2, name: text.nav[0], item: canonical },
        ],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${origin}/#software`,
        name: 'Pinta Online',
        url: editorUrl,
        applicationCategory: 'DesignApplication',
        operatingSystem: 'Any operating system with a modern web browser',
        browserRequirements: 'Requires JavaScript, HTML5 Canvas, and a modern browser',
        softwareVersion: '__PINTA_ONLINE_VERSION__',
        isAccessibleForFree: true,
        inLanguage: locale,
        image: `${origin}/about/assets/pinta-online-og.jpg`,
        screenshot: [
          `${origin}/about/assets/editor-dark.webp`,
          `${origin}/about/assets/text-editor.webp`,
          `${origin}/about/assets/effects-library.webp`,
        ],
        description: text.aboutDescription,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: text.featureList,
      },
    ],
  };
  return `<!doctype html>
<html lang="${locale}" dir="${localeMeta[locale].direction}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#111117" />
    <meta name="color-scheme" content="dark" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
    <meta name="description" content="${escapeHtml(text.aboutDescription)}" />
    <title>${escapeHtml(text.aboutTitle)}</title>
    <link rel="canonical" href="${canonical}" />
${alternateLinks('about')}
    <link rel="icon" href="/apps/com.github.PintaProject.Pinta.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/icons/pinta-192.png" />
${analyticsTags}

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Pinta Online" />
    <meta property="og:title" content="${escapeHtml(text.aboutOgTitle)}" />
    <meta property="og:description" content="${escapeHtml(text.aboutOgDescription)}" />
    <meta property="og:url" content="${canonical}" />
${openGraphLocales(locale)}
${socialImageTags(socialCards[`about-${locale}`])}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(text.aboutOgTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(text.aboutOgDescription)}" />
${socialImageTags(socialCards[`about-${locale}`], 'twitter')}
    <script type="application/ld+json">
${jsonLd(graph)}
    </script>
    <link rel="stylesheet" href="/about/about.css" />
  </head>
  <body>
    <a class="skip-link" href="#main">${escapeHtml(text.skip)}</a>
    <header class="site-header">
      <a class="brand" href="${editorPath(locale)}" aria-label="${escapeHtml(text.openEditor)}">
        <img src="/apps/com.github.PintaProject.Pinta.svg" width="40" height="40" alt="" />
        <span><strong>Pinta</strong> Online</span>
      </a>
      <nav aria-label="${escapeHtml(text.nav.join(', '))}">
        <a href="/user-guide/">User Guide</a><a href="#features">${escapeHtml(text.nav[0])}</a><a href="#screenshots">${escapeHtml(text.nav[1])}</a><a href="#formats">${escapeHtml(text.nav[2])}</a><a href="#questions">${escapeHtml(text.nav[3])}</a>
      </nav>
      ${languageSwitcher(locale, 'about', text.languageLabel)}
      <a class="button button-small" href="${editorPath(locale)}">${escapeHtml(text.openEditor)} <span aria-hidden="true">↗</span></a>
    </header>

    <main id="main">
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-copy">
          <p class="eyebrow"><span></span>${escapeHtml(text.hero.eyebrow)}</p>
          <h1 id="hero-title">${escapeHtml(text.hero.title[0])}<br /><em>${escapeHtml(text.hero.title[1])}</em></h1>
          <p class="hero-lede">${escapeHtml(text.hero.lead)}</p>
          <div class="hero-actions"><a class="button button-primary" href="${editorPath(locale)}">${escapeHtml(text.hero.start)} <span aria-hidden="true">→</span></a><a class="button button-quiet" href="#screenshots">${escapeHtml(text.hero.see)}</a></div>
          <ul class="trust-list">${text.hero.trust.map((item) => `<li><span aria-hidden="true">✓</span>${escapeHtml(item)}</li>`).join('')}</ul>
        </div>
        <figure class="hero-visual">
          <div class="window-dots" aria-hidden="true"><i></i><i></i><i></i></div>
          <img src="/about/assets/editor-dark.webp" width="1200" height="800" alt="${escapeHtml(text.editorImageAlt)}" fetchpriority="high" />
          <figcaption>${escapeHtml(text.hero.caption)}</figcaption><span class="floating-chip chip-tools">23</span><span class="floating-chip chip-effects">55</span>
        </figure>
      </section>
      <section class="numbers" aria-label="${escapeHtml(text.nav[0])}">${[23, 16, 55, 12].map((number, index) => `<div><strong>${number}</strong><span>${escapeHtml(text.stats[index])}</span></div>`).join('')}</section>

      <section class="section" id="features" aria-labelledby="features-title">
        <div class="section-heading"><p class="eyebrow"><span></span>${escapeHtml(text.features.eyebrow)}</p><h2 id="features-title">${escapeHtml(text.features.title)}</h2><p>${escapeHtml(text.features.lead)}</p></div>
        <div class="feature-grid">${text.features.cards.map(([icon, title, description]) => `<article class="feature-card"><span class="feature-icon" aria-hidden="true">${icon}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></article>`).join('')}</div>
      </section>

      <section class="showcase section" id="screenshots" aria-labelledby="screenshots-title">
        <div class="section-heading section-heading-left"><p class="eyebrow"><span></span>${escapeHtml(text.screenshots.eyebrow)}</p><h2 id="screenshots-title">${escapeHtml(text.screenshots.title)}</h2><p>${escapeHtml(text.screenshots.lead)}</p></div>
        ${images.map(([file, row], index) => `<article class="showcase-row${index === 1 ? ' showcase-row-reverse' : ''}"><div class="showcase-copy"><p class="overline">${escapeHtml(row[0])}</p><h3>${escapeHtml(row[1])}</h3><p>${escapeHtml(row[2])}</p><ul class="check-list">${row[3].map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div><figure class="screenshot-frame ${index === 1 ? 'tilt-left' : 'tilt-right'}"><img src="/about/assets/${file}" width="960" height="640" loading="lazy" alt="${escapeHtml(row[4])}" /><figcaption>${escapeHtml(row[4])}</figcaption></figure></article>`).join('\n        ')}
        <div class="detail-gallery" aria-label="${escapeHtml(text.nav[1])}">
          <figure class="detail-card detail-tall"><img src="/about/assets/${details[0][0]}" width="${details[0][1]}" height="${details[0][2]}" loading="lazy" alt="${escapeHtml(text.screenshots.details[0][0])}" /><figcaption><strong>${escapeHtml(text.screenshots.details[0][0])}</strong><span>${escapeHtml(text.screenshots.details[0][1])}</span></figcaption></figure>
          <div class="detail-stack">
            ${[1, 2].map((index) => `<figure class="detail-card"><img src="/about/assets/${details[index][0]}" width="${details[index][1]}" height="${details[index][2]}" loading="lazy" alt="${escapeHtml(text.screenshots.details[index][0])}" /><figcaption><strong>${escapeHtml(text.screenshots.details[index][0])}</strong><span>${escapeHtml(text.screenshots.details[index][1])}</span></figcaption></figure>`).join('')}
          </div>
          <figure class="detail-card detail-tall"><img src="/about/assets/${details[3][0]}" width="${details[3][1]}" height="${details[3][2]}" loading="lazy" alt="${escapeHtml(text.screenshots.details[3][0])}" /><figcaption><strong>${escapeHtml(text.screenshots.details[3][0])}</strong><span>${escapeHtml(text.screenshots.details[3][1])}</span></figcaption></figure>
        </div>
      </section>

      <section class="popart section" id="popart" aria-labelledby="popart-title">
        <div class="section-heading section-heading-left">
          <p class="eyebrow"><span></span>${escapeHtml(text.popart.eyebrow)}</p>
          <h2 id="popart-title">${escapeHtml(text.popart.title)}</h2>
          <p>${escapeHtml(text.popart.intro)}</p>
        </div>
        <figure class="popart-hero"><img src="/about/assets/pop-workspace.webp" width="1280" height="720" loading="lazy" alt="${escapeHtml(text.popart.heroAlt)}" /><figcaption>${escapeHtml(text.popart.heroCaption)}</figcaption></figure>
        <ul class="popart-grid" aria-label="${escapeHtml(text.popart.title)}">
          ${popartPlates(locale)
            .map(
              ([file, name], index) =>
                `<li class="popart-cell${index === 0 ? ' popart-plate' : ''}"><img src="/about/assets/${file}" width="657" height="492" loading="lazy" alt="${escapeHtml(name)}" /><span class="popart-label"><b>${escapeHtml(name)}</b>${escapeHtml(text.popart.labels[index])}</span></li>`,
            )
            .join('\n          ')}
        </ul>
        <p class="popart-note">${escapeHtml(text.popart.note)}</p>
      </section>
      <section class="split-section section" id="formats" aria-labelledby="formats-title">
        <div><p class="eyebrow"><span></span>${escapeHtml(text.formats.eyebrow)}</p><h2 id="formats-title">${escapeHtml(text.formats.title)}</h2><p>${escapeHtml(text.formats.lead)}</p><div class="format-groups"><div><strong>${escapeHtml(text.formats.open)}</strong><ul class="format-list"><li>OpenRaster</li><li>PNG</li><li>JPEG</li><li>WebP</li><li>AVIF</li><li>GIF</li><li>BMP</li><li>TIFF</li><li>SVG</li><li>ICO</li><li>PPM</li><li>TGA</li></ul></div><div><strong>${escapeHtml(text.formats.save)}</strong><ul class="format-list"><li>OpenRaster</li><li>PNG</li><li>JPEG</li><li>WebP</li><li>BMP</li><li>TIFF</li><li>PPM</li><li>TGA</li></ul></div></div></div>
        <figure class="light-preview"><img src="/about/assets/editor-light.webp" width="960" height="640" loading="lazy" alt="${escapeHtml(text.formats.theme)}" /><figcaption>${escapeHtml(text.formats.theme)}</figcaption></figure>
      </section>

      <section class="local-first section" aria-labelledby="local-title"><div class="local-orb" aria-hidden="true"><span>⌁</span></div><div><p class="eyebrow"><span></span>${escapeHtml(text.local.eyebrow)}</p><h2 id="local-title">${escapeHtml(text.local.title[0])}<br />${escapeHtml(text.local.title[1])}</h2><p>${escapeHtml(text.local.lead)}</p></div><ul class="local-points">${text.local.points.map(([title, description]) => `<li><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></li>`).join('')}</ul></section>

      <section class="questions section" id="questions" aria-labelledby="questions-title"><div class="section-heading section-heading-left"><p class="eyebrow"><span></span>${escapeHtml(text.faq.eyebrow)}</p><h2 id="questions-title">${escapeHtml(text.faq.title)}</h2></div><div class="faq-list">${text.faq.items.map(([question, answer], index) => `<details${index === 0 ? ' open' : ''}><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join('')}</div></section>
      <section class="final-cta" aria-labelledby="cta-title"><img src="/apps/com.github.PintaProject.Pinta.svg" width="96" height="96" alt="" /><p class="eyebrow"><span></span>${escapeHtml(text.final.eyebrow)}</p><h2 id="cta-title">${escapeHtml(text.final.title)}</h2><p>${escapeHtml(text.final.lead)}</p><a class="button button-primary" href="${editorPath(locale)}">${escapeHtml(text.final.button)} <span aria-hidden="true">→</span></a></section>
    </main>

    <footer class="site-footer"><a class="brand" href="${editorPath(locale)}"><img src="/apps/com.github.PintaProject.Pinta.svg" width="34" height="34" alt="" /><span><strong>Pinta</strong> Online</span></a><p>${escapeHtml(text.footer.description)} ${escapeHtml(text.footer.portedBy)} <a href="https://github.com/evgenyvinnik/pinta-online">Evgeny Vinnik</a>.</p><nav aria-label="Footer navigation"><a href="${editorPath(locale)}">${escapeHtml(text.footer.editor)}</a><a href="${aboutPath(locale)}" aria-current="page">${escapeHtml(text.nav[0])}</a><a href="/promo/">Quick designs</a><a href="/user-guide/">User Guide</a><a href="https://github.com/evgenyvinnik/pinta-online">${escapeHtml(text.footer.source)}</a><a href="https://www.pinta-project.com">${escapeHtml(text.footer.project)}</a><a href="https://github.com/evgenyvinnik/pinta-online/issues/new?template=bug.md">${escapeHtml(text.footer.issue)}</a></nav>${footerLanguageLinks(locale, text.languageLabel)}<small><span>Pinta Online <strong data-app-version>__PINTA_ONLINE_VERSION__</strong></span><span>${escapeHtml(text.footer.copyright)}</span></small></footer>
  </body>
</html>
`;
}

function sitemap() {
  const entries = [
    ...allCodes.map((locale) => ({ path: editorPath(locale), kind: 'editor' })),
    ...allCodes.map((locale) => ({ path: aboutPath(locale), kind: 'about' })),
    { path: '/promo/' },
    { path: '/user-guide/' },
  ];
  const alternateElements = (kind) => {
    const pathFor = kind === 'editor' ? editorPath : aboutPath;
    return [
      ...allCodes.map(
        (locale) => `    <xhtml:link rel="alternate" hreflang="${locale}" href="${origin}${pathFor(locale)}" />`,
      ),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${origin}${pathFor('en')}" />`,
    ].join('\n');
  };
  const urlElement = ({ path, kind }) =>
    ['  <url>', `    <loc>${origin}${path}</loc>`, kind ? alternateElements(kind) : '', '  </url>']
      .filter(Boolean)
      .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.map(urlElement).join('\n')}
</urlset>
`;
}

/**
 * The pop-art plates, paired with the effect name in the target language.
 *
 * The names are read from the generated runtime catalogs rather than restated in the copy blocks
 * above: they are the same strings the menus show, so a label here can never drift from what the
 * reader will actually find in the Effects menu. The first plate is untreated and has no effect
 * name, so it takes the locale's own word for it from the label list.
 */
function popartPlates(locale) {
  const catalog = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${locale}.json`), 'utf8'));
  const name = (english) => catalog[english] ?? english;
  return [
    ['pop-original.webp', copy[locale].popart.untreated],
    ['pop-halftone.webp', name('Hexagon Pixelate')],
    ['pop-inksketch.webp', name('Ink Sketch')],
    ['pop-aberration.webp', name('Chromatic Aberration')],
    ['pop-scanlines.webp', name('Scanlines')],
    ['pop-artifacts.webp', name('Colored Artifacts')],
    ['pop-posterize.webp', name('Posterize')],
    ['pop-invert.webp', name('Invert Colors')],
    ['pop-nightvision.webp', name('Night Vision')],
    ['pop-oilpaint.webp', name('Oil Painting')],
  ];
}

const outputs = new Map([[resolve(root, 'web-assets/seo/sitemap.xml'), sitemap()]]);
for (const locale of localizedCodes) {
  outputs.set(resolve(root, locale, 'index.html'), editorPage(locale, copy[locale]));
  outputs.set(resolve(root, locale, 'about/index.html'), aboutPage(locale, copy[locale]));
}
for (const locale of runtimeCodes.filter((code) => code !== 'en' && !localizedCodes.includes(code))) {
  outputs.set(resolve(root, locale, 'index.html'), editorLocaleShell(locale));
}

let staleFiles = 0;
for (const [path, content] of outputs) {
  if (checkOnly) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      staleFiles += 1;
      console.error(`${path.slice(root.length + 1)} is stale; run npm run seo:sync`);
    }
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`Generated ${path.slice(root.length + 1)}`);
}

if (staleFiles) process.exit(1);
if (checkOnly) console.log('Localized SEO pages and sitemap are synchronized.');
