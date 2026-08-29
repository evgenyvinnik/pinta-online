import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { localeLoaders, SEO_LOCALE_CODES, SUPPORTED_LOCALES, type LocaleCode } from './locales.generated';

export { I18N_CATALOG_SUMMARY, SEO_LOCALE_CODES, SUPPORTED_LOCALES, type LocaleCode } from './locales.generated';

const LANGUAGE_STORAGE_KEY = 'pinta-online-language';
const localeCodes = SUPPORTED_LOCALES.map(({ code }) => code);
const localeByNormalizedCode = new Map(SUPPORTED_LOCALES.map((locale) => [locale.code.toLowerCase(), locale]));
const seoLocaleCodes = new Set<string>(SEO_LOCALE_CODES);

function supportedLocale(candidate: string | null | undefined): LocaleCode | null {
  const normalized = candidate?.trim().replaceAll('_', '-').toLowerCase();
  if (!normalized) return null;
  const exact = localeByNormalizedCode.get(normalized);
  if (exact) return exact.code;

  const base = normalized.split('-')[0];
  const baseLocale = localeByNormalizedCode.get(base);
  if (baseLocale) return baseLocale.code;
  return SUPPORTED_LOCALES.find(({ code }) => code.toLowerCase().startsWith(`${base}-`))?.code ?? null;
}

function pathLocale(pathname: string): LocaleCode | null {
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  const locale = supportedLocale(firstSegment);
  return locale && locale !== 'en' ? locale : null;
}

function initialLocale(): LocaleCode {
  const localizedPath = pathLocale(globalThis.location?.pathname ?? '/');
  if (localizedPath) return localizedPath;
  const queryLocale = supportedLocale(new URLSearchParams(globalThis.location?.search ?? '').get('lang'));
  if (queryLocale) return queryLocale;
  return 'en';
}

function applyDocumentLocale(language: string) {
  const locale = supportedLocale(language) ?? 'en';
  const metadata = localeByNormalizedCode.get(locale.toLowerCase()) ?? SUPPORTED_LOCALES[0];
  document.documentElement.lang = locale;
  document.documentElement.dir = metadata.direction;
  document.documentElement.dataset.locale = locale;
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: {} },
  },
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: localeCodes,
  nonExplicitSupportedLngs: false,
  load: 'currentOnly',
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

applyDocumentLocale(i18n.resolvedLanguage ?? i18n.language);
i18n.on('languageChanged', (language) => {
  applyDocumentLocale(language);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, supportedLocale(language) ?? 'en');
  } catch {
    // Locale persistence is optional in privacy-restricted browser contexts.
  }
});

async function loadLocale(locale: LocaleCode) {
  if (locale !== 'en' && !i18n.hasResourceBundle(locale, 'translation')) {
    const messages = await localeLoaders[locale]();
    i18n.addResourceBundle(locale, 'translation', messages, true, true);
  }
  await i18n.changeLanguage(locale);
}

export const i18nReady = loadLocale(initialLocale());

export async function changeLocale(locale: LocaleCode) {
  await loadLocale(locale);
  const targetPath = editorPathForLocale(locale);
  if (globalThis.location.pathname !== targetPath) globalThis.location.assign(targetPath);
}

export function currentLocale(): LocaleCode {
  return supportedLocale(i18n.resolvedLanguage ?? i18n.language) ?? 'en';
}

export function editorPathForLocale(locale: LocaleCode): string {
  return locale === 'en' ? '/' : `/${locale}/`;
}

export function aboutPathForLocale(locale: LocaleCode): string {
  return locale !== 'en' && seoLocaleCodes.has(locale) ? `/${locale}/about/` : '/about/';
}

export function translateUi(source: string): string {
  if (!source) return source;
  const direct = i18n.t(source, { defaultValue: source });
  if (direct !== source || i18n.exists(source)) return direct;

  const shortcutMatch = source.match(/^(.*?)(\s+\((?:Ctrl|Command|Shift|Alt|Option|F\d|⌘).+\))$/);
  if (shortcutMatch) return `${translateUi(shortcutMatch[1])}${shortcutMatch[2]}`;

  const ellipsisMatch = source.match(/^(.*?)(…|\.\.\.)$/);
  if (ellipsisMatch) return `${translateUi(ellipsisMatch[1])}…`;

  const colonMatch = source.match(/^(.*?)(:)$/);
  if (colonMatch) return `${translateUi(colonMatch[1])}:`;

  return source;
}

export function translateDocumentName(fileName: string): string {
  const untitled = fileName.match(/^Unsaved Image (\d+)$/);
  if (!untitled) return fileName;
  return translateUi('Unsaved Image {0}').replace('{0}', untitled[1]);
}

export default i18n;
