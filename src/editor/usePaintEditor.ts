import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { runImageEffect } from '../effects/client';
import { EFFECT_BY_ID, type EffectId, type EffectParameters } from '../effects/types';
import { usePreferences } from '../state/preferences';
import { decodePortablePixmap, decodeTarga, encodePortablePixmap, encodeTarga } from './imageCodecs';
import { decodeOpenRasterArchive, encodeOpenRasterArchive } from './openRaster';
import { PALETTE } from './tools';
import type { BlendMode, ExportFormat, ExportOptions, HistorySnapshot, PaintLayer, Point, SelectionSnapshot, ToolId } from './types';
import {
  canvasFromPngBlob,
  canvasToPngBlob,
  loadWorkspace,
  saveWorkspace,
  type PersistedDocument,
  type PersistedHistorySnapshot,
  type PersistedLayer,
  type PersistedSelection,
  type PersistedWorkspace,
} from './workspacePersistence';

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const MAX_HISTORY = 30;

type Selection = {
  tool: ToolId;
  start: Point;
  end: Point;
  points?: Point[];
  mask?: HTMLCanvasElement;
};

type SelectionResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const SELECTION_RESIZE_CURSORS: Record<SelectionResizeHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

export type SelectionMode = 'replace' | 'union' | 'exclude' | 'xor' | 'intersect';
export type TextAlignment = 'left' | 'center' | 'right';
export type TextStyle = 'fill' | 'fill-outline' | 'outline' | 'background';
export type TextVariant = 'normal' | 'small-caps' | 'all-small-caps' | 'petite-caps' | 'all-petite-caps' | 'unicase' | 'title-caps';
export type ShapeFillStyle = 'outline' | 'fill' | 'fill-outline';
export type ShapeDashStyle = string;
export type PaintBrushType = 'normal' | 'block' | 'grid' | 'squares' | 'circles' | 'splatter' | 'slash';
export type EraserType = 'normal' | 'smooth';
export type FloodMode = 'contiguous' | 'global';
export type LassoMode = 'freeform' | 'polygon';
export type GradientType = 'linear' | 'reflected' | 'diamond' | 'radial' | 'conical';
export type GradientColorMode = 'color' | 'transparency';
export type ColorPickerSampleType = 'layer' | 'image';
export type ColorPickerAfterSelect = 'none' | 'previous' | 'pencil';
export type AlphaBlendingMode = 'normal' | 'overwrite';

export interface EditableLineState {
  id: string;
  points: Point[];
  tensions: number[];
  selectedPoint: number;
  reverseColors: boolean;
  options: ShapeDrawingOptions;
}

export type EditableBoundsTool = 'rectangle' | 'rounded-rectangle' | 'ellipse';

export interface EditableShapeState {
  id: string;
  tool: EditableBoundsTool;
  points: [Point, Point, Point, Point];
  selectedPoint: number;
  reverseColors: boolean;
  options: ShapeDrawingOptions;
}

export interface TextEditorState {
  x: number;
  y: number;
  value: string;
}

export interface DocumentTab {
  id: string;
  fileName: string;
  dirty: boolean;
  width: number;
  height: number;
}

interface DocumentSession extends DocumentTab {
  layers: PaintLayer[];
  activeLayerId: string;
  history: HistorySnapshot[];
  historyIndex: number;
  cleanHistoryIndex: number;
  zoom: number;
  selection: Selection | null;
}

async function persistedSelectionOf(selection: Selection | null): Promise<PersistedSelection | null> {
  if (!selection) return null;
  return {
    tool: selection.tool,
    start: { ...selection.start },
    end: { ...selection.end },
    points: selection.points?.map((point) => ({ ...point })),
    mask: selection.mask ? await canvasToPngBlob(selection.mask) : undefined,
  };
}

async function selectionFromPersisted(selection: PersistedSelection | null) {
  if (!selection) return null;
  return {
    tool: selection.tool,
    start: { ...selection.start },
    end: { ...selection.end },
    points: selection.points?.map((point) => ({ ...point })),
    mask: selection.mask ? await canvasFromPngBlob(selection.mask) : undefined,
  } satisfies Selection;
}

function imageDataCanvas(pixels: ImageData) {
  const canvas = makeCanvas(pixels.width, pixels.height);
  canvas.getContext('2d')!.putImageData(pixels, 0, 0);
  return canvas;
}

async function persistedLayerOf(layer: PaintLayer): Promise<PersistedLayer> {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    pixels: await canvasToPngBlob(layer.canvas),
  };
}

async function persistedHistorySnapshotOf(snapshot: HistorySnapshot): Promise<PersistedHistorySnapshot> {
  return {
    label: snapshot.label,
    layers: await Promise.all(snapshot.layers.map(async (layer) => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      pixels: await canvasToPngBlob(imageDataCanvas(layer.pixels)),
    }))),
    activeLayerId: snapshot.activeLayerId,
    width: snapshot.width,
    height: snapshot.height,
    selection: snapshot.selection ? {
      tool: snapshot.selection.tool,
      start: { ...snapshot.selection.start },
      end: { ...snapshot.selection.end },
      points: snapshot.selection.points?.map((point) => ({ ...point })),
      mask: snapshot.selection.mask ? await canvasToPngBlob(imageDataCanvas(snapshot.selection.mask)) : undefined,
    } : null,
  };
}

async function persistedDocumentOf(session: DocumentSession): Promise<PersistedDocument> {
  return {
    id: session.id,
    fileName: session.fileName,
    dirty: session.dirty,
    width: session.width,
    height: session.height,
    layers: await Promise.all(session.layers.map(persistedLayerOf)),
    activeLayerId: session.activeLayerId,
    zoom: session.zoom,
    selection: await persistedSelectionOf(session.selection),
    history: await Promise.all(session.history.map(persistedHistorySnapshotOf)),
    historyIndex: session.historyIndex,
    cleanHistoryIndex: session.cleanHistoryIndex,
  };
}

async function layerFromPersisted(storedLayer: PersistedLayer, width: number, height: number): Promise<PaintLayer> {
  const canvas = await canvasFromPngBlob(storedLayer.pixels);
  if (canvas.width !== width || canvas.height !== height) throw new Error('A stored layer has invalid dimensions.');
  return {
    id: storedLayer.id || makeId(),
    name: storedLayer.name || 'Layer',
    visible: storedLayer.visible,
    opacity: Math.max(0, Math.min(1, storedLayer.opacity)),
    blendMode: storedLayer.blendMode ?? 'normal',
    canvas,
  };
}

async function historySnapshotFromPersisted(snapshot: PersistedHistorySnapshot): Promise<HistorySnapshot | null> {
  const width = Math.round(snapshot.width);
  const height = Math.round(snapshot.height);
  if (width < 1 || height < 1 || width > 16384 || height > 16384 || !snapshot.layers.length) return null;
  const layers = await Promise.all(snapshot.layers.map((layer) => layerFromPersisted(layer, width, height)));
  const activeLayerId = layers.some((layer) => layer.id === snapshot.activeLayerId)
    ? snapshot.activeLayerId
    : layers.at(-1)!.id;
  const selection = await selectionFromPersisted(snapshot.selection);
  return snapshotOf(layers, activeLayerId, width, height, snapshot.label || 'Edit', selection);
}

async function documentFromPersisted(documentState: PersistedDocument): Promise<DocumentSession | null> {
  const width = Math.round(documentState.width);
  const height = Math.round(documentState.height);
  if (!documentState.id || !documentState.fileName || width < 1 || height < 1 || width > 16384 || height > 16384) return null;
  const layers = await Promise.all(documentState.layers.map((layer) => layerFromPersisted(layer, width, height)));
  if (!layers.length) return null;
  const activeLayerId = layers.some((layer) => layer.id === documentState.activeLayerId)
    ? documentState.activeLayerId
    : layers.at(-1)!.id;
  const selection = await selectionFromPersisted(documentState.selection);
  const restoredHistory = documentState.history?.length
    ? (await Promise.all(documentState.history.map(historySnapshotFromPersisted))).filter((entry): entry is HistorySnapshot => entry !== null)
    : [];
  const legacyLabel = documentState.fileName.startsWith('Unsaved Image') ? 'New Image' : 'Open Image';
  const history = restoredHistory.length
    ? restoredHistory
    : [snapshotOf(layers, activeLayerId, width, height, legacyLabel, selection)];
  const requestedHistoryIndex = Math.round(documentState.historyIndex ?? 0);
  const historyIndex = Math.max(0, Math.min(history.length - 1, requestedHistoryIndex));
  const requestedCleanHistoryIndex = Math.round(documentState.cleanHistoryIndex ?? (documentState.dirty ? -1 : historyIndex));
  const cleanHistoryIndex = requestedCleanHistoryIndex < 0
    ? -1
    : Math.max(0, Math.min(history.length - 1, requestedCleanHistoryIndex));
  return {
    id: documentState.id,
    fileName: documentState.fileName,
    dirty: documentState.dirty,
    width,
    height,
    layers,
    activeLayerId,
    history,
    historyIndex,
    cleanHistoryIndex,
    zoom: Math.max(0.1, Math.min(4, documentState.zoom || 0.8)),
    selection,
  };
}

export type CanvasAnchor = 'north-west' | 'north' | 'north-east' | 'west' | 'center' | 'east' | 'south-west' | 'south' | 'south-east';

function documentTabOf(session: DocumentSession): DocumentTab {
  return {
    id: session.id,
    fileName: session.fileName,
    dirty: session.dirty,
    width: session.width,
    height: session.height,
  };
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `layer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeLayer(width: number, height: number, name: string, white = false): PaintLayer {
  const canvas = makeCanvas(width, height);
  if (white) {
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  return {
    id: makeId(),
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    canvas,
  };
}

function snapshotOf(
  layers: PaintLayer[],
  activeLayerId: string,
  width: number,
  height: number,
  label: string,
  selection: Selection | null = null,
): HistorySnapshot {
  return {
    label,
    activeLayerId,
    width,
    height,
    layers: layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      pixels: layer.canvas.getContext('2d')!.getImageData(0, 0, width, height),
    })),
    selection: snapshotSelection(selection),
  };
}

function snapshotSelection(selection: Selection | null): SelectionSnapshot | null {
  if (!selection) return null;
  return {
    tool: selection.tool,
    start: { ...selection.start },
    end: { ...selection.end },
    points: selection.points?.map((point) => ({ ...point })),
    mask: selection.mask?.getContext('2d')!.getImageData(0, 0, selection.mask.width, selection.mask.height),
  };
}

function selectionFromSnapshot(selection: SelectionSnapshot | null | undefined): Selection | null {
  if (!selection) return null;
  let mask: HTMLCanvasElement | undefined;
  if (selection.mask) {
    mask = makeCanvas(selection.mask.width, selection.mask.height);
    mask.getContext('2d')!.putImageData(selection.mask, 0, 0);
  }
  return {
    tool: selection.tool,
    start: { ...selection.start },
    end: { ...selection.end },
    points: selection.points?.map((point) => ({ ...point })),
    mask,
  };
}

function layerFromSnapshot(layer: HistorySnapshot['layers'][number]) {
  const canvas = makeCanvas(layer.pixels.width, layer.pixels.height);
  canvas.getContext('2d')!.putImageData(layer.pixels, 0, 0);
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode ?? 'normal',
    canvas,
  } satisfies PaintLayer;
}

function canvasCompositeOperation(blendMode: BlendMode): GlobalCompositeOperation {
  return blendMode === 'normal' ? 'source-over' : blendMode;
}

function paintLayer(context: CanvasRenderingContext2D, layer: PaintLayer) {
  if (!layer.visible) return;
  context.save();
  context.globalAlpha = layer.opacity;
  context.globalCompositeOperation = canvasCompositeOperation(layer.blendMode);
  context.drawImage(layer.canvas, 0, 0);
  context.restore();
}

function exportFormatFromFileName(fileName: string): ExportFormat | null {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'png';
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
  if (extension === 'webp') return 'webp';
  if (extension === 'ora') return 'ora';
  if (extension === 'ppm') return 'ppm';
  if (extension === 'tga') return 'tga';
  return null;
}

function exportExtension(format: ExportFormat) {
  return format === 'jpeg' ? 'jpg' : format;
}

function exportMimeType(format: ExportFormat) {
  if (format === 'ora') return 'image/openraster';
  if (format === 'ppm') return 'image/x-portable-pixmap';
  if (format === 'tga') return 'image/x-tga';
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

function canvasBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function canvasPngBytes(canvas: HTMLCanvasElement) {
  const blob = await canvasBlob(canvas);
  if (!blob) throw new Error('The canvas could not be encoded as PNG.');
  return new Uint8Array(await blob.arrayBuffer());
}

function bytesBlob(bytes: Uint8Array, type: string) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type });
}

async function createDocumentExportBlob(layers: PaintLayer[], width: number, height: number, format: ExportFormat, quality = 0.92) {
  const output = makeCanvas(width, height);
  const context = output.getContext('2d')!;
  if (format === 'jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
  }
  for (const layer of layers) paintLayer(context, layer);
  if (format === 'ora') {
    return bytesBlob(await createOpenRasterArchive(layers, output.width, output.height, output), exportMimeType(format));
  }
  if (format === 'ppm' || format === 'tga') {
    const pixels = context.getImageData(0, 0, output.width, output.height);
    return bytesBlob(format === 'ppm' ? encodePortablePixmap(pixels) : encodeTarga(pixels), exportMimeType(format));
  }
  return canvasBlob(output, exportMimeType(format), quality);
}

async function drawPngBytes(canvas: HTMLCanvasElement, bytes: Uint8Array) {
  const bitmap = await createImageBitmap(bytesBlob(bytes, 'image/png'));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
}

async function openRasterArchive(file: File) {
  const decoded = decodeOpenRasterArchive(new Uint8Array(await file.arrayBuffer()));
  const layers: PaintLayer[] = [];
  for (const decodedLayer of decoded.layers) {
    const layer = makeLayer(decoded.width, decoded.height, decodedLayer.name);
    layer.visible = decodedLayer.visible;
    layer.opacity = decodedLayer.opacity;
    layer.blendMode = decodedLayer.blendMode;
    await drawPngBytes(layer.canvas, decodedLayer.png);
    layers.push(layer);
  }
  return { width: decoded.width, height: decoded.height, layers };
}

async function createOpenRasterArchive(layers: PaintLayer[], width: number, height: number, merged: HTMLCanvasElement) {
  const encodedLayers = [];
  for (const layer of layers) encodedLayers.push({
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    png: await canvasPngBytes(layer.canvas),
  });
  const thumbnailScale = Math.min(1, 256 / Math.max(width, height));
  const thumbnail = makeCanvas(Math.max(1, Math.round(width * thumbnailScale)), Math.max(1, Math.round(height * thumbnailScale)));
  thumbnail.getContext('2d')!.drawImage(merged, 0, 0, thumbnail.width, thumbnail.height);
  return encodeOpenRasterArchive({
    width,
    height,
    layers: encodedLayers,
    mergedPng: await canvasPngBytes(merged),
    thumbnailPng: await canvasPngBytes(thumbnail),
  });
}

async function decodeImageFile(file: File): Promise<{ width: number; height: number; layers: PaintLayer[] }> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.ora') || file.type === 'image/openraster') return openRasterArchive(file);
  if (lowerName.endsWith('.ppm') || lowerName.endsWith('.tga') || file.type === 'image/x-portable-pixmap' || file.type === 'image/x-tga') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = lowerName.endsWith('.ppm') || file.type === 'image/x-portable-pixmap'
      ? decodePortablePixmap(bytes)
      : decodeTarga(bytes);
    const layer = makeLayer(decoded.width, decoded.height, file.name);
    const context = layer.canvas.getContext('2d')!;
    const image = context.createImageData(decoded.width, decoded.height);
    image.data.set(decoded.data);
    context.putImageData(image, 0, 0);
    return { width: decoded.width, height: decoded.height, layers: [layer] };
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const layer = makeLayer(image.naturalWidth, image.naturalHeight, file.name);
      layer.canvas.getContext('2d')!.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight, layers: [layer] });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be opened.'));
    };
    image.src = url;
  });
}

function normalizeSelection(selection: Selection, canvasWidth: number, canvasHeight: number) {
  const left = Math.max(0, Math.min(selection.start.x, selection.end.x));
  const top = Math.max(0, Math.min(selection.start.y, selection.end.y));
  const right = Math.min(canvasWidth, Math.max(selection.start.x, selection.end.x));
  const bottom = Math.min(canvasHeight, Math.max(selection.start.y, selection.end.y));
  return {
    x: Math.floor(left),
    y: Math.floor(top),
    width: Math.max(0, Math.ceil(right) - Math.floor(left)),
    height: Math.max(0, Math.ceil(bottom) - Math.floor(top)),
    ellipse: selection.tool === 'ellipse-select',
    selection,
  };
}

function selectionHandlePoints(bounds: ReturnType<typeof normalizeSelection>) {
  const left = bounds.x;
  const top = bounds.y;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const centerX = left + bounds.width / 2;
  const centerY = top + bounds.height / 2;
  return {
    nw: { x: left, y: top },
    n: { x: centerX, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: centerY },
    se: { x: right, y: bottom },
    s: { x: centerX, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: centerY },
  } satisfies Record<SelectionResizeHandle, Point>;
}

function isResizableSelection(selection: Selection | null, tool: ToolId) {
  return selection !== null &&
    (tool === 'rectangle-select' || tool === 'ellipse-select');
}

function selectionResizeHandleAtPoint(
  selection: Selection | null,
  tool: ToolId,
  point: Point,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number,
): SelectionResizeHandle | null {
  if (!isResizableSelection(selection, tool) || !selection) return null;
  const bounds = normalizeSelection(selection, canvasWidth, canvasHeight);
  if (bounds.width < 1 || bounds.height < 1) return null;
  const hitRadius = 9.5 / zoom;
  let closest: { handle: SelectionResizeHandle; distance: number } | null = null;
  for (const [handle, handlePoint] of Object.entries(selectionHandlePoints(bounds)) as Array<[SelectionResizeHandle, Point]>) {
    const distance = Math.hypot(point.x - handlePoint.x, point.y - handlePoint.y);
    if (distance <= hitRadius && (!closest || distance < closest.distance)) closest = { handle, distance };
  }
  return closest?.handle ?? null;
}

function constrainSelectionPoint(start: Point, point: Point, canvasWidth: number, canvasHeight: number) {
  const directionX = Math.sign(point.x - start.x) || 1;
  const directionY = Math.sign(point.y - start.y) || 1;
  const availableX = directionX > 0 ? canvasWidth - start.x : start.x;
  const availableY = directionY > 0 ? canvasHeight - start.y : start.y;
  const extent = Math.min(
    Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y)),
    availableX,
    availableY,
  );
  return {
    x: start.x + directionX * extent,
    y: start.y + directionY * extent,
  };
}

function resizeSelection(
  original: Selection,
  handle: SelectionResizeHandle,
  point: Point,
  canvasWidth: number,
  canvasHeight: number,
  constrain: boolean,
): Selection {
  const bounds = normalizeSelection(original, canvasWidth, canvasHeight);
  let left = bounds.x;
  let top = bounds.y;
  let right = bounds.x + bounds.width;
  let bottom = bounds.y + bounds.height;
  const movesLeft = handle.includes('w');
  const movesRight = handle.includes('e');
  const movesTop = handle.includes('n');
  const movesBottom = handle.includes('s');

  if (constrain && (movesLeft || movesRight) && (movesTop || movesBottom)) {
    const anchor = {
      x: movesLeft ? right : left,
      y: movesTop ? bottom : top,
    };
    const constrained = constrainSelectionPoint(anchor, point, canvasWidth, canvasHeight);
    if (movesLeft) left = constrained.x;
    if (movesRight) right = constrained.x;
    if (movesTop) top = constrained.y;
    if (movesBottom) bottom = constrained.y;
  } else {
    if (movesLeft) left = point.x;
    if (movesRight) right = point.x;
    if (movesTop) top = point.y;
    if (movesBottom) bottom = point.y;
    if (constrain && (movesLeft || movesRight)) {
      const centerY = (top + bottom) / 2;
      const halfHeight = Math.abs(right - left) / 2;
      top = centerY - halfHeight;
      bottom = centerY + halfHeight;
    } else if (constrain && (movesTop || movesBottom)) {
      const centerX = (left + right) / 2;
      const halfWidth = Math.abs(bottom - top) / 2;
      left = centerX - halfWidth;
      right = centerX + halfWidth;
    }
  }

  return {
    ...original,
    start: { x: Math.min(left, right), y: Math.min(top, bottom) },
    end: { x: Math.max(left, right), y: Math.max(top, bottom) },
  };
}

const selectionBoundaryCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
let selectionMarchingPatternCanvas: HTMLCanvasElement | null = null;

function selectionBoundaryOf(mask: HTMLCanvasElement) {
  const cached = selectionBoundaryCache.get(mask);
  if (cached) return cached;
  const maskPixels = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height).data;
  const boundary = makeCanvas(mask.width, mask.height);
  const context = boundary.getContext('2d')!;
  const boundaryPixels = context.createImageData(mask.width, mask.height);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const pixel = y * mask.width + x;
      if (!maskPixels[pixel * 4 + 3]) continue;
      const edge = x === 0 || y === 0 || x === mask.width - 1 || y === mask.height - 1 ||
        !maskPixels[(pixel - 1) * 4 + 3] || !maskPixels[(pixel + 1) * 4 + 3] ||
        !maskPixels[(pixel - mask.width) * 4 + 3] || !maskPixels[(pixel + mask.width) * 4 + 3];
      if (!edge) continue;
      const index = pixel * 4;
      boundaryPixels.data[index + 3] = 255;
    }
  }
  context.putImageData(boundaryPixels, 0, 0);
  selectionBoundaryCache.set(mask, boundary);
  return boundary;
}

function selectionMarchingPattern() {
  if (selectionMarchingPatternCanvas) return selectionMarchingPatternCanvas;
  const pattern = makeCanvas(8, 8);
  const context = pattern.getContext('2d')!;
  const pixels = context.createImageData(8, 8);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if ((x + y) % 8 >= 4) continue;
      const index = (y * 8 + x) * 4;
      pixels.data[index] = 255;
      pixels.data[index + 1] = 255;
      pixels.data[index + 2] = 255;
      pixels.data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  selectionMarchingPatternCanvas = pattern;
  return pattern;
}

function drawSelectionOverlay(
  target: HTMLCanvasElement,
  selection: Selection | null,
  tool: ToolId,
  zoom: number,
  phase = 0,
) {
  const context = target.getContext('2d')!;
  context.clearRect(0, 0, target.width, target.height);
  if (!selection) return;

  context.save();
  context.strokeStyle = '#ffffff';
  context.lineWidth = 1;
  context.setLineDash([5, 4]);
  context.lineDashOffset = -phase;
  context.shadowColor = '#000000';
  context.shadowBlur = 1;
  const bounds = normalizeSelection(selection, target.width, target.height);
  if (selection.mask) {
    context.shadowBlur = 0;
    context.drawImage(selectionBoundaryOf(selection.mask), bounds.x, bounds.y);
    context.save();
    context.globalCompositeOperation = 'source-atop';
    context.translate(phase % 8, 0);
    context.fillStyle = context.createPattern(selectionMarchingPattern(), 'repeat')!;
    context.fillRect(-8, 0, target.width + 16, target.height);
    context.restore();
  } else {
    context.beginPath();
    if (selection.points?.length) {
      const [first, ...rest] = selection.points;
      context.moveTo(first.x, first.y);
      for (const point of rest) context.lineTo(point.x, point.y);
      context.closePath();
    } else if (selection.tool === 'ellipse-select') {
      context.ellipse(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width / 2, bounds.height / 2, 0, 0, Math.PI * 2);
    } else {
      context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
    context.stroke();
  }
  if (isResizableSelection(selection, tool) && bounds.width > 0 && bounds.height > 0) {
    const handleRadius = 4.5 / zoom;
    context.setLineDash([]);
    context.shadowBlur = 0;
    context.lineWidth = 1 / zoom;
    context.fillStyle = '#0000ff';
    context.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    for (const handlePoint of Object.values(selectionHandlePoints(bounds))) {
      const handleX = Math.max(handleRadius, Math.min(target.width - handleRadius, handlePoint.x));
      const handleY = Math.max(handleRadius, Math.min(target.height - handleRadius, handlePoint.y));
      context.beginPath();
      context.arc(handleX, handleY, handleRadius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }
  context.restore();
}

function createSelectionMask(selection: ReturnType<typeof normalizeSelection>) {
  const mask = makeCanvas(selection.width, selection.height);
  const context = mask.getContext('2d')!;
  context.fillStyle = '#ffffff';

  if (selection.selection.mask) {
    context.drawImage(selection.selection.mask, 0, 0, selection.width, selection.height);
    return mask;
  }

  context.beginPath();
  if (selection.selection.points?.length) {
    const [first, ...rest] = selection.selection.points;
    context.moveTo(first.x - selection.x, first.y - selection.y);
    for (const point of rest) context.lineTo(point.x - selection.x, point.y - selection.y);
    context.closePath();
  } else if (selection.ellipse) {
    context.ellipse(selection.width / 2, selection.height / 2, selection.width / 2, selection.height / 2, 0, 0, Math.PI * 2);
  } else {
    context.rect(0, 0, selection.width, selection.height);
  }
  context.fill();
  return mask;
}

function copySelectionToCanvas(source: HTMLCanvasElement, selection: ReturnType<typeof normalizeSelection>) {
  const output = makeCanvas(selection.width, selection.height);
  const context = output.getContext('2d')!;
  context.drawImage(source, -selection.x, -selection.y);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(createSelectionMask(selection), 0, 0);
  return output;
}

function selectionMaskOnCanvas(selection: Selection, width: number, height: number) {
  const bounds = normalizeSelection(selection, width, height);
  const output = makeCanvas(width, height);
  if (bounds.width > 0 && bounds.height > 0) {
    output.getContext('2d')!.drawImage(createSelectionMask(bounds), bounds.x, bounds.y);
  }
  return output;
}

function offsetSelectionMask(selection: Selection, width: number, height: number, offset: number) {
  const radius = Math.abs(Math.round(offset));
  if (radius === 0) return selection;
  const source = selectionMaskOnCanvas(selection, width, height).getContext('2d')!.getImageData(0, 0, width, height).data;
  const stride = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += source[(y * width + x) * 4 + 3] > 0 ? 1 : 0;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }
  const output = makeCanvas(width, height);
  const context = output.getContext('2d')!;
  const pixels = context.createImageData(width, height);
  const expanding = offset > 0;
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const selectedCount = integral[(bottom + 1) * stride + right + 1]
        - integral[top * stride + right + 1]
        - integral[(bottom + 1) * stride + left]
        + integral[top * stride + left];
      const fullArea = (radius * 2 + 1) ** 2;
      const selected = expanding ? selectedCount > 0 : selectedCount === fullArea;
      if (selected) {
        const index = (y * width + x) * 4;
        pixels.data[index] = 255;
        pixels.data[index + 1] = 255;
        pixels.data[index + 2] = 255;
        pixels.data[index + 3] = 255;
      }
    }
  }
  context.putImageData(pixels, 0, 0);
  return selectionFromMask(output);
}

function selectionFromMask(maskCanvas: HTMLCanvasElement, originX = 0, originY = 0): Selection | null {
  if (maskCanvas.width < 1 || maskCanvas.height < 1) return null;
  const context = maskCanvas.getContext('2d')!;
  const pixels = context.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  let minX = maskCanvas.width;
  let minY = maskCanvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < maskCanvas.height; y += 1) {
    for (let x = 0; x < maskCanvas.width; x += 1) {
      if (pixels[(y * maskCanvas.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const mask = makeCanvas(maxX - minX + 1, maxY - minY + 1);
  mask.getContext('2d')!.drawImage(maskCanvas, -minX, -minY);
  return {
    tool: 'magic-wand',
    start: { x: originX + minX, y: originY + minY },
    end: { x: originX + maxX + 1, y: originY + maxY + 1 },
    mask,
  };
}

function combineSelectionMasks(
  previous: Selection | null,
  next: Selection,
  mode: SelectionMode,
  width: number,
  height: number,
) {
  if (mode === 'replace') return next;
  if (!previous) return mode === 'union' || mode === 'xor' ? next : null;
  const previousBounds = normalizeSelection(previous, width, height);
  const nextBounds = normalizeSelection(next, width, height);
  const left = mode === 'exclude'
    ? previousBounds.x
    : mode === 'intersect'
      ? Math.max(previousBounds.x, nextBounds.x)
      : Math.min(previousBounds.x, nextBounds.x);
  const top = mode === 'exclude'
    ? previousBounds.y
    : mode === 'intersect'
      ? Math.max(previousBounds.y, nextBounds.y)
      : Math.min(previousBounds.y, nextBounds.y);
  const right = mode === 'exclude'
    ? previousBounds.x + previousBounds.width
    : mode === 'intersect'
      ? Math.min(previousBounds.x + previousBounds.width, nextBounds.x + nextBounds.width)
      : Math.max(previousBounds.x + previousBounds.width, nextBounds.x + nextBounds.width);
  const bottom = mode === 'exclude'
    ? previousBounds.y + previousBounds.height
    : mode === 'intersect'
      ? Math.min(previousBounds.y + previousBounds.height, nextBounds.y + nextBounds.height)
      : Math.max(previousBounds.y + previousBounds.height, nextBounds.y + nextBounds.height);
  if (right <= left || bottom <= top) return null;
  const output = makeCanvas(right - left, bottom - top);
  const context = output.getContext('2d')!;
  context.drawImage(createSelectionMask(previousBounds), previousBounds.x - left, previousBounds.y - top);
  context.globalCompositeOperation = mode === 'union'
    ? 'source-over'
    : mode === 'exclude'
      ? 'destination-out'
      : mode === 'xor'
        ? 'xor'
        : 'destination-in';
  if (nextBounds.width > 0 && nextBounds.height > 0) {
    context.drawImage(createSelectionMask(nextBounds), nextBounds.x - left, nextBounds.y - top);
  }
  context.globalCompositeOperation = 'source-over';
  return selectionFromMask(output, left, top);
}

function magicWandSelection(source: HTMLCanvasElement, x: number, y: number, tolerance: number, global = false): Selection {
  const width = source.width;
  const height = source.height;
  const context = source.getContext('2d')!;
  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  const startX = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const startY = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const startPixel = startY * width + startX;
  const startIndex = startPixel * 4;
  const target = [pixels[startIndex], pixels[startIndex + 1], pixels[startIndex + 2], pixels[startIndex + 3]];
  const visited = new Uint8Array(width * height);
  const selected = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let read = 0;
  let write = 0;
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  queue[write++] = startPixel;
  visited[startPixel] = 1;

  const matches = (pixel: number) => {
    const index = pixel * 4;
    return Math.abs(pixels[index] - target[0]) <= tolerance &&
      Math.abs(pixels[index + 1] - target[1]) <= tolerance &&
      Math.abs(pixels[index + 2] - target[2]) <= tolerance &&
      Math.abs(pixels[index + 3] - target[3]) <= tolerance;
  };

  if (global) {
    minX = width;
    minY = height;
    maxX = -1;
    maxY = -1;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      if (!matches(pixel)) continue;
      selected[pixel] = 1;
      const px = pixel % width;
      const py = Math.floor(pixel / width);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  } else {
    while (read < write) {
      const pixel = queue[read++];
      if (!matches(pixel)) continue;
      selected[pixel] = 1;
      const px = pixel % width;
      const py = Math.floor(pixel / width);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
      const neighbors = [
        px > 0 ? pixel - 1 : -1,
        px < width - 1 ? pixel + 1 : -1,
        py > 0 ? pixel - width : -1,
        py < height - 1 ? pixel + width : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || visited[neighbor]) continue;
        visited[neighbor] = 1;
        queue[write++] = neighbor;
      }
    }
  }

  const maskWidth = maxX - minX + 1;
  const maskHeight = maxY - minY + 1;
  const mask = makeCanvas(maskWidth, maskHeight);
  const maskContext = mask.getContext('2d')!;
  const maskImage = maskContext.createImageData(maskWidth, maskHeight);
  for (let localY = 0; localY < maskHeight; localY += 1) {
    for (let localX = 0; localX < maskWidth; localX += 1) {
      const sourcePixel = (minY + localY) * width + minX + localX;
      if (!selected[sourcePixel]) continue;
      const index = (localY * maskWidth + localX) * 4;
      maskImage.data[index] = 255;
      maskImage.data[index + 1] = 255;
      maskImage.data[index + 2] = 255;
      maskImage.data[index + 3] = 255;
    }
  }
  maskContext.putImageData(maskImage, 0, 0);
  return {
    tool: 'magic-wand',
    start: { x: minX, y: minY },
    end: { x: maxX + 1, y: maxY + 1 },
    mask,
  };
}

function getAnchorOffset(oldSize: number, newSize: number, position: 'start' | 'center' | 'end') {
  if (position === 'start') return 0;
  if (position === 'end') return newSize - oldSize;
  return Math.round((newSize - oldSize) / 2);
}

function colorToRgba(color: string) {
  const value = color.replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
    a: value.length >= 8 ? Number.parseInt(value.slice(6, 8), 16) : 255,
  };
}

function rgbaToHex(r: number, g: number, b: number, a = 255) {
  const rgb = `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
  return a >= 255 ? rgb : `${rgb}${Math.max(0, Math.min(255, Math.round(a))).toString(16).padStart(2, '0')}`;
}

function sampleCanvasColor(canvas: HTMLCanvasElement, point: Point, sampleSize: number) {
  const size = Math.max(1, Math.min(9, Math.round(sampleSize)));
  const half = Math.floor(size / 2);
  const left = Math.max(0, Math.min(canvas.width - 1, Math.floor(point.x) - half));
  const top = Math.max(0, Math.min(canvas.height - 1, Math.floor(point.y) - half));
  const width = Math.min(size, canvas.width - left);
  const height = Math.min(size, canvas.height - top);
  const pixels = canvas.getContext('2d')!.getImageData(left, top, width, height).data;
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  let alphaTotal = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    red += pixels[index] * alpha;
    green += pixels[index + 1] * alpha;
    blue += pixels[index + 2] * alpha;
    weight += alpha;
    alphaTotal += pixels[index + 3];
  }
  if (weight === 0) return '#00000000';
  return rgbaToHex(red / weight, green / weight, blue / weight, alphaTotal / (pixels.length / 4));
}

function applyTextVariant(value: string, variant: TextVariant) {
  if (variant === 'all-small-caps' || variant === 'all-petite-caps') return value.toUpperCase();
  if (variant === 'unicase') return value.toLowerCase();
  if (variant === 'title-caps') return value.replace(/\b\w/g, (character) => character.toUpperCase());
  return value;
}

interface TextDrawingOptions {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  alignment: TextAlignment;
  style: TextStyle;
  variant: TextVariant;
  outlineWidth: number;
  lineJoin: CanvasLineJoin;
  primary: string;
  secondary: string;
}

function drawTextEditor(context: CanvasRenderingContext2D, editor: TextEditorState, options: TextDrawingOptions) {
  const variant = options.variant === 'small-caps' || options.variant === 'petite-caps' ? 'small-caps ' : '';
  context.save();
  context.font = `${options.italic ? 'italic ' : ''}${variant}${options.fontWeight} ${options.fontSize}px "${options.fontFamily}"`;
  context.textAlign = options.alignment;
  context.textBaseline = 'top';
  context.lineJoin = options.lineJoin;
  context.lineWidth = options.outlineWidth;
  const lineHeight = options.fontSize * 1.22;
  const lines = applyTextVariant(editor.value, options.variant).split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const y = editor.y + lineIndex * lineHeight;
    const width = context.measureText(line || ' ').width;
    const left = options.alignment === 'center' ? editor.x - width / 2 : options.alignment === 'right' ? editor.x - width : editor.x;
    if (options.style === 'background') {
      context.fillStyle = options.secondary;
      context.fillRect(left - 2, y - 1, width + 4, lineHeight);
    }
    if (options.style === 'fill' || options.style === 'fill-outline' || options.style === 'background') {
      if (options.style === 'fill-outline') {
        context.strokeStyle = options.secondary;
        context.strokeText(line, editor.x, y);
      }
      context.fillStyle = options.primary;
      context.fillText(line, editor.x, y);
    } else {
      context.strokeStyle = options.primary;
      context.strokeText(line, editor.x, y);
    }
    if (options.underline && line) {
      context.strokeStyle = options.primary;
      context.lineWidth = Math.max(1, options.fontSize / 15);
      context.beginPath();
      context.moveTo(left, y + options.fontSize * 1.05);
      context.lineTo(left + width, y + options.fontSize * 1.05);
      context.stroke();
      context.lineWidth = options.outlineWidth;
    }
  }
  context.restore();
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function floodFill(canvas: HTMLCanvasElement, x: number, y: number, color: string, tolerance = 0, global = false) {
  const context = canvas.getContext('2d')!;
  const width = canvas.width;
  const height = canvas.height;
  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  const startX = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const startY = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const start = (startY * width + startX) * 4;
  const target = [pixels[start], pixels[start + 1], pixels[start + 2], pixels[start + 3]];
  const replacement = colorToRgba(color);

  if (
    target[0] === replacement.r && target[1] === replacement.g &&
    target[2] === replacement.b && target[3] === replacement.a
  ) return;

  const threshold = Math.max(0, Math.min(255, tolerance * 2.55));
  const matches = (index: number) =>
    Math.abs(pixels[index] - target[0]) <= threshold &&
    Math.abs(pixels[index + 1] - target[1]) <= threshold &&
    Math.abs(pixels[index + 2] - target[2]) <= threshold &&
    Math.abs(pixels[index + 3] - target[3]) <= threshold;

  const paint = (index: number) => {
    pixels[index] = replacement.r;
    pixels[index + 1] = replacement.g;
    pixels[index + 2] = replacement.b;
    pixels[index + 3] = replacement.a;
  };

  if (global) {
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const index = pixel * 4;
      if (matches(index)) paint(index);
    }
    context.putImageData(image, 0, 0);
    return;
  }

  const queue = new Int32Array(width * height);
  let read = 0;
  let write = 0;
  queue[write++] = startY * width + startX;
  paint(start);

  while (read < write) {
    const point = queue[read++];
    const px = point % width;
    const py = Math.floor(point / width);
    const neighbors = [
      px > 0 ? point - 1 : -1,
      px < width - 1 ? point + 1 : -1,
      py > 0 ? point - width : -1,
      py < height - 1 ? point + width : -1,
    ];
    for (const neighbor of neighbors) {
      if (neighbor < 0) continue;
      const index = neighbor * 4;
      if (matches(index)) {
        paint(index);
        queue[write++] = neighbor;
      }
    }
  }

  context.putImageData(image, 0, 0);
}

function drawRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, requestedRadius: number) {
  const radius = Math.min(requestedRadius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.roundRect(x, y, width, height, radius);
}

export interface ShapeDrawingOptions {
  primary: string;
  secondary: string;
  size: number;
  fillStyle: ShapeFillStyle;
  dashStyle: ShapeDashStyle;
  arrowStart: boolean;
  arrowEnd: boolean;
  arrowSize: number;
  arrowAngle: number;
  arrowLength: number;
  roundedRadius: number;
  gradientType: GradientType;
  gradientColorMode: GradientColorMode;
  reverseColors?: boolean;
}

type StoredEditableDraft =
  | { kind: 'line'; draft: EditableLineState }
  | { kind: 'shape'; draft: EditableShapeState };

function shapeDashPattern(style: ShapeDashStyle, size: number) {
  const unit = Math.max(1, size);
  if (style === '-') return [];
  if (style === 'dash') return [unit * 4, unit * 2];
  if (style === 'dot') return [unit, unit * 2];
  if (style === 'dash-dot') return [unit * 4, unit * 2, unit, unit * 2];
  const nativePatterns: Record<string, number[]> = {
    ' -': [1, 1],
    ' --': [2, 1],
    ' ---': [3, 1],
    '  -': [1, 2],
    '   -': [1, 3],
    ' - --': [1, 1, 2, 1],
    ' - - --------': [1, 1, 1, 1, 8, 1],
    ' - - ---- - ----': [1, 1, 1, 1, 4, 1, 1, 1, 4, 1],
  };
  if (nativePatterns[style]) return nativePatterns[style].map((value) => value * unit);
  return [];
}

function configureShape(context: CanvasRenderingContext2D, options: ShapeDrawingOptions) {
  const outline = options.reverseColors ? options.secondary : options.primary;
  const fill = options.reverseColors ? options.primary : options.secondary;
  context.strokeStyle = outline;
  context.fillStyle = fill;
  context.lineWidth = options.size;
  context.lineCap = 'square';
  context.lineJoin = 'round';
  context.setLineDash(shapeDashPattern(options.dashStyle, options.size));
}

function strokeAndFillShape(context: CanvasRenderingContext2D, fillStyle: ShapeFillStyle) {
  if (fillStyle === 'fill') {
    context.fillStyle = context.strokeStyle;
    context.fill('evenodd');
  } else if (fillStyle === 'fill-outline') {
    context.fill('evenodd');
    context.stroke();
  } else {
    context.stroke();
  }
}

function traceCardinalCurve(context: CanvasRenderingContext2D, points: Point[], tensions: number[]) {
  if (!points.length) return;
  context.moveTo(points[0].x, points[0].y);
  if (points.length === 1) return;
  if (points.length === 2) {
    context.lineTo(points[1].x, points[1].y);
    return;
  }
  const lastIndex = points.length - 1;
  const tangents = points.map((point, index) => {
    const tension = Math.max(0, Math.min(1, tensions[index] ?? (index === 0 || index === lastIndex ? 0 : 1 / 3)));
    if (index === 0) return {
      x: tension * (points[1].x - point.x),
      y: tension * (points[1].y - point.y),
    };
    if (index === lastIndex) return {
      x: tension * (point.x - points[index - 1].x),
      y: tension * (point.y - points[index - 1].y),
    };
    const gradedTension = tension * index / lastIndex;
    return {
      x: gradedTension * (points[index + 1].x - points[index - 1].x),
      y: gradedTension * (points[index + 1].y - points[index - 1].y),
    };
  });
  for (let index = 0; index < lastIndex; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    context.bezierCurveTo(
      current.x + tangents[index].x,
      current.y + tangents[index].y,
      next.x - tangents[index + 1].x,
      next.y - tangents[index + 1].y,
      next.x,
      next.y,
    );
  }
}

function drawArrowHead(context: CanvasRenderingContext2D, tip: Point, neighbor: Point, size: number, angleDegrees: number, lengthValue: number) {
  const safeAngle = Number.isFinite(angleDegrees) ? angleDegrees : 15;
  const safeLength = Number.isFinite(lengthValue) ? lengthValue : 10;
  const angle = Math.atan2(tip.y - neighbor.y, tip.x - neighbor.x);
  const length = Math.max(1, size + safeLength);
  const spread = Math.max(-89, Math.min(89, safeAngle)) * Math.PI / 180;
  context.save();
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(tip.x, tip.y);
  context.lineTo(tip.x - Math.cos(angle - spread) * length, tip.y - Math.sin(angle - spread) * length);
  context.lineTo(tip.x - Math.cos(angle + spread) * length, tip.y - Math.sin(angle + spread) * length);
  context.closePath();
  context.fillStyle = context.strokeStyle;
  context.fill();
  context.restore();
}

function drawEditableLine(context: CanvasRenderingContext2D, line: EditableLineState, options: ShapeDrawingOptions, showHandles = false, zoom = 1) {
  if (line.points.length < 2) return;
  context.save();
  configureShape(context, { ...options, reverseColors: line.reverseColors });
  context.beginPath();
  traceCardinalCurve(context, line.points, line.tensions);
  context.stroke();
  if (options.arrowStart) drawArrowHead(context, line.points[0], line.points[1], options.arrowSize, options.arrowAngle, options.arrowLength);
  if (options.arrowEnd) drawArrowHead(context, line.points.at(-1)!, line.points.at(-2)!, options.arrowSize, options.arrowAngle, options.arrowLength);
  if (showHandles) {
    const radius = Math.max(3, 5 / zoom);
    context.setLineDash([]);
    line.points.forEach((point, index) => {
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = index === line.selectedPoint ? '#4da3ff' : '#ffffff';
      context.fill();
      context.strokeStyle = '#17324d';
      context.lineWidth = Math.max(1, 1 / zoom);
      context.stroke();
    });
  }
  context.restore();
}

function drawEditableShape(context: CanvasRenderingContext2D, shape: EditableShapeState, options: ShapeDrawingOptions, showHandles = false, zoom = 1) {
  const start = shape.points[0];
  const end = shape.points[2];
  drawShape(context, shape.tool, start, end, { ...options, reverseColors: shape.reverseColors });
  if (!showHandles) return;
  context.save();
  context.setLineDash([]);
  const radius = Math.max(3, 5 / zoom);
  shape.points.forEach((point, index) => {
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = index === shape.selectedPoint ? '#4da3ff' : '#ffffff';
    context.fill();
    context.strokeStyle = '#17324d';
    context.lineWidth = Math.max(1, 1 / zoom);
    context.stroke();
  });
  context.restore();
}

function rectangularControlPoints(start: Point, end: Point): [Point, Point, Point, Point] {
  return [
    { x: start.x, y: start.y },
    { x: start.x, y: end.y },
    { x: end.x, y: end.y },
    { x: end.x, y: start.y },
  ];
}

function moveRectangularControlPoint(shape: EditableShapeState, index: number, point: Point): EditableShapeState {
  const points = shape.points.map((candidate) => ({ ...candidate })) as [Point, Point, Point, Point];
  points[index] = point;
  if (index === 0) {
    points[1].x = point.x;
    points[3].y = point.y;
  } else if (index === 1) {
    points[0].x = point.x;
    points[2].y = point.y;
  } else if (index === 2) {
    points[1].y = point.y;
    points[3].x = point.x;
  } else {
    points[0].y = point.y;
    points[2].x = point.x;
  }
  return { ...shape, points, selectedPoint: index };
}

function drawFreeformShape(context: CanvasRenderingContext2D, points: Point[], options: ShapeDrawingOptions) {
  if (points.length < 2) return;
  context.save();
  configureShape(context, options);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  strokeAndFillShape(context, options.fillStyle);
  context.restore();
}

function removeAntialiasing(context: CanvasRenderingContext2D) {
  const image = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
  for (let index = 3; index < image.data.length; index += 4) {
    const alpha = image.data[index];
    if (alpha === 0 || alpha === 255) continue;
    image.data[index] = alpha < 128 ? 0 : 255;
  }
  context.putImageData(image, 0, 0);
}

function constrainLinePoint(start: Point, point: Point) {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) return point;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: start.x + Math.cos(angle) * distance, y: start.y + Math.sin(angle) * distance };
}

function constrainShapePoint(start: Point, point: Point) {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const extent = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + Math.sign(dx || 1) * extent,
    y: start.y + Math.sign(dy || 1) * extent,
  };
}

function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + amount * dx), point.y - (start.y + amount * dy));
}

function distanceToLineDraft(point: Point, draft: EditableLineState) {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < draft.points.length - 1; index += 1) {
    distance = Math.min(distance, distanceToSegment(point, draft.points[index], draft.points[index + 1]));
  }
  return distance;
}

function distanceToShapeDraft(point: Point, draft: EditableShapeState) {
  const left = Math.min(draft.points[0].x, draft.points[2].x);
  const right = Math.max(draft.points[0].x, draft.points[2].x);
  const top = Math.min(draft.points[0].y, draft.points[2].y);
  const bottom = Math.max(draft.points[0].y, draft.points[2].y);
  if (draft.tool === 'ellipse') {
    const radiusX = Math.max(0.001, (right - left) / 2);
    const radiusY = Math.max(0.001, (bottom - top) / 2);
    const centerX = left + radiusX;
    const centerY = top + radiusY;
    const normalizedRadius = Math.hypot((point.x - centerX) / radiusX, (point.y - centerY) / radiusY);
    return Math.abs(normalizedRadius - 1) * Math.min(radiusX, radiusY);
  }
  const corners = rectangularControlPoints({ x: left, y: top }, { x: right, y: bottom });
  return Math.min(
    distanceToSegment(point, corners[0], corners[1]),
    distanceToSegment(point, corners[1], corners[2]),
    distanceToSegment(point, corners[2], corners[3]),
    distanceToSegment(point, corners[3], corners[0]),
  );
}

function isRenderableLineDraft(draft: EditableLineState | null) {
  return Boolean(draft && draft.points.length >= 2 && Math.hypot(
    draft.points.at(-1)!.x - draft.points[0].x,
    draft.points.at(-1)!.y - draft.points[0].y,
  ) >= 0.5);
}

function isRenderableShapeDraft(draft: EditableShapeState | null) {
  return Boolean(draft && Math.abs(draft.points[2].x - draft.points[0].x) >= 0.5 &&
    Math.abs(draft.points[2].y - draft.points[0].y) >= 0.5);
}

function configureStroke(
  context: CanvasRenderingContext2D,
  tool: ToolId,
  color: string,
  size: number,
  eraserType: EraserType,
  alphaBlendingMode: AlphaBlendingMode,
) {
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = tool === 'pencil' ? 1 : size;
  context.lineCap = tool === 'pencil' ? 'butt' : 'round';
  context.lineJoin = 'round';
  context.globalCompositeOperation = tool === 'eraser'
    ? 'destination-out'
    : tool === 'pencil' && alphaBlendingMode === 'overwrite'
      ? 'copy'
      : 'source-over';
  context.globalAlpha = tool === 'eraser' && eraserType === 'smooth' ? 0.45 : 1;
}

function drawPaintBrushSegment(
  context: CanvasRenderingContext2D,
  type: PaintBrushType,
  from: Point,
  to: Point,
  color: string,
  size: number,
  slashAngle: number,
  splatterMinimumSize: number,
  splatterMaximumSize: number,
) {
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = size;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  if (type === 'normal') {
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    return;
  }
  if (type === 'block') {
    const blockSize = Math.max(1, Math.round(size));
    context.fillRect(Math.round(to.x - blockSize / 2), Math.round(to.y - blockSize / 2), blockSize, blockSize);
    return;
  }
  if (type === 'squares') {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    context.moveTo(from.x + dy, from.y - dx);
    context.lineTo(from.x - dy, from.y + dx);
    context.lineTo(to.x - dy, to.y + dx);
    context.lineTo(to.x + dy, to.y - dx);
    context.closePath();
    context.stroke();
    return;
  }
  if (type === 'circles') {
    const centerX = Math.floor(to.x / 100) * 100 + 50;
    const centerY = Math.floor(to.y / 100) * 100 + 50;
    const radius = Math.max(size, Math.hypot(to.x - from.x, to.y - from.y) * 2);
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.stroke();
    return;
  }
  if (type === 'grid') {
    const centerX = Math.round(to.x / 100) * 100;
    const centerY = Math.round(to.y / 100) * 100;
    context.globalAlpha = 0.05;
    for (let index = 0; index < 20; index += 1) {
      context.moveTo(centerX, centerY);
      context.quadraticCurveTo(to.x + (centerX - to.x) * (index / 2), to.y + (centerY - to.y) * ((20 - index) / 2), centerX, centerY);
    }
    context.stroke();
    return;
  }
  if (type === 'splatter') {
    for (let index = 0; index < 10; index += 1) {
      const angle = (index * 2.399963229728653) + to.x * 0.01;
      const distance = ((index * 17) % 11) / 10 * Math.max(4, size);
      const minimum = Math.min(splatterMinimumSize, splatterMaximumSize);
      const maximum = Math.max(splatterMinimumSize, splatterMaximumSize);
      const radius = minimum + (index % 10) / 9 * (maximum - minimum);
      context.moveTo(to.x + Math.cos(angle) * distance + radius, to.y + Math.sin(angle) * distance);
      context.arc(to.x + Math.cos(angle) * distance, to.y + Math.sin(angle) * distance, radius, 0, Math.PI * 2);
    }
    context.fill();
    return;
  }
  const angle = slashAngle * Math.PI / 180;
  const halfLength = Math.max(4, size * 1.5);
  context.moveTo(to.x - Math.cos(angle) * halfLength, to.y - Math.sin(angle) * halfLength);
  context.lineTo(to.x + Math.cos(angle) * halfLength, to.y + Math.sin(angle) * halfLength);
  context.stroke();
}

function drawShape(
  context: CanvasRenderingContext2D,
  tool: ToolId,
  start: Point,
  end: Point,
  options: ShapeDrawingOptions,
) {
  context.save();
  configureShape(context, options);
  const width = end.x - start.x;
  const height = end.y - start.y;
  context.beginPath();

  if (tool === 'line') {
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  } else if (tool === 'rectangle') {
    context.rect(start.x, start.y, width, height);
    strokeAndFillShape(context, options.fillStyle);
  } else if (tool === 'rounded-rectangle') {
    drawRoundedRect(context, start.x, start.y, width, height, options.roundedRadius);
    strokeAndFillShape(context, options.fillStyle);
  } else if (tool === 'ellipse') {
    context.ellipse(
      start.x + width / 2,
      start.y + height / 2,
      Math.abs(width / 2),
      Math.abs(height / 2),
      0,
      0,
      Math.PI * 2,
    );
    strokeAndFillShape(context, options.fillStyle);
  } else if (tool === 'gradient') {
    const distance = Math.max(1, Math.hypot(width, height));
    const gradient = options.gradientType === 'radial' || options.gradientType === 'diamond' || options.gradientType === 'conical'
      ? context.createRadialGradient(start.x, start.y, 0, start.x, start.y, distance)
      : context.createLinearGradient(start.x, start.y, end.x, end.y);
    const primaryRgb = options.primary.slice(0, 7);
    const primary = options.primary;
    const secondary = options.gradientColorMode === 'transparency' ? `${primaryRgb}00` : options.secondary;
    if (options.gradientType === 'reflected') {
      gradient.addColorStop(0, primary);
      gradient.addColorStop(0.5, secondary);
      gradient.addColorStop(1, primary);
    } else {
      gradient.addColorStop(0, primary);
      gradient.addColorStop(1, secondary);
    }
    context.fillStyle = gradient;
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  }
  context.restore();
}

const DRAWING_TOOLS: ToolId[] = ['paintbrush', 'block-brush', 'pencil', 'eraser', 'recolor', 'clone-stamp'];
const SHAPE_TOOLS: ToolId[] = ['line', 'rectangle', 'rounded-rectangle', 'ellipse', 'gradient'];
const EDITABLE_BOUNDS_TOOLS: EditableBoundsTool[] = ['rectangle', 'rounded-rectangle', 'ellipse'];
const EDITABLE_SHAPE_TOOLS: ToolId[] = ['line', ...EDITABLE_BOUNDS_TOOLS];
const SELECTION_TOOLS: ToolId[] = ['rectangle-select', 'ellipse-select', 'lasso-select', 'magic-wand'];

export function usePaintEditor() {
  const { toolSettings, setToolSetting } = usePreferences();
  const {
    tool,
    primary,
    secondary,
    brushSize,
    paintBrushType,
    slashBrushAngle,
    splatterMinimumSize,
    splatterMaximumSize,
    eraserType,
    floodMode,
    paintBucketTolerance,
    selectionAutoScroll,
    lassoMode,
    gradientType,
    gradientColorMode,
    alphaBlendingMode,
    colorPickerSampleSize,
    colorPickerSampleType,
    colorPickerAfterSelect,
    roundedRectangleRadius,
    shapeFillStyle,
    shapeDashStyle,
    shapeAntialiasing,
    lineArrowStart,
    lineArrowEnd,
    lineArrowSize,
    lineArrowAngle,
    lineArrowLength,
    magicWandTolerance,
    recolorTolerance,
    selectionMode,
    textFontFamily,
    textFontSize,
    textFontWeight,
    textItalic,
    textUnderline,
    textAlignment,
    textStyle,
    textVariant,
    textOutlineWidth,
    textLineJoin,
  } = toolSettings;
  const setToolState = useCallback((value: ToolId) => setToolSetting('tool', value), [setToolSetting]);
  const setPrimary = useCallback((value: string) => setToolSetting('primary', value), [setToolSetting]);
  const setSecondary = useCallback((value: string) => setToolSetting('secondary', value), [setToolSetting]);
  const setBrushSize = useCallback((value: number) => setToolSetting('brushSize', value), [setToolSetting]);
  const setPaintBrushType = useCallback((value: PaintBrushType) => setToolSetting('paintBrushType', value), [setToolSetting]);
  const setSlashBrushAngle = useCallback((value: number) => setToolSetting('slashBrushAngle', value), [setToolSetting]);
  const setSplatterMinimumSize = useCallback((value: number) => setToolSetting('splatterMinimumSize', value), [setToolSetting]);
  const setSplatterMaximumSize = useCallback((value: number) => setToolSetting('splatterMaximumSize', value), [setToolSetting]);
  const setEraserType = useCallback((value: EraserType) => setToolSetting('eraserType', value), [setToolSetting]);
  const setFloodMode = useCallback((value: FloodMode) => setToolSetting('floodMode', value), [setToolSetting]);
  const setPaintBucketTolerance = useCallback((value: number) => setToolSetting('paintBucketTolerance', value), [setToolSetting]);
  const setSelectionAutoScroll = useCallback((value: boolean) => setToolSetting('selectionAutoScroll', value), [setToolSetting]);
  const setLassoMode = useCallback((value: LassoMode) => setToolSetting('lassoMode', value), [setToolSetting]);
  const setGradientType = useCallback((value: GradientType) => setToolSetting('gradientType', value), [setToolSetting]);
  const setGradientColorMode = useCallback((value: GradientColorMode) => setToolSetting('gradientColorMode', value), [setToolSetting]);
  const setAlphaBlendingMode = useCallback((value: AlphaBlendingMode) => setToolSetting('alphaBlendingMode', value), [setToolSetting]);
  const setColorPickerSampleSize = useCallback((value: number) => setToolSetting('colorPickerSampleSize', value), [setToolSetting]);
  const setColorPickerSampleType = useCallback((value: ColorPickerSampleType) => setToolSetting('colorPickerSampleType', value), [setToolSetting]);
  const setColorPickerAfterSelect = useCallback((value: ColorPickerAfterSelect) => setToolSetting('colorPickerAfterSelect', value), [setToolSetting]);
  const setRoundedRectangleRadius = useCallback((value: number) => setToolSetting('roundedRectangleRadius', value), [setToolSetting]);
  const setShapeFillStyle = useCallback((value: ShapeFillStyle) => setToolSetting('shapeFillStyle', value), [setToolSetting]);
  const setShapeDashStyle = useCallback((value: ShapeDashStyle) => setToolSetting('shapeDashStyle', value), [setToolSetting]);
  const setShapeAntialiasing = useCallback((value: boolean) => setToolSetting('shapeAntialiasing', value), [setToolSetting]);
  const setLineArrowStart = useCallback((value: boolean) => setToolSetting('lineArrowStart', value), [setToolSetting]);
  const setLineArrowEnd = useCallback((value: boolean) => setToolSetting('lineArrowEnd', value), [setToolSetting]);
  const setLineArrowSize = useCallback((value: number) => setToolSetting('lineArrowSize', value), [setToolSetting]);
  const setLineArrowAngle = useCallback((value: number) => setToolSetting('lineArrowAngle', value), [setToolSetting]);
  const setLineArrowLength = useCallback((value: number) => setToolSetting('lineArrowLength', value), [setToolSetting]);
  const setMagicWandTolerance = useCallback((value: number) => setToolSetting('magicWandTolerance', value), [setToolSetting]);
  const setRecolorTolerance = useCallback((value: number) => setToolSetting('recolorTolerance', value), [setToolSetting]);
  const setSelectionMode = useCallback((value: SelectionMode) => setToolSetting('selectionMode', value), [setToolSetting]);
  const setTextFontFamily = useCallback((value: string) => setToolSetting('textFontFamily', value), [setToolSetting]);
  const setTextFontSize = useCallback((value: number) => setToolSetting('textFontSize', value), [setToolSetting]);
  const setTextFontWeight = useCallback((value: number) => setToolSetting('textFontWeight', value), [setToolSetting]);
  const setTextItalic = useCallback((value: boolean) => setToolSetting('textItalic', value), [setToolSetting]);
  const setTextUnderline = useCallback((value: boolean) => setToolSetting('textUnderline', value), [setToolSetting]);
  const setTextAlignment = useCallback((value: TextAlignment) => setToolSetting('textAlignment', value), [setToolSetting]);
  const setTextStyle = useCallback((value: TextStyle) => setToolSetting('textStyle', value), [setToolSetting]);
  const setTextVariant = useCallback((value: TextVariant) => setToolSetting('textVariant', value), [setToolSetting]);
  const setTextOutlineWidth = useCallback((value: number) => setToolSetting('textOutlineWidth', value), [setToolSetting]);
  const setTextLineJoin = useCallback((value: CanvasLineJoin) => setToolSetting('textLineJoin', value), [setToolSetting]);
  const initialLayerRef = useRef<PaintLayer | null>(null);
  if (!initialLayerRef.current) initialLayerRef.current = makeLayer(DEFAULT_WIDTH, DEFAULT_HEIGHT, 'Background', true);
  const initialLayer = initialLayerRef.current;

  const [layers, setLayers] = useState<PaintLayer[]>([initialLayer]);
  const layersRef = useRef(layers);
  const [activeLayerId, setActiveLayerIdState] = useState(initialLayer.id);
  const activeLayerIdRef = useRef(activeLayerId);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dimensionsRef = useRef({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const initialSnapshot = useRef(snapshotOf([initialLayer], initialLayer.id, DEFAULT_WIDTH, DEFAULT_HEIGHT, 'New Image'));
  const historyRef = useRef<HistorySnapshot[]>([initialSnapshot.current]);
  const [history, setHistory] = useState<HistorySnapshot[]>(historyRef.current);
  const [historyIndex, setHistoryIndexState] = useState(0);
  const historyIndexRef = useRef(0);
  const cleanHistoryIndexRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const previousToolRef = useRef<ToolId>(tool);
  const [palette, setPaletteState] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('pinta-online-palette') ?? 'null');
      if (Array.isArray(stored) && stored.length && stored.every((color) => typeof color === 'string' && /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color))) {
        return stored.map((color) => color.toLowerCase());
      }
    } catch {
      // Ignore malformed or unavailable local storage and use Pinta's defaults.
    }
    return [...PALETTE];
  });
  const [lineDraft, setLineDraft] = useState<EditableLineState | null>(null);
  const [shapeDraft, setShapeDraft] = useState<EditableShapeState | null>(null);
  const [archivedShapeDrafts, setArchivedShapeDrafts] = useState<StoredEditableDraft[]>([]);
  const [cloneSource, setCloneSource] = useState<Point | null>(null);
  const [zoom, setZoomState] = useState(1);
  const [pointer, setPointer] = useState<Point>({ x: 0, y: 0 });
  const [fileName, setFileName] = useState('Unsaved Image 1');
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectionRef = useRef<Selection | null>(selection);
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const [movingPixels, setMovingPixels] = useState<{ canvas: HTMLCanvasElement; x: number; y: number } | null>(null);
  const clipboardRef = useRef<HTMLCanvasElement | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const [clipboardSize, setClipboardSize] = useState({ width: 0, height: 0 });
  const [effectBusy, setEffectBusy] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceSaveState, setWorkspaceSaveState] = useState<'restoring' | 'saved' | 'saving' | 'error'>('restoring');
  const [workspaceError, setWorkspaceError] = useState('');
  const workspaceReadyRef = useRef(false);
  const workspaceSaveTimerRef = useRef<number | null>(null);
  const workspaceSaveGenerationRef = useRef(0);
  const workspaceSaveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    try {
      localStorage.setItem('pinta-online-palette', JSON.stringify(palette));
    } catch {
      // Palette persistence is optional in privacy-restricted browser contexts.
    }
  }, [palette]);
  const initialDocumentIdRef = useRef('');
  if (!initialDocumentIdRef.current) initialDocumentIdRef.current = makeId();
  const initialDocumentSessionRef = useRef<DocumentSession | null>(null);
  if (!initialDocumentSessionRef.current) {
    initialDocumentSessionRef.current = {
      id: initialDocumentIdRef.current,
      fileName: 'Unsaved Image 1',
      dirty: false,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      layers: [initialLayer],
      activeLayerId: initialLayer.id,
      history: historyRef.current,
      historyIndex: 0,
      cleanHistoryIndex: 0,
      zoom: 1,
      selection: null,
    };
  }
  const documentsRef = useRef<DocumentSession[]>([initialDocumentSessionRef.current]);
  const [documents, setDocuments] = useState<DocumentTab[]>([documentTabOf(initialDocumentSessionRef.current)]);
  const [activeDocumentId, setActiveDocumentIdState] = useState(initialDocumentIdRef.current);
  const activeDocumentIdRef = useRef(activeDocumentId);
  const untitledCounterRef = useRef(2);
  const currentDocumentViewRef = useRef({ fileName, dirty, zoom, selection });
  currentDocumentViewRef.current = { fileName, dirty, zoom, selection };

  const updateSelection = useCallback((next: Selection | null) => {
    selectionRef.current = next;
    currentDocumentViewRef.current.selection = next;
    setSelection(next);
  }, []);

  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const startRef = useRef<Point>({ x: 0, y: 0 });
  const lastRef = useRef<Point>({ x: 0, y: 0 });
  const moveSelectionRef = useRef<Selection | null>(null);
  const movePixelsRef = useRef<{ canvas: HTMLCanvasElement; startX: number; startY: number; x: number; y: number } | null>(null);
  const lassoPointsRef = useRef<Point[]>([]);
  const freeformPointsRef = useRef<Point[]>([]);
  const shapeReverseRef = useRef(false);
  const lineDraftRef = useRef<EditableLineState | null>(lineDraft);
  lineDraftRef.current = lineDraft;
  const lineDragPointRef = useRef<number | null>(null);
  const lineTensionDragRef = useRef<{ index: number; last: Point } | null>(null);
  const shapeDraftRef = useRef<EditableShapeState | null>(shapeDraft);
  shapeDraftRef.current = shapeDraft;
  const shapeDragPointRef = useRef<number | null>(null);
  const archivedShapeDraftsRef = useRef<StoredEditableDraft[]>(archivedShapeDrafts);
  archivedShapeDraftsRef.current = archivedShapeDrafts;
  const shapeDraftOrderRef = useRef<string[]>([]);
  const selectionGestureRef = useRef<{ previous: Selection | null; mode: SelectionMode } | null>(null);
  const selectionResizeRef = useRef<{ original: Selection; handle: SelectionResizeHandle; start: Point } | null>(null);
  const cloneSourceRef = useRef<Point | null>(null);
  const cloneOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const cloneStrokeRef = useRef<{ snapshot: HTMLCanvasElement; offsetX: number; offsetY: number } | null>(null);
  const recolorImageRef = useRef<ImageData | null>(null);
  const recolorReverseRef = useRef(false);
  const effectBusyRef = useRef(false);
  const effectPreviewTokenRef = useRef(0);
  const textEditorRef = useRef(textEditor);
  textEditorRef.current = textEditor;
  const commitTextRef = useRef<() => boolean>(() => false);
  const finalizeShapeDraftsRef = useRef<() => boolean>(() => false);
  const commitPendingEditsRef = useRef<() => boolean>(() => false);
  const pushHistoryRef = useRef<(label: string) => void>(() => {});

  const setLayerList = useCallback((next: PaintLayer[]) => {
    layersRef.current = next;
    setLayers(next);
  }, []);

  const setActiveLayerId = useCallback((id: string) => {
    activeLayerIdRef.current = id;
    setActiveLayerIdState(id);
  }, []);

  const setDimensions = useCallback((nextWidth: number, nextHeight: number) => {
    dimensionsRef.current = { width: nextWidth, height: nextHeight };
    setWidth(nextWidth);
    setHeight(nextHeight);
  }, []);

  const setHistoryIndex = useCallback((index: number) => {
    historyIndexRef.current = index;
    setHistoryIndexState(index);
  }, []);

  const setActiveDocumentId = useCallback((id: string) => {
    activeDocumentIdRef.current = id;
    setActiveDocumentIdState(id);
  }, []);

  const publishDocumentTabs = useCallback(() => {
    setDocuments(documentsRef.current.map(documentTabOf));
  }, []);

  const resetTransientDocumentState = useCallback(() => {
    drawingRef.current = false;
    setMovingPixels(null);
    moveSelectionRef.current = null;
    movePixelsRef.current = null;
    lassoPointsRef.current = [];
    freeformPointsRef.current = [];
    lineDragPointRef.current = null;
    lineTensionDragRef.current = null;
    lineDraftRef.current = null;
    setLineDraft(null);
    shapeDragPointRef.current = null;
    shapeDraftRef.current = null;
    setShapeDraft(null);
    archivedShapeDraftsRef.current = [];
    setArchivedShapeDrafts([]);
    shapeDraftOrderRef.current = [];
    selectionGestureRef.current = null;
    selectionResizeRef.current = null;
    cloneSourceRef.current = null;
    cloneOffsetRef.current = null;
    cloneStrokeRef.current = null;
    recolorImageRef.current = null;
    setCloneSource(null);
    textEditorRef.current = null;
    setTextEditor(null);
  }, []);

  const captureActiveDocument = useCallback(() => {
    const session = documentsRef.current.find((candidate) => candidate.id === activeDocumentIdRef.current);
    if (!session) return;
    const view = currentDocumentViewRef.current;
    session.fileName = view.fileName;
    session.dirty = view.dirty;
    session.width = dimensionsRef.current.width;
    session.height = dimensionsRef.current.height;
    session.layers = layersRef.current;
    session.activeLayerId = activeLayerIdRef.current;
    session.history = historyRef.current;
    session.historyIndex = historyIndexRef.current;
    session.cleanHistoryIndex = cleanHistoryIndexRef.current;
    session.zoom = view.zoom;
    session.selection = view.selection;
  }, []);

  const loadDocument = useCallback((session: DocumentSession) => {
    setActiveDocumentId(session.id);
    setDimensions(session.width, session.height);
    setLayerList(session.layers);
    setActiveLayerId(session.activeLayerId);
    historyRef.current = session.history;
    setHistory(session.history);
    setHistoryIndex(session.historyIndex);
    cleanHistoryIndexRef.current = session.cleanHistoryIndex;
    setFileName(session.fileName);
    setDirty(session.dirty);
    setZoomState(session.zoom);
    updateSelection(session.selection);
    resetTransientDocumentState();
    setPointer({ x: 0, y: 0 });
    setRevision((value) => value + 1);
  }, [resetTransientDocumentState, setActiveDocumentId, setActiveLayerId, setDimensions, setHistoryIndex, setLayerList, updateSelection]);

  useEffect(() => {
    let cancelled = false;
    const restoreWorkspace = async () => {
      try {
        const stored = await loadWorkspace();
        if (stored?.documents.length) {
          const restoredResults = await Promise.allSettled(stored.documents.map(documentFromPersisted));
          const restored = restoredResults.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []);
          if (!cancelled && restored.length) {
            documentsRef.current = restored;
            untitledCounterRef.current = Math.max(2, Math.round(stored.untitledCounter || 2));
            const active = restored.find((session) => session.id === stored.activeDocumentId) ?? restored[0];
            loadDocument(active);
            publishDocumentTabs();
          }
        }
        if (!cancelled) {
          workspaceReadyRef.current = true;
          setWorkspaceReady(true);
          setWorkspaceSaveState('saved');
        }
      } catch (error) {
        if (!cancelled) {
          workspaceReadyRef.current = true;
          setWorkspaceReady(true);
          setWorkspaceSaveState('error');
          setWorkspaceError(error instanceof Error ? error.message : 'The saved workspace could not be restored.');
        }
      }
    };
    void restoreWorkspace();
    return () => {
      cancelled = true;
    };
  }, [loadDocument, publishDocumentTabs]);

  const switchDocument = useCallback((id: string) => {
    if (id === activeDocumentIdRef.current || effectBusyRef.current) return id === activeDocumentIdRef.current;
    const target = documentsRef.current.find((candidate) => candidate.id === id);
    if (!target) return false;
    commitPendingEditsRef.current();
    captureActiveDocument();
    loadDocument(target);
    publishDocumentTabs();
    return true;
  }, [captureActiveDocument, loadDocument, publishDocumentTabs]);

  useEffect(() => {
    const active = documentsRef.current.find((candidate) => candidate.id === activeDocumentId);
    if (!active) return;
    active.fileName = fileName;
    active.dirty = dirty;
    active.width = width;
    active.height = height;
    active.zoom = zoom;
    active.selection = selection;
    publishDocumentTabs();
  }, [activeDocumentId, dirty, fileName, height, publishDocumentTabs, selection, width, zoom]);

  const persistWorkspaceNow = useCallback(async () => {
    if (!workspaceReadyRef.current) return;
    captureActiveDocument();
    const sessions = [...documentsRef.current];
    const workspace: PersistedWorkspace = {
      version: 2,
      activeDocumentId: activeDocumentIdRef.current,
      untitledCounter: untitledCounterRef.current,
      savedAt: Date.now(),
      documents: await Promise.all(sessions.map(persistedDocumentOf)),
    };
    await saveWorkspace(workspace);
  }, [captureActiveDocument]);

  useEffect(() => {
    if (!workspaceReady) return;
    const generation = ++workspaceSaveGenerationRef.current;
    if (workspaceSaveTimerRef.current !== null) window.clearTimeout(workspaceSaveTimerRef.current);
    setWorkspaceSaveState('saving');
    workspaceSaveTimerRef.current = window.setTimeout(() => {
      workspaceSaveTimerRef.current = null;
      workspaceSaveChainRef.current = workspaceSaveChainRef.current.catch(() => undefined).then(async () => {
        if (generation !== workspaceSaveGenerationRef.current) return;
        try {
          await persistWorkspaceNow();
          if (generation === workspaceSaveGenerationRef.current) {
            setWorkspaceError('');
            setWorkspaceSaveState('saved');
          }
        } catch (error) {
          if (generation === workspaceSaveGenerationRef.current) {
            setWorkspaceError(error instanceof Error ? error.message : 'The workspace could not be saved.');
            setWorkspaceSaveState('error');
          }
        }
      });
    }, 450);
    return () => {
      if (workspaceSaveTimerRef.current !== null) {
        window.clearTimeout(workspaceSaveTimerRef.current);
        workspaceSaveTimerRef.current = null;
      }
    };
  }, [activeDocumentId, dirty, documents, height, layers, persistWorkspaceNow, revision, selection, width, workspaceReady, zoom]);

  useEffect(() => {
    const persistBeforeLeaving = () => {
      if (workspaceReadyRef.current) void persistWorkspaceNow();
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') persistBeforeLeaving();
    };
    window.addEventListener('pagehide', persistBeforeLeaving);
    document.addEventListener('visibilitychange', persistWhenHidden);
    return () => {
      window.removeEventListener('pagehide', persistBeforeLeaving);
      document.removeEventListener('visibilitychange', persistWhenHidden);
    };
  }, [persistWorkspaceNow]);

  const renderComposite = useCallback((target: HTMLCanvasElement | null = displayCanvasRef.current) => {
    if (!target) return;
    if (target.width !== dimensionsRef.current.width) target.width = dimensionsRef.current.width;
    if (target.height !== dimensionsRef.current.height) target.height = dimensionsRef.current.height;
    const context = target.getContext('2d')!;
    context.clearRect(0, 0, target.width, target.height);
    for (const layer of layersRef.current) {
      paintLayer(context, layer);
    }
  }, []);

  useEffect(() => {
    renderComposite();
    const preview = previewCanvasRef.current;
    if (preview && (preview.width !== width || preview.height !== height)) {
      preview.width = width;
      preview.height = height;
    }
  }, [height, layers, renderComposite, revision, width]);

  useEffect(() => {
    const preview = previewCanvasRef.current;
    if (!preview) return;
    const context = preview.getContext('2d')!;
    context.clearRect(0, 0, preview.width, preview.height);
    if (movingPixels) context.drawImage(movingPixels.canvas, movingPixels.x, movingPixels.y);
    const draftsById = new Map<string, StoredEditableDraft>();
    for (const archived of archivedShapeDrafts) draftsById.set(archived.draft.id, archived);
    if (lineDraft) draftsById.set(lineDraft.id, { kind: 'line', draft: lineDraft });
    if (shapeDraft) draftsById.set(shapeDraft.id, { kind: 'shape', draft: shapeDraft });
    for (const id of shapeDraftOrderRef.current) {
      const stored = draftsById.get(id);
      if (!stored) continue;
      if (stored.kind === 'line') {
        drawEditableLine(context, stored.draft, stored.draft.options, stored.draft.id === lineDraft?.id && tool === 'line', zoom);
      } else {
        drawEditableShape(context, stored.draft, stored.draft.options, stored.draft.id === shapeDraft?.id && stored.draft.tool === tool, zoom);
      }
    }
    if (tool === 'clone-stamp' && cloneSource) {
      context.save();
      context.strokeStyle = '#4da3ff';
      context.lineWidth = 1;
      context.setLineDash([3, 2]);
      context.beginPath();
      context.arc(cloneSource.x, cloneSource.y, Math.max(3, brushSize / 2), 0, Math.PI * 2);
      context.moveTo(cloneSource.x - 5, cloneSource.y);
      context.lineTo(cloneSource.x + 5, cloneSource.y);
      context.moveTo(cloneSource.x, cloneSource.y - 5);
      context.lineTo(cloneSource.x, cloneSource.y + 5);
      context.stroke();
      context.restore();
    }
  }, [archivedShapeDrafts, brushSize, cloneSource, lineDraft, movingPixels, shapeDraft, tool, zoom]);

  useEffect(() => {
    const overlay = selectionCanvasRef.current;
    if (!overlay) return;
    if (overlay.width !== width) overlay.width = width;
    if (overlay.height !== height) overlay.height = height;
    drawSelectionOverlay(overlay, selection, tool, zoom);
    if (!selection || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let animationFrame = 0;
    let lastPhase = 0;
    const animate = (timestamp: number) => {
      const phase = Math.floor(timestamp / 100);
      if (phase !== lastPhase) {
        lastPhase = phase;
        drawSelectionOverlay(overlay, selection, tool, zoom, phase);
      }
      animationFrame = window.requestAnimationFrame(animate);
    };
    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [height, selection, tool, width, zoom]);

  const hasSelection = selection !== null && normalizeSelection(selection, width, height).width > 0 && normalizeSelection(selection, width, height).height > 0;
  const selectionBounds = hasSelection && selection ? normalizeSelection(selection, width, height) : null;
  const selectionResizable = hasSelection && isResizableSelection(selection, tool);
  const selectionResizeHandle = selectionResizeRef.current?.handle ?? selectionResizeHandleAtPoint(selection, tool, pointer, width, height, zoom);
  const selectionCursor = selectionResizeHandle ? SELECTION_RESIZE_CURSORS[selectionResizeHandle] : '';

  const pushHistory = useCallback((label: string, nextLayers = layersRef.current) => {
    const entry = snapshotOf(
      nextLayers,
      activeLayerIdRef.current,
      dimensionsRef.current.width,
      dimensionsRef.current.height,
      label,
      selectionRef.current,
    );
    const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
    let nextCleanIndex = cleanHistoryIndexRef.current;
    if (nextCleanIndex > historyIndexRef.current) nextCleanIndex = -1;
    const unbounded = [...trimmed, entry];
    const droppedEntries = Math.max(0, unbounded.length - MAX_HISTORY);
    const next = unbounded.slice(droppedEntries);
    if (nextCleanIndex >= 0) {
      nextCleanIndex -= droppedEntries;
      if (nextCleanIndex < 0) nextCleanIndex = -1;
    }
    cleanHistoryIndexRef.current = nextCleanIndex;
    historyRef.current = next;
    setHistory(next);
    setHistoryIndex(next.length - 1);
    currentDocumentViewRef.current.dirty = true;
    setDirty(true);
    setRevision((value) => value + 1);
  }, [setHistoryIndex]);
  pushHistoryRef.current = (label) => pushHistory(label);

  const currentShapeOptions = useCallback((reverseColors = false): ShapeDrawingOptions => ({
    primary,
    secondary,
    size: brushSize,
    fillStyle: shapeFillStyle,
    dashStyle: shapeDashStyle,
    arrowStart: lineArrowStart,
    arrowEnd: lineArrowEnd,
    arrowSize: lineArrowSize,
    arrowAngle: lineArrowAngle,
    arrowLength: lineArrowLength,
    roundedRadius: roundedRectangleRadius,
    gradientType,
    gradientColorMode,
    reverseColors,
  }), [brushSize, gradientColorMode, gradientType, lineArrowAngle, lineArrowEnd, lineArrowLength, lineArrowSize, lineArrowStart, primary, roundedRectangleRadius, secondary, shapeDashStyle, shapeFillStyle]);

  const applyShapeOptions = useCallback((options: ShapeDrawingOptions) => {
    setPrimary(options.primary);
    setSecondary(options.secondary);
    setBrushSize(options.size);
    setShapeFillStyle(options.fillStyle);
    setShapeDashStyle(options.dashStyle);
    setLineArrowStart(options.arrowStart);
    setLineArrowEnd(options.arrowEnd);
    setLineArrowSize(options.arrowSize);
    setLineArrowAngle(options.arrowAngle ?? 15);
    setLineArrowLength(options.arrowLength ?? 10);
    setRoundedRectangleRadius(options.roundedRadius);
    setGradientType(options.gradientType);
    setGradientColorMode(options.gradientColorMode);
  }, []);

  const renderDraftToActiveLayer = useCallback((draw: (context: CanvasRenderingContext2D) => void) => {
    const layer = layersRef.current.find((candidate) => candidate.id === activeLayerIdRef.current);
    if (!layer) return false;
    const draft = makeCanvas(dimensionsRef.current.width, dimensionsRef.current.height);
    const context = draft.getContext('2d')!;
    draw(context);
    if (!shapeAntialiasing) removeAntialiasing(context);
    if (selection) {
      const bounds = normalizeSelection(selection, draft.width, draft.height);
      const fullMask = makeCanvas(draft.width, draft.height);
      fullMask.getContext('2d')!.drawImage(createSelectionMask(bounds), bounds.x, bounds.y);
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(fullMask, 0, 0);
      context.globalCompositeOperation = 'source-over';
    }
    layer.canvas.getContext('2d')!.drawImage(draft, 0, 0);
    return true;
  }, [selection, shapeAntialiasing]);

  const updateLineDraft = useCallback((next: EditableLineState | null) => {
    lineDraftRef.current = next;
    setLineDraft(next);
  }, []);

  const cancelLine = useCallback(() => {
    const id = lineDraftRef.current?.id;
    if (id) shapeDraftOrderRef.current = shapeDraftOrderRef.current.filter((candidate) => candidate !== id);
    lineDragPointRef.current = null;
    lineTensionDragRef.current = null;
    updateLineDraft(null);
  }, [updateLineDraft]);

  const commitLine = useCallback(() => {
    return finalizeShapeDraftsRef.current();
  }, []);

  const deleteLinePoint = useCallback(() => {
    const draft = lineDraftRef.current;
    if (!draft || draft.points.length <= 2) return false;
    const points = draft.points.filter((_, index) => index !== draft.selectedPoint);
    const tensions = draft.tensions.filter((_, index) => index !== draft.selectedPoint);
    updateLineDraft({ ...draft, points, tensions, selectedPoint: Math.min(draft.selectedPoint, points.length - 1) });
    return true;
  }, [updateLineDraft]);

  const setSelectedLineTension = useCallback((tension: number) => {
    const draft = lineDraftRef.current;
    if (!draft || !draft.points[draft.selectedPoint]) return false;
    const tensions = [...draft.tensions];
    tensions[draft.selectedPoint] = Math.max(0, Math.min(1, tension));
    updateLineDraft({ ...draft, tensions });
    return true;
  }, [updateLineDraft]);

  const nudgeLinePoint = useCallback((dx: number, dy: number) => {
    const draft = lineDraftRef.current;
    if (!draft || !draft.points[draft.selectedPoint]) return false;
    const points = [...draft.points];
    const point = points[draft.selectedPoint];
    points[draft.selectedPoint] = {
      x: Math.max(0, Math.min(dimensionsRef.current.width, point.x + dx)),
      y: Math.max(0, Math.min(dimensionsRef.current.height, point.y + dy)),
    };
    updateLineDraft({ ...draft, points });
    return true;
  }, [updateLineDraft]);

  const updateShapeDraft = useCallback((next: EditableShapeState | null) => {
    shapeDraftRef.current = next;
    setShapeDraft(next);
  }, []);

  const updateArchivedShapeDrafts = useCallback((next: StoredEditableDraft[]) => {
    archivedShapeDraftsRef.current = next;
    setArchivedShapeDrafts(next);
  }, []);

  const removeDraftFromOrder = useCallback((id: string) => {
    shapeDraftOrderRef.current = shapeDraftOrderRef.current.filter((candidate) => candidate !== id);
  }, []);

  const archiveCurrentLine = useCallback(() => {
    const current = lineDraftRef.current;
    if (!current) return false;
    if (isRenderableLineDraft(current)) {
      updateArchivedShapeDrafts([...archivedShapeDraftsRef.current, { kind: 'line', draft: current }]);
    } else {
      removeDraftFromOrder(current.id);
    }
    lineDragPointRef.current = null;
    lineTensionDragRef.current = null;
    updateLineDraft(null);
    return true;
  }, [removeDraftFromOrder, updateArchivedShapeDrafts, updateLineDraft]);

  const archiveCurrentShape = useCallback(() => {
    const current = shapeDraftRef.current;
    if (!current) return false;
    if (isRenderableShapeDraft(current)) {
      updateArchivedShapeDrafts([...archivedShapeDraftsRef.current, { kind: 'shape', draft: current }]);
    } else {
      removeDraftFromOrder(current.id);
    }
    shapeDragPointRef.current = null;
    updateShapeDraft(null);
    return true;
  }, [removeDraftFromOrder, updateArchivedShapeDrafts, updateShapeDraft]);

  const activateArchivedDraft = useCallback((id: string) => {
    const stored = archivedShapeDraftsRef.current.find((candidate) => candidate.draft.id === id);
    if (!stored) return false;
    let next = archivedShapeDraftsRef.current.filter((candidate) => candidate.draft.id !== id);
    if (stored.kind === 'line') {
      const current = lineDraftRef.current;
      if (current && current.id !== id) {
        if (isRenderableLineDraft(current)) next = [...next, { kind: 'line', draft: current }];
        else removeDraftFromOrder(current.id);
      }
      updateLineDraft(stored.draft);
    } else {
      const current = shapeDraftRef.current;
      if (current && current.id !== id) {
        if (isRenderableShapeDraft(current)) next = [...next, { kind: 'shape', draft: current }];
        else removeDraftFromOrder(current.id);
      }
      updateShapeDraft(stored.draft);
    }
    updateArchivedShapeDrafts(next);
    applyShapeOptions(stored.draft.options);
    return true;
  }, [applyShapeOptions, removeDraftFromOrder, updateArchivedShapeDrafts, updateLineDraft, updateShapeDraft]);

  useEffect(() => {
    if (tool === 'line' && lineDraftRef.current) {
      const current = lineDraftRef.current;
      updateLineDraft({ ...current, options: currentShapeOptions(current.reverseColors) });
    } else if (EDITABLE_BOUNDS_TOOLS.includes(tool as EditableBoundsTool) && shapeDraftRef.current?.tool === tool) {
      const current = shapeDraftRef.current;
      updateShapeDraft({ ...current, options: currentShapeOptions(current.reverseColors) });
    }
  }, [currentShapeOptions, tool, updateLineDraft, updateShapeDraft]);

  const cancelShape = useCallback(() => {
    const id = shapeDraftRef.current?.id;
    if (id) shapeDraftOrderRef.current = shapeDraftOrderRef.current.filter((candidate) => candidate !== id);
    shapeDragPointRef.current = null;
    updateShapeDraft(null);
  }, [updateShapeDraft]);

  const commitShape = useCallback(() => {
    return finalizeShapeDraftsRef.current();
  }, []);

  const nudgeShapePoint = useCallback((dx: number, dy: number) => {
    const draft = shapeDraftRef.current;
    if (!draft || !draft.points[draft.selectedPoint]) return false;
    const current = draft.points[draft.selectedPoint];
    const nextPoint = {
      x: Math.max(0, Math.min(dimensionsRef.current.width, current.x + dx)),
      y: Math.max(0, Math.min(dimensionsRef.current.height, current.y + dy)),
    };
    updateShapeDraft(moveRectangularControlPoint(draft, draft.selectedPoint, nextPoint));
    return true;
  }, [updateShapeDraft]);

  const finalizeShapeDrafts = useCallback(() => {
    const line = lineDraftRef.current;
    const shape = shapeDraftRef.current;
    const draftsById = new Map<string, StoredEditableDraft>();
    for (const archived of archivedShapeDraftsRef.current) draftsById.set(archived.draft.id, archived);
    if (line) draftsById.set(line.id, { kind: 'line', draft: line });
    if (shape) draftsById.set(shape.id, { kind: 'shape', draft: shape });
    if (!draftsById.size) return false;
    let rendered = false;
    for (const id of shapeDraftOrderRef.current) {
      const stored = draftsById.get(id);
      if (!stored) continue;
      if (stored.kind === 'line' && isRenderableLineDraft(stored.draft)) {
        rendered = renderDraftToActiveLayer((context) => drawEditableLine(context, stored.draft, stored.draft.options)) || rendered;
      } else if (stored.kind === 'shape' && isRenderableShapeDraft(stored.draft)) {
        rendered = renderDraftToActiveLayer((context) => drawEditableShape(context, stored.draft, stored.draft.options)) || rendered;
      }
    }
    lineDragPointRef.current = null;
    lineTensionDragRef.current = null;
    shapeDragPointRef.current = null;
    updateLineDraft(null);
    updateShapeDraft(null);
    updateArchivedShapeDrafts([]);
    shapeDraftOrderRef.current = [];
    if (rendered) pushHistory('Finalize Shapes');
    return rendered;
  }, [pushHistory, renderDraftToActiveLayer, updateArchivedShapeDrafts, updateLineDraft, updateShapeDraft]);
  finalizeShapeDraftsRef.current = finalizeShapeDrafts;

  const cancelText = useCallback(() => {
    textEditorRef.current = null;
    setTextEditor(null);
  }, []);

  const commitText = useCallback(() => {
    const editor = textEditorRef.current;
    if (!editor) return false;
    if (!editor.value.length) {
      textEditorRef.current = null;
      setTextEditor(null);
      return false;
    }
    const layer = layersRef.current.find((candidate) => candidate.id === activeLayerIdRef.current);
    if (!layer) {
      textEditorRef.current = null;
      setTextEditor(null);
      return false;
    }
    const draft = makeCanvas(dimensionsRef.current.width, dimensionsRef.current.height);
    const draftContext = draft.getContext('2d')!;
    drawTextEditor(draftContext, editor, {
      fontFamily: textFontFamily,
      fontSize: textFontSize,
      fontWeight: textFontWeight,
      italic: textItalic,
      underline: textUnderline,
      alignment: textAlignment,
      style: textStyle,
      variant: textVariant,
      outlineWidth: textOutlineWidth,
      lineJoin: textLineJoin,
      primary,
      secondary,
    });
    if (selection) {
      const bounds = normalizeSelection(selection, draft.width, draft.height);
      const fullMask = makeCanvas(draft.width, draft.height);
      fullMask.getContext('2d')!.drawImage(createSelectionMask(bounds), bounds.x, bounds.y);
      draftContext.globalCompositeOperation = 'destination-in';
      draftContext.drawImage(fullMask, 0, 0);
      draftContext.globalCompositeOperation = 'source-over';
    }
    layer.canvas.getContext('2d')!.drawImage(draft, 0, 0);
    textEditorRef.current = null;
    setTextEditor(null);
    pushHistory('Text');
    return true;
  }, [primary, pushHistory, secondary, selection, textAlignment, textFontFamily, textFontSize, textFontWeight, textItalic, textLineJoin, textOutlineWidth, textStyle, textUnderline, textVariant]);
  commitTextRef.current = commitText;

  const commitPendingEdits = useCallback(() => {
    const textCommitted = commitTextRef.current();
    const shapesCommitted = finalizeShapeDraftsRef.current();
    return textCommitted || shapesCommitted;
  }, []);
  commitPendingEditsRef.current = commitPendingEdits;

  const setTool = useCallback((nextTool: ToolId) => {
    if (nextTool !== tool && tool === 'lasso-select' && lassoMode === 'polygon' && selectionGestureRef.current) {
      updateSelection(selectionGestureRef.current.previous);
      selectionGestureRef.current = null;
      lassoPointsRef.current = [];
    }
    const staysInEditableShapeFamily = EDITABLE_SHAPE_TOOLS.includes(tool) && EDITABLE_SHAPE_TOOLS.includes(nextTool);
    if (nextTool !== tool && !staysInEditableShapeFamily) commitPendingEditsRef.current();
    if (nextTool !== tool && staysInEditableShapeFamily &&
      EDITABLE_BOUNDS_TOOLS.includes(tool as EditableBoundsTool) &&
      EDITABLE_BOUNDS_TOOLS.includes(nextTool as EditableBoundsTool) &&
      shapeDraftRef.current?.tool !== nextTool) {
      archiveCurrentShape();
    }
    if (nextTool !== tool) previousToolRef.current = tool;
    setToolState(nextTool);
  }, [archiveCurrentShape, lassoMode, tool, updateSelection]);

  const beginText = useCallback((point: Point) => {
    commitPendingEditsRef.current();
    const next = { x: point.x, y: point.y, value: '' };
    textEditorRef.current = next;
    setTextEditor(next);
  }, []);

  const updateText = useCallback((value: string) => {
    const current = textEditorRef.current;
    if (!current) return;
    const next = { ...current, value };
    textEditorRef.current = next;
    setTextEditor(next);
  }, []);

  const moveText = useCallback((x: number, y: number) => {
    const current = textEditorRef.current;
    if (!current) return;
    const next = {
      ...current,
      x: Math.max(0, Math.min(dimensionsRef.current.width, x)),
      y: Math.max(0, Math.min(dimensionsRef.current.height, y)),
    };
    textEditorRef.current = next;
    setTextEditor(next);
  }, []);

  const restoreHistory = useCallback((index: number) => {
    commitPendingEditsRef.current();
    const entry = historyRef.current[index];
    if (!entry) return;
    const restored = entry.layers.map(layerFromSnapshot);
    setDimensions(entry.width, entry.height);
    setLayerList(restored);
    setActiveLayerId(entry.activeLayerId);
    setHistoryIndex(index);
    const nextDirty = index !== cleanHistoryIndexRef.current;
    currentDocumentViewRef.current.dirty = nextDirty;
    setDirty(nextDirty);
    updateSelection(selectionFromSnapshot(entry.selection));
    setMovingPixels(null);
    cloneSourceRef.current = null;
    cloneOffsetRef.current = null;
    setCloneSource(null);
    setRevision((value) => value + 1);
  }, [setActiveLayerId, setDimensions, setHistoryIndex, setLayerList, updateSelection]);

  const undo = useCallback(() => {
    if (textEditorRef.current || lineDraftRef.current || shapeDraftRef.current || archivedShapeDraftsRef.current.length) {
      const committed = commitPendingEditsRef.current();
      if (committed && historyIndexRef.current > 0) restoreHistory(historyIndexRef.current - 1);
      return;
    }
    if (historyIndexRef.current > 0) restoreHistory(historyIndexRef.current - 1);
  }, [restoreHistory]);

  const redo = useCallback(() => {
    if (textEditorRef.current || lineDraftRef.current || shapeDraftRef.current || archivedShapeDraftsRef.current.length) {
      commitPendingEditsRef.current();
      return;
    }
    if (historyIndexRef.current < history.length - 1) restoreHistory(historyIndexRef.current + 1);
  }, [history.length, restoreHistory]);

  const newDocument = useCallback((newWidth = DEFAULT_WIDTH, newHeight = DEFAULT_HEIGHT, background: 'white' | 'secondary' | 'transparent' = 'white') => {
    const safeWidth = Math.max(1, Math.min(16384, Math.round(newWidth)));
    const safeHeight = Math.max(1, Math.min(16384, Math.round(newHeight)));
    const layer = makeLayer(safeWidth, safeHeight, 'Background', background === 'white');
    if (background === 'secondary') {
      const context = layer.canvas.getContext('2d')!;
      context.fillStyle = secondary;
      context.fillRect(0, 0, safeWidth, safeHeight);
    }
    const entry = snapshotOf([layer], layer.id, safeWidth, safeHeight, 'New Image');
    const session: DocumentSession = {
      id: makeId(),
      fileName: `Unsaved Image ${untitledCounterRef.current++}`,
      dirty: false,
      width: safeWidth,
      height: safeHeight,
      layers: [layer],
      activeLayerId: layer.id,
      history: [entry],
      historyIndex: 0,
      cleanHistoryIndex: 0,
      zoom: 1,
      selection: null,
    };
    commitPendingEditsRef.current();
    captureActiveDocument();
    const activeIndex = documentsRef.current.findIndex((candidate) => candidate.id === activeDocumentIdRef.current);
    const next = [...documentsRef.current];
    next.splice(activeIndex + 1, 0, session);
    documentsRef.current = next;
    loadDocument(session);
    publishDocumentTabs();
  }, [captureActiveDocument, loadDocument, publishDocumentTabs, secondary]);

  const newDocumentFromCanvas = useCallback((source: HTMLCanvasElement, historyLabel = 'New Screenshot') => {
    const safeWidth = Math.max(1, Math.min(16384, source.width));
    const safeHeight = Math.max(1, Math.min(16384, source.height));
    const layer = makeLayer(safeWidth, safeHeight, 'Background');
    layer.canvas.getContext('2d')!.drawImage(source, 0, 0, safeWidth, safeHeight);
    const entry = snapshotOf([layer], layer.id, safeWidth, safeHeight, historyLabel);
    const session: DocumentSession = {
      id: makeId(),
      fileName: `Unsaved Image ${untitledCounterRef.current++}`,
      dirty: false,
      width: safeWidth,
      height: safeHeight,
      layers: [layer],
      activeLayerId: layer.id,
      history: [entry],
      historyIndex: 0,
      cleanHistoryIndex: 0,
      zoom: 1,
      selection: null,
    };
    commitPendingEditsRef.current();
    captureActiveDocument();
    const activeIndex = documentsRef.current.findIndex((candidate) => candidate.id === activeDocumentIdRef.current);
    const next = [...documentsRef.current];
    next.splice(activeIndex + 1, 0, session);
    documentsRef.current = next;
    loadDocument(session);
    publishDocumentTabs();
    return true;
  }, [captureActiveDocument, loadDocument, publishDocumentTabs]);

  const openFile = useCallback(async (file: File) => {
    const opened = await decodeImageFile(file);
    const activeLayer = opened.layers.at(-1)!;
    const entry = snapshotOf(opened.layers, activeLayer.id, opened.width, opened.height, 'Open Image');
    const session: DocumentSession = {
      id: makeId(),
      fileName: file.name,
      dirty: false,
      width: opened.width,
      height: opened.height,
      layers: opened.layers,
      activeLayerId: activeLayer.id,
      history: [entry],
      historyIndex: 0,
      cleanHistoryIndex: 0,
      zoom: 1,
      selection: null,
    };
    commitPendingEditsRef.current();
    captureActiveDocument();
    const activeIndex = documentsRef.current.findIndex((candidate) => candidate.id === activeDocumentIdRef.current);
    const next = [...documentsRef.current];
    next.splice(activeIndex + 1, 0, session);
    documentsRef.current = next;
    loadDocument(session);
    publishDocumentTabs();
  }, [captureActiveDocument, loadDocument, publishDocumentTabs]);

  const saveImage = useCallback(async (options: ExportOptions = {}) => {
    commitPendingEditsRef.current();
    const currentName = currentDocumentViewRef.current.fileName;
    const format = options.format ?? exportFormatFromFileName(currentName) ?? 'png';
    const requestedName = options.fileName?.trim() || currentName;
    const baseName = requestedName.replace(/\.[^.]+$/, '') || 'pinta-image';
    const savedName = `${baseName}.${exportExtension(format)}`;
    const blob = await createDocumentExportBlob(layersRef.current, dimensionsRef.current.width, dimensionsRef.current.height, format, options.quality ?? 0.92);
    if (!blob) return false;
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.download = savedName;
    link.href = url;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    cleanHistoryIndexRef.current = historyIndexRef.current;
    const session = documentsRef.current.find((candidate) => candidate.id === activeDocumentIdRef.current);
    if (session) {
      session.fileName = savedName;
      session.dirty = false;
      session.cleanHistoryIndex = historyIndexRef.current;
    }
    currentDocumentViewRef.current.fileName = savedName;
    currentDocumentViewRef.current.dirty = false;
    setFileName(savedName);
    setDirty(false);
    publishDocumentTabs();
    return true;
  }, [publishDocumentTabs]);

  const saveAllImages = useCallback(async () => {
    commitPendingEditsRef.current();
    captureActiveDocument();
    const dirtyDocuments = documentsRef.current.filter((session) => session.dirty);
    let saved = 0;
    for (const session of dirtyDocuments) {
      const format = exportFormatFromFileName(session.fileName) ?? 'png';
      const baseName = session.fileName.replace(/\.[^.]+$/, '') || 'pinta-image';
      const savedName = `${baseName}.${exportExtension(format)}`;
      const blob = await createDocumentExportBlob(session.layers, session.width, session.height, format);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = savedName;
      link.href = url;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      session.fileName = savedName;
      session.dirty = false;
      session.cleanHistoryIndex = session.historyIndex;
      saved += 1;
    }
    const active = documentsRef.current.find((session) => session.id === activeDocumentIdRef.current);
    if (active) {
      cleanHistoryIndexRef.current = active.cleanHistoryIndex;
      currentDocumentViewRef.current.fileName = active.fileName;
      currentDocumentViewRef.current.dirty = active.dirty;
      setFileName(active.fileName);
      setDirty(active.dirty);
    }
    publishDocumentTabs();
    return saved;
  }, [captureActiveDocument, publishDocumentTabs]);

  const createCompositeDataUrl = useCallback(() => {
    commitPendingEditsRef.current();
    const output = makeCanvas(dimensionsRef.current.width, dimensionsRef.current.height);
    const context = output.getContext('2d')!;
    for (const layer of layersRef.current) paintLayer(context, layer);
    return output.toDataURL('image/png');
  }, []);

  const closeDocument = useCallback((id: string) => {
    if (effectBusyRef.current) return false;
    commitPendingEditsRef.current();
    captureActiveDocument();
    const closingIndex = documentsRef.current.findIndex((candidate) => candidate.id === id);
    if (closingIndex < 0) return false;
    const closingActiveDocument = id === activeDocumentIdRef.current;
    const remaining = documentsRef.current.filter((candidate) => candidate.id !== id);

    if (remaining.length === 0) {
      const layer = makeLayer(DEFAULT_WIDTH, DEFAULT_HEIGHT, 'Background', true);
      const entry = snapshotOf([layer], layer.id, DEFAULT_WIDTH, DEFAULT_HEIGHT, 'New Image');
      remaining.push({
        id: makeId(),
        fileName: `Unsaved Image ${untitledCounterRef.current++}`,
        dirty: false,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        layers: [layer],
        activeLayerId: layer.id,
        history: [entry],
        historyIndex: 0,
        cleanHistoryIndex: 0,
        zoom: 1,
        selection: null,
      });
    }

    documentsRef.current = remaining;
    if (closingActiveDocument) {
      loadDocument(remaining[Math.min(closingIndex, remaining.length - 1)]);
    }
    publishDocumentTabs();
    return true;
  }, [captureActiveDocument, loadDocument, publishDocumentTabs]);

  const closeAllDocuments = useCallback(() => {
    if (effectBusyRef.current) return false;
    commitPendingEditsRef.current();
    const layer = makeLayer(DEFAULT_WIDTH, DEFAULT_HEIGHT, 'Background', true);
    const entry = snapshotOf([layer], layer.id, DEFAULT_WIDTH, DEFAULT_HEIGHT, 'New Image');
    const session: DocumentSession = {
      id: makeId(),
      fileName: `Unsaved Image ${untitledCounterRef.current++}`,
      dirty: false,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      layers: [layer],
      activeLayerId: layer.id,
      history: [entry],
      historyIndex: 0,
      cleanHistoryIndex: 0,
      zoom: 1,
      selection: null,
    };
    documentsRef.current = [session];
    loadDocument(session);
    publishDocumentTabs();
    return true;
  }, [loadDocument, publishDocumentTabs]);

  const activeLayer = useCallback(() => layersRef.current.find((layer) => layer.id === activeLayerIdRef.current), []);

  const addLayer = useCallback(() => {
    commitPendingEditsRef.current();
    const layer = makeLayer(dimensionsRef.current.width, dimensionsRef.current.height, `Layer ${layersRef.current.length + 1}`);
    const activeIndex = layersRef.current.findIndex((candidate) => candidate.id === activeLayerIdRef.current);
    const next = [...layersRef.current];
    next.splice(activeIndex + 1, 0, layer);
    setLayerList(next);
    setActiveLayerId(layer.id);
    activeLayerIdRef.current = layer.id;
    pushHistory('Add New Layer', next);
  }, [pushHistory, setActiveLayerId, setLayerList]);

  const importLayerFromFile = useCallback(async (file: File) => {
    commitPendingEditsRef.current();
    const opened = await decodeImageFile(file);
    const imported = makeLayer(dimensionsRef.current.width, dimensionsRef.current.height, file.name);
    const source = makeCanvas(opened.width, opened.height);
    const sourceContext = source.getContext('2d')!;
    for (const layer of opened.layers) paintLayer(sourceContext, layer);
    imported.canvas.getContext('2d')!.drawImage(source, 0, 0);
    const activeIndex = layersRef.current.findIndex((candidate) => candidate.id === activeLayerIdRef.current);
    const next = [...layersRef.current];
    next.splice(activeIndex + 1, 0, imported);
    setLayerList(next);
    setActiveLayerId(imported.id);
    activeLayerIdRef.current = imported.id;
    pushHistory('Import From File', next);
    return true;
  }, [pushHistory, setActiveLayerId, setLayerList]);

  const duplicateLayer = useCallback(() => {
    commitPendingEditsRef.current();
    const source = activeLayer();
    if (!source) return;
    const copy = makeLayer(source.canvas.width, source.canvas.height, `${source.name} copy`);
    copy.visible = source.visible;
    copy.opacity = source.opacity;
    copy.blendMode = source.blendMode;
    copy.canvas.getContext('2d')!.drawImage(source.canvas, 0, 0);
    const index = layersRef.current.indexOf(source);
    const next = [...layersRef.current];
    next.splice(index + 1, 0, copy);
    setLayerList(next);
    setActiveLayerId(copy.id);
    activeLayerIdRef.current = copy.id;
    pushHistory('Duplicate Layer', next);
  }, [activeLayer, pushHistory, setActiveLayerId, setLayerList]);

  const deleteLayer = useCallback(() => {
    commitPendingEditsRef.current();
    if (layersRef.current.length === 1) return;
    const index = layersRef.current.findIndex((layer) => layer.id === activeLayerIdRef.current);
    const next = layersRef.current.filter((layer) => layer.id !== activeLayerIdRef.current);
    const nextActive = next[Math.max(0, index - 1)] ?? next[0];
    setLayerList(next);
    setActiveLayerId(nextActive.id);
    activeLayerIdRef.current = nextActive.id;
    pushHistory('Delete Layer', next);
  }, [pushHistory, setActiveLayerId, setLayerList]);

  const mergeLayerDown = useCallback(() => {
    commitPendingEditsRef.current();
    const index = layersRef.current.findIndex((layer) => layer.id === activeLayerIdRef.current);
    if (index <= 0) return;
    const top = layersRef.current[index];
    const bottom = layersRef.current[index - 1];
    const merged = makeLayer(width, height, bottom.name);
    const context = merged.canvas.getContext('2d')!;
    paintLayer(context, bottom);
    paintLayer(context, top);
    const next = [...layersRef.current];
    next.splice(index - 1, 2, merged);
    setLayerList(next);
    setActiveLayerId(merged.id);
    activeLayerIdRef.current = merged.id;
    pushHistory('Merge Layer Down', next);
  }, [height, pushHistory, setActiveLayerId, setLayerList, width]);

  const moveLayer = useCallback((direction: -1 | 1) => {
    commitPendingEditsRef.current();
    const index = layersRef.current.findIndex((layer) => layer.id === activeLayerIdRef.current);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= layersRef.current.length) return;
    const next = [...layersRef.current];
    [next[index], next[target]] = [next[target], next[index]];
    setLayerList(next);
    pushHistory(direction > 0 ? 'Move Layer Up' : 'Move Layer Down', next);
  }, [pushHistory, setLayerList]);

  const flipLayer = useCallback((direction: 'horizontal' | 'vertical') => {
    commitPendingEditsRef.current();
    const layer = layersRef.current.find((candidate) => candidate.id === activeLayerIdRef.current);
    if (!layer) return false;
    const canvas = makeCanvas(layer.canvas.width, layer.canvas.height);
    const context = canvas.getContext('2d')!;
    context.translate(direction === 'horizontal' ? canvas.width : 0, direction === 'vertical' ? canvas.height : 0);
    context.scale(direction === 'horizontal' ? -1 : 1, direction === 'vertical' ? -1 : 1);
    context.drawImage(layer.canvas, 0, 0);
    const next = layersRef.current.map((candidate) => candidate.id === layer.id ? { ...candidate, canvas } : candidate);
    setLayerList(next);
    pushHistory(direction === 'horizontal' ? 'Flip Layer Horizontal' : 'Flip Layer Vertical', next);
    return true;
  }, [pushHistory, setLayerList]);

  const rotateZoomLayer = useCallback((angle: number, panHorizontal: number, panVertical: number, zoomAmount: number) => {
    commitPendingEditsRef.current();
    const layer = layersRef.current.find((candidate) => candidate.id === activeLayerIdRef.current);
    if (!layer) return false;
    const safeAngle = Math.max(-360, Math.min(360, angle));
    const safePanHorizontal = Math.max(-1, Math.min(1, panHorizontal));
    const safePanVertical = Math.max(-1, Math.min(1, panVertical));
    const safeZoom = Math.max(0.01, Math.min(16, zoomAmount));
    if (safeAngle === 0 && safePanHorizontal === 0 && safePanVertical === 0 && safeZoom === 1) return false;
    const canvas = makeCanvas(layer.canvas.width, layer.canvas.height);
    const context = canvas.getContext('2d')!;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    context.translate((1 + safePanHorizontal) * centerX, (1 + safePanVertical) * centerY);
    context.rotate(-safeAngle * Math.PI / 180);
    context.scale(safeZoom, safeZoom);
    context.translate(-centerX, -centerY);
    context.drawImage(layer.canvas, 0, 0);
    const next = layersRef.current.map((candidate) => candidate.id === layer.id ? { ...candidate, canvas } : candidate);
    setLayerList(next);
    pushHistory('Rotate / Zoom Layer', next);
    return true;
  }, [pushHistory, setLayerList]);

  const flattenImage = useCallback(() => {
    commitPendingEditsRef.current();
    if (layersRef.current.length < 2) return false;
    const flattened = makeLayer(dimensionsRef.current.width, dimensionsRef.current.height, layersRef.current[0].name);
    const context = flattened.canvas.getContext('2d')!;
    for (const layer of layersRef.current) paintLayer(context, layer);
    const next = [flattened];
    setLayerList(next);
    setActiveLayerId(flattened.id);
    activeLayerIdRef.current = flattened.id;
    pushHistory('Flatten', next);
    return true;
  }, [pushHistory, setActiveLayerId, setLayerList]);

  const toggleLayer = useCallback((id: string) => {
    commitPendingEditsRef.current();
    const next = layersRef.current.map((layer) => layer.id === id ? { ...layer, visible: !layer.visible } : layer);
    setLayerList(next);
    pushHistory('Layer Visibility', next);
  }, [pushHistory, setLayerList]);

  const renameLayer = useCallback((id: string, name: string) => {
    commitPendingEditsRef.current();
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = layersRef.current.map((layer) => layer.id === id ? { ...layer, name: trimmed } : layer);
    setLayerList(next);
    pushHistory('Layer Properties', next);
  }, [pushHistory, setLayerList]);

  const updateLayerProperties = useCallback((id: string, properties: { name: string; visible: boolean; opacity: number; blendMode: BlendMode }) => {
    commitPendingEditsRef.current();
    const trimmed = properties.name.trim();
    if (!trimmed) return false;
    const layer = layersRef.current.find((candidate) => candidate.id === id);
    if (!layer) return false;
    const opacity = Math.max(0, Math.min(1, properties.opacity));
    if (layer.name === trimmed && layer.visible === properties.visible && layer.opacity === opacity && layer.blendMode === properties.blendMode) return false;
    const next = layersRef.current.map((candidate) => candidate.id === id ? {
      ...candidate,
      name: trimmed,
      visible: properties.visible,
      opacity,
      blendMode: properties.blendMode,
    } : candidate);
    setLayerList(next);
    pushHistory('Layer Properties', next);
    return true;
  }, [pushHistory, setLayerList]);

  const selectAll = useCallback(() => {
    commitPendingEditsRef.current();
    updateSelection({
      tool: 'rectangle-select',
      start: { x: 0, y: 0 },
      end: { x: dimensionsRef.current.width, y: dimensionsRef.current.height },
    });
    pushHistoryRef.current('Select All');
  }, []);

  const deselect = useCallback(() => {
    commitPendingEditsRef.current();
    if (!selectionRef.current) return;
    updateSelection(null);
    pushHistoryRef.current('Deselect');
  }, []);

  const copySelection = useCallback(() => {
    const layer = activeLayer();
    if (!layer) return false;
    const target = selection ?? {
      tool: 'rectangle-select' as const,
      start: { x: 0, y: 0 },
      end: { x: dimensionsRef.current.width, y: dimensionsRef.current.height },
    };
    const bounds = normalizeSelection(target, dimensionsRef.current.width, dimensionsRef.current.height);
    if (bounds.width < 1 || bounds.height < 1) return false;
    clipboardRef.current = copySelectionToCanvas(layer.canvas, bounds);
    setClipboardSize({ width: bounds.width, height: bounds.height });
    setHasClipboard(true);
    return true;
  }, [activeLayer, selection]);

  const copyMerged = useCallback(() => {
    commitPendingEditsRef.current();
    const composite = makeCanvas(dimensionsRef.current.width, dimensionsRef.current.height);
    const context = composite.getContext('2d')!;
    for (const layer of layersRef.current) paintLayer(context, layer);
    const target = selection ?? {
      tool: 'rectangle-select' as const,
      start: { x: 0, y: 0 },
      end: { x: dimensionsRef.current.width, y: dimensionsRef.current.height },
    };
    const bounds = normalizeSelection(target, dimensionsRef.current.width, dimensionsRef.current.height);
    if (bounds.width < 1 || bounds.height < 1) return false;
    clipboardRef.current = copySelectionToCanvas(composite, bounds);
    setClipboardSize({ width: bounds.width, height: bounds.height });
    setHasClipboard(true);
    return true;
  }, [selection]);

  const eraseCurrentSelection = useCallback((historyLabel: string) => {
    const layer = activeLayer();
    if (!layer) return false;
    const context = layer.canvas.getContext('2d')!;
    context.save();
    context.globalCompositeOperation = 'destination-out';
    if (selection) {
      const bounds = normalizeSelection(selection, dimensionsRef.current.width, dimensionsRef.current.height);
      context.drawImage(createSelectionMask(bounds), bounds.x, bounds.y);
    } else {
      context.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
    }
    context.restore();
    pushHistory(historyLabel);
    return true;
  }, [activeLayer, pushHistory, selection]);

  const cutSelection = useCallback(() => {
    commitPendingEditsRef.current();
    if (!copySelection()) return false;
    return eraseCurrentSelection('Cut');
  }, [copySelection, eraseCurrentSelection]);

  const paste = useCallback((expandCanvas = false) => {
    commitPendingEditsRef.current();
    const clipboard = clipboardRef.current;
    let layer = activeLayer();
    if (!clipboard || !layer) return false;
    if (expandCanvas && (clipboard.width > dimensionsRef.current.width || clipboard.height > dimensionsRef.current.height)) {
      const nextWidth = Math.max(dimensionsRef.current.width, clipboard.width);
      const nextHeight = Math.max(dimensionsRef.current.height, clipboard.height);
      const next = layersRef.current.map((candidate) => {
        const canvas = makeCanvas(nextWidth, nextHeight);
        canvas.getContext('2d')!.drawImage(candidate.canvas, 0, 0);
        return { ...candidate, canvas };
      });
      setDimensions(nextWidth, nextHeight);
      setLayerList(next);
      layer = next.find((candidate) => candidate.id === layer!.id)!;
    }
    const bounds = selection ? normalizeSelection(selection, dimensionsRef.current.width, dimensionsRef.current.height) : null;
    const x = expandCanvas ? 0 : bounds?.x ?? Math.round((dimensionsRef.current.width - clipboard.width) / 2);
    const y = expandCanvas ? 0 : bounds?.y ?? Math.round((dimensionsRef.current.height - clipboard.height) / 2);
    layer.canvas.getContext('2d')!.drawImage(clipboard, x, y);
    updateSelection({
      tool: 'rectangle-select',
      start: { x, y },
      end: { x: x + clipboard.width, y: y + clipboard.height },
    });
    pushHistory('Paste');
    return true;
  }, [activeLayer, pushHistory, selection, setDimensions, setLayerList]);

  const pasteIntoNewLayer = useCallback((expandCanvas = false) => {
    commitPendingEditsRef.current();
    const clipboard = clipboardRef.current;
    if (!clipboard) return false;
    const nextWidth = expandCanvas ? Math.max(dimensionsRef.current.width, clipboard.width) : dimensionsRef.current.width;
    const nextHeight = expandCanvas ? Math.max(dimensionsRef.current.height, clipboard.height) : dimensionsRef.current.height;
    const layer = makeLayer(nextWidth, nextHeight, 'Pasted Layer');
    const bounds = selection ? normalizeSelection(selection, dimensionsRef.current.width, dimensionsRef.current.height) : null;
    const x = expandCanvas ? 0 : bounds?.x ?? Math.round((dimensionsRef.current.width - clipboard.width) / 2);
    const y = expandCanvas ? 0 : bounds?.y ?? Math.round((dimensionsRef.current.height - clipboard.height) / 2);
    layer.canvas.getContext('2d')!.drawImage(clipboard, x, y);
    const activeIndex = layersRef.current.findIndex((candidate) => candidate.id === activeLayerIdRef.current);
    const next = expandCanvas && (nextWidth !== dimensionsRef.current.width || nextHeight !== dimensionsRef.current.height)
      ? layersRef.current.map((candidate) => {
        const canvas = makeCanvas(nextWidth, nextHeight);
        canvas.getContext('2d')!.drawImage(candidate.canvas, 0, 0);
        return { ...candidate, canvas };
      })
      : [...layersRef.current];
    next.splice(Math.max(0, activeIndex + 1), 0, layer);
    if (expandCanvas) setDimensions(nextWidth, nextHeight);
    setLayerList(next);
    setActiveLayerId(layer.id);
    activeLayerIdRef.current = layer.id;
    updateSelection({
      tool: 'rectangle-select',
      start: { x, y },
      end: { x: x + clipboard.width, y: y + clipboard.height },
    });
    pushHistory('Paste Into New Layer', next);
    return true;
  }, [pushHistory, selection, setActiveLayerId, setDimensions, setLayerList]);

  const pasteIntoNewImage = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard) return false;
    return newDocumentFromCanvas(clipboard, 'Pasted Image');
  }, [newDocumentFromCanvas]);

  const fillSelection = useCallback(() => {
    commitPendingEditsRef.current();
    const layer = activeLayer();
    if (!layer || !selection) return false;
    const bounds = normalizeSelection(selection, dimensionsRef.current.width, dimensionsRef.current.height);
    if (bounds.width < 1 || bounds.height < 1) return false;
    const fill = makeCanvas(bounds.width, bounds.height);
    const fillContext = fill.getContext('2d')!;
    fillContext.fillStyle = primary;
    fillContext.fillRect(0, 0, fill.width, fill.height);
    fillContext.globalCompositeOperation = 'destination-in';
    fillContext.drawImage(createSelectionMask(bounds), 0, 0);
    layer.canvas.getContext('2d')!.drawImage(fill, bounds.x, bounds.y);
    pushHistory('Fill Selection');
    return true;
  }, [activeLayer, primary, pushHistory, selection]);

  const invertSelection = useCallback(() => {
    commitPendingEditsRef.current();
    if (!selection) return false;
    const width = dimensionsRef.current.width;
    const height = dimensionsRef.current.height;
    const inverted = makeCanvas(width, height);
    const context = inverted.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'destination-out';
    context.drawImage(selectionMaskOnCanvas(selection, width, height), 0, 0);
    updateSelection(selectionFromMask(inverted));
    pushHistory('Invert Selection');
    return true;
  }, [pushHistory, selection]);

  const offsetSelection = useCallback((offset: number) => {
    commitPendingEditsRef.current();
    if (!selection) return false;
    const safeOffset = Math.max(-100, Math.min(100, Math.round(offset)));
    if (safeOffset === 0) return false;
    updateSelection(offsetSelectionMask(selection, dimensionsRef.current.width, dimensionsRef.current.height, safeOffset));
    pushHistory('Offset Selection');
    return true;
  }, [pushHistory, selection]);

  const cropToSelection = useCallback(() => {
    commitPendingEditsRef.current();
    if (!selection) return false;
    const bounds = normalizeSelection(selection, dimensionsRef.current.width, dimensionsRef.current.height);
    if (bounds.width < 1 || bounds.height < 1) return false;
    const next = layersRef.current.map((layer) => {
      const canvas = copySelectionToCanvas(layer.canvas, bounds);
      return { ...layer, canvas };
    });
    setDimensions(bounds.width, bounds.height);
    setLayerList(next);
    updateSelection(null);
    pushHistory('Crop to Selection', next);
    return true;
  }, [pushHistory, selection, setDimensions, setLayerList]);

  const autoCropImage = useCallback(() => {
    commitPendingEditsRef.current();
    const currentWidth = dimensionsRef.current.width;
    const currentHeight = dimensionsRef.current.height;
    const composite = makeCanvas(currentWidth, currentHeight);
    const context = composite.getContext('2d')!;
    for (const layer of layersRef.current) paintLayer(context, layer);
    const pixels = context.getImageData(0, 0, currentWidth, currentHeight).data;
    let left = currentWidth;
    let top = currentHeight;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < currentHeight; y += 1) {
      for (let x = 0; x < currentWidth; x += 1) {
        if (pixels[(y * currentWidth + x) * 4 + 3] === 0) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) return false;
    const nextWidth = right - left + 1;
    const nextHeight = bottom - top + 1;
    if (left === 0 && top === 0 && nextWidth === currentWidth && nextHeight === currentHeight) return false;
    const next = layersRef.current.map((layer) => {
      const canvas = makeCanvas(nextWidth, nextHeight);
      canvas.getContext('2d')!.drawImage(layer.canvas, -left, -top);
      return { ...layer, canvas };
    });
    setDimensions(nextWidth, nextHeight);
    setLayerList(next);
    updateSelection(null);
    pushHistory('Auto Crop', next);
    return true;
  }, [pushHistory, setDimensions, setLayerList]);

  const resizeImage = useCallback((newWidth: number, newHeight: number, resampling = 'bilinear') => {
    commitPendingEditsRef.current();
    const safeWidth = Math.max(1, Math.min(16384, Math.round(newWidth)));
    const safeHeight = Math.max(1, Math.min(16384, Math.round(newHeight)));
    if (safeWidth === dimensionsRef.current.width && safeHeight === dimensionsRef.current.height) return;
    const next = layersRef.current.map((layer) => {
      const canvas = makeCanvas(safeWidth, safeHeight);
      const context = canvas.getContext('2d')!;
      context.imageSmoothingEnabled = resampling !== 'nearest';
      context.imageSmoothingQuality = resampling === 'bicubic' ? 'high' : 'medium';
      context.drawImage(layer.canvas, 0, 0, safeWidth, safeHeight);
      return { ...layer, canvas };
    });
    setDimensions(safeWidth, safeHeight);
    setLayerList(next);
    updateSelection(null);
    pushHistory('Resize Image', next);
  }, [pushHistory, setDimensions, setLayerList]);

  const resizeCanvas = useCallback((newWidth: number, newHeight: number, anchor: CanvasAnchor = 'center') => {
    commitPendingEditsRef.current();
    const safeWidth = Math.max(1, Math.min(16384, Math.round(newWidth)));
    const safeHeight = Math.max(1, Math.min(16384, Math.round(newHeight)));
    if (safeWidth === dimensionsRef.current.width && safeHeight === dimensionsRef.current.height) return;
    const horizontal = anchor.endsWith('west') ? 'start' : anchor.endsWith('east') ? 'end' : 'center';
    const vertical = anchor.startsWith('north') ? 'start' : anchor.startsWith('south') ? 'end' : 'center';
    const offsetX = getAnchorOffset(dimensionsRef.current.width, safeWidth, horizontal);
    const offsetY = getAnchorOffset(dimensionsRef.current.height, safeHeight, vertical);
    const next = layersRef.current.map((layer) => {
      const canvas = makeCanvas(safeWidth, safeHeight);
      canvas.getContext('2d')!.drawImage(layer.canvas, offsetX, offsetY);
      return { ...layer, canvas };
    });
    setDimensions(safeWidth, safeHeight);
    setLayerList(next);
    updateSelection(null);
    pushHistory('Resize Canvas', next);
  }, [pushHistory, setDimensions, setLayerList]);

  const flipImage = useCallback((direction: 'horizontal' | 'vertical') => {
    commitPendingEditsRef.current();
    const currentWidth = dimensionsRef.current.width;
    const currentHeight = dimensionsRef.current.height;
    const next = layersRef.current.map((layer) => {
      const canvas = makeCanvas(currentWidth, currentHeight);
      const context = canvas.getContext('2d')!;
      context.translate(direction === 'horizontal' ? currentWidth : 0, direction === 'vertical' ? currentHeight : 0);
      context.scale(direction === 'horizontal' ? -1 : 1, direction === 'vertical' ? -1 : 1);
      context.drawImage(layer.canvas, 0, 0);
      return { ...layer, canvas };
    });
    setLayerList(next);
    updateSelection(null);
    pushHistory(direction === 'horizontal' ? 'Flip Horizontal' : 'Flip Vertical', next);
  }, [pushHistory, setLayerList]);

  const rotateImage = useCallback((rotation: 'clockwise' | 'counter-clockwise' | '180') => {
    commitPendingEditsRef.current();
    const oldWidth = dimensionsRef.current.width;
    const oldHeight = dimensionsRef.current.height;
    const quarterTurn = rotation !== '180';
    const nextWidth = quarterTurn ? oldHeight : oldWidth;
    const nextHeight = quarterTurn ? oldWidth : oldHeight;
    const next = layersRef.current.map((layer) => {
      const canvas = makeCanvas(nextWidth, nextHeight);
      const context = canvas.getContext('2d')!;
      if (rotation === 'clockwise') {
        context.translate(nextWidth, 0);
        context.rotate(Math.PI / 2);
      } else if (rotation === 'counter-clockwise') {
        context.translate(0, nextHeight);
        context.rotate(-Math.PI / 2);
      } else {
        context.translate(nextWidth, nextHeight);
        context.rotate(Math.PI);
      }
      context.drawImage(layer.canvas, 0, 0);
      return { ...layer, canvas };
    });
    setDimensions(nextWidth, nextHeight);
    setLayerList(next);
    updateSelection(null);
    pushHistory(rotation === 'clockwise' ? 'Rotate 90° Clockwise' : rotation === 'counter-clockwise' ? 'Rotate 90° Counter-Clockwise' : 'Rotate 180°', next);
  }, [pushHistory, setDimensions, setLayerList]);

  const clearActiveLayer = useCallback(() => {
    commitPendingEditsRef.current();
    eraseCurrentSelection('Erase Selection');
  }, [eraseCurrentSelection]);

  const effectParametersFor = useCallback((parameters: EffectParameters, activeSelection: Selection | null, sourceWidth: number, sourceHeight: number) => {
    const primaryRgba = colorToRgba(primary);
    const secondaryRgba = colorToRgba(secondary);
    const enriched: EffectParameters = {
      ...parameters,
      __primaryR: primaryRgba.r,
      __primaryG: primaryRgba.g,
      __primaryB: primaryRgba.b,
      __secondaryR: secondaryRgba.r,
      __secondaryG: secondaryRgba.g,
      __secondaryB: secondaryRgba.b,
      __paletteCount: palette.length,
    };
    palette.forEach((color, index) => {
      const rgba = colorToRgba(color);
      enriched[`__palette${index}R`] = rgba.r;
      enriched[`__palette${index}G`] = rgba.g;
      enriched[`__palette${index}B`] = rgba.b;
    });
    if (activeSelection) {
      const effectBounds = normalizeSelection(activeSelection, sourceWidth, sourceHeight);
      enriched.__selectionX = effectBounds.x;
      enriched.__selectionY = effectBounds.y;
      enriched.__selectionWidth = effectBounds.width;
      enriched.__selectionHeight = effectBounds.height;
    }
    return enriched;
  }, [palette, primary, secondary]);

  const clearEffectPreview = useCallback(() => {
    effectPreviewTokenRef.current += 1;
    const preview = previewCanvasRef.current;
    if (preview) preview.getContext('2d')!.clearRect(0, 0, preview.width, preview.height);
  }, []);

  const previewEffect = useCallback(async (effect: EffectId, parameters: EffectParameters = {}) => {
    const token = ++effectPreviewTokenRef.current;
    commitPendingEditsRef.current();
    const layer = activeLayer();
    const preview = previewCanvasRef.current;
    if (!layer || !preview) return false;
    const sourceWidth = layer.canvas.width;
    const sourceHeight = layer.canvas.height;
    const source = layer.canvas.getContext('2d')!.getImageData(0, 0, sourceWidth, sourceHeight);
    const activeSelection = selectionRef.current;
    const processed = await runImageEffect(source, effect, effectParametersFor(parameters, activeSelection, sourceWidth, sourceHeight));
    if (token !== effectPreviewTokenRef.current || activeLayerIdRef.current !== layer.id) return false;

    const processedCanvas = makeCanvas(sourceWidth, sourceHeight);
    processedCanvas.getContext('2d')!.putImageData(processed, 0, 0);
    const previewLayerCanvas = makeCanvas(sourceWidth, sourceHeight);
    const previewLayerContext = previewLayerCanvas.getContext('2d')!;
    previewLayerContext.drawImage(layer.canvas, 0, 0);
    if (activeSelection) {
      const fullMask = selectionMaskOnCanvas(activeSelection, sourceWidth, sourceHeight);
      previewLayerContext.save();
      previewLayerContext.globalCompositeOperation = 'destination-out';
      previewLayerContext.drawImage(fullMask, 0, 0);
      previewLayerContext.restore();
      processedCanvas.getContext('2d')!.globalCompositeOperation = 'destination-in';
      processedCanvas.getContext('2d')!.drawImage(fullMask, 0, 0);
    } else {
      previewLayerContext.clearRect(0, 0, sourceWidth, sourceHeight);
    }
    previewLayerContext.drawImage(processedCanvas, 0, 0);

    if (preview.width !== sourceWidth) preview.width = sourceWidth;
    if (preview.height !== sourceHeight) preview.height = sourceHeight;
    const previewContext = preview.getContext('2d')!;
    previewContext.clearRect(0, 0, sourceWidth, sourceHeight);
    for (const candidate of layersRef.current) {
      paintLayer(previewContext, candidate.id === layer.id ? { ...candidate, canvas: previewLayerCanvas } : candidate);
    }
    return true;
  }, [activeLayer, effectParametersFor]);

  const applyEffect = useCallback(async (effect: EffectId, parameters: EffectParameters = {}) => {
    if (effectBusyRef.current) return false;
    clearEffectPreview();
    commitPendingEditsRef.current();
    const layer = activeLayer();
    if (!layer) return false;
    const context = layer.canvas.getContext('2d')!;
    const sourceWidth = layer.canvas.width;
    const sourceHeight = layer.canvas.height;
    const sourceHistoryIndex = historyIndexRef.current;
    const source = context.getImageData(0, 0, sourceWidth, sourceHeight);
    const activeSelection = selectionRef.current;
    const effectParameters = effectParametersFor(parameters, activeSelection, sourceWidth, sourceHeight);
    effectBusyRef.current = true;
    setEffectBusy(true);
    try {
      const processed = await runImageEffect(source, effect, effectParameters);
      const currentLayer = layersRef.current.find((candidate) => candidate.id === layer.id);
      const documentUnchanged = currentLayer === layer &&
        historyIndexRef.current === sourceHistoryIndex &&
        layer.canvas.width === sourceWidth && layer.canvas.height === sourceHeight;
      if (!documentUnchanged) return false;

      if (activeSelection) {
        const processedCanvas = makeCanvas(sourceWidth, sourceHeight);
        const processedContext = processedCanvas.getContext('2d')!;
        processedContext.putImageData(processed, 0, 0);
        const fullMask = selectionMaskOnCanvas(activeSelection, sourceWidth, sourceHeight);
        processedContext.globalCompositeOperation = 'destination-in';
        processedContext.drawImage(fullMask, 0, 0);
        processedContext.globalCompositeOperation = 'source-over';
        context.save();
        context.globalCompositeOperation = 'destination-out';
        context.drawImage(fullMask, 0, 0);
        context.restore();
        context.drawImage(processedCanvas, 0, 0);
      } else {
        context.putImageData(processed, 0, 0);
      }
      pushHistory(EFFECT_BY_ID[effect].name);
      return true;
    } finally {
      effectBusyRef.current = false;
      setEffectBusy(false);
    }
  }, [activeLayer, clearEffectPreview, effectParametersFor, pushHistory]);

  const setZoom = useCallback((value: number) => {
    setZoomState(Math.min(4, Math.max(0.1, value)));
  }, []);

  const clearPreview = useCallback(() => {
    const preview = previewCanvasRef.current;
    if (preview) preview.getContext('2d')!.clearRect(0, 0, preview.width, preview.height);
  }, []);

  const eventPoint = useCallback((event: ReactPointerEvent<HTMLElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(width, (event.clientX - bounds.left) * (width / bounds.width))),
      y: Math.max(0, Math.min(height, (event.clientY - bounds.top) * (height / bounds.height))),
    };
  }, [height, width]);

  const determineSelectionMode = useCallback((event: ReactPointerEvent<HTMLElement>): SelectionMode => {
    if (event.button === 2) return event.ctrlKey || event.metaKey ? 'xor' : 'exclude';
    if (event.ctrlKey || event.metaKey) return 'union';
    if (event.altKey) return 'intersect';
    return selectionMode;
  }, [selectionMode]);

  const updateSelectionGesture = useCallback((point: Point, constrain = false) => {
    const gesture = selectionGestureRef.current;
    if (!gesture) return;
    let nextSelection: Selection;
    if (tool === 'lasso-select') {
      const lastPoint = lassoPointsRef.current.at(-1);
      if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= 1.5) lassoPointsRef.current.push(point);
      const points = lassoPointsRef.current;
      const xs = points.map((item) => item.x);
      const ys = points.map((item) => item.y);
      nextSelection = {
        tool,
        start: { x: Math.min(...xs), y: Math.min(...ys) },
        end: { x: Math.max(...xs), y: Math.max(...ys) },
        points: [...points],
      };
    } else {
      const end = constrain && (tool === 'rectangle-select' || tool === 'ellipse-select')
        ? constrainSelectionPoint(startRef.current, point, dimensionsRef.current.width, dimensionsRef.current.height)
        : point;
      nextSelection = { tool, start: startRef.current, end };
    }
    updateSelection(combineSelectionMasks(
      gesture.previous,
      nextSelection,
      gesture.mode,
      dimensionsRef.current.width,
      dimensionsRef.current.height,
    ));
  }, [tool]);

  const finishPolygonLasso = useCallback(() => {
    const gesture = selectionGestureRef.current;
    if (tool !== 'lasso-select' || lassoMode !== 'polygon' || !gesture) return false;
    if (lassoPointsRef.current.length < 3) {
      updateSelection(gesture.previous);
      selectionGestureRef.current = null;
      lassoPointsRef.current = [];
      return false;
    }
    selectionGestureRef.current = null;
    lassoPointsRef.current = [];
    pushHistory('Select');
    return true;
  }, [lassoMode, pushHistory, tool, updateSelection]);

  const removePolygonLassoPoint = useCallback(() => {
    const gesture = selectionGestureRef.current;
    if (tool !== 'lasso-select' || lassoMode !== 'polygon' || !gesture || !lassoPointsRef.current.length) return false;
    lassoPointsRef.current.pop();
    const lastPoint = lassoPointsRef.current.at(-1);
    if (!lastPoint) {
      updateSelection(gesture.previous);
      selectionGestureRef.current = null;
      return true;
    }
    updateSelectionGesture(lastPoint);
    return true;
  }, [lassoMode, tool, updateSelection, updateSelectionGesture]);

  const cancelPolygonLasso = useCallback(() => {
    const gesture = selectionGestureRef.current;
    if (tool !== 'lasso-select' || lassoMode !== 'polygon' || !gesture) return false;
    updateSelection(gesture.previous);
    selectionGestureRef.current = null;
    lassoPointsRef.current = [];
    return true;
  }, [lassoMode, tool, updateSelection]);

  const drawStroke = useCallback((from: Point, to: Point) => {
    const layer = activeLayer();
    if (!layer) return;
    const context = layer.canvas.getContext('2d')!;

    if (tool === 'clone-stamp') {
      const clone = cloneStrokeRef.current;
      if (!clone) return;
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const steps = Math.max(1, Math.ceil(distance / Math.max(1, brushSize / 4)));
      for (let step = 0; step <= steps; step += 1) {
        const amount = step / steps;
        const x = from.x + (to.x - from.x) * amount;
        const y = from.y + (to.y - from.y) * amount;
        context.save();
        context.beginPath();
        context.arc(x, y, Math.max(0.5, brushSize / 2), 0, Math.PI * 2);
        context.clip();
        context.drawImage(clone.snapshot, clone.offsetX, clone.offsetY);
        context.restore();
      }
      renderComposite();
      return;
    }

    if (tool === 'recolor') {
      const image = recolorImageRef.current;
      if (!image) return;
      const target = colorToRgba(recolorReverseRef.current ? primary : secondary);
      const replacement = colorToRgba(recolorReverseRef.current ? secondary : primary);
      const threshold = recolorTolerance * 2.55;
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const steps = Math.max(1, Math.ceil(distance / Math.max(1, brushSize / 3)));
      for (let step = 0; step <= steps; step += 1) {
        const amount = step / steps;
        const centerX = Math.round(from.x + (to.x - from.x) * amount);
        const centerY = Math.round(from.y + (to.y - from.y) * amount);
        const radius = Math.max(1, brushSize / 2);
        const minX = Math.max(0, Math.floor(centerX - radius));
        const maxX = Math.min(image.width - 1, Math.ceil(centerX + radius));
        const minY = Math.max(0, Math.floor(centerY - radius));
        const maxY = Math.min(image.height - 1, Math.ceil(centerY + radius));
        for (let y = minY; y <= maxY; y += 1) {
          for (let x = minX; x <= maxX; x += 1) {
            if ((x - centerX) ** 2 + (y - centerY) ** 2 > radius ** 2) continue;
            const index = (y * image.width + x) * 4;
            if (Math.abs(image.data[index] - target.r) > threshold ||
              Math.abs(image.data[index + 1] - target.g) > threshold ||
              Math.abs(image.data[index + 2] - target.b) > threshold) continue;
            image.data[index] = clampByte(replacement.r + image.data[index] - target.r);
            image.data[index + 1] = clampByte(replacement.g + image.data[index + 1] - target.g);
            image.data[index + 2] = clampByte(replacement.b + image.data[index + 2] - target.b);
          }
        }
      }
      context.putImageData(image, 0, 0);
      renderComposite();
      return;
    }

    context.save();
    configureStroke(context, tool, primary, brushSize, eraserType, alphaBlendingMode);
    if (tool === 'paintbrush') drawPaintBrushSegment(context, paintBrushType, from, to, primary, brushSize, slashBrushAngle, splatterMinimumSize, splatterMaximumSize);
    else if (tool === 'block-brush') {
      const halfWidth = Math.max(0.5, brushSize);
      const endY = Math.abs(to.y - from.y) < 0.001 ? to.y + 1 : to.y;
      context.beginPath();
      context.moveTo(from.x - halfWidth, from.y);
      context.lineTo(from.x + halfWidth, from.y);
      context.lineTo(to.x + halfWidth, endY);
      context.lineTo(to.x - halfWidth, endY);
      context.closePath();
      context.fill();
    }
    else {
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
    context.restore();
    renderComposite();
  }, [activeLayer, alphaBlendingMode, brushSize, eraserType, paintBrushType, primary, recolorTolerance, renderComposite, secondary, slashBrushAngle, splatterMaximumSize, splatterMinimumSize, tool]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const point = eventPoint(event);
    setPointer(point);
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = point;
    lastRef.current = point;

    if (event.button === 0 && (tool === 'rectangle-select' || tool === 'ellipse-select')) {
      const resizeHandle = selectionResizeHandleAtPoint(
        selection,
        tool,
        point,
        dimensionsRef.current.width,
        dimensionsRef.current.height,
        zoom,
      );
      if (resizeHandle && selection) {
        const bounds = normalizeSelection(selection, dimensionsRef.current.width, dimensionsRef.current.height);
        selectionResizeRef.current = {
          original: {
            tool,
            start: { x: bounds.x, y: bounds.y },
            end: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
          },
          handle: resizeHandle,
          start: point,
        };
        selectionGestureRef.current = null;
        drawingRef.current = true;
        return;
      }
    }

    if (tool === 'lasso-select' && lassoMode === 'polygon') {
      if (!selectionGestureRef.current) {
        selectionGestureRef.current = { previous: selection, mode: determineSelectionMode(event) };
        lassoPointsRef.current = [point];
      } else {
        const previousPoint = lassoPointsRef.current.at(-1);
        if (!previousPoint || Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) >= 1.5) {
          lassoPointsRef.current.push(point);
        }
      }
      updateSelectionGesture(point);
      return;
    }

    if (tool === 'move-selection' && selection) {
      drawingRef.current = true;
      moveSelectionRef.current = selection;
      return;
    }

    if (tool === 'move-pixels' && selection) {
      const layer = activeLayer();
      if (!layer) return;
      const bounds = normalizeSelection(selection, dimensionsRef.current.width, dimensionsRef.current.height);
      if (bounds.width < 1 || bounds.height < 1) return;
      const pixels = copySelectionToCanvas(layer.canvas, bounds);
      const context = layer.canvas.getContext('2d')!;
      context.save();
      context.globalCompositeOperation = 'destination-out';
      context.drawImage(createSelectionMask(bounds), bounds.x, bounds.y);
      context.restore();
      moveSelectionRef.current = selection;
      movePixelsRef.current = { canvas: pixels, startX: bounds.x, startY: bounds.y, x: bounds.x, y: bounds.y };
      setMovingPixels({ canvas: pixels, x: bounds.x, y: bounds.y });
      drawingRef.current = true;
      renderComposite();
      return;
    }

    if (tool === 'magic-wand') {
      const layer = activeLayer();
      if (layer) {
        const nextSelection = magicWandSelection(
          layer.canvas,
          point.x,
          point.y,
          Math.round(magicWandTolerance * 2.55),
          floodMode === 'global' || event.shiftKey,
        );
        updateSelection(combineSelectionMasks(
          selection,
          nextSelection,
          determineSelectionMode(event),
          dimensionsRef.current.width,
          dimensionsRef.current.height,
        ));
        pushHistory('Magic Wand Selection');
      }
      return;
    }

    if (tool === 'clone-stamp') {
      if (event.ctrlKey || event.metaKey) {
        cloneSourceRef.current = point;
        cloneOffsetRef.current = null;
        setCloneSource(point);
        return;
      }
      const source = cloneSourceRef.current;
      const layer = activeLayer();
      if (!source || !layer) return;
      const snapshot = makeCanvas(layer.canvas.width, layer.canvas.height);
      snapshot.getContext('2d')!.drawImage(layer.canvas, 0, 0);
      const offset = cloneOffsetRef.current ?? { x: point.x - source.x, y: point.y - source.y };
      cloneOffsetRef.current = offset;
      cloneStrokeRef.current = {
        snapshot,
        offsetX: offset.x,
        offsetY: offset.y,
      };
      drawingRef.current = true;
      drawStroke(point, { x: point.x + 0.01, y: point.y + 0.01 });
      return;
    }

    if (tool === 'recolor') {
      const layer = activeLayer();
      if (!layer) return;
      recolorImageRef.current = layer.canvas.getContext('2d')!.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
      recolorReverseRef.current = event.button === 2;
      drawingRef.current = true;
      drawStroke(point, { x: point.x + 0.01, y: point.y + 0.01 });
      return;
    }

    if (tool === 'zoom') {
      setZoom(zoom * (event.altKey ? 0.8 : 1.25));
      return;
    }

    if (tool === 'color-picker') {
      const layer = activeLayer();
      if (colorPickerSampleType === 'image') renderComposite();
      const source = colorPickerSampleType === 'layer' ? layer?.canvas : displayCanvasRef.current;
      if (source) {
        const color = sampleCanvasColor(source, point, colorPickerSampleSize);
        if (event.button === 2) setSecondary(color);
        else setPrimary(color);
      }
      if (colorPickerAfterSelect === 'previous') setTool(previousToolRef.current);
      if (colorPickerAfterSelect === 'pencil') setTool('pencil');
      return;
    }

    if (tool === 'paint-bucket') {
      const layer = activeLayer();
      if (layer) {
        floodFill(
          layer.canvas,
          point.x,
          point.y,
          event.button === 2 ? secondary : primary,
          paintBucketTolerance,
          floodMode === 'global' || event.shiftKey,
        );
        pushHistory('Paint Bucket');
      }
      return;
    }

    if (tool === 'text') {
      beginText(point);
      return;
    }

    if (tool === 'line') {
      const current = lineDraftRef.current;
      const hitRadius = Math.max(4, 9 / zoom);
      if (current && event.button === 0 && (event.ctrlKey || event.metaKey)) {
        const origin = current.points[current.selectedPoint] ?? current.points.at(-1)!;
        archiveCurrentLine();
        const next: EditableLineState = {
          id: makeId(),
          points: [origin, point],
          tensions: [0, 0],
          selectedPoint: 1,
          reverseColors: false,
          options: currentShapeOptions(),
        };
        shapeDraftOrderRef.current.push(next.id);
        updateLineDraft(next);
        lineDragPointRef.current = 1;
        drawingRef.current = true;
        return;
      }
      if (current) {
        const handleIndex = current.points.findIndex((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= hitRadius);
        if (handleIndex >= 0) {
          updateLineDraft({ ...current, selectedPoint: handleIndex });
          if (event.button === 0) {
            lineDragPointRef.current = handleIndex;
            lineTensionDragRef.current = null;
          } else {
            lineDragPointRef.current = null;
            lineTensionDragRef.current = { index: handleIndex, last: point };
          }
          drawingRef.current = true;
          return;
        }
        if (event.button !== 0) return;
        let segmentIndex = -1;
        let segmentDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < current.points.length - 1; index += 1) {
          const distance = distanceToSegment(point, current.points[index], current.points[index + 1]);
          if (distance < segmentDistance) {
            segmentDistance = distance;
            segmentIndex = index;
          }
        }
        if (segmentIndex >= 0 && segmentDistance <= hitRadius) {
          const points = [...current.points];
          const tensions = [...current.tensions];
          points.splice(segmentIndex + 1, 0, point);
          tensions.splice(segmentIndex + 1, 0, 1 / 3);
          updateLineDraft({ ...current, points, tensions, selectedPoint: segmentIndex + 1 });
          lineDragPointRef.current = segmentIndex + 1;
          drawingRef.current = true;
          return;
        }
      }
      if (event.button !== 0) return;
      const archivedHit = [...archivedShapeDraftsRef.current].reverse().find((stored) =>
        stored.kind === 'line' && distanceToLineDraft(point, stored.draft) <= hitRadius);
      if (archivedHit) {
        activateArchivedDraft(archivedHit.draft.id);
        return;
      }
      archiveCurrentLine();
      const next: EditableLineState = {
        id: makeId(),
        points: [point, point],
        tensions: [0, 0],
        selectedPoint: 1,
        reverseColors: false,
        options: currentShapeOptions(),
      };
      shapeDraftOrderRef.current.push(next.id);
      updateLineDraft(next);
      lineDragPointRef.current = 1;
      drawingRef.current = true;
      return;
    }

    if (EDITABLE_BOUNDS_TOOLS.includes(tool as EditableBoundsTool)) {
      const current = shapeDraftRef.current;
      const hitRadius = Math.max(4, 9 / zoom);
      if (current) {
        const handleIndex = current.points.findIndex((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= hitRadius);
        if (handleIndex >= 0) {
          updateShapeDraft({ ...current, selectedPoint: handleIndex });
          shapeDragPointRef.current = handleIndex;
          drawingRef.current = true;
          return;
        }
        if (distanceToShapeDraft(point, current) <= hitRadius) return;
      }
      if (event.button === 0) {
        const archivedHit = [...archivedShapeDraftsRef.current].reverse().find((stored) =>
          stored.kind === 'shape' && stored.draft.tool === tool && distanceToShapeDraft(point, stored.draft) <= hitRadius);
        if (archivedHit) {
          activateArchivedDraft(archivedHit.draft.id);
          return;
        }
      }
      archiveCurrentShape();
      const next: EditableShapeState = {
        id: makeId(),
        tool: tool as EditableBoundsTool,
        points: rectangularControlPoints(point, point),
        selectedPoint: 2,
        reverseColors: event.button === 2,
        options: currentShapeOptions(event.button === 2),
      };
      shapeDraftOrderRef.current.push(next.id);
      updateShapeDraft(next);
      shapeDragPointRef.current = 2;
      drawingRef.current = true;
      return;
    }

    if (tool === 'freeform') {
      freeformPointsRef.current = [point];
      shapeReverseRef.current = event.button === 2;
      drawingRef.current = true;
      return;
    }

    if (DRAWING_TOOLS.includes(tool)) {
      drawingRef.current = true;
      drawStroke(point, { x: point.x + 0.01, y: point.y + 0.01 });
      return;
    }

    if (SHAPE_TOOLS.includes(tool) || SELECTION_TOOLS.includes(tool)) {
      drawingRef.current = true;
      if (SHAPE_TOOLS.includes(tool)) shapeReverseRef.current = event.button === 2;
      if (SELECTION_TOOLS.includes(tool)) {
        const mode = determineSelectionMode(event);
        selectionGestureRef.current = { previous: selection, mode };
        if (tool === 'lasso-select') {
          lassoPointsRef.current = [point];
          const nextSelection: Selection = { tool, start: point, end: point, points: [point] };
          updateSelection(combineSelectionMasks(selection, nextSelection, mode, dimensionsRef.current.width, dimensionsRef.current.height));
        } else {
          const nextSelection: Selection = { tool, start: point, end: point };
          updateSelection(combineSelectionMasks(selection, nextSelection, mode, dimensionsRef.current.width, dimensionsRef.current.height));
        }
      }
    }
  }, [activateArchivedDraft, activeLayer, archiveCurrentLine, archiveCurrentShape, beginText, colorPickerAfterSelect, colorPickerSampleSize, colorPickerSampleType, currentShapeOptions, determineSelectionMode, drawStroke, eventPoint, floodMode, lassoMode, magicWandTolerance, paintBucketTolerance, primary, pushHistory, renderComposite, secondary, selection, setTool, setZoom, tool, updateLineDraft, updateSelectionGesture, updateShapeDraft, zoom]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const point = eventPoint(event);
    setPointer(point);
    if (!drawingRef.current) return;

    if (selectionResizeRef.current) {
      const resize = selectionResizeRef.current;
      updateSelection(resizeSelection(
        resize.original,
        resize.handle,
        point,
        dimensionsRef.current.width,
        dimensionsRef.current.height,
        event.shiftKey,
      ));
      return;
    }

    if (tool === 'line' && lineTensionDragRef.current) {
      const drag = lineTensionDragRef.current;
      const draft = lineDraftRef.current;
      const current = draft?.points[drag.index];
      if (!draft || !current) return;
      const previous = draft.points[drag.index - 1] ?? current;
      const next = draft.points[drag.index + 1] ?? current;
      const midpoint = { x: (previous.x + next.x) / 2, y: (previous.y + next.y) / 2 };
      const xDifference = previous.x - next.x;
      const yDifference = previous.y - next.y;
      const totalDifference = xDifference + yDifference;
      const xChange = current.x <= midpoint.x ? point.x - drag.last.x : drag.last.x - point.x;
      const yChange = current.y <= midpoint.y ? point.y - drag.last.y : drag.last.y - point.y;
      const rawChange = Math.abs(totalDifference) < 0.001
        ? (drag.last.y - point.y) / 50
        : Math.round(Math.max(-1, Math.min(1, (xChange * yDifference + yChange * xDifference) / totalDifference))) / 50;
      const tensions = [...draft.tensions];
      tensions[drag.index] = Math.max(0, Math.min(1, (tensions[drag.index] ?? 0) + rawChange));
      lineTensionDragRef.current = { ...drag, last: point };
      updateLineDraft({ ...draft, tensions, selectedPoint: drag.index });
      return;
    }

    if (tool === 'line' && lineDragPointRef.current !== null) {
      const draft = lineDraftRef.current;
      const index = lineDragPointRef.current;
      if (!draft || !draft.points[index]) return;
      const anchor = index > 0 ? draft.points[index - 1] : draft.points[1];
      const nextPoint = event.shiftKey && anchor ? constrainLinePoint(anchor, point) : point;
      const points = [...draft.points];
      points[index] = nextPoint;
      updateLineDraft({ ...draft, points, selectedPoint: index });
      return;
    }

    if (EDITABLE_BOUNDS_TOOLS.includes(tool as EditableBoundsTool) && shapeDragPointRef.current !== null) {
      const draft = shapeDraftRef.current;
      const index = shapeDragPointRef.current;
      if (!draft || !draft.points[index]) return;
      const opposite = draft.points[(index + 2) % 4];
      const nextPoint = event.shiftKey ? constrainShapePoint(opposite, point) : point;
      updateShapeDraft(moveRectangularControlPoint(draft, index, nextPoint));
      return;
    }

    if (tool === 'freeform') {
      const lastPoint = freeformPointsRef.current.at(-1);
      if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= 1.5) freeformPointsRef.current.push(point);
      const preview = previewCanvasRef.current;
      if (!preview) return;
      const context = preview.getContext('2d')!;
      context.clearRect(0, 0, preview.width, preview.height);
      drawFreeformShape(context, freeformPointsRef.current, currentShapeOptions(shapeReverseRef.current));
      return;
    }

    if ((tool === 'move-selection' || tool === 'move-pixels') && moveSelectionRef.current) {
      const original = moveSelectionRef.current;
      const originalBounds = normalizeSelection(original, dimensionsRef.current.width, dimensionsRef.current.height);
      let dx = point.x - startRef.current.x;
      let dy = point.y - startRef.current.y;
      dx = Math.max(-originalBounds.x, Math.min(dimensionsRef.current.width - originalBounds.x - originalBounds.width, dx));
      dy = Math.max(-originalBounds.y, Math.min(dimensionsRef.current.height - originalBounds.y - originalBounds.height, dy));
      updateSelection({
        ...original,
        start: { x: original.start.x + dx, y: original.start.y + dy },
        end: { x: original.end.x + dx, y: original.end.y + dy },
        points: original.points?.map((item) => ({ x: item.x + dx, y: item.y + dy })),
      });
      if (tool === 'move-pixels' && movePixelsRef.current) {
        movePixelsRef.current.x = Math.round(movePixelsRef.current.startX + dx);
        movePixelsRef.current.y = Math.round(movePixelsRef.current.startY + dy);
        setMovingPixels({ canvas: movePixelsRef.current.canvas, x: movePixelsRef.current.x, y: movePixelsRef.current.y });
      }
      return;
    }

    if (DRAWING_TOOLS.includes(tool)) {
      drawStroke(lastRef.current, point);
      lastRef.current = point;
      return;
    }

    if (SELECTION_TOOLS.includes(tool)) {
      if (tool !== 'magic-wand') updateSelectionGesture(point, event.shiftKey);
      return;
    }

    if (SHAPE_TOOLS.includes(tool)) {
      const preview = previewCanvasRef.current;
      if (!preview) return;
      const context = preview.getContext('2d')!;
      context.clearRect(0, 0, preview.width, preview.height);
      const previewPoint = event.shiftKey && tool !== 'gradient'
        ? constrainShapePoint(startRef.current, point)
        : point;
      drawShape(context, tool, startRef.current, previewPoint, currentShapeOptions(shapeReverseRef.current));
    }
  }, [currentShapeOptions, drawStroke, eventPoint, tool, updateLineDraft, updateSelection, updateSelectionGesture, updateShapeDraft]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return;
    const point = eventPoint(event);
    drawingRef.current = false;

    if (selectionResizeRef.current) {
      const resize = selectionResizeRef.current;
      if (Math.hypot(point.x - resize.start.x, point.y - resize.start.y) < Math.max(1, 3 / zoom)) {
        updateSelection(null);
        selectionResizeRef.current = null;
        pushHistory('Deselect');
        return;
      }
      updateSelection(resizeSelection(
        resize.original,
        resize.handle,
        point,
        dimensionsRef.current.width,
        dimensionsRef.current.height,
        event.shiftKey,
      ));
      selectionResizeRef.current = null;
      pushHistory('Resize Selection');
      return;
    }

    if (tool === 'line') {
      const draft = lineDraftRef.current;
      const index = lineDragPointRef.current;
      if (draft && index !== null && draft.points[index]) {
        const anchor = index > 0 ? draft.points[index - 1] : draft.points[1];
        const nextPoint = event.shiftKey && anchor ? constrainLinePoint(anchor, point) : point;
        const points = [...draft.points];
        points[index] = nextPoint;
        updateLineDraft({ ...draft, points, selectedPoint: index });
      }
      lineDragPointRef.current = null;
      lineTensionDragRef.current = null;
      return;
    }

    if (EDITABLE_BOUNDS_TOOLS.includes(tool as EditableBoundsTool)) {
      const draft = shapeDraftRef.current;
      const index = shapeDragPointRef.current;
      if (draft && index !== null && draft.points[index]) {
        const opposite = draft.points[(index + 2) % 4];
        const nextPoint = event.shiftKey ? constrainShapePoint(opposite, point) : point;
        updateShapeDraft(moveRectangularControlPoint(draft, index, nextPoint));
      }
      shapeDragPointRef.current = null;
      return;
    }

    if (tool === 'freeform') {
      const points = [...freeformPointsRef.current, point];
      freeformPointsRef.current = [];
      clearPreview();
      if (points.length >= 3 && renderDraftToActiveLayer((context) => drawFreeformShape(context, points, currentShapeOptions(shapeReverseRef.current)))) {
        pushHistory('Freeform Shape');
      }
      return;
    }

    if (tool === 'move-selection') {
      moveSelectionRef.current = null;
      pushHistory('Move Selection');
      return;
    }

    if (tool === 'move-pixels' && movePixelsRef.current) {
      const layer = activeLayer();
      if (layer) {
        layer.canvas.getContext('2d')!.drawImage(movePixelsRef.current.canvas, movePixelsRef.current.x, movePixelsRef.current.y);
        setMovingPixels(null);
        movePixelsRef.current = null;
        moveSelectionRef.current = null;
        pushHistory('Move Selected Pixels');
      }
      return;
    }

    if (SELECTION_TOOLS.includes(tool)) {
      const gesture = selectionGestureRef.current;
      if (tool !== 'magic-wand' && Math.hypot(point.x - startRef.current.x, point.y - startRef.current.y) < Math.max(1, 3 / zoom)) {
        updateSelection(null);
        selectionGestureRef.current = null;
        lassoPointsRef.current = [];
        if (gesture?.previous) pushHistory('Deselect');
        return;
      }
      if (tool !== 'magic-wand') updateSelectionGesture(point, event.shiftKey);
      selectionGestureRef.current = null;
      pushHistory('Select');
      return;
    }

    if (DRAWING_TOOLS.includes(tool)) {
      if (tool === 'clone-stamp') cloneStrokeRef.current = null;
      if (tool === 'recolor') recolorImageRef.current = null;
      pushHistory(tool === 'eraser' ? 'Eraser' : tool === 'pencil' ? 'Pencil' : tool === 'clone-stamp' ? 'Clone Stamp' : tool === 'recolor' ? 'Recolor' : tool === 'block-brush' || (tool === 'paintbrush' && paintBrushType === 'block') ? 'Block Brush' : 'Paintbrush');
    } else if (SHAPE_TOOLS.includes(tool)) {
      const finalPoint = event.shiftKey && tool !== 'gradient'
        ? constrainShapePoint(startRef.current, point)
        : point;
      if (renderDraftToActiveLayer((context) => drawShape(context, tool, startRef.current, finalPoint, currentShapeOptions(shapeReverseRef.current)))) {
        clearPreview();
        pushHistory(tool === 'gradient' ? 'Gradient' : 'Draw Shape');
      }
    }
  }, [activeLayer, clearPreview, currentShapeOptions, eventPoint, paintBrushType, pushHistory, renderDraftToActiveLayer, tool, updateLineDraft, updateSelection, updateSelectionGesture, updateShapeDraft, zoom]);

  const swapColors = useCallback(() => {
    setPrimary(secondary);
    setSecondary(primary);
  }, [primary, secondary]);

  const replacePalette = useCallback((colors: string[]) => {
    const normalized = colors
      .filter((color) => /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color))
      .map((color) => color.toLowerCase());
    if (!normalized.length) return false;
    setPaletteState(normalized);
    return true;
  }, []);

  const resetPalette = useCallback(() => {
    setPaletteState([...PALETTE]);
  }, []);

  const resizePalette = useCallback((size: number) => {
    const nextSize = Math.max(1, Math.min(96, Math.round(size)));
    setPaletteState((current) => current.length >= nextSize
      ? current.slice(0, nextSize)
      : [...current, ...Array.from({ length: nextSize - current.length }, () => '#ffffff')]);
  }, []);

  const setPaletteColor = useCallback((index: number, color: string) => {
    if (!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return false;
    setPaletteState((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? color.toLowerCase() : candidate));
    return true;
  }, []);

  const addPaletteColor = useCallback((color: string) => {
    if (!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) || palette.length >= 96) return false;
    setPaletteState((current) => [...current, color.toLowerCase()]);
    return true;
  }, [palette.length]);

  return {
    displayCanvasRef,
    previewCanvasRef,
    selectionCanvasRef,
    documents,
    activeDocumentId,
    workspaceReady,
    workspaceSaveState,
    workspaceError,
    switchDocument,
    closeDocument,
    closeAllDocuments,
    layers,
    activeLayerId,
    setActiveLayerId,
    history,
    historyIndex,
    revision,
    width,
    height,
    tool,
    setTool,
    primary,
    setPrimary,
    secondary,
    setSecondary,
    swapColors,
    palette,
    replacePalette,
    resetPalette,
    resizePalette,
    setPaletteColor,
    addPaletteColor,
    brushSize,
    setBrushSize,
    paintBrushType,
    setPaintBrushType,
    slashBrushAngle,
    setSlashBrushAngle,
    splatterMinimumSize,
    setSplatterMinimumSize,
    splatterMaximumSize,
    setSplatterMaximumSize,
    eraserType,
    setEraserType,
    floodMode,
    setFloodMode,
    paintBucketTolerance,
    setPaintBucketTolerance,
    selectionAutoScroll,
    setSelectionAutoScroll,
    lassoMode,
    setLassoMode,
    polygonLassoPointCount: lassoPointsRef.current.length,
    finishPolygonLasso,
    removePolygonLassoPoint,
    cancelPolygonLasso,
    gradientType,
    setGradientType,
    gradientColorMode,
    setGradientColorMode,
    alphaBlendingMode,
    setAlphaBlendingMode,
    colorPickerSampleSize,
    setColorPickerSampleSize,
    colorPickerSampleType,
    setColorPickerSampleType,
    colorPickerAfterSelect,
    setColorPickerAfterSelect,
    roundedRectangleRadius,
    setRoundedRectangleRadius,
    shapeFillStyle,
    setShapeFillStyle,
    shapeDashStyle,
    setShapeDashStyle,
    shapeAntialiasing,
    setShapeAntialiasing,
    lineArrowStart,
    setLineArrowStart,
    lineArrowEnd,
    setLineArrowEnd,
    lineArrowSize,
    setLineArrowSize,
    lineArrowAngle,
    setLineArrowAngle,
    lineArrowLength,
    setLineArrowLength,
    lineDraft,
    commitLine,
    cancelLine,
    deleteLinePoint,
    nudgeLinePoint,
    setSelectedLineTension,
    shapeDraft,
    commitShape,
    cancelShape,
    nudgeShapePoint,
    magicWandTolerance,
    setMagicWandTolerance,
    recolorTolerance,
    setRecolorTolerance,
    selectionMode,
    setSelectionMode,
    textEditor,
    updateText,
    moveText,
    commitText,
    cancelText,
    textFontFamily,
    setTextFontFamily,
    textFontSize,
    setTextFontSize,
    textFontWeight,
    setTextFontWeight,
    textItalic,
    setTextItalic,
    textUnderline,
    setTextUnderline,
    textAlignment,
    setTextAlignment,
    textStyle,
    setTextStyle,
    textVariant,
    setTextVariant,
    textOutlineWidth,
    setTextOutlineWidth,
    textLineJoin,
    setTextLineJoin,
    cloneSource,
    zoom,
    setZoom,
    pointer,
    fileName,
    dirty,
    selection,
    selectionBounds,
    selectionResizable,
    selectionCursor,
    hasSelection,
    hasClipboard,
    clipboardSize,
    effectBusy,
    undo,
    redo,
    newDocument,
    newDocumentFromCanvas,
    openFile,
    saveImage,
    saveAllImages,
    createCompositeDataUrl,
    addLayer,
    importLayerFromFile,
    duplicateLayer,
    deleteLayer,
    mergeLayerDown,
    moveLayer,
    flipLayer,
    rotateZoomLayer,
    flattenImage,
    toggleLayer,
    renameLayer,
    updateLayerProperties,
    selectAll,
    deselect,
    copySelection,
    copyMerged,
    cutSelection,
    paste,
    pasteIntoNewLayer,
    pasteIntoNewImage,
    fillSelection,
    invertSelection,
    offsetSelection,
    cropToSelection,
    autoCropImage,
    resizeImage,
    resizeCanvas,
    flipImage,
    rotateImage,
    clearActiveLayer,
    applyEffect,
    previewEffect,
    clearEffectPreview,
    goToHistory: restoreHistory,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
