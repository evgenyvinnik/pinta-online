import { describe, expect, it } from 'vitest';
// Importing runs the bootstrap, which returns early off production, so this is side-effect free
// in jsdom beyond setting the debug object.
import { pageIdentityFor } from '../../web-assets/analytics.js';

describe('pageIdentityFor', () => {
  it('labels the editor, however the root is spelled', () => {
    expect(pageIdentityFor('/')).toBe('Editor');
    expect(pageIdentityFor('/index.html')).toBe('Editor');
  });

  it('labels the static pages', () => {
    expect(pageIdentityFor('/about/')).toBe('About');
    expect(pageIdentityFor('/about/index.html')).toBe('About');
    expect(pageIdentityFor('/promo/')).toBe('Promo');
    expect(pageIdentityFor('/promo/index.html')).toBe('Promo');
    expect(pageIdentityFor('/user-guide/')).toBe('User Guide');
  });

  it('reports a localized page as the same page', () => {
    for (const locale of ['fr', 'de', 'ar', 'he', 'ru', 'ko']) {
      expect(pageIdentityFor(`/${locale}/`), locale).toBe('Editor');
      expect(pageIdentityFor(`/${locale}/about/`), locale).toBe('About');
    }
  });

  it('handles regional locale codes', () => {
    for (const locale of ['pt-BR', 'zh-CN', 'zh-TW', 'en-GB', 'en-CA']) {
      expect(pageIdentityFor(`/${locale}/`), locale).toBe('Editor');
      expect(pageIdentityFor(`/${locale}/about/`), locale).toBe('About');
    }
  });

  it('does not mistake a page name for a locale prefix', () => {
    // '/about/' begins with two letters; stripping them would report it as the editor.
    expect(pageIdentityFor('/about/')).toBe('About');
    expect(pageIdentityFor('/promo/')).toBe('Promo');
    expect(pageIdentityFor('/user-guide/')).toBe('User Guide');
  });

  it('never returns anything outside the fixed set', () => {
    const allowed = new Set(['Editor', 'About', 'Promo', 'User Guide', 'Other']);
    const paths = [
      '/',
      '/about/',
      '/promo/',
      '/user-guide/',
      '/fr/',
      '/pt-BR/about/',
      '/anything/else/',
      '/deeply/nested/path/',
      '',
      '/x',
      '/404.html',
    ];
    for (const path of paths) expect(allowed.has(pageIdentityFor(path)), path).toBe(true);
  });

  it('cannot echo a document name back, whatever the path contains', () => {
    // The whole point: nothing the user opened or typed can reach the label.
    const label = pageIdentityFor('/holiday-photos/passport-scan.png');
    expect(label).toBe('Other');
    expect(label).not.toContain('passport');
  });
});
