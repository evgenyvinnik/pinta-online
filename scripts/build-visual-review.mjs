import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const webRoot = path.resolve(root, process.env.PINTA_WEB_SCREENSHOTS ?? 'tests/visual/__screenshots__/chromium');
// The full native capture set includes workspaces, menus and option strips. The detailed
// dialog audit supplements it; indexing only that folder hid most of the comparison evidence.
const nativeRoots = process.env.PINTA_NATIVE_SCREENSHOTS
  ? [path.resolve(root, process.env.PINTA_NATIVE_SCREENSHOTS)]
  : ['tests/visual/pinta-reference', 'tests/visual/native-dialog-references'].map((folder) =>
      path.resolve(root, folder),
    );
const reportRoot = path.resolve(root, process.env.PINTA_REVIEW_OUTPUT ?? 'playwright-report');
const reportPath = path.join(reportRoot, 'manual-comparison.html');

async function pngFiles(directory, prefix = '') {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await pngFiles(path.join(directory, entry.name), relative)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) files.push(relative);
  }
  return files.sort();
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function href(target) {
  return path.relative(reportRoot, target).split(path.sep).map(encodeURIComponent).join('/');
}

const webFiles = await pngFiles(webRoot);
if (!webFiles.length) {
  console.error(`No approved web screenshots found in ${webRoot}. Run npm run test:visual:update first.`);
  process.exit(1);
}

const nativeFiles = new Map();
for (const nativeRoot of nativeRoots) {
  for (const file of await pngFiles(nativeRoot)) {
    const name = path.basename(file);
    if (!nativeFiles.has(name)) nativeFiles.set(name, path.join(nativeRoot, file));
  }
}
const matchedNativeCount = webFiles.filter((file) => nativeFiles.has(path.basename(file))).length;
const categories = [...new Set(webFiles.map((file) => file.split('-')[0]))];
const rows = webFiles
  .map((file) => {
    const title = file.replace(/\.png$/i, '').replaceAll('-', ' ');
    const webImage = href(path.join(webRoot, file));
    const nativeFile = nativeFiles.get(path.basename(file));
    const hasNative = nativeFile !== undefined;
    const nativeImage = nativeFile ? href(nativeFile) : '';
    const boundary = [
      'dialog-new-screenshot.png',
      'dialog-print-image.png',
      'workspace-file-drop.png',
      'workspace-toolbar-hidden.png',
    ].includes(file);
    return `
    <article class="comparison" data-category="${escapeHtml(file.split('-')[0])}" data-missing="${hasNative ? 'false' : 'true'}">
      <header><h2>${escapeHtml(title)}</h2><code>${escapeHtml(file)}</code></header>
      <p class="provenance">${hasNative ? `Reference: ${escapeHtml(path.relative(root, nativeFile))}` : 'Unpaired: not a native-parity pass.'}${boundary ? ' · Platform/web-only difference: reference records the native boundary, not an equivalent dialog.' : ''}</p>
      <div class="pair">
        <figure><figcaption>Web implementation</figcaption><a href="${webImage}"><img src="${webImage}" alt="Web ${escapeHtml(title)}"></a></figure>
        <figure><figcaption>Native Pinta${hasNative ? '' : ' — reference missing'}</figcaption>${hasNative ? `<a href="${nativeImage}"><img src="${nativeImage}" alt="Native ${escapeHtml(title)}"></a>` : '<div class="missing">Add a native capture with this exact filename.</div>'}</figure>
      </div>
    </article>`;
  })
  .join('');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pinta visual comparison</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #171717; color: #f3f3f3; }
    body { margin: 0; }
    .toolbar { position: sticky; z-index: 2; top: 0; display: flex; gap: 12px; align-items: center; padding: 14px 20px; background: rgba(25,25,25,.96); border-bottom: 1px solid #444; backdrop-filter: blur(10px); }
    .toolbar h1 { margin: 0 auto 0 0; font-size: 18px; }
    select, label { font: inherit; }
    main { display: grid; gap: 18px; padding: 18px; }
    .comparison { overflow: hidden; background: #242424; border: 1px solid #3d3d3d; border-radius: 12px; }
    .comparison > header { display: flex; align-items: baseline; gap: 12px; padding: 12px 15px; border-bottom: 1px solid #3d3d3d; }
    h2 { margin: 0; font-size: 15px; text-transform: capitalize; }
    code { color: #aaa; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #3d3d3d; }
    figure { min-width: 0; margin: 0; padding: 12px; background: #202020; }
    figcaption { margin-bottom: 9px; color: #bbb; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    img { display: block; width: 100%; height: auto; background: #111; border-radius: 6px; }
    .provenance, .instructions { padding: 0 15px; color: #bbb; font-size: 13px; }
    body.actual-size figure { overflow: auto; }
    body.actual-size img { width: auto; max-width: none; }
    .missing { min-height: 220px; display: grid; place-items: center; padding: 20px; color: #e4b45f; background: repeating-linear-gradient(135deg, #29251e 0 12px, #24211c 12px 24px); border-radius: 6px; text-align: center; }
    .hidden { display: none; }
    @media (max-width: 900px) { .pair { grid-template-columns: 1fr; } .toolbar { flex-wrap: wrap; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <h1>Pinta visual comparison · ${webFiles.length} web screens · ${nativeFiles.size} native references</h1>
    <label>Category <select id="category"><option value="all">All</option>${categories.map((category) => `<option>${escapeHtml(category)}</option>`).join('')}</select></label>
    <label><input id="missing" type="checkbox"> Missing references only</label>
    <label><input id="actual-size" type="checkbox"> Actual pixels (scroll)</label>
    <label>Find <input id="search" type="search" placeholder="e.g. curves"></label>
  </div>
  <p class="instructions">Approved web baselines versus stored native evidence — not a fresh capture or an automatic parity verdict. Compare control order, labels, defaults, alignment, clipping and enabled state. Open images for detail. Unpaired web-only, localized and output screenshots need separate review; a missing pair does not prove a missing feature.</p>
  <main>${rows}</main>
  <script>
    document.querySelectorAll('figure img').forEach((image) => {
      const showDimensions = () => {
        const caption = image.closest('figure').querySelector('figcaption');
        caption.textContent += ' · ' + image.naturalWidth + '×' + image.naturalHeight;
      };
      if (image.complete && image.naturalWidth) showDimensions();
      else image.addEventListener('load', showDimensions, { once: true });
    });
    const category = document.querySelector('#category');
    const missing = document.querySelector('#missing');
    const search = document.querySelector('#search');
    function filter() {
      document.querySelectorAll('.comparison').forEach((card) => {
        const categoryMatches = category.value === 'all' || card.dataset.category === category.value;
        const missingMatches = !missing.checked || card.dataset.missing === 'true';
        const searchMatches = card.querySelector('header').textContent.toLowerCase().includes(search.value.toLowerCase());
        card.classList.toggle('hidden', !categoryMatches || !missingMatches || !searchMatches);
      });
    }
    category.addEventListener('change', filter);
    missing.addEventListener('change', filter);
    search.addEventListener('input', filter);
    document.querySelector('#actual-size').addEventListener('change', (event) => {
      document.body.classList.toggle('actual-size', event.target.checked);
    });
  </script>
</body>
</html>`;

await mkdir(reportRoot, { recursive: true });
await writeFile(reportPath, html);
console.log(`Visual comparison report: ${reportPath}`);
console.log(
  `${matchedNativeCount}/${webFiles.length} web screenshots have a filename-matched native reference (${nativeFiles.size} native references indexed).`,
);
