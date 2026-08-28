import type { AffineTransform, BlendMode, Point, ToolId } from './types';
import { context2d } from './canvasContext';

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

export interface PersistedFloatingPixels {
  layerId: string;
  pixels: Blob;
  transform: AffineTransform;
}

export interface PersistedTextEditor {
  x: number;
  y: number;
  value: string;
}

export interface PersistedTextDrawingOptions {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  alignment: 'left' | 'center' | 'right';
  style: 'fill' | 'fill-outline' | 'outline' | 'background';
  variant: 'normal' | 'small-caps' | 'all-small-caps' | 'petite-caps' | 'all-petite-caps' | 'unicase' | 'title-caps';
  outlineWidth: number;
  lineJoin: CanvasLineJoin;
  primary: string;
  secondary: string;
}

export interface PersistedReeditableText {
  editor: PersistedTextEditor;
  options: PersistedTextDrawingOptions;
  bounds: { x: number; y: number; width: number; height: number };
  layerId: string;
  historyIndex: number;
  basePixels: Blob;
  renderedPixels: Blob;
}

export interface PersistedShapeDrawingOptions {
  primary: string;
  secondary: string;
  size: number;
  fillStyle: 'outline' | 'fill' | 'fill-outline';
  dashStyle: string;
  arrowStart: boolean;
  arrowEnd: boolean;
  arrowSize: number;
  arrowAngle: number;
  arrowLength: number;
  roundedRadius: number;
  gradientType: 'linear' | 'reflected' | 'diamond' | 'radial' | 'conical';
  gradientColorMode: 'color' | 'transparency';
  reverseColors?: boolean;
}

export interface PersistedEditableLine {
  id: string;
  points: Point[];
  tensions: number[];
  selectedPoint: number;
  reverseColors: boolean;
  options: PersistedShapeDrawingOptions;
}

export interface PersistedEditableShape {
  id: string;
  tool: 'rectangle' | 'rounded-rectangle' | 'ellipse';
  points: [Point, Point, Point, Point];
  selectedPoint: number;
  reverseColors: boolean;
  options: PersistedShapeDrawingOptions;
}

export interface PersistedGradientDraft {
  layerId: string;
  start: Point;
  end: Point;
  reverseColors: boolean;
  options: PersistedShapeDrawingOptions;
  selection: PersistedSelection | null;
  basePixels: Blob;
}

export type PersistedEditableDraft =
  | { kind: 'line'; draft: PersistedEditableLine }
  | { kind: 'shape'; draft: PersistedEditableShape };

export interface PersistedHistorySnapshot {
  label: string;
  layers: PersistedLayer[];
  activeLayerId: string;
  width: number;
  height: number;
  selection: PersistedSelection | null;
  floatingPixels?: PersistedFloatingPixels | null;
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
  floatingPixels?: PersistedFloatingPixels | null;
  history?: PersistedHistorySnapshot[];
  historyIndex?: number;
  cleanHistoryIndex?: number;
  textEditor?: PersistedTextEditor | null;
  reeditableTexts?: PersistedReeditableText[];
  /** Legacy v2 workspaces stored only the last document-wide text record. */
  reeditableText?: PersistedReeditableText | null;
  reeditingText?: PersistedReeditableText | null;
  lineDraft?: PersistedEditableLine | null;
  shapeDraft?: PersistedEditableShape | null;
  archivedShapeDrafts?: PersistedEditableDraft[];
  shapeDraftOrder?: string[];
  gradientDraft?: PersistedGradientDraft | null;
}

export interface PersistedWorkspace {
  version: 2;
  activeDocumentId: string;
  untitledCounter: number;
  savedAt: number;
  documents: PersistedDocument[];
}

interface LegacyPersistedWorkspace extends Omit<PersistedWorkspace, 'version'> {
  version: 1;
}

type LoadablePersistedWorkspace = PersistedWorkspace | LegacyPersistedWorkspace;

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
    const result = await new Promise<LoadablePersistedWorkspace | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as LoadablePersistedWorkspace | undefined);
      request.onerror = () => reject(request.error ?? new Error('Could not read the saved workspace.'));
    });
    await waitForTransaction(transaction);
    return result?.version === 1 || result?.version === 2 ? result : undefined;
  } finally {
    database.close();
  }
}

/**
 * The workspace stores a lossless PNG for every layer and history checkpoint of every open
 * image, so a few large documents can exceed the origin's quota. Browsers signal that with a
 * QuotaExceededError whose own message says nothing actionable.
 */
export class WorkspaceQuotaError extends Error {
  constructor(usageHint: string) {
    super(
      `There is not enough browser storage left to save your work${usageHint}. `
      + 'Closing images you have already exported, or clearing this site\'s data after saving '
      + 'copies, frees the space Pinta needs.',
    );
    this.name = 'WorkspaceQuotaError';
  }
}

function isQuotaError(error: unknown) {
  return error instanceof DOMException
    && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

async function storageUsageHint() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.usage || !estimate.quota) return '';
    const used = Math.round(estimate.usage / 1024 / 1024);
    const total = Math.round(estimate.quota / 1024 / 1024);
    return ` (${used} MB of about ${total} MB used)`;
  } catch {
    return '';
  }
}

export async function saveWorkspace(workspace: PersistedWorkspace) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(WORKSPACE_STORE, 'readwrite');
    transaction.objectStore(WORKSPACE_STORE).put(workspace, CURRENT_WORKSPACE_KEY);
    await waitForTransaction(transaction);
  } catch (error) {
    if (isQuotaError(error)) throw new WorkspaceQuotaError(await storageUsageHint());
    throw error;
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
    context2d(canvas).drawImage(bitmap, 0, 0);
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
    context2d(canvas).drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
