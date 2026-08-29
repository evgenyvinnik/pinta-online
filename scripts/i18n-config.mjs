import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import gettextParser from 'gettext-parser';

export const MIN_UPSTREAM_COVERAGE = 0.9;
export const PRESERVED_LOCALES = ['he'];
export const SEO_LOCALE_CODES = ['en', 'fr', 'de', 'ar', 'he'];

const rtlLanguages = new Set(['ar', 'dv', 'fa', 'he', 'ps', 'ur']);
const localeNameOverrides = {
  en: 'English',
  'en-CA': 'English (Canada)',
  'en-GB': 'English (United Kingdom)',
  id: 'Bahasa Indonesia',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
};

export function sourceLocaleToCode(sourceLocale) {
  return sourceLocale.replaceAll('_', '-');
}

function nativeLocaleName(code) {
  if (localeNameOverrides[code]) return localeNameOverrides[code];
  return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
}

function directionFor(code) {
  return rtlLanguages.has(code.split('-')[0]) ? 'rtl' : 'ltr';
}

function catalogStats(path) {
  const parsed = gettextParser.po.parse(readFileSync(path));
  let total = 0;
  let translated = 0;

  for (const context of Object.values(parsed.translations)) {
    for (const entry of Object.values(context)) {
      if (!entry.msgid) continue;
      total += 1;
      if ((entry.msgstr ?? []).some((message) => message.trim())) translated += 1;
    }
  }

  return { total, translated, coverage: total ? translated / total : 0 };
}

export function loadLocaleInventory(root) {
  const poDirectory = resolve(root, 'original/po');
  const upstream = readdirSync(poDirectory)
    .filter((file) => file.endsWith('.po'))
    .sort()
    .map((file) => {
      const poLocale = file.slice(0, -3);
      const code = sourceLocaleToCode(poLocale);
      const stats = catalogStats(resolve(poDirectory, file));
      return {
        code,
        poLocale,
        name: nativeLocaleName(code),
        direction: directionFor(code),
        translated: stats.translated,
        total: stats.total,
        coverage: Number((stats.coverage * 100).toFixed(1)),
        preserved: PRESERVED_LOCALES.includes(code),
      };
    });
  const selected = upstream.filter((locale) => locale.coverage >= MIN_UPSTREAM_COVERAGE * 100 || locale.preserved);
  const templateMessages = Math.max(...upstream.map(({ total }) => total));

  return {
    threshold: MIN_UPSTREAM_COVERAGE * 100,
    templateMessages,
    upstreamCatalogs: upstream.length,
    qualifyingCatalogs: upstream.filter((locale) => locale.coverage >= MIN_UPSTREAM_COVERAGE * 100).length,
    locales: [
      {
        code: 'en',
        poLocale: null,
        name: nativeLocaleName('en'),
        direction: 'ltr',
        translated: templateMessages,
        total: templateMessages,
        coverage: 100,
        preserved: false,
      },
      ...selected,
    ],
    seoLocales: SEO_LOCALE_CODES,
  };
}
