import { describe, expect, it } from 'vitest';
import {
  REGISTERED_SHORTCUT_SECTIONS,
  documentIndexShortcut,
  focusedEditorOwnsShortcut,
  isEditableTarget,
  nextToolForShortcut,
  resolvePintaShortcut,
} from '../../src/editor/shortcuts';
import { TOOLS } from '../../src/editor/tools';

function press(init: Partial<KeyboardEvent> & { key?: string; code?: string }) {
  return { key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: null, ...init } as KeyboardEvent;
}

describe('resolvePintaShortcut', () => {
  it('accepts Ctrl and Command interchangeably for Primary accelerators', () => {
    expect(resolvePintaShortcut(press({ key: 's', ctrlKey: true }))).toBe('save-image');
    expect(resolvePintaShortcut(press({ key: 's', metaKey: true }))).toBe('save-image');
  });

  it('keeps Ctrl-only accelerators off Command, matching the C# <Ctrl> declarations', () => {
    // Redo is <Primary>Z or <Ctrl>Y; Command-Y is a system shortcut and must not be claimed.
    expect(resolvePintaShortcut(press({ key: 'y', ctrlKey: true }))).toBe('redo');
    expect(resolvePintaShortcut(press({ key: 'y', metaKey: true }))).toBeNull();
    expect(resolvePintaShortcut(press({ key: 'd', ctrlKey: true }))).toBe('deselect');
    expect(resolvePintaShortcut(press({ key: 'd', metaKey: true }))).toBeNull();
  });

  it('distinguishes shifted from unshifted variants of the same key', () => {
    expect(resolvePintaShortcut(press({ key: 'z', ctrlKey: true }))).toBe('undo');
    expect(resolvePintaShortcut(press({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe('redo');
  });

  it('requires the modifier — a bare letter is a tool shortcut, not a command', () => {
    expect(resolvePintaShortcut(press({ key: 's' }))).toBeNull();
    expect(resolvePintaShortcut(press({ key: 'z' }))).toBeNull();
  });

  it('rejects a stroke carrying an Alt the shortcut does not declare', () => {
    expect(resolvePintaShortcut(press({ key: 's', ctrlKey: true, altKey: true }))).toBeNull();
    // …but honours one that does.
    expect(resolvePintaShortcut(press({ key: 'a', ctrlKey: true, altKey: true }))).toBe('save-all');
  });

  it('matches by code where the key varies with layout and shift state', () => {
    expect(resolvePintaShortcut(press({ code: 'NumpadAdd', key: '+', ctrlKey: true }))).toBe('zoom-in');
    expect(resolvePintaShortcut(press({ key: 'f1' }))).toBe('help');
  });

  it('is case-insensitive, so Shift-produced uppercase still resolves', () => {
    expect(resolvePintaShortcut(press({ key: 'Z', ctrlKey: true, shiftKey: true }))).toBe('redo');
  });

  it('returns null for a key no shortcut claims', () => {
    expect(resolvePintaShortcut(press({ key: 'ArrowLeft' }))).toBeNull();
    expect(resolvePintaShortcut(press({ key: '' }))).toBeNull();
  });
});

describe('documentIndexShortcut', () => {
  it('maps Alt with a digit to a zero-based tab index', () => {
    expect(documentIndexShortcut(press({ code: 'Digit1', key: '1', altKey: true }))).toBe(0);
    expect(documentIndexShortcut(press({ code: 'Digit9', key: '9', altKey: true }))).toBe(8);
  });

  it('falls back to the key when the layout reports no Digit code', () => {
    expect(documentIndexShortcut(press({ code: '', key: '3', altKey: true }))).toBe(2);
  });

  it('ignores zero, other modifiers and non-digits', () => {
    expect(documentIndexShortcut(press({ code: 'Digit0', key: '0', altKey: true }))).toBeNull();
    expect(documentIndexShortcut(press({ code: 'Digit1', key: '1' }))).toBeNull();
    expect(documentIndexShortcut(press({ code: 'Digit1', key: '1', altKey: true, ctrlKey: true }))).toBeNull();
    expect(documentIndexShortcut(press({ code: 'KeyA', key: 'a', altKey: true }))).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('recognises fields and their descendants, not the page at large', () => {
    document.body.innerHTML = `
      <input id="field" />
      <div id="rich" contenteditable="true"><span id="inner">text</span></div>
      <div id="plain"></div>`;

    expect(isEditableTarget(document.getElementById('field'))).toBe(true);
    expect(isEditableTarget(document.getElementById('inner'))).toBe(true);
    expect(isEditableTarget(document.getElementById('plain'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('focusedEditorOwnsShortcut', () => {
  function inField(selector: string, init: Partial<KeyboardEvent>) {
    document.body.innerHTML = `
      <input id="plain" />
      <div class="canvas-text-editor"><textarea id="canvas-text"></textarea></div>`;
    return press({ ...init, target: document.querySelector(selector) });
  }

  it('lets a focused field keep the editing shortcuts the browser expects', () => {
    for (const key of ['a', 'c', 'v', 'x', 'y', 'z']) {
      expect(focusedEditorOwnsShortcut(inField('#plain', { key, ctrlKey: true }))).toBe(true);
    }
  });

  it('does not claim application shortcuts that a text field has no use for', () => {
    // Ctrl+S must reach the application even while a field has focus.
    expect(focusedEditorOwnsShortcut(inField('#plain', { key: 's', ctrlKey: true }))).toBe(false);
    expect(focusedEditorOwnsShortcut(inField('#plain', { key: 'b', ctrlKey: true }))).toBe(false);
  });

  it('adds the formatting shortcuts only inside the on-canvas text editor', () => {
    for (const key of ['b', 'i', 's', 'u']) {
      expect(focusedEditorOwnsShortcut(inField('#canvas-text', { key, ctrlKey: true }))).toBe(true);
      expect(focusedEditorOwnsShortcut(inField('#plain', { key, ctrlKey: true }))).toBe(false);
    }
  });

  it('never claims a stroke outside a field', () => {
    document.body.innerHTML = '<div id="canvas"></div>';
    expect(focusedEditorOwnsShortcut(press({ key: 'z', ctrlKey: true, target: document.getElementById('canvas') }))).toBe(false);
  });
});

describe('nextToolForShortcut', () => {
  it('cycles through every tool sharing a key and wraps around', () => {
    const shared = TOOLS.filter((tool) => tool.shortcut?.toLowerCase() === 's').map((tool) => tool.id);
    expect(shared.length).toBeGreaterThan(1);

    const visited = [shared[0]];
    for (let step = 0; step < shared.length; step += 1) {
      visited.push(nextToolForShortcut(visited[visited.length - 1], 's')!);
    }
    // A full cycle returns to where it started, having touched each tool once.
    expect(visited.slice(0, shared.length)).toEqual(shared);
    expect(visited[shared.length]).toBe(shared[0]);
  });

  it('selects the first match when the current tool is not in the group', () => {
    const [first] = TOOLS.filter((tool) => tool.shortcut?.toLowerCase() === 's');
    expect(nextToolForShortcut('paintbrush', 's')).toBe(first.id);
  });

  it('is case-insensitive and returns null for an unclaimed key', () => {
    expect(nextToolForShortcut('paintbrush', 'S')).toBe(nextToolForShortcut('paintbrush', 's'));
    expect(nextToolForShortcut('paintbrush', '§')).toBeNull();
  });
});

describe('REGISTERED_SHORTCUT_SECTIONS', () => {
  it('presents every registered shortcut exactly once, so the dialog cannot drift', () => {
    const listed = REGISTERED_SHORTCUT_SECTIONS.flatMap((section) => section.entries);
    expect(listed.length).toBeGreaterThan(0);
    expect(new Set(listed.map(([label]) => label)).size).toBe(listed.length);
    for (const section of REGISTERED_SHORTCUT_SECTIONS) {
      const labels = section.entries.map(([label]) => label);
      expect(labels).toEqual([...labels].sort((left, right) => left.localeCompare(right)));
    }
  });
});
