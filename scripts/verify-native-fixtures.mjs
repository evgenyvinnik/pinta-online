#!/usr/bin/env node
/**
 * Regenerates the native effect fixtures from the real C# effects and fails if they have drifted.
 *
 * The fixtures in tests/fixtures/native-effects.json are the strongest parity evidence the port
 * has: they pin the web kernels to bytes produced by the actual Pinta effects in original/,
 * including Cairo premultiplication, integer division, float bilinear weights, fixed-point
 * stepping and skipped out-of-bounds samples. They used to come from a transcription that was
 * never kept, which made them impossible to check — section 6 of docs/final_polish.md asks for
 * exactly that to be fixed.
 *
 * The harness needs GTK and Cairo, which a web checkout has no reason to install, so this runs it
 * inside the .NET SDK image by default. Pass --local to use a dotnet on PATH instead.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const fixturePath = path.join(root, 'tests', 'fixtures', 'native-effects.json');
const project = 'tools/effect-fixtures/EffectFixtures.csproj';
const local = process.argv.includes('--local');
const write = process.argv.includes('--write');

function runHarness() {
  if (local) {
    return execFileSync('dotnet', ['run', '--project', project], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  }
  // libadwaita-1-dev pulls in the Cairo and GTK runtime the effects link against. The image is
  // cached after the first run; the install is the slow part, not the render.
  const script = [
    'apt-get update -qq >/dev/null 2>&1',
    'apt-get install -y -qq libadwaita-1-dev >/dev/null 2>&1',
    `dotnet run --project ${project} 2>/dev/null`,
  ].join(' && ');
  return execFileSync(
    'docker',
    ['run', '--rm', '-v', `${root}:/w`, '-w', '/w', 'mcr.microsoft.com/dotnet/sdk:10.0', 'bash', '-c', script],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

let produced;
try {
  produced = JSON.parse(runHarness());
} catch (error) {
  const hint = local
    ? 'Needs a dotnet with GTK and Cairo available. On macOS the Cairo native library is usually absent; drop --local to use Docker.'
    : 'Needs Docker running. With a GTK-capable dotnet on PATH, pass --local instead.';
  fail(`Could not run the native effect harness.\n${hint}\n\n${error.message}`);
}

if (write) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(fixturePath, `${JSON.stringify(produced, null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, fixturePath)} from the native effects.`);
  process.exit(0);
}

const stored = JSON.parse(readFileSync(fixturePath, 'utf8'));
const differences = [];

for (const key of ['width', 'height']) {
  if (stored[key] !== produced[key]) differences.push(`${key}: stored ${stored[key]}, native ${produced[key]}`);
}
if (String(stored.source) !== String(produced.source)) {
  differences.push('source: the input the fixtures were rendered from has changed');
}

const names = new Set([...Object.keys(stored.effects ?? {}), ...Object.keys(produced.effects)]);
for (const name of [...names].sort()) {
  const storedBytes = stored.effects?.[name];
  const nativeBytes = produced.effects[name];
  if (!storedBytes) {
    differences.push(`${name}: produced by the harness but missing from the fixture file`);
    continue;
  }
  if (!nativeBytes) {
    differences.push(`${name}: in the fixture file but no longer produced by the harness`);
    continue;
  }
  const first = storedBytes.findIndex((value, index) => value !== nativeBytes[index]);
  if (first !== -1 || storedBytes.length !== nativeBytes.length) {
    const pixel = Math.floor(first / 4);
    const channel = ['R', 'G', 'B', 'A'][first % 4];
    differences.push(
      `${name}: first difference at pixel ${pixel} channel ${channel} — ` +
        `stored ${storedBytes[first]}, native ${nativeBytes[first]}`,
    );
  }
}

if (differences.length) {
  fail(
    `The stored native effect fixtures no longer match the C# effects:\n\n` +
      differences.map((line) => `  - ${line}`).join('\n') +
      `\n\nIf original/ was updated deliberately, re-record them with:\n` +
      `  node scripts/verify-native-fixtures.mjs --write\n` +
      `and expect the web kernels to need the same change. Never re-record them from the web\n` +
      `implementation's own output — that would make the fixtures agree with whatever it does.`,
  );
}

const count = Object.keys(produced.effects).length;
console.log(`${count} native effect fixtures reproduce exactly from the C# effects in original/.`);
