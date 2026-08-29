# Final polish and parity assessment

> Audit snapshot: 28 August 2026. This document distinguishes behavior that is covered by
> automated tests from visual similarity, deliberate browser boundaries, and work that remains.

## Executive verdict

Pinta Online is a substantial, high-fidelity browser port, but it is not yet an identical
replacement for desktop Pinta.

| Area | Assessment |
| --- | --- |
| Core editing | Strong: all 22 native tools, selections, live marching ants, layers, text, gradients, history, shortcuts, and palette editing |
| Effects | Strong: 46 built-in effects plus 9 optional add-in effects |
| Dialogs | Broad coverage, but screenshot similarity does not prove every native interaction or edge case |
| Reliability | Good beta quality with recovery, migrations, worker fallback, quota handling, and complete history restoration |
| Localization | 30 selectable UI locales, but web-specific strings are fully translated only for French, German, Arabic, and Hebrew |
| SEO and PWA | Implemented: localized pages, sitemap, hreflang, analytics, manifest, icons, and offline worker |
| Browser coverage | Insufficient: automated behavioral testing is Chromium-only |
| Mobile and touch | Partial: pinch behavior exists, but real touch, long-press, and responsive editor workflows remain mostly manual |
| Performance | One meaningful hover budget exists, but it covers only a narrow scenario |
| Architecture | Considerably improved, but the largest React hook remains difficult to maintain |

## What is genuinely accomplished

The web implementation has:

- The complete 22-tool native catalog plus optional Block Brush.
- All 46 native adjustments and effects and nine optional add-in effects.
- Persistent tabs, pixels, selections, drafts, layers, and complete named undo history.
- Native-style shortcuts that override browser defaults where possible.
- Real magic-wand persistence and animated marching ants.
- File-handle integration, clipboard handling, OpenRaster, TIFF, BMP, TGA, PPM, JPEG,
  WebP, and PNG workflows.
- Error boundaries, workspace recovery, versioned IndexedDB migrations, storage-pressure
  warnings, effect cancellation, and worker fallback.
- About pages, a user guide, Google Analytics, a sitemap, reciprocal `hreflang`, structured
  data, PWA metadata, and Evgeny Vinnik attribution.
- 189 Playwright visual tests producing 194 baselines, 93 behavioral browser tests, and more
  than 260 unit tests.

The last remotely tested functional commit at the time of this audit, `83f6624d`, passed the
[Web visual regression workflow](https://github.com/evgenyvinnik/pinta-online/actions/runs/33232860924).
That is meaningful evidence of stability, but the screenshots compare the web application against
approved web baselines. Only 110 baseline names have direct native-reference counterparts; the
remaining dialog audits are substantially manual. The suite protects visual stability, not a
blanket claim of pixel-identical Pinta UI.

## Priority zero: versioning and deployment

At the time of the audit, production served `1.0.260829.32` while `origin/master` contained
`1.0.260829.33`.

The race is caused by two independent deployment paths:

1. [`versioning.yml`](../.github/workflows/versioning.yml) commits the new version and manually
   dispatches deployment.
2. [`deploy-pages.yml`](../.github/workflows/deploy-pages.yml) later deploys the exact commit that
   passed the earlier visual workflow, which still contains the previous version.

The later deployment can therefore overwrite the versioned build. The bot-generated version commit
also receives no new Web visual run when it is pushed with the default GitHub Actions token.

Fix this first. Either derive the displayed version during the tested build, or ensure that the
version bump exists before testing and remove the competing manual deployment. The exact artifact
that passes the complete gate must be the artifact published to GitHub Pages.

## Refactoring status

The refactor has produced major improvements:

- `App.tsx`: approximately 5,428 to **1,429** lines.
- `usePaintEditor.ts`: 5,572 to **2,621** lines.
- `effects/processor.ts`: 2,929 to **196** lines.
- Components and dialog hosting are separated.
- Effect kernels and many editor helpers are in focused modules.

Closed since this document was written:

- ~~Workspace serialization remains inline.~~ Extracted to
  [`workspaceSerialization.ts`](../src/editor/workspaceSerialization.ts) — 15 functions, 254 lines.
- ~~Two effect kernel files remain approximately 799 and 791 lines.~~ Split along the catalog's own
  category boundaries into `blur.ts` (261) and `artistic.ts` (402). Every kernel is now under the
  700-line target: shared 647, pixelOps 595, distortions 530, artistic 402, generators 388,
  blur 261.
- ~~ESLint currently permits 45 warnings.~~ Zero, with every rule at `error`. Two rules were also
  found to be off or misconfigured; see §12a of [`refactoring.md`](refactoring.md) for the 358 dead
  bindings that turned up when `no-unused-vars` was switched on.
- `App.tsx` is down to 22 `useState` and 30 `useCallback`, five of the nine planned hooks having
  landed. `useViewportZoom` was the most recent and the clearest win: 284 lines out, and nine refs
  that had no reader outside the group became private.

Still open:

- `usePaintEditor.ts` holds 67 callbacks and should continue toward sub-hook composition. Seven
  sub-hooks have landed; the remaining five were measured and deliberately left — see §8.2a of
  [`refactoring.md`](refactoring.md), which explains why moving them would make the file longer to
  read rather than shorter.
- `styles.css` remains approximately 5,854 lines. Its split was correctly abandoned after it
  demonstrated cascade regressions; any future split needs an explicit cascade-layer or ordering
  design rather than a mechanical series of imports.

Refactoring should proceed only from a clean, stationary worktree. Pure moves need to remain
separate from behavior changes, and every rendering-related extraction must preserve all approved
visual baselines.

## Reliability gaps

The reliability foundation is strong, but several limits remain:

- `SurfaceDiff` reduces in-memory history cost. IndexedDB persistence no longer throws that away:
  each distinct `PixelNode` is encoded once per save and the same `Blob` instance is reused for
  every step that shares it, so structured clone stores those bytes once. A fifty-step history over
  four layers with one layer being painted used to write 200 PNGs, 150 of them duplicates; it now
  writes 53. What remains is that a save still rewrites the whole record rather than appending —
  the cost is now proportional to distinct pixels rather than to history length, which is the part
  that was exhausting quota.
- ~~Emergency recovery downloads individual layer PNGs, not a reconstructed OpenRaster document.~~
  **Resolved 29 August 2026.** It now writes one `.ora` per open document, so layer names,
  visibility, opacity and blend modes survive the rescue instead of the work arriving as a pile of
  loose images. This was possible without weakening the module's rule against depending on the
  editor or the renderer, because `encodeOpenRasterArchive` is a pure function from stored PNG
  bytes to a zip. The loose-PNG path remains as a fallback for a document whose archive cannot be
  built — a worse copy beats no copy on this code path. `mergedimage.png` is written only for
  single-layer documents, since producing it otherwise would mean compositing.
- ~~During this audit, the full local gate lost its preview server after 78 of 93 browser tests.~~
  **Resolved 29 August 2026.** The cause was `reuseExistingServer: !process.env.CI`. Because the
  `webServer` command rebuilds `dist/`, a server left running from an earlier invocation kept
  serving the previous `index.html`, whose hashed asset names no longer existed — an `ENOENT` on
  the stylesheet followed by `ERR_CONNECTION_REFUSED` across every subsequent test. It reproduced
  at scale during the refactor: **53 false failures in a single run.** Both configs now set
  `reuseExistingServer: false`, and both route the server through
  [`scripts/run-preview-server.mjs`](../scripts/run-preview-server.mjs), which keeps a timestamped
  transcript and an explicit exit reason under `test-results/server-logs/`. Recording the exit
  reason needed `gracefulShutdown` as well: without it Playwright `SIGKILL`s the server's process
  group, so nothing can observe the shutdown.
- Timing measurements taken on a loaded machine are not evidence. During this work an apparent
  large e2e regression was traced through two wrong causes before the real one turned up: swap
  94% full and load average 25–30. The same suite ran in **17.2 minutes** under that pressure and
  **45.7 seconds** once it cleared. A `vitest` run under the same pressure also reported 179 of
  264 tests as the whole suite. Re-measure on a quiet machine before believing any timing delta.
- Codespell previously failed on an effect-coordinate identifier and ran outside the deployment
  gate. The identifier has since been corrected, and spelling is now a dependency of the release
  workflow. See the historical
  [Codespell run](https://github.com/evgenyvinnik/pinta-online/actions/runs/33232860949).
- Firefox is now a gate alongside Chromium; WebKit is measured but not gating. Running the
  behavioural suite unmodified on 29 August 2026 gave **Firefox 83/93** and **WebKit 54/93**.
  Firefox now passes **92, with 1 skipped and none failing**. WebKit is **61/93** after the same
  fixes — they helped, but not the way they helped Firefox, so its remaining 32 are mostly
  different causes and not yet analysed. They spread across the docked tool windows, the icon and
  text flyouts, add-in registration, icon loading, storage pressure, text engines, and gradients,
  which is a body of work rather than a last mile. WebKit also runs the suite in about ten minutes
  against Chromium's forty seconds on this machine.

  Of the ten Firefox failures, only one was a browser capability the port cannot reach, and it is
  a limitation of the *test* rather than the app: Firefox builds a `ClipboardEvent` whose
  `clipboardData` is present but empty, so a synthesized paste carries no file. A real Ctrl+V
  works. That test is skipped there with the reason recorded in it.

  Two were real defects the Chromium-only suite had been hiding. The selection-rounding bug is
  described below. The other: `errorDetails` rendered `error.stack`, and only Chromium prefixes a
  stack with `Name: message` — so a bug report from Firefox or Safari arrived as anonymous frames
  with no indication of what had failed. The heading is now written explicitly.

  The remaining seven were tests over-specifying Chromium's arithmetic. Six drove the mouse to
  fractional page coordinates, which Chromium honours and Firefox truncates; they now click whole
  pixels, and where the true value depends on widget granularity they assert that value rather
  than a rounder-looking one. The seventh asserted exact bytes for a semi-transparent pixel
  round-tripped through a canvas, which cannot survive premultiplication exactly — it now checks
  what the codec actually guarantees: alpha exact, opaque pixels exact, and colour to the
  precision the canvas can hold at that alpha.

  Cross-browser testing paid for itself immediately by finding a real parity bug that Chromium
  had been hiding. `normalizeSelectionBounds` floored the near edge of a selection and ceilinged
  the far one, which widens the box by a pixel whenever a drag lands on fractional coordinates.
  Chromium reports fractional pointer coordinates and Firefox reports integers, so over a canvas
  whose origin sits at x=239.5 the identical gesture measured 100 pixels in one browser and 101
  in the other. Native rounds both corners — `SelectTool.cs:88` for the anchor and
  `RectangleHandle.cs:123` for every drag update — so the port now does too. That single change
  fixed four of the ten Firefox failures.
- The performance contract measures only six-layer pointer hovering under 5 ms per move. It does
  not budget drawing, effects, restoration, saving, history reconstruction, or memory.

## Visual parity limits

The visual and dialog audits are extensive, but they should be described precisely:

- Approved web screenshots are regression baselines for the web implementation.
- Native references are reviewed manually; there is no general native-versus-web pixel comparison
  in CI.
- Some add-in dialog references are reconstructed from source because the native UI could not be
  captured directly in every environment.
- Current native captures primarily describe one Linux/GTK environment, not every macOS, Windows,
  GTK theme, font, and scale-factor combination.
- RTL coverage includes representative workspaces and dialogs, but not the full cross-product of
  every popup, tool, dialog, constrained viewport, and supported direction.

Consequently, the correct current claim is **high visual fidelity with pinned regression coverage**,
not pixel-identical reproduction on every platform.

## Localization reality

The original application contains 73 `.po` catalogs. The web port selects the 28 catalogs with at
least 90% upstream coverage, deliberately retains Hebrew, and adds English as the source language.
This results in 30 selectable UI locales.

However, [`generate-i18n-catalogs.mjs`](../scripts/generate-i18n-catalogs.mjs) contains
browser-specific overrides only for French, German, Arabic, and Hebrew. Other locales translate
native Pinta messages but fall back to English for approximately 65 web-only strings.

SEO indexing is intentionally limited to English, French, German, Arabic, and Hebrew. Other locale
routes are `noindex`, which is preferable to advertising untranslated SEO copy. New SEO locales
should be indexed only after their page-specific copy is written and reviewed by a fluent speaker.

## Effect verification limits

The 46 built-in effects have unusually strong algorithm coverage, including byte fixtures for
native integer behavior, sampling, seeded randomness, and premultiplied-alpha routines. Two
verification weaknesses remain:

- The standalone C# fixture harness is not retained as a reproducible tool in the web repository.
  The expected bytes remain, but their generation cannot be independently repeated from the current
  tree.
- Hue/Saturation was validated with a transcription produced during the same pass as the port.
  [`parity-plan.md`](parity-plan.md) records that this validation is partly circular and deserves an
  independent second implementation or review.

## Why the web implementation is smaller

The SLOC report at the time of this audit showed:

| Scope | Code lines |
| --- | ---: |
| Web production implementation | 26,453 |
| Original Pinta production implementation | 41,508 |
| Web tests, scripts, and supporting code | 15,872 |

The production web code is 63.7% of native Pinta, but web production plus supporting infrastructure
is 42,325 lines—slightly above the original production count.

> Regenerated 29 August 2026, after the effect-kernel and workspace-serialization splits. The
> file count rose from 38 to 86 without a comparable rise in code lines, which is the refactor
> doing what it was for: the same work spread across modules small enough to read.

The native application also carries GTK plumbing, platform integration, Mono.Addins infrastructure,
Pango text behavior, packaging, and desktop lifecycle code. The browser supplies some of that
functionality, while other portions remain unported. The static current-report table in
[`README.md`](../README.md) should be regenerated whenever SLOC changes materially.

## Deliberate browser boundaries

Some native surfaces should not be reproduced inside the page:

- Filesystem chooser and permission UI.
- Printer selection, driver settings, and final print confirmation.
- Screen-capture and other browser permission prompts.
- Execution or installation of arbitrary Mono.Addins assemblies.
- Operating-system recent-document integration.
- Exact GTK/Pango font, caret, IME, and text-layout behavior.
- Platform codec plugins that the browser does not expose.

The application should preserve Pinta's command flow, state, cancellation, and error behavior around
these boundaries while leaving the privileged surface to the browser or operating system.

## Recommended completion sequence

### 1. Make releases trustworthy

- Remove the version/deployment race.
- Run `verify:version` against the exact tested artifact.
- Ensure only a successful complete gate can publish GitHub Pages.
- Make Codespell and zero-warning ESLint part of the required checks.

### 2. Stabilize the test infrastructure

- ~~Reproduce and fix the preview-server disappearance during the full local browser suite.~~
  Done — stale `dist/` served by a reused server; see [Reliability gaps](#reliability-gaps).
- ~~Do not reuse an unrelated existing preview server in deterministic gate runs.~~
  Done — `reuseExistingServer: false` in both configs.
- ~~Record server output and process exit reasons as Playwright artifacts.~~
  Done — [`scripts/run-preview-server.mjs`](../scripts/run-preview-server.mjs) writes
  `test-results/server-logs/{e2e-preview,visual-dev,performance-preview}.log` for all three
  browser suites, which CI already uploads with the rest of `test-results`.
- Keep CI and local gate behavior as similar as practical. Partly done: `npm run gate` now runs
  the same four checks locally that CI runs. Two differences remain deliberate — CI retries once
  and uses 2 workers, local retries zero and uses 4 — so a flake fails the local gate loudly
  instead of being retried away.

Remaining known flakiness is entirely load-driven, and worth stating precisely because it is easy
to mistake for a real regression. Each project is green when measured on a quiet machine:

| Project | Result | Time |
| --- | --- | ---: |
| chromium | 93 passed | 37–42s |
| firefox | 92 passed, 1 skipped | 1.2–1.3m |
| touch | 8 passed | 7s |
| all three together | 193 passed, 1 skipped | 2.0m |

Under load the same code fails an arbitrary subset and the runtime inflates five to twenty times:
the combined suite has measured 2.0m, 5.6m, 6.8m and 13.3m, and chromium alone went from 37s and
93 passed to 8.5m and 89 passed at load 46. No two loaded runs fail the same tests, which is the
signature to look for. Firefox is the exception that proves the rule — it passed 92 at load 37,
because it finishes in a fraction of the memory the other two need.

**Before believing any failure here, check `uptime` and re-run the affected project on its own.**

### 3. Finish the structural refactor

- Extract the remaining `App` logic into ownership-based hooks. Five of nine done; the largest
  remaining is the global keydown effect.
- ~~Extract workspace serialization.~~ Done.
- Split `usePaintEditor` into sub-hooks while preserving its public contract. Seven done, five
  measured and deliberately declined.
- ~~Split the remaining over-700-line effect kernels along coherent algorithm boundaries.~~ Done.
- Leave the stylesheet intact until a cascade-preserving design and visual proof exist.

### 4. Prove browser and touch stability

- ~~Add Firefox and WebKit behavioral projects.~~ Firefox is added to
  [`playwright.e2e.config.ts`](../playwright.e2e.config.ts) and is green: 92 passed, 1 skipped.
  WebKit is deliberately not added yet: at 61 of 93 it would make the gate permanently red, which
  only teaches people to ignore it. Re-measuring it after the Firefox work was worth doing — it
  moved 54 to 61 — but it also showed the rest is not the same problem, so it stays measured
  rather than gating until someone works through it.
- ~~Test browser-specific clipboard, File System Access, service-worker, and codec fallbacks.~~
  Partly done: clipboard, File System Access save failures, and the BMP codec are now exercised on
  both browsers, with the one genuine capability gap skipped and explained. Service workers are
  still Chromium-only.
- ~~Add real touch-emulated editor tests at 390 x 844 for drawing, long-press secondary color,
  selection handles, pinch zoom, panning, dialogs, and toolbar reachability.~~ Eight tests in
  [`touch.spec.ts`](../tests/e2e/touch.spec.ts), run by a `touch` project at 390x844 with
  `hasTouch` and `isMobile`. They cover the coarse-pointer media query matching at all, enlarged
  targets, the callout suppression, drawing, the long-press secondary colour, panning, toolbar
  reachability, and a dialog fitting the screen. Pinch is not among them: Chromium delivers a
  pinch as a ctrl-wheel and Safari as `gesturechange`, so an emulated pinch would test the
  emulator. The wheel path is already covered by the desktop suite.

  Gestures go through CDP `Input.dispatchTouchEvent` rather than synthesized `PointerEvent`s.
  Dispatched events do not work here: `onPointerDown` calls `setPointerCapture`, which throws for
  a pointer id the browser has no active pointer for, so the handler aborts before drawing
  anything. Three other assumptions had to be corrected against what the app actually exposes —
  the canvas is zoomed to fit at this width so an element offset is not an image coordinate, the
  colour wells paint through a `--well-color` custom property rather than `background-color`, and
  the history dock is off screen so the title's dirty marker is the observable for an edit.
- Test browser-specific clipboard, File System Access, service-worker, and codec fallbacks.

### 5. Expand performance and storage budgets

- Budget continuous drawing and selection dragging.
- Budget effect preview, cancellation, and confirmation latency.
- Budget save, restore, tab switching, and long-history reconstruction.
- Measure heap, canvas backing stores, and IndexedDB growth for large documents.
- Persist history incrementally rather than rewriting full PNG snapshots. Partly done: duplicate
  snapshots are no longer written at all (see [Reliability gaps](#reliability-gaps)), pinned by
  [`historyPersistence.test.ts`](../tests/unit/historyPersistence.test.ts). Appending rather than
  rewriting the record is still open.
- ~~Provide a reconstructed ORA recovery download where possible.~~ Done, with five tests in
  [`workspaceRecovery.test.ts`](../tests/unit/workspaceRecovery.test.ts) covering the archive
  contents, the top-first stack order the format requires, multi-document recovery, and both
  refusal paths.

### 6. Strengthen parity evidence

- Add automated perceptual native-versus-web comparisons for captures with matching environments.
- Complete the English/RTL and desktop/constrained-viewport dialog cross-product.
- Retain a reproducible C# effect fixture harness.
- Independently revalidate Hue/Saturation.
- Record unavoidable browser differences next to each parity claim.

### 7. Complete localization and documentation

- Translate or professionally review the browser-specific strings for additional high-value
  locales.
- Add indexed SEO locales only when their unique copy is complete.
- Synchronize architecture, reliability, parity, test-count, refactoring, and SLOC documentation
  after each milestone.

## Completion definition

Final polish is complete when:

- One exact, versioned, fully tested artifact is deployed without racing workflows.
- Required CI is green with no spelling or React hook warnings.
- Chromium, Firefox, and WebKit behavioral suites pass.
- Automated touch tests cover the actual responsive editor.
- Every native dialog and tool popup has a reviewed reference, behavior test, and representative
  RTL/constrained-viewport coverage.
- Storage and performance budgets cover real editing, not only pointer hovering.
- Remaining differences are documented browser/platform boundaries rather than accidental parity
  gaps.
- The architecture and SLOC documentation describe the code that is actually on `master`.
