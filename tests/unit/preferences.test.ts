import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreferenceState } from '../../src/state/preferences';

const STORAGE_KEY = 'pinta-online-preferences-v1';

/**
 * The persist `merge` is not exported, so drive it the way the browser does: seed localStorage,
 * then import the module fresh. That also covers zustand's own rehydration, which is where a
 * malformed record would actually be met.
 */
async function loadWith(stored: unknown) {
  localStorage.clear();
  if (stored !== undefined) localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: stored, version: 0 }));
  vi.resetModules();
  const { usePreferences } = await import('../../src/state/preferences');
  return usePreferences.getState() as PreferenceState;
}

/** The narrow-screen default is decided by matchMedia, which jsdom does not implement. */
function withScreenWidth(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('max-width: 640px') ? matches : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => withScreenWidth(false));

afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('preference rehydration', () => {
  it('starts from the defaults when nothing is stored', async () => {
    const state = await loadWith(undefined);
    expect(state.theme).toBe('default');
    expect(state.showToolbox).toBe(true);
    expect(state.persistHistory).toBe(true);
    // Add-ins are bundled but opt-in, mirroring installation in the desktop application.
    expect(state.enabledAddins).toEqual([]);
  });

  it('never leaves a defaulted key undefined, whatever the record omits', async () => {
    const state = await loadWith({ theme: 'dark' });
    for (const [key, value] of Object.entries(state)) {
      expect(value, `${key} was undefined after merge`).toBeDefined();
    }
    expect(state.theme).toBe('dark');
  });

  it('keeps stored values it recognises', async () => {
    const state = await loadWith({ theme: 'light', showToolbar: false, rulerMetric: 'inches', persistHistory: false });
    expect(state.theme).toBe('light');
    expect(state.showToolbar).toBe(false);
    expect(state.rulerMetric).toBe('inches');
    expect(state.persistHistory).toBe(false);
  });

  it('hides the docks by default on a phone, and honours an explicit choice there', async () => {
    withScreenWidth(true);
    expect((await loadWith(undefined)).showSidebar).toBe(false);
    // A deliberate choice must survive; only the absence of one consults the screen.
    expect((await loadWith({ showSidebar: true })).showSidebar).toBe(true);
  });

  it('discards add-in ids that no longer exist rather than carrying them forward', async () => {
    const state = await loadWith({ enabledAddins: ['block-brush', 'removed-in-a-later-build', 42] });
    expect(state.enabledAddins).toEqual(['block-brush']);
  });

  it('replaces a non-array add-in record with the defaults', async () => {
    const state = await loadWith({ enabledAddins: 'block-brush' });
    expect(state.enabledAddins).toEqual([]);
  });

  it('keeps only well-formed colours, capped at the palette length', async () => {
    const state = await loadWith({
      recentColors: ['#ff0000', '#00ff00ff', 'red', '#fff', 123, null, ...Array.from({ length: 40 }, () => '#123456')],
    });
    expect(state.recentColors.slice(0, 2)).toEqual(['#ff0000', '#00ff00ff']);
    expect(state.recentColors.every((color) => /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color))).toBe(true);
    expect(state.recentColors.length).toBeLessThanOrEqual(24);
  });

  it('fills in tool settings a record predating them never stored', async () => {
    const fresh = await loadWith(undefined);
    const partial = await loadWith({ toolSettings: { brushSize: 30 } });

    expect(partial.toolSettings.brushSize).toBe(30);
    // Every other key must come from the defaults, not vanish.
    for (const key of Object.keys(fresh.toolSettings)) {
      expect(partial.toolSettings[key as keyof typeof partial.toolSettings]).toBeDefined();
    }
  });

  it('merges per-tool scoping without dropping the tools a record omits', async () => {
    const fresh = await loadWith(undefined);
    const scopeKey = Object.keys(fresh.scopedToolSettings)[0] as keyof typeof fresh.scopedToolSettings;
    const partial = await loadWith({ scopedToolSettings: { [scopeKey]: { paintbrush: 30 } } });

    for (const key of Object.keys(fresh.scopedToolSettings)) {
      expect(partial.scopedToolSettings[key as typeof scopeKey]).toBeDefined();
    }
  });

  it('merges dock layout keys added after the record was written', async () => {
    const fresh = await loadWith(undefined);
    const partial = await loadWith({ dockLayout: { layersMinimized: true } });

    expect(partial.dockLayout.layersMinimized).toBe(true);
    for (const key of Object.keys(fresh.dockLayout)) {
      expect(partial.dockLayout[key as keyof typeof partial.dockLayout]).toBeDefined();
    }
  });

  it('falls back to the defaults when the stored JSON is unparseable', async () => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, '{not json');
    vi.resetModules();
    const { usePreferences } = await import('../../src/state/preferences');

    expect(usePreferences.getState().theme).toBe('default');
  });
});
