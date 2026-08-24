import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import gettextParser from 'gettext-parser';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'src/i18n/locales');
const locales = ['fr', 'de', 'ar', 'he'];
const checkOnly = process.argv.includes('--check');

// These strings are specific to the browser edition and do not exist in Pinta's
// gettext catalogs. Native Pinta translations remain authoritative for all
// matching messages; this small set only covers the web language chooser.
const webOverrides = {
  fr: {
    Apply: 'Appliquer',
    'Choose language': 'Choisir la langue',
    'Interface language': 'Langue de l’interface',
    Language: 'Langue',
    'Language changes apply immediately.': 'Les changements de langue sont appliqués immédiatement.',
    'Keyboard Shortcuts': 'Raccourcis clavier',
    'Features & Screenshots': 'Fonctionnalités et captures d’écran',
    'Pinta Online — free browser-based paint and image editor': 'Pinta Online — éditeur de peinture et d’images gratuit dans le navigateur',
    'Ported to the web by': 'Porté sur le Web par',
    'Quit Pinta': 'Quitter Pinta',
  },
  de: {
    Apply: 'Anwenden',
    'Choose language': 'Sprache auswählen',
    'Interface language': 'Sprache der Benutzeroberfläche',
    Language: 'Sprache',
    'Language changes apply immediately.': 'Sprachänderungen werden sofort übernommen.',
    'Keyboard Shortcuts': 'Tastenkürzel',
    'Features & Screenshots': 'Funktionen und Screenshots',
    'Pinta Online — free browser-based paint and image editor': 'Pinta Online — kostenloser Mal- und Bildeditor im Browser',
    'Ported to the web by': 'Für das Web portiert von',
    'Quit Pinta': 'Pinta beenden',
  },
  ar: {
    Apply: 'تطبيق',
    'Choose language': 'اختر اللغة',
    'Interface language': 'لغة الواجهة',
    Language: 'اللغة',
    'Language changes apply immediately.': 'تُطبّق تغييرات اللغة فورًا.',
    'Keyboard Shortcuts': 'اختصارات لوحة المفاتيح',
    'Features & Screenshots': 'الميزات ولقطات الشاشة',
    'Pinta Online — free browser-based paint and image editor': 'بِنْتا أونلاين — محرر رسم وصور مجاني في المتصفح',
    'Ported to the web by': 'نقله إلى الويب',
    'Quit Pinta': 'اخرج من بِنْتا',
  },
  he: {
    Apply: 'החל',
    'Choose language': 'בחירת שפה',
    'Interface language': 'שפת הממשק',
    Language: 'שפה',
    'Language changes apply immediately.': 'שינוי השפה חל באופן מיידי.',
    'Keyboard Shortcuts': 'קיצורי מקלדת',
    'Features & Screenshots': 'תכונות וצילומי מסך',
    'Pinta Online — free browser-based paint and image editor': 'Pinta Online — עורך ציור ותמונות חינמי בדפדפן',
    'Ported to the web by': 'הוסב לרשת על ידי',
    'Quit Pinta': 'יציאה מפינטה',
  },
};

function normalizeMessage(message) {
  return message
    .replaceAll('...', '…')
    .replace(/_/g, '')
    .trim();
}

function catalogFor(locale) {
  const source = readFileSync(resolve(root, `original/po/${locale}.po`));
  const parsed = gettextParser.po.parse(source);
  const catalog = {};

  for (const context of Object.values(parsed.translations)) {
    for (const entry of Object.values(context)) {
      const sourceMessage = normalizeMessage(entry.msgid ?? '');
      const translatedMessage = normalizeMessage(entry.msgstr?.[0] ?? '');
      if (sourceMessage && translatedMessage) catalog[sourceMessage] = translatedMessage;
    }
  }

  if (catalog['Tool Box'] && !catalog.Tools) catalog.Tools = catalog['Tool Box'];
  Object.assign(catalog, webOverrides[locale]);
  return Object.fromEntries(Object.entries(catalog).sort(([left], [right]) => left.localeCompare(right)));
}

mkdirSync(outputDirectory, { recursive: true });
let staleCatalogs = 0;
for (const locale of locales) {
  const output = `${JSON.stringify(catalogFor(locale), null, 2)}\n`;
  const outputPath = resolve(outputDirectory, `${locale}.json`);
  if (checkOnly) {
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== output) {
      staleCatalogs += 1;
      console.error(`${locale}.json is stale; run npm run i18n:sync`);
    }
  } else {
    writeFileSync(outputPath, output);
    console.log(`Generated ${locale}.json from original/po/${locale}.po`);
  }
}

if (staleCatalogs) process.exit(1);
if (checkOnly) console.log('Generated locale catalogs match the original Pinta gettext sources.');
