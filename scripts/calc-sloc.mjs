#!/usr/bin/env node

/**
 * Count source lines of code for the web implementation, the original Pinta
 * implementation, and supporting tests/tooling.
 *
 * Usage:
 *   npm run sloc
 *   npm run sloc -- --markdown
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = join(scriptDirectory, '..');

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cs',
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.mjs',
  '.scss',
  '.ts',
  '.tsx',
]);

const IGNORED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.next',
  '.nyc_output',
  '.turbo',
  '.vercel',
  'artifacts',
  'bin',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'obj',
  'playwright-report',
  'playwright-report-e2e',
  'test-results',
]);

const IGNORED_FILES = new Set([
  '.DS_Store',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const ORIGINAL_SOURCE_ROOTS = [
  'original/Pinta/',
  'original/Pinta.Core/',
  'original/Pinta.Docking/',
  'original/Pinta.Effects/',
  'original/Pinta.Gui.Addins/',
  'original/Pinta.Gui.Widgets/',
  'original/Pinta.Resources/',
  'original/Pinta.Tools/',
];

const CATEGORY_DEFINITIONS = {
  web: {
    title: 'Web implementation (React / TypeScript)',
    stats: createStats(),
  },
  original: {
    title: 'Original implementation (C# / GTK)',
    stats: createStats(),
  },
  support: {
    title: 'Tests, scripts, and supporting code',
    stats: createStats(),
  },
};

function createStats() {
  return {
    totalFiles: 0,
    totalLines: 0,
    codeLines: 0,
    commentLines: 0,
    blankLines: 0,
    byExtension: new Map(),
  };
}

function normalizedRelativePath(filePath) {
  return relative(rootDirectory, filePath).split(sep).join('/');
}

function categoryFor(relativePath) {
  if (
    relativePath.startsWith('src/') ||
    relativePath.startsWith('about/') ||
    relativePath.startsWith('user-guide/') ||
    relativePath === 'index.html'
  ) {
    return 'web';
  }
  if (ORIGINAL_SOURCE_ROOTS.some((sourceRoot) => relativePath.startsWith(sourceRoot))) {
    return 'original';
  }
  return 'support';
}

function commentSyntax(extension) {
  if (extension === '.html') return { blockStart: '<!--', blockEnd: '-->', lineStart: null };
  if (extension === '.css' || extension === '.scss') return { blockStart: '/*', blockEnd: '*/', lineStart: null };
  return { blockStart: '/*', blockEnd: '*/', lineStart: '//' };
}

function classifyLine(line, extension, state) {
  let remaining = line.trim();
  if (!remaining && !state.inBlockComment) return 'blank';
  const syntax = commentSyntax(extension);
  let containsComment = state.inBlockComment;

  while (true) {
    if (state.inBlockComment) {
      const blockEnd = remaining.indexOf(syntax.blockEnd);
      if (blockEnd === -1) return 'comment';
      state.inBlockComment = false;
      remaining = remaining.slice(blockEnd + syntax.blockEnd.length).trim();
      containsComment = true;
      if (!remaining) return 'comment';
    }

    if (syntax.lineStart && remaining.startsWith(syntax.lineStart)) return 'comment';

    const blockStart = remaining.indexOf(syntax.blockStart);
    const lineStart = syntax.lineStart ? remaining.indexOf(syntax.lineStart) : -1;
    if (lineStart === 0) return 'comment';
    if (lineStart > 0 && (blockStart === -1 || lineStart < blockStart)) return 'code';
    if (blockStart > 0) return 'code';
    if (blockStart === -1) return remaining ? 'code' : containsComment ? 'comment' : 'blank';

    containsComment = true;
    const blockEnd = remaining.indexOf(syntax.blockEnd, syntax.blockStart.length);
    if (blockEnd === -1) {
      state.inBlockComment = true;
      return 'comment';
    }
    remaining = remaining.slice(blockEnd + syntax.blockEnd.length).trim();
    if (!remaining) return 'comment';
  }
}

async function countLines(filePath) {
  const content = await readFile(filePath, 'utf8');
  const extension = extname(filePath).toLowerCase();
  const lines = content ? content.split(/\r?\n/) : [];
  if (lines.at(-1) === '') lines.pop();
  const result = { total: lines.length, code: 0, comments: 0, blank: 0 };
  const state = { inBlockComment: false };

  for (const line of lines) {
    const classification = classifyLine(line, extension, state);
    if (classification === 'code') result.code += 1;
    else if (classification === 'comment') result.comments += 1;
    else result.blank += 1;
  }

  return result;
}

function addToStats(stats, extension, lineStats) {
  stats.totalFiles += 1;
  stats.totalLines += lineStats.total;
  stats.codeLines += lineStats.code;
  stats.commentLines += lineStats.comments;
  stats.blankLines += lineStats.blank;
  const extensionStats = stats.byExtension.get(extension) ?? { files: 0, code: 0, comments: 0, blank: 0 };
  extensionStats.files += 1;
  extensionStats.code += lineStats.code;
  extensionStats.comments += lineStats.comments;
  extensionStats.blank += lineStats.blank;
  stats.byExtension.set(extension, extensionStats);
}

async function walkDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name) || IGNORED_FILES.has(entry.name)) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(extension)) continue;
    const category = categoryFor(normalizedRelativePath(fullPath));
    addToStats(CATEGORY_DEFINITIONS[category].stats, extension, await countLines(fullPath));
  }
}

function formattedNumber(value) {
  return value.toLocaleString('en-US');
}

function paddedNumber(value, width = 11) {
  return formattedNumber(value).padStart(width);
}

function printStatsTable({ title, stats }) {
  console.log(`\n${title}`);
  console.log('-'.repeat(63));
  console.log(`${'Extension'.padEnd(13)}${'Files'.padStart(8)}${'Code'.padStart(12)}${'Comments'.padStart(12)}${'Blank'.padStart(12)}`);
  console.log('-'.repeat(63));
  const extensions = [...stats.byExtension.entries()].sort((left, right) => right[1].code - left[1].code);
  for (const [extension, values] of extensions) {
    console.log(`${extension.padEnd(13)}${paddedNumber(values.files, 8)}${paddedNumber(values.code, 12)}${paddedNumber(values.comments, 12)}${paddedNumber(values.blank, 12)}`);
  }
  console.log('-'.repeat(63));
  console.log(`${'TOTAL'.padEnd(13)}${paddedNumber(stats.totalFiles, 8)}${paddedNumber(stats.codeLines, 12)}${paddedNumber(stats.commentLines, 12)}${paddedNumber(stats.blankLines, 12)}`);
}

function printComparison() {
  const web = CATEGORY_DEFINITIONS.web.stats;
  const original = CATEGORY_DEFINITIONS.original.stats;
  const percentage = original.codeLines ? (web.codeLines / original.codeLines) * 100 : 0;
  console.log('\nImplementation comparison');
  console.log('-'.repeat(63));
  console.log(`${'Metric'.padEnd(20)}${'Web'.padStart(14)}${'Original'.padStart(14)}${'Difference'.padStart(15)}`);
  console.log('-'.repeat(63));
  for (const [label, webValue, originalValue] of [
    ['Files', web.totalFiles, original.totalFiles],
    ['Code lines', web.codeLines, original.codeLines],
    ['Comment lines', web.commentLines, original.commentLines],
    ['Blank lines', web.blankLines, original.blankLines],
    ['Total lines', web.totalLines, original.totalLines],
  ]) {
    const difference = webValue - originalValue;
    const differenceLabel = difference > 0 ? `+${formattedNumber(difference)}` : formattedNumber(difference);
    console.log(`${label.padEnd(20)}${paddedNumber(webValue, 14)}${paddedNumber(originalValue, 14)}${differenceLabel.padStart(15)}`);
  }
  console.log('-'.repeat(63));
  console.log(`Web code lines are ${percentage.toFixed(1)}% of the original production source count.`);
}

function printMarkdown() {
  console.log('| Area | Files | Code | Comments | Blank | Total |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const category of Object.values(CATEGORY_DEFINITIONS)) {
    const { stats } = category;
    console.log(`| ${category.title} | ${formattedNumber(stats.totalFiles)} | ${formattedNumber(stats.codeLines)} | ${formattedNumber(stats.commentLines)} | ${formattedNumber(stats.blankLines)} | ${formattedNumber(stats.totalLines)} |`);
  }
}

async function main() {
  await walkDirectory(rootDirectory);
  if (process.argv.includes('--markdown')) {
    printMarkdown();
    return;
  }
  console.log('\nSLOC (Source Lines of Code) report');
  console.log('='.repeat(63));
  for (const category of Object.values(CATEGORY_DEFINITIONS)) printStatsTable(category);
  printComparison();
  console.log('\nCounts exclude dependencies, generated output, binary assets, lockfiles, and documentation.');
}

main().catch((error) => {
  console.error('Unable to calculate SLOC:', error);
  process.exitCode = 1;
});
