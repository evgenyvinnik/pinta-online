// Icon file names are string literals, and the dev server / SPA fallback answers an
// unknown /actions/*.svg request with index.html instead of a 404. A typo therefore
// renders a blank image rather than failing the build, so every referenced name is
// checked against the icon sets Vite copies into the bundle.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const iconSets = {
  actions: [
    resolve(root, 'original/Pinta.Resources/icons/hicolor/scalable/actions'),
    resolve(root, 'original/Pinta.Resources/icons/hicolor/16x16/actions'),
  ],
  'standard-icons': [resolve(root, 'web-assets/pinta-standard-icons')],
};

const available = new Map();
for (const [set, directories] of Object.entries(iconSets)) {
  const names = new Set();
  for (const directory of directories) {
    for (const entry of readdirSync(directory)) names.add(entry);
  }
  available.set(set, names);
}

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}

const missing = [];
for (const file of sourceFiles(resolve(root, 'src'))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(
    /\bicon:\s*'([^']+\.(?:svg|png))'|\bfile="([^"]+\.(?:svg|png))"|\bfile=\{'([^']+\.(?:svg|png))'\}/g,
  )) {
    const name = match[1] ?? match[2] ?? match[3];
    // `standard` icons come from the GTK set; everything else is a Pinta action icon.
    const line = source.slice(0, match.index).split('\n').length;
    const context = source.slice(match.index, match.index + 240);
    const set =
      /\bstandard(?:\s*=\s*\{?true\}?)?[\s/>,}]/.test(context) || /standard: true/.test(context)
        ? 'standard-icons'
        : 'actions';
    if (available.get(set).has(name)) continue;
    if (available.get(set === 'actions' ? 'standard-icons' : 'actions').has(name)) continue;
    missing.push(`${relative(root, file)}:${line} → ${name}`);
  }
}

if (missing.length) {
  console.error('Icon names with no matching file:');
  for (const entry of missing) console.error(`  ${entry}`);
  process.exitCode = 1;
} else {
  console.log('Every referenced icon resolves to a Pinta or GTK icon file.');
}
