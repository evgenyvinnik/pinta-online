# React performance work queue

## Implementation result (August 2026)

All six phases are now implemented. The pinned Playwright Chromium container measures the
original 2000 × 1500, six-layer hover fixture at **0.324 ms of scripting per pointer move**, well
inside the 5 ms regression budget and down from the original 69.2 ms measurement.

| Phase | Implementation |
| --- | --- |
| 1 | Every layer carries a pixel revision and a memoized 53 × 42 canvas thumbnail; rendering never calls `toDataURL()`. |
| 2 | Pointer and selection-size values use small external stores coalesced with `requestAnimationFrame`; only their status readouts subscribe. |
| 3 | `usePaintEditor` exposes stable `commands`, `document`, `tool`, and `transient` slices, and list leaves are memoized. |
| 4 | Menu/header chrome, the status bar, auxiliary dialogs, and the dock own their interaction state; dialog form drafts already remain inside their dialog components. |
| 5 | `App` and `usePaintEditor` use narrow Zustand selectors instead of subscribing to the full preferences store. |
| 6 | `tests/performance/react-performance.spec.ts` enforces the production CDP budget in the same pinned Chromium image as visual CI. |

Run `npm run test:performance` for the reproducible container measurement, or
`npm run test:performance:local` for a non-authoritative local diagnostic run. The test report
includes `performance-metrics.json` with the raw scripting and layout deltas.

Every number here is measured against the production build in Chromium via the CDP
`Performance` domain, not estimated. The metric is **scripting time per pointer move while
merely hovering the canvas** — no button held, nothing being drawn. A 60 Hz frame budget is
16.7 ms.

| Document | Layers | Layers pad | Script per move |
| --- | ---: | --- | ---: |
| 800 × 600 | 1 | visible | 5.9 ms |
| 2000 × 1500 | 1 | visible | 12.8 ms |
| 2000 × 1500 | 6 | visible | **69.2 ms** |
| 2000 × 1500 | 6 | **hidden** | **2.3 ms** |

Moving the mouse across a six-layer image costs four dropped frames per event. Hiding the
Layers pad with F12 makes the same gesture **30× cheaper**, which localises almost the entire
cost to one line of JSX.

## The two root causes

Everything in this plan follows from these.

**1. A full-resolution PNG is encoded for every layer on every render.**
[`src/App.tsx`](../src/App.tsx) renders the layer thumbnail as:

```jsx
<img src={layer.canvas.toDataURL()} alt="" />
```

`toDataURL()` synchronously PNG-encodes the entire layer at full resolution. On a 2000 × 1500
canvas that is roughly 10 ms per layer, per render. Six layers, and a single re-render costs
more than four frames — regardless of whether any layer actually changed.

**2. Pointer position lives in React state, so every mouse move re-renders the application.**
`onPointerMove` calls `setPointer(point)` unconditionally
([`src/editor/usePaintEditor.ts`](../src/editor/usePaintEditor.ts)). `App` is one component
holding **59 `useState` hooks** and roughly 5,300 lines of JSX across 48 child components, and
**none of them are wrapped in `React.memo`**. So the entire tree re-renders — including cause 1
— to update a coordinate readout in the status bar.

The layouts confirm it: 120 pointer moves produce 120 layout passes. Idle produces zero.

---

## Phase 1 — Stop encoding PNGs during render

**Effort S · measured 30× on the hot path**

This is the whole finding. It is also the smallest change in this plan.

### Do this

1. **Cache the thumbnail, keyed on layer identity plus a revision counter.** There is already a
   document-level `revision` in `usePaintEditor`; add a per-layer counter bumped wherever a
   layer's pixels change, so an unrelated re-render reuses the cached image.
2. **Render at thumbnail size, not full size.** The `.layer-thumbnail` box is well under 60 px
   wide. Draw the layer once into a small offscreen canvas and encode that — the cost drops by
   the area ratio, which on a 2000 × 1500 layer is over 1000×, before caching even applies.
3. **Prefer a canvas over a data URL.** Rendering the small canvas directly, or via
   `createImageBitmap`, avoids base64 encoding and the string allocation entirely. If an `<img>`
   is needed for layout reasons, `toBlob` plus an object URL beats `toDataURL` — remember to
   revoke it.

### Why this ordering

Phases 2 and 3 reduce *how often* the tree renders. Phase 1 reduces *what a render costs*. Doing
Phase 1 first means every later phase is measured against a sane baseline, and it alone takes
the six-layer case from 69 ms to roughly 2–3 ms.

---

## Phase 2 — Take pointer position out of React state

**Effort S · removes ~120 renders per second of hovering**

The status bar shows the cursor position. Updating it currently re-renders everything.

### Do this

1. Keep the live pointer in a ref, not state.
2. Let the readout subscribe to it on its own — either a small component with its own
   `useSyncExternalStore` over a tiny emitter, or a direct text-node write from the pointer
   handler. Native Pinta does exactly the latter: `ActionManager.CreateStatusBar` holds a
   `Gtk.Label` and calls `SetText` on it.
3. Do the same for the selection-size readout, which changes on every drag of a selection.
4. Coalesce with `requestAnimationFrame` so a 120 Hz pointer cannot outpace the display.

While here: `onPointerMove` also returns early when not drawing, so the expensive branch is
already guarded — the cost is purely the state write.

---

## Phase 3 — Make memoisation possible at all

**Effort M · currently impossible**

`usePaintEditor` ends with a plain object literal (roughly 200 keys, not memoised), so `editor`
has a **new identity on every render**. Any `React.memo` added today would compare props, see a
changed `editor`, and re-render anyway. This phase is a prerequisite, not a win on its own.

### Do this

1. **Split the returned object by change frequency**, then memoise each part:
   - *commands* — the 161 `useCallback` functions, stable for the session
   - *document* — layers, dimensions, history, selection
   - *tool* — the active tool and its options
   - *transient* — pointer, zoom, drafts

   Consumers take only the slice they need, so a zoom change stops invalidating the toolbar.
2. **Then apply `React.memo`** to the leaf components that render lists: layer rows, history
   rows, palette swatches, tool buttons. These are the ones re-rendered most and cheapest to
   compare.
3. Verify with the React DevTools profiler that the memo actually holds — a single unstable prop
   silently defeats it, which is the usual outcome when this is done without step 1.

---

## Phase 4 — Break up the App monolith

**Effort M–L · structural**

`App` holds 59 `useState` hooks. Opening a menu, typing in a dialog field, or toggling a chip
re-renders the canvas viewport, the dock, the status bar and every dialog's JSX.

### Do this

Extract by ownership, moving state down with each piece:

| Extract | State it should own |
| --- | --- |
| Dialog host | `dialog`, `effectDialog`, `showAbout`, `showSaveAs`, and the other ~20 dialog flags |
| Menu bar and header | `openMenu`, `menuSurface`, `layerMenuOpen`, `zoomListOpen` |
| Status bar | pointer readout, selection readout, zoom combo draft |
| Dock sidebar | layer menu, dock drag state |

A dialog's own input state should never reach the canvas. Today it does.

---

## Phase 5 — Subscribe to preferences narrowly

**Effort S**

Both `App` and `usePaintEditor` call `usePreferences()` with no selector, so they re-render on
**any** store change — including the recent-colours list, which updates whenever a colour is
picked. Zustand supports selectors precisely to avoid this:

```ts
const showRulers = usePreferences((state) => state.showRulers);
```

Note the interaction with Phase 3: `usePaintEditor` pulls `toolSettings` and
`scopedToolSettings` wholesale, so changing the paintbrush width currently re-renders every
consumer of the editor. Selector-scoping there is worth more than in `App`.

---

## Phase 6 — Keep it from regressing

**Effort S · without this, the above erodes**

None of the 84 e2e or 187 visual tests would fail if a render became ten times more expensive.
The measurements in this document were taken with a throwaway script.

Add a performance budget test using the same CDP metrics that produced the table above:

1. Open a fixed 2000 × 1500 fixture with a fixed layer count.
2. Perform a fixed number of pointer moves.
3. Assert scripting time per move stays under a threshold — start generously, around 5 ms, and
   tighten once Phases 1–3 land.

Run it in the same pinned Docker Chromium the visual suite uses, so the number is comparable
between runs. A wall-clock assertion on a developer laptop is noise; the same container is not.

---

## Suggested order

Phase 1 alone, then re-measure. It is a handful of lines and, on the evidence, removes most of
the problem. Phase 2 next — also small, and it cuts render *frequency* rather than cost, so the
two compose. Phase 6 before 3 and 4, so the structural refactors have a number to be judged
against rather than a feeling.

## How these numbers were taken

```js
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
// read Performance.getMetrics before and after N pointer moves,
// then diff ScriptDuration and LayoutCount
```

Production build (`npm run build` plus `npm run preview`), default Chromium, 1440 × 960
viewport, no throttling. Dev-server numbers run roughly 4–5× higher because of unminified React
and `StrictMode` double-rendering — do not compare the two.
