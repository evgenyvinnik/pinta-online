import { TOOLS } from './tools';
import type { ToolId } from './types';

export type PintaShortcut =
  | 'help'
  | 'keyboard-shortcuts'
  | 'quit'
  | 'fullscreen'
  | 'tool-windows'
  | 'zoom-in'
  | 'zoom-out'
  | 'best-fit'
  | 'actual-size'
  | 'next-document'
  | 'previous-document'
  | 'new-image'
  | 'open-image'
  | 'close-image'
  | 'close-all'
  | 'save-image'
  | 'save-as'
  | 'save-all'
  | 'print'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'copy-merged'
  | 'paste'
  | 'paste-new-layer'
  | 'paste-new-image'
  | 'erase-selection'
  | 'fill-selection'
  | 'invert-selection'
  | 'offset-selection'
  | 'select-all'
  | 'deselect'
  | 'crop-selection'
  | 'auto-crop'
  | 'resize-image'
  | 'resize-canvas'
  | 'rotate-clockwise'
  | 'rotate-counter-clockwise'
  | 'rotate-180'
  | 'flatten-image'
  | 'add-layer'
  | 'delete-layer'
  | 'duplicate-layer'
  | 'merge-layer-down'
  | 'flip-layer-horizontal'
  | 'flip-layer-vertical'
  | 'layer-properties'
  | 'curves'
  | 'invert-colors'
  | 'levels';

interface ShortcutStroke {
  key?: string;
  code?: string;
  primary?: boolean;
  control?: boolean;
  shift?: boolean | 'either';
  alt?: boolean;
}

// Pinta's <Primary> accelerator maps to Ctrl or Command. The few shortcuts
// declared as <Ctrl> in the C# application remain explicitly Control-only.
const SHORTCUTS: ReadonlyArray<readonly [PintaShortcut, ReadonlyArray<ShortcutStroke>]> = [
  ['help', [{ key: 'f1' }]],
  ['keyboard-shortcuts', [{ key: ',', primary: true }]],
  ['quit', [{ key: 'q', primary: true }]],
  ['fullscreen', [{ key: 'f11' }]],
  ['tool-windows', [{ key: 'f12' }]],
  ['zoom-in', [
    { key: '=', primary: true },
    { key: '+', primary: true, shift: 'either' },
    { key: '=' },
    { key: '+', shift: 'either' },
    { code: 'NumpadAdd' },
    { code: 'NumpadAdd', primary: true },
  ]],
  ['zoom-out', [
    { key: '-', primary: true },
    { key: '_', primary: true, shift: 'either' },
    { key: '-' },
    { key: '_', shift: 'either' },
    { code: 'NumpadSubtract' },
    { code: 'NumpadSubtract', primary: true },
  ]],
  ['best-fit', [{ key: 'b', primary: true }]],
  ['actual-size', [{ key: '0', primary: true }]],
  ['previous-document', [{ key: 'tab', primary: true, shift: true }]],
  ['next-document', [{ key: 'tab', primary: true }]],
  ['add-layer', [{ key: 'n', primary: true, shift: true }]],
  ['duplicate-layer', [{ key: 'd', primary: true, shift: true }]],
  ['delete-layer', [{ key: 'delete', primary: true, shift: true }]],
  ['curves', [{ key: 'm', primary: true, shift: true }]],
  ['merge-layer-down', [{ key: 'm', primary: true }]],
  ['flatten-image', [{ key: 'f', primary: true, shift: true }]],
  ['flip-layer-horizontal', [{ key: 'f', primary: true }]],
  ['flip-layer-vertical', [{ key: 'f', shift: true }]],
  ['close-all', [{ key: 'w', primary: true, shift: true }]],
  ['close-image', [{ key: 'w', primary: true }]],
  ['redo', [{ key: 'z', primary: true, shift: true }, { key: 'y', control: true }]],
  ['undo', [{ key: 'z', primary: true }]],
  ['save-as', [{ key: 's', primary: true, shift: true }]],
  ['save-image', [{ key: 's', primary: true }]],
  ['save-all', [{ key: 'a', control: true, alt: true }]],
  ['print', [{ key: 'p', primary: true }]],
  ['open-image', [{ key: 'o', primary: true }]],
  ['new-image', [{ key: 'n', primary: true }]],
  ['resize-canvas', [{ key: 'r', primary: true, shift: true }]],
  ['resize-image', [{ key: 'r', primary: true }]],
  ['rotate-clockwise', [{ key: 'h', primary: true }]],
  ['rotate-counter-clockwise', [{ key: 'g', primary: true }]],
  ['rotate-180', [{ key: 'j', primary: true }]],
  ['levels', [{ key: 'l', primary: true }]],
  ['layer-properties', [{ key: 'f4' }]],
  ['auto-crop', [{ key: 'x', control: true, alt: true }]],
  ['crop-selection', [{ key: 'x', primary: true, shift: true }]],
  ['cut', [{ key: 'x', primary: true }]],
  ['copy-merged', [{ key: 'c', primary: true, shift: true }]],
  ['copy', [{ key: 'c', primary: true }]],
  ['paste-new-image', [{ key: 'v', primary: true, alt: true }, { key: 'v', shift: true }]],
  ['paste-new-layer', [{ key: 'v', primary: true, shift: true }]],
  ['paste', [{ key: 'v', primary: true }]],
  ['invert-colors', [{ key: 'i', primary: true, shift: true }]],
  ['invert-selection', [{ key: 'i', primary: true }]],
  ['offset-selection', [{ key: 'o', primary: true, shift: true }]],
  ['deselect', [{ key: 'a', primary: true, shift: true }, { key: 'd', control: true }]],
  ['select-all', [{ key: 'a', primary: true }]],
  ['erase-selection', [{ key: 'delete' }]],
  ['fill-selection', [{ key: 'backspace' }]],
];

function matchesStroke(event: KeyboardEvent, stroke: ShortcutStroke) {
  const keyMatches = stroke.key === undefined || event.key.toLowerCase() === stroke.key;
  const codeMatches = stroke.code === undefined || event.code === stroke.code;
  if (!keyMatches || !codeMatches) return false;

  const primaryPressed = event.ctrlKey || event.metaKey;
  if (stroke.primary) {
    if (!primaryPressed) return false;
  } else if (stroke.control) {
    if (!event.ctrlKey || event.metaKey) return false;
  } else if (primaryPressed) {
    return false;
  }

  if (event.altKey !== Boolean(stroke.alt)) return false;
  if (stroke.shift !== 'either' && event.shiftKey !== Boolean(stroke.shift)) return false;
  return true;
}

export function resolvePintaShortcut(event: KeyboardEvent): PintaShortcut | null {
  for (const [shortcut, strokes] of SHORTCUTS) {
    if (strokes.some((stroke) => matchesStroke(event, stroke))) return shortcut;
  }
  return null;
}

export function documentIndexShortcut(event: KeyboardEvent): number | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const match = /^Digit([1-9])$/.exec(event.code);
  if (match) return Number(match[1]) - 1;
  return /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : null;
}

export function isEditableTarget(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function focusedEditorOwnsShortcut(event: KeyboardEvent) {
  if (!isEditableTarget(event.target)) return false;
  const key = event.key.toLowerCase();
  const primary = event.ctrlKey || event.metaKey;
  if (primary && !event.altKey && ['a', 'c', 'v', 'x', 'y', 'z'].includes(key)) return true;
  return Boolean(event.target.closest('.canvas-text-editor'))
    && primary
    && !event.altKey
    && ['b', 'i', 's', 'u'].includes(key);
}

export function nextToolForShortcut(currentTool: ToolId, key: string): ToolId | null {
  const matching = TOOLS.filter((tool) => tool.shortcut?.toLowerCase() === key.toLowerCase());
  if (!matching.length) return null;
  const currentIndex = matching.findIndex((tool) => tool.id === currentTool);
  return matching[(currentIndex + 1) % matching.length].id;
}
