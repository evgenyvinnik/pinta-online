import type { BlendMode, Point, ToolId } from './types';

const DATABASE_NAME = 'pinta-online';
const DATABASE_VERSION = 1;
const WORKSPACE_STORE = 'workspace';
const CURRENT_WORKSPACE_KEY = 'current';

export interface PersistedSelection {
  tool: ToolId;
  start: Point;
  end: Point;
  points?: Point[];
  mask?: Blob;
}

export interface PersistedLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  pixels: Blob;
}

export interface PersistedDocument {
  id: string;
  fileName: string;
  dirty: boolean;
  width: number;
  height: number;
  layers: PersistedLayer[];
  activeLayerId: string;
  zoom: number;
  selection: PersistedSelection | null;
}

export interface PersistedWorkspace {
  version: 1;
  activeDocumentId: string;
  untitledCounter: number;
  savedAt: number;
  documents: PersistedDocument[];
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) database.createObjectStore(WORKSPACE_STORE);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open the workspace database.'));
    request.onblocked = () => reject(new Error('The workspace database is blocked by another Pinta tab.'));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('The workspace transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The workspace transaction was aborted.'));
  });
}

export async function loadWorkspace() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(WORKSPACE_STORE, 'readonly');
    const request = transaction.objectStore(WORKSPACE_STORE).get(CURRENT_WORKSPACE_KEY);
    const result = await new Promise<PersistedWorkspace | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as PersistedWorkspace | undefined);
      request.onerror = () => reject(request.error ?? new Error('Could not read the saved workspace.'));
    });
    await waitForTransaction(transaction);
    return result?.version === 1 ? result : undefined;
  } finally {
    database.close();
  }
}

export async function saveWorkspace(workspace: PersistedWorkspace) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(WORKSPACE_STORE, 'readwrite');
    transaction.objectStore(WORKSPACE_STORE).put(workspace, CURRENT_WORKSPACE_KEY);
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}

export async function clearWorkspace() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(WORKSPACE_STORE, 'readwrite');
    transaction.objectStore(WORKSPACE_STORE).delete(CURRENT_WORKSPACE_KEY);
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}

export function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The canvas could not be encoded for workspace storage.'));
    }, 'image/png');
  });
}

export async function canvasFromPngBlob(blob: Blob) {
  const canvas = document.createElement('canvas');
  if ('createImageBitmap' in globalThis) {
    const bitmap = await createImageBitmap(blob);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The stored canvas could not be decoded.'));
      image.src = url;
    });
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
