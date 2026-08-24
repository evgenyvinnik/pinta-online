import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LOCALES = [
  { code: 'en', name: 'English', direction: 'ltr' },
  { code: 'fr', name: 'Français', direction: 'ltr' },
  { code: 'de', name: 'Deutsch', direction: 'ltr' },
  { code: 'ar', name: 'العربية', direction: 'rtl' },
  { code: 'he', name: 'עברית', direction: 'rtl' },
] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]['code'];

const LANGUAGE_STORAGE_KEY = 'pinta-online-language';
const localeCodes = SUPPORTED_LOCALES.map(({ code }) => code);
const localeLoaders = {
  fr: () => import('./locales/fr.json').then((module) => module.default),
  de: () => import('./locales/de.json').then((module) => module.default),
  ar: () => import('./locales/ar.json').then((module) => module.default),
  he: () => import('./locales/he.json').then((module) => module.default),
};

function supportedLocale(candidate: string | null | undefined): LocaleCode | null {
  const language = candidate?.toLowerCase().split(/[-_]/)[0];
  return localeCodes.includes(language as LocaleCode) ? language as LocaleCode : null;
}

function initialLocale(): LocaleCode {
  const queryLocale = supportedLocale(new URLSearchParams(globalThis.location?.search ?? '').get('lang'));
  if (queryLocale) return queryLocale;
  try {
    const savedLocale = supportedLocale(localStorage.getItem(LANGUAGE_STORAGE_KEY));
    if (savedLocale) return savedLocale;
  } catch {
    // Locale persistence is optional in privacy-restricted browser contexts.
  }
  for (const language of navigator.languages ?? [navigator.language]) {
    const locale = supportedLocale(language);
    if (locale) return locale;
  }
  return 'en';
}

function applyDocumentLocale(language: string) {
  const locale = supportedLocale(language) ?? 'en';
  document.documentElement.lang = locale;
  document.documentElement.dir = i18n.dir(locale);
  document.documentElement.dataset.locale = locale;
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: {} },
    },
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: localeCodes,
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
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
}

export function currentLocale(): LocaleCode {
  return supportedLocale(i18n.resolvedLanguage ?? i18n.language) ?? 'en';
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
