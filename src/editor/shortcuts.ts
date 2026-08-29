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
  [
    'zoom-in',
    [
      { key: '=', primary: true },
      { key: '+', primary: true, shift: 'either' },
      { key: '=' },
      { key: '+', shift: 'either' },
      { code: 'NumpadAdd' },
      { code: 'NumpadAdd', primary: true },
    ],
  ],
  [
    'zoom-out',
    [
      { key: '-', primary: true },
      { key: '_', primary: true, shift: 'either' },
      { key: '-' },
      { key: '_', shift: 'either' },
      { code: 'NumpadSubtract' },
      { code: 'NumpadSubtract', primary: true },
    ],
  ],
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
  [
    'redo',
    [
      { key: 'z', primary: true, shift: true },
      { key: 'y', control: true },
    ],
  ],
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
  [
    'paste-new-image',
    [
      { key: 'v', primary: true, alt: true },
      { key: 'v', shift: true },
    ],
  ],
  ['paste-new-layer', [{ key: 'v', primary: true, shift: true }]],
  ['paste', [{ key: 'v', primary: true }]],
  ['invert-colors', [{ key: 'i', primary: true, shift: true }]],
  ['invert-selection', [{ key: 'i', primary: true }]],
  ['offset-selection', [{ key: 'o', primary: true, shift: true }]],
  [
    'deselect',
    [
      { key: 'a', primary: true, shift: true },
      { key: 'd', control: true },
    ],
  ],
  ['select-all', [{ key: 'a', primary: true }]],
  ['erase-selection', [{ key: 'delete' }]],
  ['fill-selection', [{ key: 'backspace' }]],
];

interface ShortcutPresentation {
  section: 'Layers' | 'File' | 'Edit' | 'View' | 'Image' | 'Adjustments' | 'Help';
  label: string;
  keys: string;
}

const SHORTCUT_PRESENTATION: Record<PintaShortcut, ShortcutPresentation> = {
  help: { section: 'Help', label: 'Pinta Help', keys: 'F1' },
  'keyboard-shortcuts': { section: 'Help', label: 'Keyboard Shortcuts', keys: 'Ctrl+,' },
  quit: { section: 'File', label: 'Quit', keys: 'Ctrl+Q' },
  fullscreen: { section: 'View', label: 'Fullscreen', keys: 'F11' },
  'tool-windows': { section: 'View', label: 'Tool Windows', keys: 'F12' },
  'zoom-in': { section: 'View', label: 'Zoom In', keys: '+ / Ctrl++' },
  'zoom-out': { section: 'View', label: 'Zoom Out', keys: '− / Ctrl+−' },
  'best-fit': { section: 'View', label: 'Best Fit', keys: 'Ctrl+B' },
  'actual-size': { section: 'View', label: 'Normal Size', keys: 'Ctrl+0' },
  'next-document': { section: 'View', label: 'Next Image', keys: 'Ctrl+Tab' },
  'previous-document': { section: 'View', label: 'Previous Image', keys: 'Ctrl+Shift+Tab' },
  'new-image': { section: 'File', label: 'New', keys: 'Ctrl+N' },
  'open-image': { section: 'File', label: 'Open', keys: 'Ctrl+O' },
  'close-image': { section: 'File', label: 'Close', keys: 'Ctrl+W' },
  'close-all': { section: 'File', label: 'Close All', keys: 'Ctrl+Shift+W' },
  'save-image': { section: 'File', label: 'Save', keys: 'Ctrl+S' },
  'save-as': { section: 'File', label: 'Save As', keys: 'Ctrl+Shift+S' },
  'save-all': { section: 'File', label: 'Save All', keys: 'Ctrl+Alt+A' },
  print: { section: 'File', label: 'Print', keys: 'Ctrl+P' },
  undo: { section: 'Edit', label: 'Undo', keys: 'Ctrl+Z' },
  redo: { section: 'Edit', label: 'Redo', keys: 'Ctrl+Shift+Z / Ctrl+Y' },
  cut: { section: 'Edit', label: 'Cut', keys: 'Ctrl+X' },
  copy: { section: 'Edit', label: 'Copy', keys: 'Ctrl+C' },
  'copy-merged': { section: 'Edit', label: 'Copy Merged', keys: 'Ctrl+Shift+C' },
  paste: { section: 'Edit', label: 'Paste', keys: 'Ctrl+V' },
  'paste-new-layer': { section: 'Edit', label: 'Paste Into New Layer', keys: 'Ctrl+Shift+V' },
  'paste-new-image': { section: 'Edit', label: 'Paste Into New Image', keys: 'Shift+V / Ctrl+Alt+V' },
  'erase-selection': { section: 'Edit', label: 'Erase Selection', keys: 'Delete' },
  'fill-selection': { section: 'Edit', label: 'Fill Selection', keys: 'Backspace' },
  'invert-selection': { section: 'Edit', label: 'Invert Selection', keys: 'Ctrl+I' },
  'offset-selection': { section: 'Edit', label: 'Offset Selection', keys: 'Ctrl+Shift+O' },
  'select-all': { section: 'Edit', label: 'Select All', keys: 'Ctrl+A' },
  deselect: { section: 'Edit', label: 'Deselect All', keys: 'Ctrl+Shift+A / Ctrl+D' },
  'crop-selection': { section: 'Image', label: 'Crop to Selection', keys: 'Ctrl+Shift+X' },
  'auto-crop': { section: 'Image', label: 'Auto Crop', keys: 'Ctrl+Alt+X' },
  'resize-image': { section: 'Image', label: 'Resize Image', keys: 'Ctrl+R' },
  'resize-canvas': { section: 'Image', label: 'Resize Canvas', keys: 'Ctrl+Shift+R' },
  'rotate-clockwise': { section: 'Image', label: 'Rotate Clockwise', keys: 'Ctrl+H' },
  'rotate-counter-clockwise': { section: 'Image', label: 'Rotate Counter-Clockwise', keys: 'Ctrl+G' },
  'rotate-180': { section: 'Image', label: 'Rotate 180°', keys: 'Ctrl+J' },
  'flatten-image': { section: 'Image', label: 'Flatten', keys: 'Ctrl+Shift+F' },
  'add-layer': { section: 'Layers', label: 'Add New Layer', keys: 'Ctrl+Shift+N' },
  'delete-layer': { section: 'Layers', label: 'Delete Layer', keys: 'Ctrl+Shift+Delete' },
  'duplicate-layer': { section: 'Layers', label: 'Duplicate Layer', keys: 'Ctrl+Shift+D' },
  'merge-layer-down': { section: 'Layers', label: 'Merge Layer Down', keys: 'Ctrl+M' },
  'flip-layer-horizontal': { section: 'Layers', label: 'Flip Horizontal', keys: 'Ctrl+F' },
  'flip-layer-vertical': { section: 'Layers', label: 'Flip Vertical', keys: 'Shift+F' },
  'layer-properties': { section: 'Layers', label: 'Layer Properties', keys: 'F4' },
  curves: { section: 'Adjustments', label: 'Curves', keys: 'Ctrl+Shift+M' },
  'invert-colors': { section: 'Adjustments', label: 'Invert Colors', keys: 'Ctrl+Shift+I' },
  levels: { section: 'Adjustments', label: 'Levels', keys: 'Ctrl+L' },
};

const SHORTCUT_SECTION_ORDER: ReadonlyArray<ShortcutPresentation['section']> = [
  'Layers',
  'File',
  'Edit',
  'View',
  'Image',
  'Adjustments',
  'Help',
];

/** The dialog is derived from the same registry used to intercept keyboard events. */
export const REGISTERED_SHORTCUT_SECTIONS = SHORTCUT_SECTION_ORDER.map((title) => ({
  title,
  entries: SHORTCUTS.flatMap(([shortcut]) => {
    const presentation = SHORTCUT_PRESENTATION[shortcut];
    return presentation.section === title ? [[presentation.label, presentation.keys] as const] : [];
  }).sort(([left], [right]) => left.localeCompare(right)),
}));

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
  return (
    Boolean(event.target.closest('.canvas-text-editor')) &&
    primary &&
    !event.altKey &&
    ['b', 'i', 's', 'u'].includes(key)
  );
}

export function nextToolForShortcut(currentTool: ToolId, key: string): ToolId | null {
  const matching = TOOLS.filter((tool) => tool.shortcut?.toLowerCase() === key.toLowerCase());
  if (!matching.length) return null;
  const currentIndex = matching.findIndex((tool) => tool.id === currentTool);
  return matching[(currentIndex + 1) % matching.length].id;
}
