import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const webRoot = path.resolve(root, process.env.PINTA_WEB_SCREENSHOTS ?? 'tests/visual/__screenshots__/chromium');
const nativeRoot = path.resolve(root, process.env.PINTA_NATIVE_SCREENSHOTS ?? 'tests/visual/native-dialog-references');
const reportRoot = path.resolve(root, 'playwright-report');
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
    if (entry.isDirectory()) files.push(...await pngFiles(path.join(directory, entry.name), relative));
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

const nativeFileList = await pngFiles(nativeRoot);
const nativeFiles = new Map(nativeFileList.map((file) => [path.basename(file), file]));
const matchedNativeCount = webFiles.filter((file) => nativeFiles.has(path.basename(file))).length;
const categories = [...new Set(webFiles.map((file) => file.split('-')[0]))];
const rows = webFiles.map((file) => {
  const title = file.replace(/\.png$/i, '').replaceAll('-', ' ');
  const webImage = href(path.join(webRoot, file));
  const nativeFile = nativeFiles.get(path.basename(file));
  const hasNative = nativeFile !== undefined;
  const nativeImage = nativeFile ? href(path.join(nativeRoot, nativeFile)) : '';
  return `
    <article class="comparison" data-category="${escapeHtml(file.split('-')[0])}" data-missing="${hasNative ? 'false' : 'true'}">
      <header><h2>${escapeHtml(title)}</h2><code>${escapeHtml(file)}</code></header>
      <div class="pair">
        <figure><figcaption>Web implementation</figcaption><a href="${webImage}"><img src="${webImage}" alt="Web ${escapeHtml(title)}"></a></figure>
        <figure><figcaption>Native Pinta${hasNative ? '' : ' — reference missing'}</figcaption>${hasNative ? `<a href="${nativeImage}"><img src="${nativeImage}" alt="Native ${escapeHtml(title)}"></a>` : '<div class="missing">Add a native capture with this exact filename.</div>'}</figure>
      </div>
    </article>`;
}).join('');

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
    img { display: block; width: 100%; max-height: 78vh; object-fit: contain; object-position: top center; background: #111; border-radius: 6px; }
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
  </div>
  <main>${rows}</main>
  <script>
    const category = document.querySelector('#category');
    const missing = document.querySelector('#missing');
    function filter() {
      document.querySelectorAll('.comparison').forEach((card) => {
        const categoryMatches = category.value === 'all' || card.dataset.category === category.value;
        const missingMatches = !missing.checked || card.dataset.missing === 'true';
        card.classList.toggle('hidden', !categoryMatches || !missingMatches);
      });
    }
    category.addEventListener('change', filter);
    missing.addEventListener('change', filter);
  </script>
</body>
</html>`;

await mkdir(reportRoot, { recursive: true });
await writeFile(reportPath, html);
console.log(`Visual comparison report: ${reportPath}`);
console.log(`${matchedNativeCount}/${webFiles.length} web screenshots have a filename-matched native reference (${nativeFiles.size} native references indexed).`);
