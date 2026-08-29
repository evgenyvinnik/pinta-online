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

- `App.tsx`: approximately 5,428 to 1,951 lines.
- `usePaintEditor.ts`: 5,572 to 3,962 lines.
- `effects/processor.ts`: 2,929 to 212 lines.
- Components and dialog hosting are separated.
- Effect kernels and many editor helpers are in focused modules.

The target in [`refactoring.md`](refactoring.md) has not yet been reached:

- `App.tsx` still contains roughly 15 states and 45 callbacks.
- `usePaintEditor.ts` still contains approximately 164 callbacks and should eventually become
  sub-hook composition.
- Workspace serialization remains inline.
- Two effect kernel files remain approximately 799 and 791 lines, above the 700-line target.
- `styles.css` remains approximately 5,854 lines. Its split was correctly abandoned after it
  demonstrated cascade regressions; any future split needs an explicit cascade-layer or ordering
  design rather than a mechanical series of imports.
- ESLint currently permits 45 warnings, including numerous missing hook dependencies. These should
  reach zero before the high-risk hook extraction continues.

Refactoring should proceed only from a clean, stationary worktree. Pure moves need to remain
separate from behavior changes, and every rendering-related extraction must preserve all approved
visual baselines.

## Reliability gaps

The reliability foundation is strong, but several limits remain:

- `SurfaceDiff` reduces in-memory history cost, while IndexedDB persistence still serializes full
  PNG history snapshots. Large documents and long histories can exhaust browser quota.
- Emergency recovery downloads individual layer PNGs, not a reconstructed OpenRaster document.
- During this audit, the full local gate lost its preview server after 78 of 93 browser tests. The
  initial failure and every cascading PWA, localization, and SEO case passed on fresh isolated
  servers. This points to a test-server lifecycle or resource problem rather than 15 independent
  application regressions, but it still makes the gate less trustworthy.
- Codespell previously failed on an effect-coordinate identifier and ran outside the deployment
  gate. The identifier has since been corrected, and spelling is now a dependency of the release
  workflow. See the historical
  [Codespell run](https://github.com/evgenyvinnik/pinta-online/actions/runs/33232860949).
- Only Chromium is exercised. Firefox and WebKit remain unproven, particularly for clipboard,
  service workers, canvas limits, file APIs, fonts, gestures, and Safari/iOS behavior.
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
| Web production implementation | 25,783 |
| Original Pinta production implementation | 41,508 |
| Web tests, scripts, and supporting code | 15,788 |

The production web code is 62.1% of native Pinta, but web production plus supporting infrastructure
is 41,571 lines—almost exactly the original production count.

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

- Reproduce and fix the preview-server disappearance during the full local browser suite.
- Do not reuse an unrelated existing preview server in deterministic gate runs.
- Record server output and process exit reasons as Playwright artifacts.
- Keep CI and local gate behavior as similar as practical.

### 3. Finish the structural refactor

- Extract the remaining `App` logic into ownership-based hooks.
- Extract workspace serialization.
- Split `usePaintEditor` into sub-hooks while preserving its public contract.
- Split the remaining over-700-line effect kernels along coherent algorithm boundaries.
- Leave the stylesheet intact until a cascade-preserving design and visual proof exist.

### 4. Prove browser and touch stability

- Add Firefox and WebKit behavioral projects.
- Add real touch-emulated editor tests at 390 x 844 for drawing, long-press secondary color,
  selection handles, pinch zoom, panning, dialogs, and toolbar reachability.
- Test browser-specific clipboard, File System Access, service-worker, and codec fallbacks.

### 5. Expand performance and storage budgets

- Budget continuous drawing and selection dragging.
- Budget effect preview, cancellation, and confirmation latency.
- Budget save, restore, tab switching, and long-history reconstruction.
- Measure heap, canvas backing stores, and IndexedDB growth for large documents.
- Persist history incrementally rather than rewriting full PNG snapshots.
- Provide a reconstructed ORA recovery download where possible.

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
