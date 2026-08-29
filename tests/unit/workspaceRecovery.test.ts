import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { downloadWorkspaceCopy } from '../../src/editor/workspaceRecovery';
import { CURRENT_WORKSPACE_VERSION, type PersistedLayer } from '../../src/editor/workspacePersistence';

/**
 * The recovery path runs when the editor is the broken thing, so these tests drive it the way it
 * actually runs: straight from a stored workspace record, with no editor and no rendering. The
 * IndexedDB stand-in is the one from workspaceMigration.test.ts — jsdom ships no IndexedDB, and a
 * real one would exercise the browser rather than this code.
 */
function fires(run: () => void) {
  return {
    set(this: unknown, handler: (() => void) | null) {
      if (handler)
        queueMicrotask(() => {
          run();
          handler();
        });
    },
  };
}

function withStoredWorkspace(record: unknown) {
  const getRequest = { result: record, error: null };
  Object.defineProperty(
    getRequest,
    'onsuccess',
    fires(() => undefined),
  );
  Object.defineProperty(getRequest, 'onerror', { set: () => undefined });

  const store = { get: () => getRequest };
  const transaction = { error: null, objectStore: () => store };
  Object.defineProperty(
    transaction,
    'oncomplete',
    fires(() => undefined),
  );
  Object.defineProperty(transaction, 'onerror', { set: () => undefined });
  Object.defineProperty(transaction, 'onabort', { set: () => undefined });

  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => store,
    transaction: () => transaction,
    close: () => undefined,
    onversionchange: null as unknown,
  };

  const open = () => {
    const openRequest = { result: database, error: null };
    Object.defineProperty(openRequest, 'onupgradeneeded', { set: () => undefined });
    Object.defineProperty(openRequest, 'onerror', { set: () => undefined });
    Object.defineProperty(openRequest, 'onblocked', { set: () => undefined });
    Object.defineProperty(
      openRequest,
      'onsuccess',
      fires(() => undefined),
    );
    return openRequest;
  };

  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open } });
}

/** Captures what the download would have written, keyed by file name. */
function captureDownloads() {
  const written = new Map<string, Blob>();
  const urls = new Map<string, Blob>();
  let next = 0;

  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      const url = `blob:recovery/${(next += 1)}`;
      urls.set(url, blob);
      return url;
    },
  });
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', { configurable: true, value: () => undefined });

  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const element = createElement(tag) as HTMLElement;
    if (tag !== 'a') return element;
    const anchor = element as HTMLAnchorElement;
    anchor.click = () => {
      const blob = urls.get(anchor.href);
      if (blob) written.set(anchor.download, blob);
    };
    return anchor;
  });

  return written;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const layerPng = (marker: number) => new Blob([new Uint8Array([...PNG_SIGNATURE, marker])]);

function layer(name: string, marker: number, extra: Partial<PersistedLayer> = {}): PersistedLayer {
  return { id: name, name, visible: true, opacity: 1, blendMode: 'normal', pixels: layerPng(marker), ...extra };
}

function storedDocument(fileName: string, layers: PersistedLayer[]) {
  return {
    id: fileName,
    fileName,
    dirty: true,
    width: 640,
    height: 360,
    layers,
    activeLayerId: layers[0].id,
    zoom: 1,
    selection: null,
  };
}

function workspaceWith(documents: unknown[]) {
  return { version: CURRENT_WORKSPACE_VERSION, activeDocumentId: 'a', untitledCounter: 1, savedAt: 0, documents };
}

describe('emergency workspace recovery', () => {
  it('writes a layered document as a readable OpenRaster archive', async () => {
    withStoredWorkspace(
      workspaceWith([
        storedDocument('Sketch.png', [
          layer('Background', 1),
          layer('Ink', 2, { visible: false, opacity: 0.5, blendMode: 'multiply' }),
        ]),
      ]),
    );
    const written = captureDownloads();

    const result = await downloadWorkspaceCopy();

    expect(result).toEqual({ documents: 1, layers: 2, archives: 1 });
    expect([...written.keys()]).toEqual(['Sketch.ora']);

    const archive = unzipSync(new Uint8Array(await written.get('Sketch.ora')!.arrayBuffer()));
    // The mimetype entry is what makes the file identifiable as OpenRaster at all.
    expect(strFromU8(archive.mimetype)).toBe('image/openraster');
    expect(archive['data/layer0.png']).toBeDefined();
    expect(archive['data/layer1.png']).toBeDefined();

    // The point of recovering as .ora rather than loose PNGs is that this survives.
    const stack = strFromU8(archive['stack.xml']);
    expect(stack).toContain('w="640"');
    expect(stack).toContain('name="Ink"');
    expect(stack).toContain('visibility="hidden"');
    expect(stack).toContain('composite-op="svg:multiply"');
  });

  it('orders the recovered stack top layer first, as the format requires', async () => {
    withStoredWorkspace(
      workspaceWith([storedDocument('Order.png', [layer('Bottom', 1), layer('Middle', 2), layer('Top', 3)])]),
    );
    const written = captureDownloads();

    await downloadWorkspaceCopy();

    const archive = unzipSync(new Uint8Array(await written.get('Order.ora')!.arrayBuffer()));
    const names = [...strFromU8(archive['stack.xml']).matchAll(/<layer\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(['Top', 'Middle', 'Bottom']);
  });

  it('recovers every open document, not just the active one', async () => {
    withStoredWorkspace(
      workspaceWith([storedDocument('First.png', [layer('a', 1)]), storedDocument('Second.jpg', [layer('b', 2)])]),
    );
    const written = captureDownloads();

    const result = await downloadWorkspaceCopy();

    expect(result).toEqual({ documents: 2, layers: 2, archives: 2 });
    expect([...written.keys()].sort()).toEqual(['First.ora', 'Second.ora']);
  });

  it('falls back to loose layer PNGs when the archive cannot be built', async () => {
    // A layer whose pixels are not a Blob is exactly the corruption this path exists for.
    const broken = { ...layer('Background', 1), pixels: null as unknown as Blob };
    withStoredWorkspace(workspaceWith([storedDocument('Broken.png', [broken])]));
    const written = captureDownloads();

    await expect(downloadWorkspaceCopy()).rejects.toThrow(/could not be read/);
    expect(written.size).toBe(0);
  });

  it('refuses politely when there is nothing stored', async () => {
    withStoredWorkspace(workspaceWith([]));
    captureDownloads();

    await expect(downloadWorkspaceCopy()).rejects.toThrow(/no saved work/);
  });
});
