import { describe, expect, it } from 'vitest';
import { CURRENT_WORKSPACE_VERSION, WorkspaceVersionError, loadWorkspace } from '../../src/editor/workspacePersistence';

/**
 * A minimal stand-in for the single IndexedDB read `loadWorkspace` performs. jsdom ships no
 * IndexedDB, and a real one would exercise the browser rather than the migration chain this
 * covers. Each handler fires as soon as it is assigned, so the fake cannot deadlock on the
 * order the production code happens to attach them in.
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

function workspace(version: number) {
  return { version, activeDocumentId: 'a', untitledCounter: 2, savedAt: 0, documents: [] };
}

describe('workspace schema versioning', () => {
  it('reads a workspace written by this build unchanged', async () => {
    withStoredWorkspace(workspace(CURRENT_WORKSPACE_VERSION));
    await expect(loadWorkspace()).resolves.toMatchObject({ version: CURRENT_WORKSPACE_VERSION });
  });

  it('migrates a v1 workspace forward rather than discarding it', async () => {
    withStoredWorkspace({ ...workspace(1), untitledCounter: 7 });
    const restored = await loadWorkspace();

    expect(restored?.version).toBe(CURRENT_WORKSPACE_VERSION);
    // The migration must carry the payload across, not just stamp a version onto nothing.
    expect(restored?.untitledCounter).toBe(7);
  });

  it('refuses a workspace from a newer build instead of silently replacing it', async () => {
    withStoredWorkspace(workspace(CURRENT_WORKSPACE_VERSION + 1));
    // Returning undefined here would boot empty and then overwrite work this build cannot read.
    await expect(loadWorkspace()).rejects.toBeInstanceOf(WorkspaceVersionError);
  });

  it('ignores a record that is not a workspace at all', async () => {
    for (const junk of [undefined, null, {}, { version: 'two', documents: [] }, { version: 2 }]) {
      withStoredWorkspace(junk);
      await expect(loadWorkspace()).resolves.toBeUndefined();
    }
  });
});
