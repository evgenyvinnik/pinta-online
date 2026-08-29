import { describe, expect, it } from 'vitest';
import {
  SELECTION_TOOLS,
  constrainSelectionPoint,
  isResizableSelection,
  normalizeSelection,
  selectionHandlePoints,
  selectionResizeHandleAtPoint,
} from '../../src/editor/selectionGeometry';
import type { Selection } from '../../src/editor/types';

// The mask members rasterise and stay with Playwright. The geometry below decides where a
// selection is and which handle the pointer grabbed, and it is reachable without a canvas.

const rect = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  tool: Selection['tool'] = 'rectangle-select',
): Selection => ({ tool, start, end });

describe('SELECTION_TOOLS', () => {
  it('lists exactly the tools that produce a selection', () => {
    expect([...SELECTION_TOOLS].sort()).toEqual(['ellipse-select', 'lasso-select', 'magic-wand', 'rectangle-select']);
  });
});

describe('normalizeSelection', () => {
  it('orders the corners however the drag was made', () => {
    const forward = normalizeSelection(rect({ x: 10, y: 20 }, { x: 40, y: 60 }), 800, 600);
    const backward = normalizeSelection(rect({ x: 40, y: 60 }, { x: 10, y: 20 }), 800, 600);
    expect(forward).toMatchObject({ x: 10, y: 20, width: 30, height: 40 });
    expect(backward).toMatchObject({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('keeps geometry outside the canvas, so a transform can bring it back', () => {
    expect(normalizeSelection(rect({ x: -30, y: -20 }, { x: 10, y: 10 }), 800, 600)).toMatchObject({
      x: -30,
      y: -20,
      width: 40,
      height: 30,
    });
  });

  it('flags the ellipse tool so the mask is drawn as one', () => {
    expect(normalizeSelection(rect({ x: 0, y: 0 }, { x: 4, y: 4 }, 'ellipse-select'), 800, 600).ellipse).toBe(true);
    expect(normalizeSelection(rect({ x: 0, y: 0 }, { x: 4, y: 4 }), 800, 600).ellipse).toBe(false);
  });
});

describe('selectionHandlePoints', () => {
  it('places eight handles: four corners and four edge midpoints', () => {
    const points = selectionHandlePoints(normalizeSelection(rect({ x: 10, y: 20 }, { x: 110, y: 220 }), 800, 600));
    expect(Object.keys(points).sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    expect(points).toMatchObject({
      nw: { x: 10, y: 20 },
      se: { x: 110, y: 220 },
      n: { x: 60, y: 20 },
      w: { x: 10, y: 120 },
    });
  });
});

describe('isResizableSelection', () => {
  it('allows the two rectangular tools and refuses the freeform ones', () => {
    const selection = rect({ x: 0, y: 0 }, { x: 10, y: 10 });
    expect(isResizableSelection(selection, 'rectangle-select')).toBe(true);
    expect(isResizableSelection(selection, 'ellipse-select')).toBe(true);
    expect(isResizableSelection(selection, 'lasso-select')).toBe(false);
    expect(isResizableSelection(selection, 'magic-wand')).toBe(false);
    expect(isResizableSelection(null, 'rectangle-select')).toBe(false);
  });
});

describe('selectionResizeHandleAtPoint', () => {
  const selection = rect({ x: 100, y: 100 }, { x: 300, y: 200 });

  it('finds each handle when the pointer is on it', () => {
    expect(selectionResizeHandleAtPoint(selection, 'rectangle-select', { x: 100, y: 100 }, 800, 600, 1)).toBe('nw');
    expect(selectionResizeHandleAtPoint(selection, 'rectangle-select', { x: 300, y: 200 }, 800, 600, 1)).toBe('se');
    expect(selectionResizeHandleAtPoint(selection, 'rectangle-select', { x: 200, y: 100 }, 800, 600, 1)).toBe('n');
  });

  it('returns null well away from every handle', () => {
    expect(selectionResizeHandleAtPoint(selection, 'rectangle-select', { x: 200, y: 150 }, 800, 600, 1)).toBeNull();
  });

  it('shrinks its grab radius as zoom rises, so a handle stays the same size on screen', () => {
    // The radius is 9.5 image pixels at 1x; six pixels away is inside it there and outside at 8x.
    const near = { x: 106, y: 106 };
    expect(selectionResizeHandleAtPoint(selection, 'rectangle-select', near, 800, 600, 1)).toBe('nw');
    expect(selectionResizeHandleAtPoint(selection, 'rectangle-select', near, 800, 600, 8)).toBeNull();
  });

  it('picks the nearer handle when two are within reach', () => {
    // A selection small enough that nw and n overlap; the pointer sits closer to nw.
    const tiny = rect({ x: 100, y: 100 }, { x: 108, y: 140 });
    expect(selectionResizeHandleAtPoint(tiny, 'rectangle-select', { x: 100, y: 100 }, 800, 600, 1)).toBe('nw');
  });

  it('offers no handles for a tool that cannot resize', () => {
    expect(selectionResizeHandleAtPoint(selection, 'paintbrush', { x: 100, y: 100 }, 800, 600, 1)).toBeNull();
  });
});

describe('constrainSelectionPoint', () => {
  // This is the Shift-to-square constraint, not a clamp: it squares the drag off the start point
  // and stops at the canvas edge in whichever direction the drag is heading.
  it('squares the drag to the larger axis', () => {
    expect(constrainSelectionPoint({ x: 100, y: 100 }, { x: 180, y: 130 }, 800, 600)).toEqual({ x: 180, y: 180 });
  });

  it('squares in whichever direction the drag goes', () => {
    expect(constrainSelectionPoint({ x: 100, y: 100 }, { x: 20, y: 70 }, 800, 600)).toEqual({ x: 20, y: 20 });
  });

  it('stops at the canvas edge rather than squaring past it', () => {
    expect(constrainSelectionPoint({ x: 700, y: 100 }, { x: 900, y: 400 }, 800, 600)).toEqual({ x: 800, y: 200 });
  });

  it('still produces a direction when the pointer has not moved', () => {
    expect(constrainSelectionPoint({ x: 50, y: 50 }, { x: 50, y: 50 }, 800, 600)).toEqual({ x: 50, y: 50 });
  });
});
