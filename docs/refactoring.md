# Refactoring plan: breaking up the four large files

Four files carry most of this codebase, and two of them are past the point where a person can hold
them in their head:

| File | Lines at `HEAD` | What makes it big |
| --- | ---: | --- |
| [`src/styles.css`](../src/styles.css) | 5,848 | One stylesheet for the whole application |
| [`src/editor/usePaintEditor.ts`](../src/editor/usePaintEditor.ts) | 5,572 | 99 module-level helpers plus a 3,361-line hook |
| [`src/App.tsx`](../src/App.tsx) | 5,428 | 47 components plus a 2,764-line `App` function |
| [`src/effects/processor.ts`](../src/effects/processor.ts) | 2,929 | 102 effect kernels behind one dispatcher |

This plan is a sequence of mechanical, individually shippable steps that reduce those to files you
can read in one sitting, **without changing behaviour once**.

> **Status.** Phases 1, 2, 4 and 6 are complete. Phase 3 is 4 hooks of 9 and phase 5 is 7 sub-hooks
> of 12 — both stopped on measurement rather than part-way, see §8.2a. Phase 7 was attempted and
> reverted, see §10. Every heading below keeps its original plan; measured corrections are called
> out in blockquotes beside it.
>
> **All line numbers are from `HEAD`** (`2b72e1a3`) so they are reproducible. Re-derive them at any
> time with the inventory script in [§11](#11-the-inventory-script). Numbers shift as you go, which
> is why every step below is keyed on **symbol names**, not offsets.

---

## 1. Rules of engagement

These are not stylistic preferences. Each one exists because breaking it is how this kind of work
goes wrong.

**R1 — A step is a *pure move* or it is a different step.**
Move the bytes verbatim. Add `export`. Add imports. Nothing else. No renaming, no signature change,
no "while I'm here". If a move needs a signature change to compile, that change is its own commit,
made *before* the move.

**R2 — A correct extraction changes zero visual baselines.**
There are 194 approved screenshots. A pure component move cannot alter rendering, so if
`npm run test:visual` reports a single changed pixel, the move was not pure. **Do not update the
baseline. Find the mistake.** This is the strongest invariant available and it is what makes
Phases 2–4 safe to do quickly.

**R3 — One extraction per commit.**
Reviewable, and `git revert`-able without collateral. A commit that moves two unrelated components
is two commits.

**R4 — Never introduce a barrel file.**
No `components/index.ts` re-exporting everything. Barrels defeat tree-shaking, create import
cycles, and make it impossible to see what actually depends on what. Import from the defining
module, always.

**R5 — Extract bottom-up within a file.**
When several symbols move out of one file in a session, take the last one first. Earlier line
numbers stay valid, and the diffs stay small.

**R6 — The gate runs before every commit.**

```bash
npm run gate
```

That is `lint` + `lint:eslint` + `test:unit` + the e2e suite as one command, and it exists as a
script for a reason: piping a suite through `grep` to shorten its output makes the shell report
`grep`'s exit code, not the suite's, so `&&` happily continues past a red run. That mistake was
made twice during Phase 1 and Phase 4. Run the script; do not reassemble it with pipes.

Plus, for anything that touches `App.tsx`, `styles.css`, or rendering:

```bash
npm run test:visual
```

**R7 — Extraction is not redesign.**
The goal is smaller files, not a different architecture. Where the current design is genuinely
wrong — the 270-line keydown effect, the 403-line `onPointerDown` — that is called out below as a
*separate, optional* piece of work with its own risk profile. Do not smuggle it into a move.

### Non-goals

- Changing the React data flow (refs stay refs, the `revision` counter stays).
- Splitting `usePaintEditor`'s **public surface**. All 204 keys keep their names and semantics;
  consumers must not notice.
- Introducing a state library, a router, CSS modules, or a component framework.
- Reducing total line count. This work moves lines; it does not delete them.

---

## 2. Preconditions

**P1 — Land the in-flight work first.** Refactoring a file another session is editing produces
conflicts that cannot be resolved mechanically, because both sides move code rather than edit it in
place. This bit during Phase 1: work was picked up mid-extraction with `CanvasRuler` already moved
but uncommitted, and measurements taken while a file was being rewritten underneath were
meaningless. Check that the tree is clean *and* that nothing has been written recently:

```bash
git status --short              # must be clean
ls -lT src/App.tsx              # and not written in the last few minutes
```

**P2 — Merge the `surface-diff-history` branch.** It changes history storage in
`usePaintEditor.ts`. Merging a branch into a file that has since been split is far harder than
merging first and splitting after.

**P3 — Establish the baseline.** Record the starting state so progress is measurable and any
regression is attributable:

```bash
npm run lint && npm run test:unit && npx playwright test --config=playwright.e2e.config.ts && npm run test:visual
```

All four must be green. If `test:visual` has a pre-existing failure, resolve it first — you are
about to rely on that suite as your safety net.

---

## 3. Target end state

| File | Start | Predicted | **Actual** | Outcome |
| --- | ---: | ---: | ---: | --- |
| `src/App.tsx` | 5,726 | ~250 | **1,730** | Phases 1 and 2 done; 4 of 9 phase-3 hooks |
| `src/editor/usePaintEditor.ts` | 5,771 | ~600 | **2,915** | Phase 4 done; 7 of 12 phase-5 sub-hooks |
| `src/effects/processor.ts` | 2,929 | ~200 | **252** | Done; validation boundary included |
| `src/styles.css` | 5,854 | ~40 | **5,854** | Abandoned — the split breaks the cascade, see §10 |

The two ~250/~600 predictions were made before any of this was measured, and both are
unreachable by extraction alone — see §8.4 for why. Unit tests went from 174 to 264 along the
way, almost all of them in phase 4.

Nothing above 700 lines anywhere in `src/`, reached through roughly 70 commits, none of which
changes behaviour.

---

## 4. Phase 1 — `App.tsx`: extract the components (safest, biggest win) — **DONE**

**Removes 2,326 lines. Risk: very low. 13 commits.**

> **Completed.** `App.tsx` went from **5,726 lines to 3,245** across 14 commits — 13 extractions
> plus one preceding promotion (§4.2's shared-helper rule fired once, for the project URL
> constants, which now live in [`src/projectLinks.ts`](../src/projectLinks.ts)). The result is 15
> component files, none over 428 lines.
>
> **The visual suite reported 189 passed and zero changed at every checkpoint**, which is R2 doing
> exactly its job: every one of these was a genuine pure move. `import-x/no-cycle` also reports no
> cycles (§7.3).
>
> Four extractions needed more than the table listed, each for the same reason — a private helper
> with no other consumer had to travel with its component: `DialogName` and `ANCHORS` with
> `ImageSizeDialog`; `ApplicationError`, `PrintPreview` and `PrintSettings` with the system dialogs;
> the four option tables with `NativeToolOptions`; and `LevelChannel`, `LevelControlKey`,
> `LEVEL_CONTROLS` and `CURVE_CHANNEL_COLORS` with the effect editors. Deciding move-vs-promote is
> a one-line check — count the remaining references in `App.tsx`; a count of 1 is the declaration
> itself, meaning nothing else uses it.

47 of the 48 components in `App.tsx` are not `App`. Critically, **they already take narrow props** —
only `NativeToolOptions` receives the whole editor object (`ReturnType<typeof usePaintEditor>`,
which appears exactly once in the file). Every dialog takes a handful of values and callbacks.

That means these are already decoupled; they are simply in the wrong file. This phase is pure
`cut`, `paste`, `export`, `import`.

### 4.1 The extraction table

Execute in this order. Sizes are the sum of each group's members at `HEAD`.

| # | Target file | Lines | Symbols to move |
| --: | --- | ---: | --- |
| 1 | `src/components/primitives.tsx` | 273 | `IconButton`, `PintaIcon`, `BusySpinner`, `SwapColorsIcon`, `ResetColorsIcon`, `PlusGlyph`, `ColorSwatch`, `AngleDial`, `PointPad`, `ToolbarStepper`, `ToolbarIconSelect`, `useSecondaryLongPress` |
| 2 | `src/components/dialogControls.tsx` | 70 | `DialogStepper`, `DialogResetButton`, `DialogActions` |
| 3 | `src/components/menus.tsx` | 59 | `MenuItem`, `Popover`, `TopLevelMenu` |
| 4 | `src/components/CanvasRuler.tsx` | 50 | `CanvasRuler`, `rulerStep` |
| 5 | `src/components/dialogs/paletteDialogs.tsx` | 59 | `PaletteResizeDialog`, `PaletteSaveDialog` |
| 6 | `src/components/dialogs/layerDialogs.tsx` | 89 | `LayerPropertiesDialog`, `RotateZoomLayerDialog` |
| 7 | `src/components/dialogs/systemDialogs.tsx` | 186 | `InformationDialog`, `ErrorReportDialog`, `EffectProgressDialog`, `PrintDialog`, `ScreenshotDialog`, `OffsetSelectionDialog`, `CanvasGridDialog` |
| 8 | `src/components/dialogs/documentDialogs.tsx` | 198 | `CloseDocumentDialog`, `PasteExpandDialog`, `FlattenConfirmDialog`, `SaveAsDialog`, `JpegQualityDialog`, `initialExportFormat` |
| 9 | `src/components/dialogs/ImageSizeDialog.tsx` | 228 | `ImageSizeDialog`, `loadResizeSettings` |
| 10 | `src/components/dialogs/aboutDialogs.tsx` | 261 | `KeyboardShortcutsDialog`, `LanguageDialog`, `AboutDialog`, `AddinManagerDialog`, `FontFamilyDialog` |
| 11 | `src/components/NativeToolOptions.tsx` | 175 | `NativeToolOptions` |
| 12 | `src/components/dialogs/effect/editors.tsx` | 390 | `HistogramChart`, `LevelGradient`, `LevelsEditor`, `CurvesEditor`, `AlignmentEditor`, `levelParameterKey`, `levelValue`, `levelColor`, `mapLevelValue`, `leveledHistogram` |
| 13 | `src/components/dialogs/effect/EffectDialog.tsx` | 274 | `EffectDialog` |

Order rationale: leaves first (primitives depend on nothing local), so each later step's imports
already exist. `EffectDialog` is last because it consumes the editors from step 12.

### 4.2 Mechanics of one extraction

Worked example for step 3, `src/components/menus.tsx`:

**Step 3a — create the file with the moved bodies.**

```tsx
import type { ReactNode } from 'react';
import { translateUi } from '../i18n';
import { PintaIcon } from './primitives';

export interface MenuItemProps { /* moved verbatim from App.tsx */ }

export function MenuItem({ icon, label, shortcut, checked, disabled, onClick }: MenuItemProps) {
  /* body moved verbatim */
}

export function Popover(/* … */) { /* verbatim */ }
export function TopLevelMenu(/* … */) { /* verbatim */ }
```

**Step 3b — delete the originals from `App.tsx` and import instead.**

```tsx
import { MenuItem, Popover, TopLevelMenu } from './components/menus';
```

**Step 3c — resolve what the compiler complains about, and *only* that.**

```bash
npm run lint
```

Typical findings and the correct response:

| Compiler says | Do this |
| --- | --- |
| Cannot find name `translateUi` | Add the import to the new file |
| `MenuItemProps` is not exported | Export the interface alongside its component |
| `X` is declared but never read (in `App.tsx`) | Delete that now-orphaned import |
| A helper is used by both the moved code and `App` | **Stop.** Promote the helper to its own module in a preceding commit, then redo the move |

That last row is the only real decision in the phase. Do not duplicate the helper, and do not
import it back from `App.tsx` — that creates a cycle.

**Step 3d — gate and commit.**

```bash
npm run lint && npm run test:unit && npx playwright test --config=playwright.e2e.config.ts && npm run test:visual
```

```bash
git commit -m "refactor: move menu components out of App.tsx"
```

The visual suite must report **189 tests passed, 0 baselines changed**. Anything else means the move
was not pure.

### 4.3 Shared type placement

Several moved components reference prop interfaces currently declared at the top level of
`App.tsx` (`MenuItemProps`, `EffectDialogProps`, `ImageSizeDialogProps`, `SaveAsDialogProps`,
`LayerPropertiesDialogProps`, `AddinManagerDialogProps`, `CurvesEditorProps`, `LevelsEditorProps`).

**Move each interface into the file of the component that uses it.** Do not create a
`components/types.ts`: a shared type file becomes a dumping ground and re-couples everything it
touches. If two components genuinely share a prop type, that is a signal one should import from
the other, or that the type belongs in `src/editor/types.ts` with the rest of the model.

### 4.4 Expected state after Phase 1

`App.tsx` drops from 5,428 to **~3,100 lines**, consisting almost entirely of the `App` function.
That is the point at which the remaining phases become tractable.

---

## 5. Phase 2 — `App.tsx`: extract the JSX regions

**Removes ~900 lines. Risk: low. 7 commits.**

`App`'s JSX runs from line 4266 to the end — 1,163 lines with a very clean top-level structure:

| Lines | Region | Extract to |
| --- | --- | --- |
| 4299–4331 | Hidden file inputs | *leave in place* — three `<input>` elements tied to refs |
| 4332–4365 | `<nav>` main menu bar | `src/components/MenuBar.tsx` |
| 4367–4481 | Header bar (115) | `src/components/HeaderBar.tsx` |
| 4485–4520 | Persistence + storage banners | `src/components/StatusBanners.tsx` |
| 4522–4539 | Toolbox aside | `src/components/Toolbox.tsx` |
| 4542–4771 | Canvas area (230) | `src/components/CanvasArea.tsx` |
| 4773–4936 | Layers/History docks (164) | `src/components/DockSidebar.tsx` |
| 4940–5063 | Palette + status bar (124) | `src/components/StatusBar.tsx` |
| 5069–5423 | Dialog host (355) | `src/components/DialogHost.tsx` |

### 5.1 The prop-drilling problem, and the rule for it

These regions read far more of `App`'s state than the Phase 1 components did. `CanvasArea` alone
touches the editor, zoom state, ruler settings, grid settings, pointer handlers, and several refs.

**The rule: pass an explicit props object. Do not reach for context.**

React context here would be a mistake, for a reason specific to this codebase: the editor object
is recreated on every render and any context consumer re-renders with it, which is precisely the
performance problem the `revision` counter and the ref-heavy design exist to avoid. Explicit props
keep the dependency visible and let React bail out where nothing changed.

If a region needs more than ~15 props, that is a finding worth recording — not a reason to
abandon the extraction. Group related props into one object (`zoom={{ mode, draft, listOpen }}`)
and note the coupling in the commit message.

### 5.2 `DialogHost` is the highest-value extraction here

The dialog host is 355 lines of ~30 near-identical conditional mounts:

```tsx
{showKeyboardShortcuts && <KeyboardShortcutsDialog onClose={() => setShowKeyboardShortcuts(false)} />}
{showLanguage && <LanguageDialog onClose={() => setShowLanguage(false)} />}
{showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
```

Extract it verbatim first (R1). **Then**, as a separate commit, consider collapsing the ~18
boolean flags into one discriminated union:

```ts
type OpenDialog =
  | { kind: 'none' }
  | { kind: 'keyboard-shortcuts' }
  | { kind: 'language' }
  | { kind: 'layer-properties'; layerId: string }
  | { kind: 'rotate-zoom-layer'; layerId: string; thumbnailUrl: string }
  /* … */;
```

This is a behaviour-affecting change — it makes "two dialogs open at once" unrepresentable, which
is a fix, not a move — so it needs its own commit, its own review, and a full e2e run. It also
shrinks the keydown effect's dependency array (§6.2) more than anything else on this list.

---

## 6. Phase 3 — `App.tsx`: split the logic half into hooks

**Removes ~1,300 lines. Risk: medium. 9 commits.**

The 1,600 lines before the JSX hold 48 `useState`, 18 `useRef`, 39 `useCallback`, and 19
`useEffect`. They cluster cleanly.

### 6.1 The extraction table

| # | Target hook | Owns | Members |
| --: | --- | --- | --- |
| 1 | `src/hooks/useToast.ts` | Transient feedback | `toast`, `notify` |
| 2 | `src/hooks/usePaletteFiles.ts` | Palette import/export | `handlePaletteFile`, `savePalette`, `paletteInputRef` |
| 3 | `src/hooks/useClipboardBridge.ts` | OS clipboard | `performPaste`, `pasteImportedImage`, `showEmptyClipboard`, `requestPaste`, `publishClipboardImage`, `copyImage`, `pendingPaste`, `clipboardInformation`, `fallbackPasteTargetRef`, the `onPaste` effect |
| 4 | `src/hooks/useFileCommands.ts` | Open/save/import | `reportOpenFailures`, `openImages`, `saveImageAs`, `saveCurrentImage`, `handleLayerFile`, `handleFiles`, `isDraggingFile`, `fileInputRef`, `layerFileInputRef`, the launch-queue effect |
| 5 | `src/hooks/useViewportZoom.ts` | Zoom and viewport | `zoomMode`, `zoomDraft`, `zoomListOpen`, `zoomMarquee`, `viewportMetrics`, `fitZoomToWindow`, `zoomToWindow`, `setFixedZoom`, `commitZoomDraft`, `zoomToSelection`, `zoomAtPoint`, `zoomImagePointToClient`, and the `zoom*Ref` family |
| 6 | `src/hooks/useDockResize.ts` | Splitters | `startDockResize`, `startPadResize` |
| 7 | `src/hooks/useBulkDocumentActions.ts` | Close-all / save-all | `requestCloseAll`, `completeCloseAllStep`, `completeSaveAllStep`, `requestSaveAll`, `requestCloseDocument`, `closeAllQueue`, `saveAllQueue`, `saveAllCount`, `closingDocumentId`, `showCloseAllConfirm` |
| 8 | `src/hooks/usePrintAndScreenshot.ts` | Print + capture | `openPrintDialog`, `captureScreenshot`, `printPreview`, `showScreenshot`, `screenshotBusy`, `screenshotError` |
| 9 | `src/hooks/useAppShortcuts.ts` | Global keyboard | The keydown effect (§6.2) |

Each hook returns an object; `App` calls them in sequence and passes the results into the Phase 2
regions. Extract in the order given — 1 through 4 have no dependencies on the others, and 9 must
be last because it depends on nearly everything.

### 6.1a Status, and the same metric applied

Five of the nine have landed: `useToast` (31 lines), `usePrintAndScreenshot` (103),
`useClipboardBridge` (134), `useBulkDocumentActions` (132) and `useViewportZoom` (369). `App.tsx`
is down from 1,741 lines to 1,429. `useFileCommands` and `usePaletteFiles` went into
`src/editor/` instead, next to the editor state they drive.

The §8.2a pass-through count works here too, and it is what made `useViewportZoom` worth doing:

| Group | Lines moved | References outside the group | Ratio |
| --- | ---: | ---: | ---: |
| `useViewportZoom` | 284 | 29 of 134 | **22%** |

Nine of its refs — `panRef`, `zoomDragRef`, `zoomRef`, `renderedZoomRef`, `zoomAnchorRef`,
`gestureStartZoomRef`, `fittedViewportSizeRef`, `autoFittedDocumentsRef` and the viewport element
itself — had **zero** references outside the group, so extracting made them private rather than
merely relocating them. That is the shape worth looking for: not "how many lines move" but "how
much of this stops being visible to everything else".

Row 5 in the table above lists `zoomDraft`, `zoomListOpen` and `commitZoomDraft` as members. They
do not exist; the status-bar zoom control is not a draft-and-commit combo in the current UI. The
hook owns what is actually there.

### 6.2 The keydown effect

Lines 3438–3708: **270 lines with a 42-entry dependency array**. It is the single worst piece of
code in the file, and it is worth understanding *why* before touching it.

> **Measured correction, 30 August 2026.** The premise below is wrong, and acting on it costs work
> for nothing. The claim is that most of those dependencies exist only so `modalOpen` can test every
> dialog flag. They do not: **all 16 of the flags are also read by the Escape branch**, which closes
> whichever dialog is open, so hoisting `modalOpen` removes none of them. It was tried — the array
> went from 49 entries to 50, the extra being the hoisted boolean itself — and reverted.
>
> Two things were learned that outlive the attempt. Three of the terms in `modalOpen`
> (`primaryDialogs.dialog`, `.effectDialog`, `.showSaveAs`) and `auxiliaryDialogRef` are **ref reads
> inside the handler, not React state**. Hoisting those to render time would have been a real bug:
> a dialog opened since the last render would stop suppressing shortcuts, so a keystroke would fire
> straight through it. TypeScript caught the first three; the fourth had to be reasoned about.
>
> Step 2 below is therefore struck. The thing to attack is the Escape branch's per-dialog closing,
> and that was done: it is now `closeTopmostDialog`, a `useCallback` holding the 31 names the chain
> needs, and the effect takes one. **The handler went from 49 dependencies to 40 and from 428 lines
> to 332.** Nine of the sixteen flags left the effect entirely; the other seven are read by other
> branches too, which is the same reason the `modalOpen` hoist failed.
>
> Naming it was worth as much as shrinking it. The order of that chain is a contract — a
> confirmation raised by another dialog has to close before the dialog that raised it — and several
> arms undo work rather than hiding a panel: a running effect is cancelled, a layer preview cleared,
> the colour wells put back. None of that was stated anywhere before.
>
> What remains is the 332-line handler with 40 dependencies, and extracting *that* is still a pure
> relocation: all 40 are used elsewhere in `App`, so a `useAppShortcuts` hook would take a 40-field
> options object and hide nothing. By the §8.2a rule that is the shape to leave alone, and it is
> left alone until something changes the number.

Most of those 42 dependencies exist for one reason: the handler computes `modalOpen` by testing
every dialog flag individually, so it must re-subscribe whenever any of them changes.

Fix it in this order, as three separate commits:

1. **Move it verbatim** into `useAppShortcuts.ts`, dependency array intact. Pure move; gate; commit.
2. **Hoist `modalOpen` to a computed boolean** passed in as one prop. The dependency array loses
   ~18 entries immediately and the handler stops re-subscribing on every dialog toggle.
3. **Route the command dispatch through a stable ref.** Store the command map in a
   `useRef` updated by a separate effect, so the listener itself depends only on `[]` and is
   attached once for the session.

Step 3 is a real behaviour change in one respect — the listener is no longer torn down and
recreated — so it needs the keyboard-heavy e2e tests run explicitly:

```bash
npx playwright test --config=playwright.e2e.config.ts -g "shortcut|keyboard|undo|redo"
```

If §5.2's discriminated union has already landed, step 2 is nearly free.

### 6.3 Expected state after Phase 3

`App.tsx` is **~250 lines**: imports, the hook calls, and the composed JSX shell.

---

## 7. Phase 4 — `usePaintEditor.ts`: extract the module-level helpers

**Removes ~2,000 lines. Risk: very low. 9 commits.**

Lines 1–2212 hold **99 module-level functions with no hook coupling at all** — they take canvases,
`ImageData`, and plain values. This is the same extraction already done successfully for
`geometry.ts`, `historyBudget.ts`, `selectionMorphology.ts`, and `surfaceDiff.ts`, and it is the
highest value-to-risk ratio in this entire plan.

### 7.1 The extraction table

| # | Target file | Lines | Contents |
| --: | --- | ---: | --- |
| 1 | `src/editor/canvasUtils.ts` | ~90 | `makeCanvas`, `cloneCanvas`, `canvasesHaveSamePixels`, `imageDataCanvas`, `imageDataEqual`, `makeId`, `clampByte`, `colorToRgba`, `rgbaToHex` |
| 2 | `src/editor/exportFormats.ts` | ~200 | `exportFormatFromFileName`, `exportExtension`, `exportMimeType`, `canvasBlob`, `writeExportBlob`, `canvasPngBytes`, `bytesBlob`, `createDocumentExportBlob`, `drawPngBytes`, `openRasterArchive`, `createOpenRasterArchive`, `decodeImageFile` |
| 3 | `src/editor/workspaceSerialization.ts` | ~280 | The 15 `persisted*Of` / `*FromPersisted` functions plus `documentTabOf` |
| 4 | `src/editor/layerSnapshots.ts` | ~120 | `snapshotOf`, `deduplicateHistoryPixels`, `snapshotSelection`, `selectionFromSnapshot`, `layerFromSnapshot`, `paintLayer`, `makeLayer`, `floatingPixelsFromSnapshot`, `snapshotFloatingPixels`, `drawFloatingPixels` |
| 5 | `src/editor/selectionGeometry.ts` | ~230 | `normalizeSelection`, `selectionHandlePoints`, `isResizableSelection`, `selectionResizeHandleAtPoint`, `constrainSelectionPoint`, `resizeSelection`, `selectionBoundaryOf`, `transformSelection` |
| 6 | `src/editor/selectionMasks.ts` | ~260 | `createSelectionMask`, `copySelectionToCanvas`, `selectionMaskOnCanvas`, `constrainCanvasMutationToSelection`, `selectionFromMask`, `combineSelectionMasks`, `selectionMarchingPattern`, `selectionOverlayScratch`, `drawSelectionOverlay` |
| 7 | `src/editor/colorMatching.ts` | ~150 | `colorDifferenceWithinTolerance`, `floodTolerance`, `recolorColorTolerance`, `magicWandSelection`, `floodFill`, `sampleCanvasColor`, `getAnchorOffset` |
| 8 | `src/editor/shapeRendering.ts` | ~380 | `shapeDashPattern`, `configureShape`, `strokeAndFillShape`, `traceCardinalCurve`, `drawArrowHead`, `drawEditableLine`, `drawEditableShape`, `rectangularControlPoints`, `moveRectangularControlPoint`, `drawFreeformShape`, `removeAntialiasing`, `constrainLinePoint`, `constrainShapePoint`, `distanceToSegment`, `distanceToLineDraft`, `distanceToShapeDraft`, `isRenderableLineDraft`, `isRenderableShapeDraft`, `drawRoundedRect`, `drawShape` |
| 9 | `src/editor/brushRendering.ts` | ~290 | `configureStroke`, `drawPaintBrushSegment`, `gradientAmount`, `drawGradientPixels`, `renderGradientDraftToLayer`, `applyTextVariant`, `textEditorBounds`, `drawTextEditor` |

### 7.2 Write tests as you extract

Unlike Phase 1, these extractions **make previously untestable logic testable**, and that is most of
the point. Every one of the four modules already extracted this way found a real defect or a real
coverage hole:

- `zoom.ts` → `zoomOutLevel` returned its input unclamped.
- `historyPixels.ts` → per-node depth tracking was unsound.
- `selectionMorphology.ts` → the grow/shrink path had **no test anywhere**.
- `geometry.ts` → transform composition was only reachable through the UI.

So for each extraction, add `tests/unit/<module>.test.ts` **in the same commit**. Concretely:

| Module | Properties worth asserting |
| --- | --- |
| `canvasUtils` | `imageDataEqual` on identical/differing/differently-sized buffers; `rgbaToHex` round-trips `colorToRgba`; `clampByte` at −1, 0, 255, 256 |
| `exportFormats` | Extension↔MIME↔format agree for all nine formats; unknown extensions fall back rather than throwing |
| `selectionGeometry` | Normalisation is drag-direction independent; sizes never negative; handle hit-testing at each of the eight handles |
| `selectionMasks` | Union/intersect/subtract/xor against small ASCII masks |
| `colorMatching` | Tolerance boundaries at 0 and 100; flood fill on a closed region does not leak |
| `shapeRendering` | `distanceToSegment` for endpoints, midpoint, and perpendicular cases; `traceCardinalCurve` passes through its control points |

Note `jsdom` has no canvas backend. Anything that genuinely rasterises stays in Playwright; assert
the pure decisions (bounds, distances, tolerances, format mapping) and leave pixels to the browser.
`tests/unit/setup.ts` already polyfills `ImageData` for the rest.

### 7.3 Import-cycle warning

`usePaintEditor.ts` will import all nine modules. **None of them may import `usePaintEditor.ts`.**
If one appears to need a type from it (`Selection`, `FloatingPixelsState`, `TransformGesture` are
currently declared there), move that type into `src/editor/types.ts` in a preceding commit. Types
belong with the model, not with the hook that happens to use them.

After the phase, verify no cycles. TypeScript compiles cyclic imports happily, so this needs a
separate tool — `madge` is not a dependency, and `npx` fetches it on demand:

```bash
npx --yes madge --circular --extensions ts,tsx src/
```

The failure mode a cycle produces here is not a build error but an `undefined` import at module
initialisation, which surfaces as a runtime crash on first use — worth checking explicitly rather
than trusting the compiler.

---

## 8. Phase 5 — `usePaintEditor.ts`: split the hook body

**Removes ~2,700 lines. Risk: high. 12 commits. Do this last.**

The hook body is lines 2213–5573: 3,361 lines, 262 declarations, 162 `useCallback`, and **66 refs
shared across every concern**. This is the hardest part of the plan, and it is legitimate to stop
after Phase 4 — a 2,900-line hook made entirely of coordination is a substantially better place
than a 5,572-line one that also contains all the drawing code.

### 8.1 The technique

> **Measured correction.** The omnibus `EditorRefs` object below is heavier than the code needs.
> Counting what each group actually touches: `useImageCommands` reads **3** refs,
> `useLayerCommands` **5**, `useSelectionCommands` **8**, `useEffectRunner` **9** — not 66. Every
> sub-hook extracted in this work takes an explicit dependency object naming exactly what it uses.
>
> That is not tidiness. `useSelectionCommands` needs six refs *plus* the live selection, the active
> layer, the primary colour and `newDocumentFromCanvas` — which is the statement of how far copy
> and paste reach across the editor. An `EditorRefs` parameter would have hidden precisely the
> thing the extraction exists to reveal. Keep the paragraph below for the reasoning about refs
> versus state; ignore the single-object prescription.

The refs are what make naive extraction impossible: pointer handlers read current values
synchronously, and every sub-hook needs the same ones. Do **not** try to give each sub-hook its own
state — that reintroduces the staleness the refs exist to prevent.

Instead, create the refs once and pass them down as one object:

```ts
// src/editor/editorRefs.ts
export interface EditorRefs {
  layersRef: MutableRefObject<PaintLayer[]>;
  activeLayerIdRef: MutableRefObject<string>;
  selectionRef: MutableRefObject<Selection | null>;
  historyRef: MutableRefObject<HistorySnapshot[]>;
  historyIndexRef: MutableRefObject<number>;
  dimensionsRef: MutableRefObject<{ width: number; height: number }>;
  /* … all 66 … */
}

export function useEditorRefs(): EditorRefs { /* one useRef per field */ }
```

Each sub-hook then has the shape:

```ts
export function useLayerCommands(refs: EditorRefs, pushHistory: PushHistory) {
  const addLayer = useCallback(/* verbatim */, [refs, pushHistory]);
  /* … */
  return { addLayer, deleteLayer, duplicateLayer, mergeLayerDown, moveLayer, /* … */ };
}
```

`usePaintEditor` becomes: create refs, call sub-hooks in dependency order, assemble the same
204-key return object. **The public surface does not change** — that is what keeps `App.tsx` and
the entire test suite valid throughout.

### 8.2 The extraction table, in dependency order

| # | Target hook | Lines | Depends on | Members |
| --: | --- | ---: | --- | --- |
| 1 | `useToolSettings.ts` | ~50 | preferences only | The 47 trivial setters at 2258–2304 |
| 2 | `usePaletteState.ts` | ~40 | refs | `swapColors`, `replacePalette`, `resetPalette`, `resizePalette`, `setPaletteColor`, `addPaletteColor` |
| 3 | `useDocumentSessions.ts` | ~310 | refs | `updateSelection`, `updateFloatingPixels`, `setLayerList`, `setActiveLayerId`, `setDimensions`, `setHistoryIndex`, `setActiveDocumentId`, `publishDocumentTabs`, `resetTransientDocumentState`, `captureActiveDocument`, `loadDocument`, `clearActiveDocument`, `switchDocument` |
| 4 | `useWorkspacePersistence.ts` | ~120 | 3 | `sampleStoragePressure`, `persistWorkspaceNow`, the restore effect, the debounced save effect |
| 5 | `useHistory.ts` | ~130 | 3 | `pushHistory`, `restoreHistory`, `undo`, `redo`, `renderComposite` |
| 6 | `useLayerCommands.ts` | ~240 | 5 | `activeLayer` through `updateLayerProperties` (18 callbacks, 3614–3855) |
| 7 | `useSelectionCommands.ts` | ~220 | 5 | `selectAll` through `offsetSelection` (3855–4078) |
| 8 | `useImageCommands.ts` | ~145 | 5 | `cropToSelection`, `autoCropImage`, `resizeImage`, `resizeCanvas`, `flipImage`, `rotateImage`, `clearActiveLayer` |
| 9 | `useShapeDrafts.ts` | ~255 | 5 | `currentShapeOptions` through `finalizeShapeDrafts` (2928–3183) |
| 10 | `useTextEditing.ts` | ~180 | 5 | `cancelText`, `commitText`, `beginText`, `beginReeditingText`, `updateText`, `moveText`, `commitFloatingPixels`, `commitPendingEdits` |
| 11 | `useEffectRunner.ts` | ~190 | 5 | `effectParametersFor`, `clearEffectPreview`, `getActiveHistogram`, `previewEffect`, `applyEffect`, `cancelEffect` |
| 12 | `useFileCommands.ts` | ~220 | 3, 5 | `newDocument`, `newDocumentFromCanvas`, `openFile`, `saveImage`, `saveAllImages`, `createCompositeDataUrl`, `closeDocument`, `closeAllDocuments` |

### 8.2a What was extracted, and the number that predicts whether it is worth it

Seven of the twelve landed. The one that decides each case is **how many of a group's members are
referenced elsewhere in the hook** rather than flowing straight to the return object. A member the
body still uses has to be destructured back in, so the file gets the block removed and a
declaration added, and nets almost nothing.

| Sub-hook | Lines moved | Members used elsewhere | Refs | Net effect |
| --- | ---: | --- | ---: | --- |
| `usePaletteState` | 36 | 0 of 6 | 0 | done |
| `useImageCommands` | 142 | 0 of 7 | 3 | done |
| `useEffectRunner` | 189 | 0 of 6 | 9 | done |
| `useLayerCommands` | 240 | 1 of 16 | 5 | done |
| `useSelectionCommands` | 222 | 1 of 14 | 8 | done |
| `useFileCommands` | 215 | 1 of 8 | 10 | done |
| `useToolSettings` | 97 | **85 of 89** | 0 | done, but **netted 10 lines** |
| `useShapeDrafts` | 214 | **9 of 21** | 13 | **not done** |
| `useTextEditing` | 166 | **5 of 9** | 15 | **not done** |
| `useHistory` | 112 | 2 of 5, but `pushHistory` is called by nearly every command | 19 | **not done** |
| `useDocumentSessions` | ~310 | `updateSelection`, `setLayerList` and friends are used throughout | many | **not done** |
| `useWorkspacePersistence` | ~120 | depends on the sessions hook above | many | **not done** |

`useToolSettings` is the cautionary case and worth keeping: 97 lines left and an 89-name
destructure came back, for a net saving of ten. It was still worth doing — the setters are now
isolated and the per-tool scoping is legible in one place — but it is not what the phase is for.

The five not done are all of that shape or worse. Extracting `useShapeDrafts` would move 214 lines
out, bring most of a 21-name destructure back, and thread 13 refs through a parameter list, leaving
a file the same length that now has to be read alongside another to follow a single stroke. That is
a worse outcome than leaving it, so it was left. **Do not treat those five rows as remaining work
without re-measuring**; if the pointer dispatch is ever restructured (§8.3) the numbers change and
the question is worth reopening.

### 8.3 The pointer dispatch stays put — deliberately

`onPointerDown` is **403 lines** (4659–5062), `onPointerMove` 130, `onPointerUp` 129. Together with
`drawStroke` (114) and `nudgeTransform` (41) they are ~820 lines of tool dispatch, and they read
essentially every ref in the editor.

**Leave them in `usePaintEditor.ts` during Phase 5.** They are the one place where the refactor
could plausibly break drawing, and drawing is the product.

If you want to tackle them afterwards, the right shape is a **per-tool strategy table**, not more
hooks:

```ts
// src/editor/tools/handlers.ts
interface ToolHandler {
  onPointerDown?(context: ToolContext, event: ToolPointerEvent): void;
  onPointerMove?(context: ToolContext, event: ToolPointerEvent): void;
  onPointerUp?(context: ToolContext, event: ToolPointerEvent): void;
}

export const TOOL_HANDLERS: Partial<Record<ToolId, ToolHandler>> = { /* … */ };
```

That mirrors how native Pinta is organised (`Pinta.Tools/Tools/*.cs`, one class per tool) and would
close a genuine structural parity gap. Do it **one tool at a time**, each with its own commit and
its own visual baseline check, starting with the simplest (`pan`, `zoom`, `color-picker`) and
leaving `move-pixels` and the shape tools for last.

Budget this as its own project. It is roughly the size of Phases 1–4 combined.

### 8.4 Why ~600 lines is not reachable this way

The prediction in §3 assumed the hook is a stack of separable concerns. Measured, it is a stack of
separable *commands* sitting on a shared spine: history, document sessions, drafts and text
editing all feed the pointer handlers and each other, and `pushHistory` alone is called from
nearly every command in the file.

The commands came out cleanly and took about 1,050 lines with them. What remains is roughly 800
lines of that spine, ~820 lines of pointer dispatch, and the assembly of the 204-key return
object. Getting near 600 needs the pointer work in §8.3, not more sub-hooks.

---

## 9. Phase 6 — `processor.ts`: split by category

**Removes ~2,700 lines. Risk: low. 8 commits.**

102 functions behind a 168-line `processEffect` dispatcher (line 2763). The effect catalog in
`src/effects/types.ts` already assigns every effect a category, so the split is pre-decided:

| Target file | Category | Effects |
| --- | --- | ---: |
| `src/effects/kernels/adjustments.ts` | `adjustment` + `color` | 11 |
| `src/effects/kernels/blur.ts` | `blur` | 6 |
| `src/effects/kernels/distort.ts` | `distort` | 10 |
| `src/effects/kernels/noise.ts` | `noise` | 4 |
| `src/effects/kernels/artistic.ts` | `artistic` | 3 |
| `src/effects/kernels/photo.ts` | `photo` | 5 |
| `src/effects/kernels/render.ts` | `render` | 7 |
| `src/effects/kernels/stylize.ts` | `stylize` | 6 |
| `src/effects/kernels/objects.ts` | `object` | 3 |
| `src/effects/kernels/shared.ts` | — | `processLocalHistogram` (155), `nativeWarpSample` (61), `processWarp` (49) and other cross-category primitives |

`processor.ts` keeps only the dispatcher and re-exports `processEffect`, so
`effects.worker.ts` and `effects/client.ts` are untouched.

### 9.1 Do `shared.ts` first

`processLocalHistogram` is used by Median, Reduce Noise, Unfocus, Outline Object and others across
category boundaries; `nativeWarpSample` and `processWarp` back most of the distortions. Extract
those **before** the categories, or every subsequent step will fight over them.

### 9.2 The fixtures are the safety net

`tests/unit/effects.test.ts` holds **83 byte-level assertions** generated from an independent C#
transcription of the native `Render` methods. A pure move keeps every one of them green.

```bash
npm run verify:effects   # aliases the same suite
```

**If a fixture fails, you changed a kernel.** Revert; do not regenerate the fixture. Those values
come from the original implementation and regenerating them from this one would silently destroy
the parity they exist to protect.

---

## 10. Phase 7 — `styles.css`: split into an import manifest — **ABANDONED, with evidence**

**Removes ~5,800 lines. Risk: low, but verify carefully. 12 commits.**

> **Attempted and reverted.** The split below was built exactly as described — eleven family
> files, `styles.css` reduced to a 16-line manifest, import order mirroring the original
> top-to-bottom order — and it **failed 95 of the 189 visual baselines**.
>
> The failures were layout, not colour: effect dialogs rendered 430px wide instead of 310px,
> because a narrowing rule that previously came later now loads before the general
> `.pinta-dialog { width: min(430px, …) }`.
>
> The cause is measurable and fatal to the approach. The stylesheet's families are **interleaved
> across 159 contiguous runs** of 767 top-level blocks. There is no grouping of those runs that
> preserves the original order, so *any* family split reorders specificity-equal rules, and this
> stylesheet depends on that order in at least ninety places.
>
> Two alternatives were considered and rejected:
>
> - **Update the baselines.** Forbidden by R2, and correctly so — these were real rendering
>   changes, not noise.
> - **Split positionally instead**, cutting at block boundaries so order is preserved byte for
>   byte. This is completely safe and meets the "nothing above 700 lines" target, but it puts
>   `.canvas-*` rules in files 4 and 8 and helps nobody find anything. Smaller files that are
>   harder to navigate are not an improvement.
>
> Making this phase work needs the stylesheet's rules reordered so families *are* contiguous,
> one verified move at a time, with the visual suite after each. That is a different and much
> larger project than an extraction, and it should be planned as one rather than smuggled in
> here.
>
> `styles.css` stays at 5,854 lines. Everything below is the original plan, kept for whoever
> takes that on.

One 5,848-line stylesheet with only 5 comment markers and 12 media queries. Split by selector
family into `src/styles/`, with `styles.css` reduced to an ordered manifest:

```css
/* src/styles.css — order is significant; see §10.1 */
@import './styles/tokens.css';
@import './styles/base.css';
@import './styles/chrome.css';
@import './styles/toolbox.css';
@import './styles/canvas.css';
@import './styles/docks.css';
@import './styles/statusbar.css';
@import './styles/dialogs.css';
@import './styles/effects.css';
@import './styles/color.css';
@import './styles/addins.css';
@import './styles/about.css';
@import './styles/responsive.css';
@import './styles/print.css';
```

Selector families, by count of top-level rules at `HEAD`:

| File | Families | Rules |
| --- | --- | ---: |
| `dialogs.css` | `.native-*` (164), `.dialog-*` (27) | ~191 |
| `color.css` | `.color-*` (61) | ~61 |
| `addins.css` | `.addin-*` (54) | ~54 |
| `effects.css` | `.levels-*` (35), `.curves-*` (17), `.effect-*` (24) | ~76 |
| `about.css` | `.about-*` (32) | ~32 |
| `canvas.css` | `.canvas-*` (27), `.zoom-*` (11) | ~38 |
| `docks.css` | `.dock-*` (22), `.layer-*` (24), `.history-*` (8) | ~54 |
| `chrome.css` | `.macos-*` (13), `.menu-*` (9), `.document-*` (15), `.tool-*` (14) | ~51 |
| `print.css` | `.print-*` (18) + the `@media print` block | ~19 |

### 10.1 Two rules that matter more than usual here

**Order is behaviour.** CSS cascade means moving a rule past another with equal specificity changes
rendering. Preserve the original relative order within and across files — the manifest order above
mirrors the current top-to-bottom order of the file.

**Move the media queries with their subjects.** The 12 `@media` blocks currently sit at scattered
line offsets (925, 1430, 1451, 2137, 3538, 3761, 5548, 5579, 5630, 5657, 5759, 5799). A block that
overrides `.canvas-*` belongs in `canvas.css` immediately after those rules — not in a
`responsive.css` catch-all, which would place it after unrelated later files and change which rule
wins. `responsive.css` should hold only the four global breakpoints at 5548–5758 that cut across
every family, and `print.css` the `@media print` block at 5799.

### 10.2 Verification is entirely visual

TypeScript cannot help here. The 194 baselines are the only check:

```bash
npm run test:visual
```

Run it after **every** file split, not at the end of the phase. A cascade regression discovered
after twelve moves is a bisect; discovered after one, it is obvious. This is the phase where R2
earns its place.

---

## 11. The inventory script

Re-derive every table above at any time. Save as `scripts/inventory.mjs` if it proves useful:

```js
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const lines = readFileSync(path, 'utf8').split('\n');
const pattern = /^(?:export default |export )?(?:async )?(function|const|interface|type)\s+([A-Za-z0-9_]+)/;

const declarations = [];
lines.forEach((line, index) => {
  const match = pattern.exec(line);
  if (match) declarations.push({ line: index + 1, kind: match[1], name: match[2] });
});
declarations.push({ line: lines.length + 1, kind: '', name: '<eof>' });

const sized = declarations
  .slice(0, -1)
  .map((entry, index) => ({ ...entry, size: declarations[index + 1].line - entry.line }))
  .sort((a, b) => b.size - a.size);

console.log(`${path}: ${lines.length} lines, ${sized.length} top-level declarations\n`);
for (const { name, kind, line, size } of sized) {
  console.log(`${String(size).padStart(6)}  ${String(line).padStart(5)}  ${kind.padEnd(9)} ${name}`);
}
```

```bash
node scripts/inventory.mjs src/App.tsx | head -30
```

---

## 12. Sequencing and effort

| Phase | Target | Risk | Predicted | **Actual** |
| --- | --- | --- | ---: | --- |
| 0 | Preconditions | — | 0 | done |
| 1 | `App.tsx` components | very low | 2,326 | **done**, 2,481 moved |
| 2 | `App.tsx` JSX regions | low | ~900 | **done**, 1,291 moved |
| 3 | `App.tsx` logic hooks | medium | ~1,300 | **4 of 9**, ~400 moved |
| 4 | `usePaintEditor` helpers | very low | ~2,000 | **done**, ~2,000 moved |
| 5 | `usePaintEditor` hook body | high | ~2,700 | **7 of 12**, ~1,050 moved — see §8.2a |
| 6 | `processor.ts` kernels | low | ~2,700 | **done**, 2,717 moved |
| 7 | `styles.css` | low | ~5,800 | **abandoned** — see §10 |

Three of the seven splits this plan proposed did not survive their dependency graphs, all in the
same way: the grouping looked obvious from the catalog or the file's own naming, and the code
disagreed.

- **Selection geometry vs masks** (§7.1 steps 5 and 6) — the masks need `normalizeSelection` and the
  geometry needs `createSelectionMask`. One module.
- **Shape vs brush rendering** (steps 8 and 9) — the shape helpers call `drawGradientPixels`. One
  module.
- **Effect kernels by category** (§9) — the plan called this "pre-decided" because every effect has
  a category, but **50 of the 89 declarations are shared helpers with no category at all**. Seeded
  from the catalog, then grown by actual references.

The lesson generalises: check the dependency graph before trusting a split, and expect the file's
own vocabulary to be a worse guide than its imports.

**If you only do part of this, do Phases 1, 4, and 6.** That advice held: they carried the lowest
risk, moved ~7,200 lines, and Phase 4 was indeed the one that converted untestable code into tested
code — 90 of the 264 unit tests came from it, and writing them corrected four contracts that had
been assumed rather than read.

Phases 2, 3, and 5 are where judgement is required, and that also held, though not where expected.
The expensive judgement was not in any single extraction; it was in deciding which extractions were
worth making at all (§8.2a) and which were unsafe (§10).

Phases 1–3 and Phase 4–5 touch disjoint files, so they can proceed in parallel by different people.
Phases 6 and 7 are independent of everything.

---

## 12a. Linting and formatting

ESLint landed alongside Phase 1 and is wired into both workflows:

```bash
npm run lint          # tsc -b, unchanged
npm run lint:eslint   # the complementary check
```

The rule set is deliberately small, because a config reporting hundreds of pre-existing problems
gets ignored. Two rules earn their place for this plan specifically:

- **`import-x/no-cycle`** (error) — §7.3's failure mode. TypeScript compiles cycles happily; they
  surface as an `undefined` import at module initialisation. This makes the `madge` step in §7.3
  redundant.
- **`react-hooks/exhaustive-deps`** (error since 29 August 2026, previously a warning) — the 45
  warnings are gone; the dependency arrays are filled in. They were warnings because acting on
  them changes behaviour, so each was treated as a question rather than a defect, and none were
  answered inside a move commit.
- **`@typescript-eslint/no-unused-vars`** (error since 29 August 2026) — this was `off`, carrying a
  comment that TypeScript already reported unused locals. It did not: `noUnusedLocals` is set in no
  tsconfig, so nothing was checking at all. Enabling it found **358 dead bindings in `src/`**, the
  large majority unused imports left behind by the extractions in this plan — `processor.ts` alone
  still imported 61 kernel symbols it had stopped calling after Phase 6 split them out.

  The cleanup needed four passes to reach a fixpoint, because each round of removals exposes the
  next. Two lessons worth carrying: a script that edits import specifiers must handle
  `X as Y` aliases (one mangled specifier merged three React event types into a single
  ungrammatical line), and when the last specifier of an import goes, the whole statement goes with
  it — so check first whether that module was doing anything on import. Here exactly one was:
  `src/i18n/index.ts` calls `i18n.init` at module scope, and it survived because `App.tsx` still
  imports it directly.

**Prettier was applied on 29 August 2026**, as a single isolated commit, once the move commits
were done — which is what the plan below asked for. It rewrote **124 files**, and `format:check`
now runs in CI so the formatting cannot drift again.

Two exclusions were added to `.prettierignore` rather than accepting the churn:

- **`*.html`** — the localized pages are written by `scripts/generate-seo-locales.mjs`, and
  `npm run verify:seo` regenerates and compares them. Formatting them here would fail that check
  on the next run.
- **`*.md`** — prose is wrapped deliberately. Reformatting to `printWidth` reflows every
  paragraph and buries the actual edits in a document's history.

The one real risk was `styles.css`, where the plan noted the visual suite is the only safety net.
It held: 163 lines changed there and **all 189 baselines passed unchanged**. Prettier reorders
declarations within a rule but never reorders the rules themselves, so the cascade — the thing
that defeated the Phase 7 split — is untouched.

---

## 13. What not to do

Specific to this codebase, and each one is a mistake somebody will be tempted to make.

**Do not "fix" an effect kernel while moving it.** They are transcriptions of C#, down to integer
overflow and fixed-point rounding. The 83 fixtures will catch it — treat that as the system
working, not as a fixture that needs updating.

**Do not convert refs to state in `usePaintEditor`.** All 66 exist because pointer handlers need
values synchronously. Converting one to state introduces a one-frame lag that shows up as dropped
input under fast drawing — the hardest class of bug to reproduce and the easiest to ship.

**Do not add React context for the editor object.** See §5.1. It re-renders every consumer on every
editor change, which is the exact problem the current design avoids.

**Do not create `components/index.ts`.** See R4.

**Do not extract `App`'s three hidden `<input type="file">` elements.** They are bound to refs and
their position in the DOM matters for the file-picker flows. Leave them in the shell.

**Do not split `styles.css` by page or by component.** Split by selector family, matching the
cascade order that already exists. Component-scoped CSS would require touching every rule, which is
no longer a move.

**Do not update a visual baseline during this work.** Under R2 a changed baseline means a failed
extraction, without exception. The moment you allow one exception, the safety net is gone for every
remaining step.
