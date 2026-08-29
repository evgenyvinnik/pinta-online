import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const versioning = readFileSync(resolve(root, '.github/workflows/versioning.yml'), 'utf8');
const checks = readFileSync(resolve(root, '.github/workflows/web-visual.yml'), 'utf8');
const deploy = readFileSync(resolve(root, '.github/workflows/deploy-pages.yml'), 'utf8');

function requireText(source, text, description) {
  if (!source.includes(text)) throw new Error(`Release workflow is missing ${description}.`);
}

function forbidText(source, text, description) {
  if (source.includes(text)) throw new Error(`Release workflow still contains ${description}.`);
}

requireText(versioning, 'workflow_call:', 'the reusable version calculation');
requireText(versioning, 'GITHUB_RUN_NUMBER', 'the monotonic GitHub run number');
requireText(versioning, 'date -u', 'the UTC build date');
forbidText(versioning, 'contents: write', 'repository write permission');
forbidText(versioning, 'git push', 'a post-test version commit');
forbidText(versioning, 'workflow_dispatch:', 'an independent versioning dispatch');
forbidText(versioning, 'gh workflow run', 'a competing deployment dispatch');

requireText(checks, 'uses: ./.github/workflows/versioning.yml', 'the shared version job');
requireText(checks, 'node scripts/set-version.mjs "$PINTA_BUILD_VERSION"', 'build-version injection');
requireText(checks, 'npm run verify:version', 'synchronized version verification');
requireText(checks, 'npm run test:visual:container', 'visual regression coverage');
requireText(checks, 'npm run test:e2e:container', 'browser behavior coverage');
requireText(checks, 'npm run test:performance:container', 'performance budget coverage');
requireText(checks, 'name: github-pages-dist', 'the immutable production artifact');
requireText(checks, 'path: dist', 'the built production directory');
requireText(
  checks,
  "github.event_name == 'push' && github.ref == 'refs/heads/master'",
  'master-only artifact publishing',
);

const injectAt = checks.indexOf('node scripts/set-version.mjs');
const verifyAt = checks.indexOf('npm run verify:version');
const firstTestAt = checks.indexOf('npm run test:unit');
const buildAt = checks.lastIndexOf('npm run build');
const uploadAt = checks.indexOf('name: github-pages-dist');
if (!(injectAt >= 0 && injectAt < verifyAt && verifyAt < firstTestAt && firstTestAt < buildAt && buildAt < uploadAt)) {
  throw new Error('The version must be injected and verified before tests, then the tested build must be uploaded.');
}

requireText(deploy, "workflows: ['Web visual regression']", 'the successful-check workflow trigger');
requireText(deploy, "github.event.workflow_run.conclusion == 'success'", 'the successful-run condition');
requireText(deploy, "github.event.workflow_run.event == 'push'", 'the protected push-only condition');
requireText(deploy, 'uses: actions/download-artifact@v7', 'cross-workflow artifact download');
requireText(deploy, 'name: github-pages-dist', 'the matching production artifact name');
requireText(deploy, 'run-id: ${{ github.event.workflow_run.id }}', 'the exact tested run id');
requireText(deploy, 'github-token: ${{ github.token }}', 'cross-workflow artifact authorization');
forbidText(deploy, 'workflow_dispatch:', 'a manual deployment bypass');
forbidText(deploy, 'actions/checkout', 'a second source checkout');
forbidText(deploy, 'npm run build', 'a second production build');

console.log('Release workflows publish one immutable, versioned, fully tested artifact.');
