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
    'Add-in Manager': 'Gestionnaire d’extensions',
    'Bundled web add-ins': 'Extensions web intégrées',
    'Enable only the optional tools and effects you want to use.': 'Activez uniquement les outils et effets facultatifs que vous souhaitez utiliser.',
    'Enable all': 'Tout activer',
    'Disable all': 'Tout désactiver',
    Enabled: 'Activée',
    Disabled: 'Désactivée',
    'Upstream source': 'Source d’origine',
    'Changes apply immediately and are saved in this browser. No add-in code is downloaded at runtime.': 'Les modifications s’appliquent immédiatement et sont enregistrées dans ce navigateur. Aucun code d’extension n’est téléchargé à l’exécution.',
    'Enabled add-ins appear in the toolbox, Adjustments, or Effects menus.': 'Les extensions activées apparaissent dans la boîte à outils ou dans les menus Ajustements et Effets.',
    'Independent web implementation': 'Implémentation web indépendante',
    'Block Brush': 'Pinceau bloc',
    'Colored Grayscale': 'Niveaux de gris colorés',
    'Chromatic Aberration': 'Aberration chromatique',
    Scanlines: 'Lignes de balayage',
    'Colored Artifacts': 'Artefacts colorés',
    'Pixel Drag': 'Traînée de pixels',
    'Row Slice': 'Découpage en lignes',
    'Adjustment Noise': 'Bruit d’ajustement',
    'Hexagon Pixelate': 'Pixellisation hexagonale',
    'Night Vision': 'Vision nocturne',
    'Night Vision Effect': 'Effet de vision nocturne',
    Done: 'Terminé',
    'Block Brush tool': 'Outil Pinceau bloc',
    'Colored Grayscale adjustment': 'Ajustement Niveaux de gris colorés',
    'Hexagon Pixelate effect': 'Effet Pixellisation hexagonale',
    'Night Vision effect': 'Effet Vision nocturne',
    'A pack of stylized digital glitch, scanline, slicing, and artifact effects.': 'Un ensemble d’effets stylisés de glitch numérique, de lignes de balayage, de découpage et d’artefacts.',
    'A hard-edged rectangular brush that paints continuous block-shaped strokes.': 'Un pinceau rectangulaire à bords nets qui peint des traits continus en forme de blocs.',
    'Turns an image into grayscale on paper tinted with the current primary color.': 'Transforme une image en niveaux de gris sur un papier teinté avec la couleur principale actuelle.',
    'Adds configurable hexagonal pixelation with center or average sampling.': 'Ajoute une pixellisation hexagonale configurable avec échantillonnage central ou moyen.',
    'Recolors the image with a night-vision green response and optional sensor noise.': 'Recolore l’image avec une réponse verte de vision nocturne et un bruit de capteur facultatif.',
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
    'Add-in Manager': 'Erweiterungsverwaltung',
    'Bundled web add-ins': 'Integrierte Web-Erweiterungen',
    'Enable only the optional tools and effects you want to use.': 'Aktivieren Sie nur die optionalen Werkzeuge und Effekte, die Sie verwenden möchten.',
    'Enable all': 'Alle aktivieren',
    'Disable all': 'Alle deaktivieren',
    Enabled: 'Aktiviert',
    Disabled: 'Deaktiviert',
    'Upstream source': 'Originalquelle',
    'Changes apply immediately and are saved in this browser. No add-in code is downloaded at runtime.': 'Änderungen werden sofort angewendet und in diesem Browser gespeichert. Zur Laufzeit wird kein Erweiterungscode heruntergeladen.',
    'Enabled add-ins appear in the toolbox, Adjustments, or Effects menus.': 'Aktivierte Erweiterungen erscheinen im Werkzeugkasten oder in den Menüs Anpassungen und Effekte.',
    'Independent web implementation': 'Unabhängige Web-Implementierung',
    'Block Brush': 'Blockpinsel',
    'Colored Grayscale': 'Farbiges Graustufenbild',
    'Chromatic Aberration': 'Chromatische Aberration',
    Scanlines: 'Abtastzeilen',
    'Colored Artifacts': 'Farbige Artefakte',
    'Pixel Drag': 'Pixel ziehen',
    'Row Slice': 'Zeilenversatz',
    'Adjustment Noise': 'Anpassungsrauschen',
    'Hexagon Pixelate': 'Sechseckig verpixeln',
    'Night Vision': 'Nachtsicht',
    'Night Vision Effect': 'Nachtsichteffekt',
    Done: 'Fertig',
    'Block Brush tool': 'Blockpinsel-Werkzeug',
    'Colored Grayscale adjustment': 'Anpassung Farbiges Graustufenbild',
    'Hexagon Pixelate effect': 'Effekt Sechseckig verpixeln',
    'Night Vision effect': 'Nachtsichteffekt',
    'A pack of stylized digital glitch, scanline, slicing, and artifact effects.': 'Ein Paket stilisierter digitaler Glitch-, Abtastzeilen-, Schnitt- und Artefakteffekte.',
    'A hard-edged rectangular brush that paints continuous block-shaped strokes.': 'Ein rechteckiger Pinsel mit harten Kanten für durchgehende blockförmige Striche.',
    'Turns an image into grayscale on paper tinted with the current primary color.': 'Wandelt ein Bild in Graustufen auf Papier um, das mit der aktuellen Primärfarbe getönt ist.',
    'Adds configurable hexagonal pixelation with center or average sampling.': 'Fügt konfigurierbare sechseckige Verpixelung mit Mittelwert- oder Mittelpunktabtastung hinzu.',
    'Recolors the image with a night-vision green response and optional sensor noise.': 'Färbt das Bild mit einer grünen Nachtsicht-Kennlinie und optionalem Sensorrauschen neu.',
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
    'Add-in Manager': 'مدير الإضافات',
    'Bundled web add-ins': 'إضافات ويب مضمّنة',
    'Enable only the optional tools and effects you want to use.': 'فعّل فقط الأدوات والتأثيرات الاختيارية التي تريد استخدامها.',
    'Enable all': 'تفعيل الكل',
    'Disable all': 'تعطيل الكل',
    Enabled: 'مفعّلة',
    Disabled: 'معطّلة',
    'Upstream source': 'المصدر الأصلي',
    'Changes apply immediately and are saved in this browser. No add-in code is downloaded at runtime.': 'تُطبّق التغييرات فورًا وتُحفظ في هذا المتصفح. لا يُنزّل أي كود إضافات أثناء التشغيل.',
    'Enabled add-ins appear in the toolbox, Adjustments, or Effects menus.': 'تظهر الإضافات المفعّلة في صندوق الأدوات أو قائمتي التعديلات والتأثيرات.',
    'Independent web implementation': 'تنفيذ ويب مستقل',
    'Block Brush': 'فرشاة الكتلة',
    'Colored Grayscale': 'تدرّج رمادي ملوّن',
    'Chromatic Aberration': 'انحراف لوني',
    Scanlines: 'خطوط المسح',
    'Colored Artifacts': 'تشوهات ملوّنة',
    'Pixel Drag': 'سحب البكسلات',
    'Row Slice': 'تقطيع الصفوف',
    'Adjustment Noise': 'ضجيج الضبط',
    'Hexagon Pixelate': 'بكسلة سداسية',
    'Night Vision': 'رؤية ليلية',
    'Night Vision Effect': 'تأثير الرؤية الليلية',
    Done: 'تم',
    'Block Brush tool': 'أداة فرشاة الكتلة',
    'Colored Grayscale adjustment': 'تعديل التدرّج الرمادي الملوّن',
    'Hexagon Pixelate effect': 'تأثير البكسلة السداسية',
    'Night Vision effect': 'تأثير الرؤية الليلية',
    'A pack of stylized digital glitch, scanline, slicing, and artifact effects.': 'حزمة من تأثيرات الخلل الرقمي وخطوط المسح والتقطيع والتشوهات بأسلوب فني.',
    'A hard-edged rectangular brush that paints continuous block-shaped strokes.': 'فرشاة مستطيلة ذات حواف حادة ترسم ضربات كتلية متصلة.',
    'Turns an image into grayscale on paper tinted with the current primary color.': 'تحوّل الصورة إلى تدرّج رمادي على ورق ملوّن باللون الأساسي الحالي.',
    'Adds configurable hexagonal pixelation with center or average sampling.': 'تضيف بكسلة سداسية قابلة للضبط بأخذ عينة من المركز أو المتوسط.',
    'Recolors the image with a night-vision green response and optional sensor noise.': 'تعيد تلوين الصورة باستجابة خضراء للرؤية الليلية مع ضجيج مستشعر اختياري.',
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
    'Add-in Manager': 'מנהל תוספים',
    'Bundled web add-ins': 'תוספי רשת מובנים',
    'Enable only the optional tools and effects you want to use.': 'יש להפעיל רק את הכלים והאפקטים האופציונליים הרצויים.',
    'Enable all': 'הפעלת הכול',
    'Disable all': 'השבתת הכול',
    Enabled: 'מופעל',
    Disabled: 'מושבת',
    'Upstream source': 'מקור מקורי',
    'Changes apply immediately and are saved in this browser. No add-in code is downloaded at runtime.': 'השינויים חלים מיד ונשמרים בדפדפן הזה. קוד תוספים אינו מורד בזמן הריצה.',
    'Enabled add-ins appear in the toolbox, Adjustments, or Effects menus.': 'תוספים מופעלים יופיעו בארגז הכלים או בתפריטי ההתאמות והאפקטים.',
    'Independent web implementation': 'מימוש רשת עצמאי',
    'Block Brush': 'מברשת בלוק',
    'Colored Grayscale': 'גווני אפור צבעוניים',
    'Chromatic Aberration': 'סטייה כרומטית',
    Scanlines: 'קווי סריקה',
    'Colored Artifacts': 'ארטיפקטים צבעוניים',
    'Pixel Drag': 'גרירת פיקסלים',
    'Row Slice': 'חיתוך שורות',
    'Adjustment Noise': 'רעש התאמה',
    'Hexagon Pixelate': 'פיקסול משושה',
    'Night Vision': 'ראיית לילה',
    'Night Vision Effect': 'אפקט ראיית לילה',
    Done: 'סיום',
    'Block Brush tool': 'כלי מברשת בלוק',
    'Colored Grayscale adjustment': 'התאמת גווני אפור צבעוניים',
    'Hexagon Pixelate effect': 'אפקט פיקסול משושה',
    'Night Vision effect': 'אפקט ראיית לילה',
    'A pack of stylized digital glitch, scanline, slicing, and artifact effects.': 'חבילה של אפקטי תקלה דיגיטלית, קווי סריקה, חיתוך וארטיפקטים מסוגננים.',
    'A hard-edged rectangular brush that paints continuous block-shaped strokes.': 'מברשת מלבנית בעלת קצוות חדים המציירת משיכות בלוק רציפות.',
    'Turns an image into grayscale on paper tinted with the current primary color.': 'הופכת תמונה לגווני אפור על נייר הצבוע בצבע הראשי הנוכחי.',
    'Adds configurable hexagonal pixelation with center or average sampling.': 'מוסיפה פיקסול משושה הניתן להגדרה עם דגימת מרכז או ממוצע.',
    'Recolors the image with a night-vision green response and optional sensor noise.': 'צובעת מחדש את התמונה בתגובה ירוקה של ראיית לילה עם רעש חיישן אופציונלי.',
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
