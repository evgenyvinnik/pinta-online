import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = packageJson.devDependencies['@playwright/test'];
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const volume = `pinta-online-playwright-${version.replaceAll('.', '-')}`;

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--init',
    '--ipc=host',
    '--env',
    'CI=1',
    '--volume',
    `${process.cwd()}:/work`,
    '--volume',
    `${volume}:/work/node_modules`,
    '--workdir',
    '/work',
    image,
    'bash',
    '-lc',
    'npm ci && npm run test:performance:container',
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(`Unable to start Docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
