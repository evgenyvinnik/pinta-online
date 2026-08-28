import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import gettextParser from 'gettext-parser';
import { loadLocaleInventory } from './i18n-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'src/i18n/locales');
const checkOnly = process.argv.includes('--check');
const inventory = loadLocaleInventory(root);
const locales = inventory.locales.filter(({ code }) => code !== 'en');
const generatedModulePath = resolve(root, 'src/i18n/locales.generated.ts');
const generatedManifestPath = resolve(root, 'src/i18n/locales.generated.json');

// These strings are specific to the browser edition and do not exist in Pinta's
// gettext catalogs. Native Pinta translations remain authoritative for all
// matching messages; this small set only covers the web language chooser.
const webOverrides = {
  fr: {
    Apply: 'Appliquer',
    Saving: 'Enregistrement…',
    Name: 'Nom',
    Format: 'Format',
    'File name': 'Nom du fichier',
    'File format': 'Format du fichier',
    'JPEG quality': 'Qualité JPEG',
    'Save Image As': 'Enregistrer l’image sous',
    'No image open': 'Aucune image ouverte',
    'Create a new image or open an existing image to start editing.': 'Créez une nouvelle image ou ouvrez une image existante pour commencer.',
    'Choose language': 'Choisir la langue',
    'Interface language': 'Langue de l’interface',
    Language: 'Langue',
    'Language changes apply immediately.': 'Les changements de langue sont appliqués immédiatement.',
    'Keyboard Shortcuts': 'Raccourcis clavier',
    'Features & Screenshots': 'Fonctionnalités et captures d’écran',
    'Pinta Online — free browser-based paint and image editor': 'Pinta Online — éditeur de peinture et d’images gratuit dans le navigateur',
    'Ported to the web by': 'Porté sur le Web par',
    'Add Primary Color': 'Ajouter la couleur primaire',
    'Add Palette Color': 'Ajouter une couleur de palette',
    'Pinta Online could not continue': 'Pinta Online n’a pas pu continuer',
    'The drawing area stopped responding': 'La zone de dessin ne répond plus',
    'The tool windows stopped responding': 'Les fenêtres d’outils ne répondent plus',
    'This dialog stopped responding': 'Cette boîte de dialogue ne répond plus',
    'An unexpected error interrupted the editor. Your saved work is still stored in this browser.': 'Une erreur inattendue a interrompu l’éditeur. Votre travail enregistré est toujours stocké dans ce navigateur.',
    'The rest of the editor is still usable. Reload to bring the drawing area back.': 'Le reste de l’éditeur reste utilisable. Rechargez pour rétablir la zone de dessin.',
    'The rest of the editor is still usable. Reload to bring the Layers and History windows back.': 'Le reste de l’éditeur reste utilisable. Rechargez pour rétablir les fenêtres Calques et Historique.',
    'Close the dialog to keep working. Your image has not been changed.': 'Fermez la boîte de dialogue pour continuer. Votre image n’a pas été modifiée.',
    'If reloading brings the error straight back, the saved workspace is likely the cause. Start without it, or download a copy of your layers first.': 'Si le rechargement ramène immédiatement l’erreur, l’espace de travail enregistré en est probablement la cause. Démarrez sans lui, ou téléchargez d’abord une copie de vos calques.',
    Reload: 'Recharger',
    'Reload without restoring': 'Recharger sans restaurer',
    'Download a copy': 'Télécharger une copie',
    'Started without your saved workspace.': 'Démarré sans votre espace de travail enregistré.',
    'Saving is paused so the stored work is not overwritten. Open or export what you need, then reload normally.': 'L’enregistrement est suspendu afin de ne pas écraser le travail stocké. Ouvrez ou exportez ce dont vous avez besoin, puis rechargez normalement.',
    'Zoom level': 'Niveau de zoom',
    'Selection size': 'Taille de la sélection',
    'Minimize Layers': 'Réduire les Calques',
    'Restore Layers': 'Restaurer les Calques',
    'Minimize History': 'Réduire l’Historique',
    'Restore History': 'Restaurer l’Historique',
    'Resize tool windows': 'Redimensionner les fenêtres d’outils',
    'Resize Layers and History': 'Redimensionner Calques et Historique',
    'Choose zoom level': 'Choisir le niveau de zoom',
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
    'Page setup': 'Mise en page',
    Orientation: 'Orientation',
    Scaling: 'Mise à l’échelle',
    'Scale to fit one page': 'Ajuster à une page',
    'Actual size (96 PPI)': 'Taille réelle (96 ppp)',
    'Custom scale': 'Échelle personnalisée',
    Margins: 'Marges',
    'Center image on page': 'Centrer l’image sur la page',
    'Paper size, printer options, and destination remain available in the browser’s print window.': 'Le format du papier, les options d’impression et la destination restent disponibles dans la fenêtre d’impression du navigateur.',
    'one page': 'une page',
    'A pack of stylized digital glitch, scanline, slicing, and artifact effects.': 'Un ensemble d’effets stylisés de glitch numérique, de lignes de balayage, de découpage et d’artefacts.',
    'A hard-edged rectangular brush that paints continuous block-shaped strokes.': 'Un pinceau rectangulaire à bords nets qui peint des traits continus en forme de blocs.',
    'Turns an image into grayscale on paper tinted with the current primary color.': 'Transforme une image en niveaux de gris sur un papier teinté avec la couleur principale actuelle.',
    'Adds configurable hexagonal pixelation with center or average sampling.': 'Ajoute une pixellisation hexagonale configurable avec échantillonnage central ou moyen.',
    'Recolors the image with a night-vision green response and optional sensor noise.': 'Recolore l’image avec une réponse verte de vision nocturne et un bruit de capteur facultatif.',
  },
  de: {
    Apply: 'Anwenden',
    Saving: 'Wird gespeichert…',
    Name: 'Name',
    Format: 'Format',
    'File name': 'Dateiname',
    'File format': 'Dateiformat',
    'JPEG quality': 'JPEG-Qualität',
    'Save Image As': 'Bild speichern unter',
    'No image open': 'Kein Bild geöffnet',
    'Create a new image or open an existing image to start editing.': 'Erstellen Sie ein neues Bild oder öffnen Sie ein vorhandenes Bild, um mit der Bearbeitung zu beginnen.',
    'Choose language': 'Sprache auswählen',
    'Interface language': 'Sprache der Benutzeroberfläche',
    Language: 'Sprache',
    'Language changes apply immediately.': 'Sprachänderungen werden sofort übernommen.',
    'Keyboard Shortcuts': 'Tastenkürzel',
    'Features & Screenshots': 'Funktionen und Screenshots',
    'Pinta Online — free browser-based paint and image editor': 'Pinta Online — kostenloser Mal- und Bildeditor im Browser',
    'Ported to the web by': 'Für das Web portiert von',
    'Add Primary Color': 'Primärfarbe hinzufügen',
    'Add Palette Color': 'Palettenfarbe hinzufügen',
    'Pinta Online could not continue': 'Pinta Online konnte nicht fortfahren',
    'The drawing area stopped responding': 'Der Zeichenbereich reagiert nicht mehr',
    'The tool windows stopped responding': 'Die Werkzeugfenster reagieren nicht mehr',
    'This dialog stopped responding': 'Dieser Dialog reagiert nicht mehr',
    'An unexpected error interrupted the editor. Your saved work is still stored in this browser.': 'Ein unerwarteter Fehler hat den Editor unterbrochen. Die gespeicherte Arbeit liegt weiterhin in diesem Browser.',
    'The rest of the editor is still usable. Reload to bring the drawing area back.': 'Der Rest des Editors bleibt nutzbar. Neu laden, um den Zeichenbereich zurückzuholen.',
    'The rest of the editor is still usable. Reload to bring the Layers and History windows back.': 'Der Rest des Editors bleibt nutzbar. Neu laden, um die Fenster Ebenen und Verlauf zurückzuholen.',
    'Close the dialog to keep working. Your image has not been changed.': 'Den Dialog schließen, um weiterzuarbeiten. Das Bild wurde nicht verändert.',
    'If reloading brings the error straight back, the saved workspace is likely the cause. Start without it, or download a copy of your layers first.': 'Kehrt der Fehler nach dem Neuladen sofort zurück, ist der gespeicherte Arbeitsbereich die wahrscheinliche Ursache. Ohne ihn starten oder zuerst eine Kopie der Ebenen herunterladen.',
    Reload: 'Neu laden',
    'Reload without restoring': 'Ohne Wiederherstellung neu laden',
    'Download a copy': 'Kopie herunterladen',
    'Started without your saved workspace.': 'Ohne den gespeicherten Arbeitsbereich gestartet.',
    'Saving is paused so the stored work is not overwritten. Open or export what you need, then reload normally.': 'Das Speichern ist pausiert, damit die gespeicherte Arbeit nicht überschrieben wird. Öffnen oder exportieren, was gebraucht wird, dann normal neu laden.',
    'Zoom level': 'Zoomstufe',
    'Selection size': 'Auswahlgröße',
    'Minimize Layers': 'Ebenen minimieren',
    'Restore Layers': 'Ebenen wiederherstellen',
    'Minimize History': 'Verlauf minimieren',
    'Restore History': 'Verlauf wiederherstellen',
    'Resize tool windows': 'Werkzeugfenster anpassen',
    'Resize Layers and History': 'Ebenen und Verlauf anpassen',
    'Choose zoom level': 'Zoomstufe wählen',
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
    'Page setup': 'Seiteneinrichtung',
    Orientation: 'Ausrichtung',
    Scaling: 'Skalierung',
    'Scale to fit one page': 'Auf eine Seite einpassen',
    'Actual size (96 PPI)': 'Tatsächliche Größe (96 PPI)',
    'Custom scale': 'Benutzerdefinierte Skalierung',
    Margins: 'Ränder',
    'Center image on page': 'Bild auf der Seite zentrieren',
    'Paper size, printer options, and destination remain available in the browser’s print window.': 'Papierformat, Druckeroptionen und Ziel bleiben im Druckfenster des Browsers verfügbar.',
    'one page': 'eine Seite',
    'A pack of stylized digital glitch, scanline, slicing, and artifact effects.': 'Ein Paket stilisierter digitaler Glitch-, Abtastzeilen-, Schnitt- und Artefakteffekte.',
    'A hard-edged rectangular brush that paints continuous block-shaped strokes.': 'Ein rechteckiger Pinsel mit harten Kanten für durchgehende blockförmige Striche.',
    'Turns an image into grayscale on paper tinted with the current primary color.': 'Wandelt ein Bild in Graustufen auf Papier um, das mit der aktuellen Primärfarbe getönt ist.',
    'Adds configurable hexagonal pixelation with center or average sampling.': 'Fügt konfigurierbare sechseckige Verpixelung mit Mittelwert- oder Mittelpunktabtastung hinzu.',
    'Recolors the image with a night-vision green response and optional sensor noise.': 'Färbt das Bild mit einer grünen Nachtsicht-Kennlinie und optionalem Sensorrauschen neu.',
  },
  ar: {
    Apply: 'تطبيق',
    Saving: 'جارٍ الحفظ…',
    Name: 'الاسم',
    Format: 'التنسيق',
    'File name': 'اسم الملف',
    'File format': 'تنسيق الملف',
    'JPEG quality': 'جودة JPEG',
    'Save Image As': 'حفظ الصورة باسم',
    'No image open': 'لا توجد صورة مفتوحة',
    'Create a new image or open an existing image to start editing.': 'أنشئ صورة جديدة أو افتح صورة موجودة لبدء التحرير.',
    'Choose language': 'اختر اللغة',
    'Interface language': 'لغة الواجهة',
    Language: 'اللغة',
    'Language changes apply immediately.': 'تُطبّق تغييرات اللغة فورًا.',
    'Keyboard Shortcuts': 'اختصارات لوحة المفاتيح',
    'Features & Screenshots': 'الميزات ولقطات الشاشة',
    'Pinta Online — free browser-based paint and image editor': 'بِنْتا أونلاين — محرر رسم وصور مجاني في المتصفح',
    'Ported to the web by': 'نقله إلى الويب',
    'Add Primary Color': 'إضافة اللون الأساسي',
    'Add Palette Color': 'إضافة لون إلى اللوحة',
    'Pinta Online could not continue': 'تعذّر على بِنْتا أونلاين المتابعة',
    'The drawing area stopped responding': 'توقّفت منطقة الرسم عن الاستجابة',
    'The tool windows stopped responding': 'توقّفت نوافذ الأدوات عن الاستجابة',
    'This dialog stopped responding': 'توقّف هذا الحوار عن الاستجابة',
    'An unexpected error interrupted the editor. Your saved work is still stored in this browser.': 'أوقف خطأ غير متوقع المحرر. عملك المحفوظ لا يزال مخزّنًا في هذا المتصفح.',
    'The rest of the editor is still usable. Reload to bring the drawing area back.': 'بقية المحرر ما زالت قابلة للاستخدام. أعد التحميل لاستعادة منطقة الرسم.',
    'The rest of the editor is still usable. Reload to bring the Layers and History windows back.': 'بقية المحرر ما زالت قابلة للاستخدام. أعد التحميل لاستعادة نافذتي الطبقات والسجل.',
    'Close the dialog to keep working. Your image has not been changed.': 'أغلق الحوار لمتابعة العمل. لم تتغيّر صورتك.',
    'If reloading brings the error straight back, the saved workspace is likely the cause. Start without it, or download a copy of your layers first.': 'إذا عاد الخطأ فور إعادة التحميل، فالأرجح أن مساحة العمل المحفوظة هي السبب. ابدأ بدونها، أو نزّل نسخة من طبقاتك أولًا.',
    Reload: 'إعادة التحميل',
    'Reload without restoring': 'إعادة التحميل دون استعادة',
    'Download a copy': 'تنزيل نسخة',
    'Started without your saved workspace.': 'بدأ التشغيل دون مساحة العمل المحفوظة.',
    'Saving is paused so the stored work is not overwritten. Open or export what you need, then reload normally.': 'الحفظ متوقف مؤقتًا حتى لا يُكتب فوق العمل المخزّن. افتح أو صدّر ما تحتاجه، ثم أعد التحميل بشكل طبيعي.',
    'Zoom level': 'مستوى التكبير',
    'Selection size': 'حجم التحديد',
    'Minimize Layers': 'تصغير الطبقات',
    'Restore Layers': 'استعادة الطبقات',
    'Minimize History': 'تصغير السجل',
    'Restore History': 'استعادة السجل',
    'Resize tool windows': 'تغيير حجم نوافذ الأدوات',
    'Resize Layers and History': 'تغيير حجم الطبقات والسجل',
    'Choose zoom level': 'اختيار مستوى التكبير',
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
    'Page setup': 'إعداد الصفحة',
    Orientation: 'الاتجاه',
    Scaling: 'التحجيم',
    'Scale to fit one page': 'ملاءمة في صفحة واحدة',
    'Actual size (96 PPI)': 'الحجم الفعلي (96 بكسل/بوصة)',
    'Custom scale': 'مقياس مخصص',
    Margins: 'الهوامش',
    'Center image on page': 'توسيط الصورة في الصفحة',
    'Paper size, printer options, and destination remain available in the browser’s print window.': 'يظل حجم الورق وخيارات الطابعة والوجهة متاحة في نافذة الطباعة بالمتصفح.',
    'one page': 'صفحة واحدة',
    'A pack of stylized digital glitch, scanline, slicing, and artifact effects.': 'حزمة من تأثيرات الخلل الرقمي وخطوط المسح والتقطيع والتشوهات بأسلوب فني.',
    'A hard-edged rectangular brush that paints continuous block-shaped strokes.': 'فرشاة مستطيلة ذات حواف حادة ترسم ضربات كتلية متصلة.',
    'Turns an image into grayscale on paper tinted with the current primary color.': 'تحوّل الصورة إلى تدرّج رمادي على ورق ملوّن باللون الأساسي الحالي.',
    'Adds configurable hexagonal pixelation with center or average sampling.': 'تضيف بكسلة سداسية قابلة للضبط بأخذ عينة من المركز أو المتوسط.',
    'Recolors the image with a night-vision green response and optional sensor noise.': 'تعيد تلوين الصورة باستجابة خضراء للرؤية الليلية مع ضجيج مستشعر اختياري.',
  },
  he: {
    Apply: 'החל',
    Saving: 'מתבצעת שמירה…',
    Name: 'שם',
    Format: 'תבנית',
    'File name': 'שם הקובץ',
    'File format': 'תבנית הקובץ',
    'JPEG quality': 'איכות JPEG',
    'Save Image As': 'שמירת תמונה בשם',
    'No image open': 'אין תמונה פתוחה',
    'Create a new image or open an existing image to start editing.': 'צרו תמונה חדשה או פתחו תמונה קיימת כדי להתחיל לערוך.',
    'Choose language': 'בחירת שפה',
    'Interface language': 'שפת הממשק',
    Language: 'שפה',
    'Language changes apply immediately.': 'שינוי השפה חל באופן מיידי.',
    'Keyboard Shortcuts': 'קיצורי מקלדת',
    'Features & Screenshots': 'תכונות וצילומי מסך',
    'Pinta Online — free browser-based paint and image editor': 'Pinta Online — עורך ציור ותמונות חינמי בדפדפן',
    'Ported to the web by': 'הוסב לרשת על ידי',
    'Add Primary Color': 'הוספת הצבע הראשי',
    'Add Palette Color': 'הוספת צבע ללוח',
    'Pinta Online could not continue': 'פינטה אונליין לא הצליחה להמשיך',
    'The drawing area stopped responding': 'אזור הציור הפסיק להגיב',
    'The tool windows stopped responding': 'חלונות הכלים הפסיקו להגיב',
    'This dialog stopped responding': 'תיבת דו־שיח זו הפסיקה להגיב',
    'An unexpected error interrupted the editor. Your saved work is still stored in this browser.': 'שגיאה בלתי צפויה קטעה את העורך. העבודה השמורה שלך עדיין מאוחסנת בדפדפן הזה.',
    'The rest of the editor is still usable. Reload to bring the drawing area back.': 'שאר העורך עדיין שמיש. יש לרענן כדי להחזיר את אזור הציור.',
    'The rest of the editor is still usable. Reload to bring the Layers and History windows back.': 'שאר העורך עדיין שמיש. יש לרענן כדי להחזיר את חלונות השכבות וההיסטוריה.',
    'Close the dialog to keep working. Your image has not been changed.': 'יש לסגור את תיבת הדו־שיח כדי להמשיך לעבוד. התמונה שלך לא השתנתה.',
    'If reloading brings the error straight back, the saved workspace is likely the cause. Start without it, or download a copy of your layers first.': 'אם השגיאה חוזרת מיד לאחר הרענון, סביר שמרחב העבודה השמור הוא הסיבה. אפשר להתחיל בלעדיו, או להוריד תחילה עותק של השכבות.',
    Reload: 'רענון',
    'Reload without restoring': 'רענון ללא שחזור',
    'Download a copy': 'הורדת עותק',
    'Started without your saved workspace.': 'ההפעלה בוצעה ללא מרחב העבודה השמור.',
    'Saving is paused so the stored work is not overwritten. Open or export what you need, then reload normally.': 'השמירה מושהית כדי שהעבודה השמורה לא תידרס. יש לפתוח או לייצא את הנדרש, ואז לרענן כרגיל.',
    'Zoom level': 'רמת התקריב',
    'Selection size': 'גודל הבחירה',
    'Minimize Layers': 'מזעור השכבות',
    'Restore Layers': 'שחזור השכבות',
    'Minimize History': 'מזעור ההיסטוריה',
    'Restore History': 'שחזור ההיסטוריה',
    'Resize tool windows': 'שינוי גודל חלונות הכלים',
    'Resize Layers and History': 'שינוי גודל שכבות והיסטוריה',
    'Choose zoom level': 'בחירת רמת התקריב',
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
    'Page setup': 'הגדרת עמוד',
    Orientation: 'כיוון',
    Scaling: 'שינוי קנה מידה',
    'Scale to fit one page': 'התאמה לעמוד אחד',
    'Actual size (96 PPI)': 'גודל בפועל (96 PPI)',
    'Custom scale': 'קנה מידה מותאם אישית',
    Margins: 'שוליים',
    'Center image on page': 'מרכוז התמונה בעמוד',
    'Paper size, printer options, and destination remain available in the browser’s print window.': 'גודל הנייר, אפשרויות המדפסת והיעד נשארים זמינים בחלון ההדפסה של הדפדפן.',
    'one page': 'עמוד אחד',
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
  const source = readFileSync(resolve(root, `original/po/${locale.poLocale}.po`));
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
  Object.assign(catalog, webOverrides[locale.code]);
  return Object.fromEntries(Object.entries(catalog).sort(([left], [right]) => left.localeCompare(right)));
}

function generatedModule() {
  const publicLocales = inventory.locales.map(({ code, name, direction, coverage, preserved }) => ({
    code, name, direction, coverage, preserved,
  }));
  const loaders = locales.map(({ code }) => (
    `  ${JSON.stringify(code)}: () => import(${JSON.stringify(`./locales/${code}.json`)}).then((module) => module.default),`
  )).join('\n');

  return `// Generated by scripts/generate-i18n-catalogs.mjs. Do not edit by hand.\n` +
    `export const SUPPORTED_LOCALES = ${JSON.stringify(publicLocales, null, 2)} as const;\n\n` +
    `export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]['code'];\n\n` +
    `export const SEO_LOCALE_CODES = ${JSON.stringify(inventory.seoLocales)} as const;\n\n` +
    `export const I18N_CATALOG_SUMMARY = ${JSON.stringify({
      threshold: inventory.threshold,
      templateMessages: inventory.templateMessages,
      upstreamCatalogs: inventory.upstreamCatalogs,
      qualifyingCatalogs: inventory.qualifyingCatalogs,
      shippedCatalogs: locales.length,
    }, null, 2)} as const;\n\n` +
    `export const localeLoaders = {\n${loaders}\n} satisfies Record<Exclude<LocaleCode, 'en'>, () => Promise<Record<string, string>>>;\n`;
}

function generatedManifest() {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function synchronize(path, output, staleMessage) {
  if (checkOnly) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== output) {
      staleCatalogs += 1;
      console.error(staleMessage);
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, output);
}

mkdirSync(outputDirectory, { recursive: true });
let staleCatalogs = 0;
for (const locale of locales) {
  const output = `${JSON.stringify(catalogFor(locale), null, 2)}\n`;
  const outputPath = resolve(outputDirectory, `${locale.code}.json`);
  synchronize(outputPath, output, `${locale.code}.json is stale; run npm run i18n:sync`);
  if (!checkOnly) console.log(`Generated ${locale.code}.json from original/po/${locale.poLocale}.po`);
}
synchronize(generatedModulePath, generatedModule(), 'locales.generated.ts is stale; run npm run i18n:sync');
synchronize(generatedManifestPath, generatedManifest(), 'locales.generated.json is stale; run npm run i18n:sync');

if (staleCatalogs) process.exit(1);
if (checkOnly) console.log(`${locales.length} generated locale catalogs and their coverage manifest match the original Pinta gettext sources.`);
