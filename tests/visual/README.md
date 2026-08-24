# Pinta visual comparison workflow

This suite has two related jobs:

1. Playwright detects unintended changes in the web implementation by comparing it with approved web baselines.
2. The manual review gallery pairs those approved web baselines with screenshots captured from the original native Pinta application.

## Canonical web baselines

Run the canonical suite through Docker so Chromium, Linux libraries, fonts, device scale, locale, timezone, viewport, animation behavior, and screenshot comparator settings stay pinned:

```bash
npm run test:visual:update
npm run test:visual
```

`test:visual:update` is an approval operation. Inspect every changed PNG before committing it. Normal development and CI should use `test:visual`, which fails and writes actual/expected/diff artifacts when rendering changes.

The canonical browser version comes directly from the exact `@playwright/test` version in `package.json`; the Docker launcher selects `mcr.microsoft.com/playwright:v<version>-noble`. The first run downloads that image and creates a reusable Docker volume for Linux `node_modules` without replacing the host installation.

For faster local debugging, use:

```bash
npx playwright install chromium
npm run test:visual:local
npm run test:visual:ui
```

Local screenshots can differ from canonical Linux baselines because text and native form controls are platform-rendered. Do not approve canonical baselines with `test:visual:local:update` unless the project intentionally changes its baseline platform.

## Native Pinta captures

Approved web screenshots are stored in `tests/visual/__screenshots__/chromium/`. For each screen you want to compare:

1. Run the original application from `original/` on a consistent desktop, theme, display scale, and Pinta version.
2. Reproduce the state described by the web screenshot filename.
3. Crop dialog references to the native dialog window. Capture workspace and menu references as the complete application window.
4. Save the PNG in `tests/visual/pinta-reference/` with exactly the same filename as the web baseline.
5. Run `npm run test:visual:review` and open `playwright-report/manual-comparison.html`.

For this repository revision, use Pinta from the bundled `original/` tree, a 1440 × 960 application window, 100% display scale, English locale, default blue system accent, and both forced Dark and forced Light color schemes. Record the OS, GTK, libadwaita, and Pinta commit alongside a capture batch so later reviews do not mix platform-rendering changes with application changes. The macOS build prerequisites are documented in `original/readme.md`; they are intentionally not installed automatically by the web test runner.

The gallery shows both images side by side, reports missing native references, and filters by filename category (`workspace`, `menu`, `dialog`, `tool`, or an effect category). Native references are evidence for manual parity review; Playwright does not automatically fail on differences between two different UI platforms.

`New Screenshot` is delegated to an operating-system portal by the Linux native build, and its appearance therefore is not owned by Pinta. Printing is disabled in the bundled native revision. Their web-dialog rows use the native File menu as the reference evidence so the gallery records those differences explicitly instead of presenting invented native dialogs.

Likewise, native Pinta accepts file drops without drawing a persistent overlay. The file-drop row pairs the web overlay with Pinta's native resting workspace so that this browser-specific affordance remains part of the manual review.

The bundled native header-bar build also has no Toolbar item in View → Show/Hide. The toolbar-hidden row therefore uses the fixed native header as comparison evidence for the web-only visibility toggle.

### Reproducible Linux reference captures

On Apple Silicon, `npm run test:visual:native` builds a disposable `linux/amd64` Arch container with .NET 10, GTK4, libadwaita, Xvfb, Openbox, AT-SPI, and ImageMagick. It builds the bundled native source and captures every registered comparison state into `pinta-reference/`: light/dark and alternate workspaces, menus, standalone dialogs, every tool-options bar, every parameterized adjustment, and every parameterized effect. No GTK packages are installed on the host. The first build is slow under architecture emulation; Docker caches the capture image for later runs.

The capture runner pre-seeds a fresh native profile with a 1440 × 960 window, default blue accent, visible tool/status/dock surfaces, and an explicit light or dark scheme. Add new deterministic scenarios to `tests/visual/native/capture.sh` and register the matching filename in `scripts/run-native-captures.mjs`.

## Coverage policy

The suite currently captures:

- French LTR and Arabic RTL workspaces with translated menus, plus the language chooser
- Dark, light, responsive, distraction-free, selection, text-editing, file-drop, ruler, and grid workspaces
- Every tool's options bar, generated from the production `TOOLS` registry
- View, Image, Adjustments, Effects, Main, and Layer menus, including the bottom of scrollable menus
- Image sizing, saving, printing, screenshot, palette, layer, grid, keyboard, About, selection, and close-confirmation dialogs
- Every parameterized adjustment and effect, generated from the production `EFFECT_DEFINITIONS` registry
- The top and bottom of any dialog whose content scrolls at the canonical viewport

When a new tool or parameterized effect is added to its production registry, it is automatically added to screenshot coverage. New standalone menus, dialogs, or workspace modes should receive a named scenario in `screens.spec.ts`.
