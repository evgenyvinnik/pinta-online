# Reliability work queue

Pinta Online is an editor people keep unsaved work in. The failure that matters is not a wrong
pixel — it is losing a drawing, or being unable to reach one. This plan is ordered by blast
radius: what can take the whole application down, then what can silently rot, then what can
exhaust the browser.

## The headline problem, measured

There is no React error boundary anywhere in `src/`. A throw during render therefore unmounts the
entire tree. Confirmed by injecting a render-time throw behind a URL flag and observing the result:

| Observation | Value |
| --- | --- |
| `#root` child elements | **0** |
| `.app-shell` present | no |
| Error dialog present | no |
| Visible page text | *(empty)* |

The `window.error` listener in [`src/App.tsx`](../src/App.tsx) does fire, but `showError` is state
owned by the component that just unmounted, so nothing renders. The user sees a blank white page.

The severe case is a **poison pill**: if the throw is triggered by restored workspace state, every
reload replays it — restore, crash, blank page — and the artwork becomes unreachable through the
UI even though it is still sitting in IndexedDB.

## What is already solid

Worth stating so this plan does not re-solve it.

- The effects worker self-heals. `onerror` terminates and rejects every pending request, and the
  next call reconstructs the worker ([`src/effects/client.ts`](../src/effects/client.ts)).
- Workspace restore is per-document fault tolerant — `Promise.allSettled` plus a `flatMap` means
  one corrupt document is skipped rather than aborting the whole restore.
- Every IndexedDB operation has an explicit `onerror` / `onabort` path with a readable message.
- File import already reports per-file failures without discarding the files that did open.
- `window.error` and `window.unhandledrejection` are both handled, which is more than most apps do.

---

## Phase 1 — Contain render failures

**Effort S · highest blast radius**

An error boundary is roughly forty lines and converts "blank page, work unreachable" into "one
panel failed, everything else still works".

### Do this

1. **Add a root boundary** that renders Pinta's existing error shell instead of the tree. It must
   own its own state so it survives the failure it is reporting — do not route it through
   `showError`, which lives in the tree that just died.
2. **Add inner boundaries** around the three regions that can fail independently: the canvas
   viewport, the Layers/History dock, and the active dialog. A dialog that throws should close and
   report, not take the canvas with it.
3. **Offer a recovery path, not just an apology.** The boundary should present:
   - *Reload* — the common case, a transient failure.
   - *Reload without restoring the workspace* — the poison-pill escape. Set a flag that makes the
     next boot skip restore, so a document that crashes on load stops being fatal.
   - *Download a copy* — read the layer blobs straight from IndexedDB and save a PNG, so the work
     is recoverable even when the UI that would export it is the thing that is broken.
4. **Record the boundary in the parity docs** as a browser-specific surface with no native
   counterpart, alongside the existing error-shell row.

### Test it

An e2e test that forces a render throw behind a query flag, asserts the shell appears with a
readable message, and asserts the recovery buttons work — including that "reload without
restoring" actually boots.

---

## Phase 2 — Make failures visible

**Effort S · currently zero signal**

Two blind spots compound each other: tests do not notice thrown errors, and production does not
report them.

### Tests ignore page errors

No Playwright spec listens to `pageerror` or `console`. A test can drive a flow that throws in a
`useEffect`, never assert on it, and pass. Given the suite is 84 e2e tests wide, that is a lot of
surface where a real error could hide.

Add a shared fixture that fails any test whose page emitted an uncaught error or a `console.error`,
with a short allowlist for the two known-benign ones (the `willReadFrequently` canvas hint, and
whatever a deliberate negative-path test provokes). Wire it once in `tests/e2e` and `tests/visual`
rather than per spec.

### Production reports nothing

`web-assets/analytics.js` sends pageviews to GA and nothing else. There is no error reporting, so
a crash affecting every Safari user would be invisible.

The cheapest useful step, given GA is already loaded and consented to: send an `exception` event
from the existing `window.error` and `unhandledrejection` handlers and from the new boundary, with
the message and a coarse tag (`render`, `worker`, `persistence`, `codec`). No new dependency, no
new vendor, no personal data — deliberately not the stack trace, which can carry file paths.

---

## Phase 3 — Add the missing test layer

**Effort M · no fast tests exist today**

The project has Playwright (84 e2e, 187 visual) and six hand-rolled `verify:*` scripts that boot
Vite SSR and use `node:assert`. There is **no unit test runner**. Every pure function is either
tested through a browser or not at all.

That has two costs: the feedback loop for logic changes is a full build plus a browser, and whole
categories of logic have no coverage because writing an e2e test for them is disproportionate.

### Untested pure logic worth covering

| Module | What is untested |
| --- | --- |
| [`src/editor/zoom.ts`](../src/editor/zoom.ts) | Level stepping at and between presets, clamping, `parseZoomPercent` on junk input, `Window` round-tripping |
| [`src/editor/shortcuts.ts`](../src/editor/shortcuts.ts) | Modifier resolution, the `Ctrl`-vs-`Primary` split, tool cycling, `focusedEditorOwnsShortcut` |
| [`src/state/preferences.ts`](../src/state/preferences.ts) | The persistence `merge` — malformed stored JSON, missing keys, the per-tool scoping fallback, the phone sidebar default |
| [`src/editor/usePaintEditor.ts`](../src/editor/usePaintEditor.ts) helpers | `normalizeSelection`, transform composition, `offsetSelectionMask`, blend-mode mapping — currently only reachable through the UI |
| [`src/effects/curves.ts`](../src/effects/curves.ts) | Spline interpolation at endpoints, duplicate control points, single-point curves |
| [`src/editor/palette.ts`](../src/editor/palette.ts) | Covered by `verify:palette`, but as a script rather than a suite |

### Do this

1. Adopt **Vitest** — it reuses the existing Vite config and TypeScript setup, so there is no
   second build pipeline to maintain.
2. Move the six `verify:*` scripts into it over time. They already assert the right things; they
   are just doing it through a bespoke harness that CI partly forgets to run (see Phase 4). Keep
   the `npm run verify:*` names as aliases so the docs and workflows keep working.
3. Write property-style tests where the invariant is clearer than any example — zoom stepping is
   monotonic and idempotent at the ends; selection normalisation always yields non-negative
   dimensions inside the canvas; a preference merge never produces `undefined` for a key with a
   default.

---

## Phase 4 — Close the CI gaps

**Effort S · silent coverage loss**

Three verifiers exist as npm scripts but **run in no workflow at all**:

- `verify:image-codecs`
- `verify:openraster`
- `verify:palette`

They cover the file formats most likely to corrupt someone's work, and nothing runs them
automatically.

Separately, `web-visual.yml`'s path filters omit files that decide whether its own jobs are
meaningful:

| Missing from filters | Consequence |
| --- | --- |
| `tests/e2e/**` | Editing an e2e test does not trigger the workflow that runs e2e tests |
| `playwright.e2e.config.ts` | Same, for its configuration |
| `scripts/run-e2e-tests.mjs` | Same, for its runner |
| `scripts/verify-effects.mjs`, `verify-icons.mjs`, `verify-image-codecs.ts`, `verify-openraster.ts`, `verify-palette.ts` | Changing a verifier does not run it |

### Do this

1. Add the three missing verifiers to `web-visual.yml` and `deploy-pages.yml`.
2. Replace the hand-maintained path list with a broad filter plus explicit ignores
   (`docs/**`, `*.md`, `original/**` except the icon and `po` paths already listed). An allowlist
   that must be edited whenever a file is added will keep drifting out of date — this is the second
   time it has.
3. Consider making the deploy workflow depend on the test workflow. Today `deploy-pages.yml`
   type-checks and runs three verifiers, but never runs the e2e or visual suites, so a red test
   suite does not block a deploy.

---

## Phase 5 — Resource exhaustion

**Effort M · fails on exactly the documents people care about**

### Unbounded history

`pushHistory` appends `[...trimmed, entry]` with no cap, and each entry is a full `ImageData`
snapshot of every layer plus the selection mask. On a 4000 × 3000 image with three layers that is
roughly 144 MB **per undo step**. The thirty-entry cap was deliberately removed — there is an e2e
test asserting history persists "beyond the former thirty-entry limit" — so this is a known
trade for fidelity, not an oversight. It is still the most likely way to kill a tab.

Options, cheapest first:

1. **Budget rather than count.** Keep unlimited history for small documents; start evicting the
   oldest entries once the estimated total crosses a memory budget derived from
   `navigator.deviceMemory` where available. Surface the eviction in the History pad so it is not
   silent.
2. **Store diffs.** Native's `SurfaceDiff` stores only changed rectangles. This is the real fix and
   is already listed in [`parity-plan.md`](parity-plan.md) as a parity item — the two plans agree.

### Storage quota

Nothing anywhere handles `QuotaExceededError`. The workspace writes lossless PNG snapshots of every
layer and history checkpoint for every open document; a few large images will exceed the origin
quota. Today that surfaces as a generic "Failed to save workspace".

Handle it specifically: name the real cause, say which documents are at risk, and offer to reduce
what is persisted (for example, stop persisting history checkpoints while keeping current pixels).
Check `navigator.storage.estimate()` before large writes so the warning arrives before the failure.

### Canvas allocation

There are **110 unchecked `getContext('2d')!` assertions**. `getContext` returns `null` when the
browser refuses the allocation — routine on iOS Safari, which caps total canvas memory per tab, and
this application creates a canvas per layer plus preview, selection, and history surfaces.

Add one guarded helper (`context2d(canvas)`) that throws a typed, explanatory error, and use it
everywhere. That converts an opaque `Cannot read properties of null` into a message naming the
limit — and, combined with Phase 1, into a contained failure rather than a blank page.

---

## Phase 6 — Degrade instead of failing

**Effort S–M**

- **Worker construction has no fallback.** If the module worker cannot be created — a strict CSP,
  a failed chunk fetch offline — every adjustment and effect fails permanently. The processor is
  plain TypeScript with no worker-specific dependency, so it can run on the main thread. Slower
  and it blocks the UI, but a slow Gaussian blur beats none. Gate it behind one retry so the
  fallback is not the normal path.
- **The error modal has no rate limit.** An error thrown from a `requestAnimationFrame` loop or a
  pointer handler fires the global listener on every frame. Deduplicate by message and collapse
  repeats into a count.
- **Not every error deserves a modal.** A browser extension injecting a failing script triggers
  `window.error` today and blocks the application behind a dialog about a problem the user cannot
  act on. Ignore errors with no filename or one outside the app origin.
- **Offline and update paths are untested.** The PWA precaches and there is an e2e test for the
  registration, but none for a stale service worker serving an old bundle against a new IndexedDB
  schema. Add a persistence schema version and a migration path, so an upgrade cannot leave a
  reader unable to parse its own stored workspace.

---

## Suggested order

Phase 1 first, alone — it is small, it is the difference between a contained failure and a lost
drawing, and every later phase is easier to trust once failures are visible rather than fatal.
Phase 2 next, because it tells you whether anything else in this list is actually happening in
production. Then 4 (cheap, restores coverage that already exists), 3, 5, 6.

## Verification

```bash
npm run lint
```

```bash
npm run test:e2e
```

```bash
npm run test:visual
```

Every verifier, including the three that CI currently skips:

```bash
npm run verify:i18n && npm run verify:seo && npm run verify:effects && npm run verify:icons && npm run verify:version && npm run verify:image-codecs && npm run verify:openraster && npm run verify:palette
```
