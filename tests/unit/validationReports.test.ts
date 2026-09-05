import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function withReport(script: string, inspect: (output: string) => void) {
  const output = mkdtempSync(path.join(tmpdir(), 'pinta-review-test-'));
  try {
    execFileSync(process.execPath, [script], {
      env: { ...process.env, PINTA_REVIEW_OUTPUT: output },
      stdio: 'pipe',
    });
    inspect(output);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

describe('manual validation reports', () => {
  it('pairs full native workspaces and supplemental dialogs without stretching images', () => {
    withReport('scripts/build-visual-review.mjs', (output) => {
      const html = readFileSync(path.join(output, 'manual-comparison.html'), 'utf8');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const workspace = [...doc.querySelectorAll('article')].find(
        (card) => card.querySelector('code')?.textContent === 'workspace-default-dark.png',
      );
      expect(workspace?.getAttribute('data-missing')).toBe('false');
      expect(workspace?.querySelector('.provenance')?.textContent).toContain('pinta-reference/');
      expect(doc.querySelectorAll('article[data-missing="false"]').length).toBeGreaterThanOrEqual(110);
      expect(html).toContain('height: auto');
      expect(html).toContain('Actual pixels');
      expect(html).toContain('not a fresh capture');
    });
  });

  it('creates all 25 review sheets with original text, context and no invented approval', () => {
    withReport('scripts/build-translation-review.mjs', (output) => {
      const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8')) as {
        locale: string;
        digest: string;
        strings: number;
        status: string;
      }[];
      expect(manifest).toHaveLength(25);
      for (const locale of manifest) {
        expect(locale.strings).toBe(98);
        expect(locale.digest).toMatch(/^[a-f0-9]{64}$/);
        expect(locale.status).toBe('awaiting-fluent-review');
        const doc = new DOMParser().parseFromString(
          readFileSync(path.join(output, `${locale.locale}.html`), 'utf8'),
          'text/html',
        );
        expect(doc.querySelectorAll('article')).toHaveLength(98);
        expect(doc.querySelectorAll('select option[selected]')).toHaveLength(0);
        const data = JSON.parse(doc.querySelector('#review-data')!.textContent!);
        expect(data.digest).toBe(locale.digest);
        expect(
          data.entries.every(
            (entry: { source: string; translation: string; context: string }) =>
              entry.source && entry.translation && entry.context,
          ),
        ).toBe(true);
        expect(doc.querySelector('.example')?.textContent).toContain('120 MB');
      }
    });
  });

  it('ships a correctly sized GitHub preview under the upload limit', () => {
    const png = readFileSync('web-assets/social/github-preview.png');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(1280);
    expect(png.readUInt32BE(20)).toBe(640);
    expect(png.byteLength).toBeLessThan(1_000_000);
  });
});
