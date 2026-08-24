# Pinta Online

Pinta Online is the browser-native React edition of Pinta. It mirrors the Pinta 3 GTK/libadwaita workspace while keeping the original .NET application intact in [`original/`](original/).

Ported to the web by [Evgeny Vinnik](https://github.com/evgenyvinnik/pinta-online).

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Use `npm run build` for a production bundle in `dist/`, and `npm run verify:effects` for deterministic effect-processor checks.

## Deployment

Pushes to `master` automatically build and deploy the web application to GitHub Pages at [paint.rip](https://paint.rip). The deployment type-checks the application and verifies both localization catalogs and generated multilingual SEO pages before publishing the `dist/` bundle; it can also be started manually from GitHub Actions.

Every non-bot push to `master` also creates an automated version commit using `1.0.YYMMDD.RUN_NUMBER`, matching the date-and-run scheme used by mdreader. `package.json` is the build-time source of truth; the workflow synchronizes the lockfile, while Vite injects the version into the editor About dialog, the public About page, and `SoftwareApplication` structured data. Run `npm run verify:version` to check the metadata locally.

See [`docs/github-pages.md`](docs/github-pages.md) for the repository configuration, exact DNS records, domain verification, and HTTPS rollout checklist.

## User guide

The searchable [Pinta Online User Guide](https://paint.rip/user-guide/) adapts the useful workspace, layer, selection, drawing, transformation, enhancement, repair, export, and shortcut material from the original [Pinta User Guide](https://www.pinta-project.com/user-guide/) to the current browser implementation. Its interface images come exclusively from Pinta Online, including production assets and approved captures from the pinned Playwright screenshot suite.

Press **F1**, choose **Help → Pinta Help**, or use **Main Menu → Contents** to open the local guide. The guide publishes canonical and structured article metadata, is included in the sitemap and offline build, and has desktop, mobile, content, search, screenshot-loading, and Help-routing regression coverage.

## Source lines of code

The dependency-free [`scripts/calc-sloc.mjs`](scripts/calc-sloc.mjs) counter is adapted to this repository's web/native split from [mcpaint's SLOC report](https://github.com/evgenyvinnik/mcpaint/blob/master/scripts/calc-sloc.mjs). It reports production web code, production C#/GTK code, and supporting tests/tooling separately:

```bash
npm run sloc                 # detailed tables grouped by extension
npm run sloc -- --markdown   # compact Markdown summary
```

Current report:

| Area | Files | Code | Comments | Blank | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Web implementation (React / TypeScript) | 26 | 16,373 | 11 | 1,384 | 17,768 |
| Original implementation (C# / GTK) | 431 | 41,508 | 11,448 | 11,324 | 64,280 |
| Tests, scripts, and supporting code | 87 | 8,830 | 143 | 1,107 | 10,080 |

The report counts physical lines in supported source files and classifies each nonblank line as code or comment. It excludes dependencies, generated build output, binary assets, lockfiles, and documentation. The original implementation total covers production `original/Pinta*` source roots; native and web tests are included in the supporting-code row. These totals measure repository size, not feature completeness or language equivalence; rerun the command for the authoritative current values.

## Visual regression testing

The Playwright screenshot suite covers the editor workspaces, every tool-options state, menus, dialogs, confirmations, adjustments, and parameterized effects. Canonical screenshots are rendered with a pinned Chromium version in the matching Playwright Docker image:

```bash
npm run test:visual:update  # deliberately create or replace approved baselines
npm run test:visual         # compare the current UI with approved baselines
```

To compare against the native application, place native Pinta captures in `tests/visual/pinta-reference/` using the same filenames as the approved web screenshots, then run `npm run test:visual:review`. See [`tests/visual/README.md`](tests/visual/README.md) for the capture checklist, local authoring commands, CI behavior, and baseline review policy.

Behavioral browser tests run against the production PWA build and cover document isolation, multi-image picker/drop, editing/history, selections, palettes, durable restoration, preferences, and install metadata:

```bash
npm run test:e2e
```

## Localization

The editor uses i18next and currently ships English, French, German, Arabic, and Hebrew. English is the explicit default at `/`; translated editor routes live at `/fr/`, `/de/`, `/ar/`, and `/he/`. Choosing a language through **Pinta → Language** moves to its shareable locale URL. The site does not force browser-language redirects, so people and crawlers can always reach every version. Arabic and Hebrew mirror the application chrome with `dir="rtl"`; the drawing viewport remains coordinate-stable so RTL layout does not reverse canvas input.

French, German, Arabic, and Hebrew catalogs are generated from the original Pinta gettext files in [`original/po/`](original/po/), with only browser-specific language-chooser text maintained by the web implementation:

```bash
npm run i18n:sync       # regenerate JSON catalogs from the original .po files
npm run verify:i18n     # fail when committed catalogs are stale
```

The editor and feature tour each have a canonical page in every language: `/about/` is English, with translated versions such as `/fr/about/` and `/ar/about/`. Every page publishes reciprocal `hreflang` links and uses English as `x-default`; titles, descriptions, social metadata, visible copy, structured data, and sitemap entries are localized together:

```bash
npm run seo:sync        # regenerate locale HTML pages and sitemap.xml
npm run verify:seo      # fail when committed SEO pages are stale
```

Playwright behavior tests verify locale routes, selection, direction, reciprocal metadata, structured data, and sitemap coverage. The visual suite maintains approved French LTR and Arabic RTL editor captures, an Arabic RTL About capture, and the language dialog.

## Included in the current web build

- Pinta 3-style header, tool options, toolbox, canvas, Layers, History, palette, and status/zoom controls
- Native Pinta palette management with persistent swatch edits, 1–96 color resizing, default reset, and Paint.NET `.txt`, GIMP `.gpl`, and PaintShop Pro `.pal` import/export; the active palette also feeds palette-aware effects
- OpenRaster/PNG/JPEG/WebP/GIF/BMP plus native-codec P3 Portable Pixmap and uncompressed true-color TGA import by multi-select picker or multi-image drag and drop
- Layer-preserving OpenRaster export plus PNG, JPEG, WebP, P3 Portable Pixmap, and 32-bit uncompressed TGA export with format-aware Save / Save As behavior and quality controls
- Brush, pencil, eraser, bucket fill, gradient, color picker, clone stamp, recolor, zoom, and pan
- Editable Line / Curve previews with draggable and keyboard-movable control points, native per-point cardinal-spline tension, right-drag tension editing, path point insertion, dashed strokes, endpoint arrows, commit/cancel controls, and Shift angle constraints
- Shared editable-shape lifecycle across Line / Curve, Rectangle, Rounded Rectangle, and Ellipse tools: multiple same-type drafts remain independently selectable by clicking their outlines, keep their own style settings, survive editable-tool switches, and expose native-style control handles when active. Leaving the shape family finalizes every draft in creation order as one undoable history entry. Bounded shapes support four corner handles, keyboard nudging, live style changes, explicit commit/cancel, and Shift aspect constraints; closed freeform shapes retain outline/fill/dash/antialiasing and right-click color reversal.
- On-canvas multiline text editing with font family, variant, size, weight, italic, underline, alignment, fill/outline/background styles, and drag-to-position controls
- Rectangle, ellipse, freeform and polygon lasso, and contiguous magic-wand selections with Replace, Union, Exclude, Xor, and Intersect modes, native modifier overrides, select-all, deselect, erase, fill, invert, expand/contract offset, cut, copy, Copy Merged, paste into the current layer, paste into a new layer, paste into a new image, crop, move-selection, and move-selected-pixels workflows; selection masks are preserved in undo/redo snapshots
- Adjustable magic-wand and recolor tolerances, plus Ctrl/Command-click clone-source placement and offset sampling
- Layer create, duplicate, delete, merge, reorder, visibility, rename, thumbnails, opacity, and all 16 native Pinta blend modes
- Native Layers-pad workflows including import-from-file, active-relative insertion, horizontal/vertical layer flips, Rotate / Zoom Layer with angle/pan/scale preview, and Image → Flatten, all with deterministic undo/redo history
- Branch-aware undo/redo history
- Multi-document image tabs with independent layers, history, selection, zoom, dimensions, file names, and dirty state
- Native-order tab insertion, keyboard tab cycling, optional tab visibility, per-document close confirmation, Save All, and save-all/discard-all Close All workflow
- Image Auto Crop, selection crop, flips, 90°/180° rotations, high-quality image resizing, nine-position anchored canvas resizing, and image flattening
- Pinta-style new-image, resize-image, and resize-canvas dialogs with presets, aspect locking, orientation, background choice, live preview, and size validation
- Worker-backed Auto Level, Black and White, Brightness / Contrast, Curves, Hue / Saturation, Invert Colors, Levels, Posterize, and Sepia adjustments
- Native-style Curves editing with RGB/luminosity transfer maps, natural cubic spline control points, channel toggles, reset/removal gestures, and a five-control per-channel Levels editor
- Complete worker-backed Artistic, Blur, Color, Distort, Noise, Object, Photo, Render, and Stylize submenus—including fractals, Clouds, Cells, Voronoi, Align/Feather/Outline Object, Ink Sketch, Dithering, Dents, Median, Red Eye Removal, and Relief—with Pinta-style conditional parameter dialogs
- A persistent Add-in Manager for five bundled, opt-in web packages: six Ars Kali glitch effects, Block Brush, Colored Grayscale, Hexagon Pixelate, and Night Vision. Enabled packages immediately add their tools or effects to the native menus without downloading executable code
- Selection-aware effect application with deterministic undo/redo history
- Browser-native New Screenshot capture for a screen, window, or tab, with optional delay and automatic stream shutdown
- Composite print preview, one-page scale-to-fit print stylesheet, and browser print integration
- Native-style Best Fit, Normal Size, Zoom to Selection, persisted orthogonal/axonometric Canvas Grid settings, scroll-synchronized rulers with pixel/inch/centimeter metrics, fullscreen, and F12 tool-window control
- Complete categorized Keyboard Shortcuts and About dialogs plus a searchable Pinta Online user guide, website, issue, and translation destinations
- Source-backed libadwaita dark and light color tokens, with responsive tool/sidebar layouts
- i18next localization with Pinta-derived French, German, Arabic, and Hebrew catalogs, canonical locale URLs, translated SEO feature pages, reciprocal `hreflang` metadata, English `x-default`, and mirrored RTL editor chrome
- Lossless IndexedDB workspace restoration for every open document, layer, pixel buffer, active tab, zoom, dirty flag, and selection mask; Zustand persists lightweight theme, panel, ruler, and grid preferences
- Installable offline PWA output with Pinta-derived 192px/512px icons, the original Pinta SVG favicon, service-worker precaching, and installed-app image file handling

## Architecture

React owns the editor UI and live document state. Zustand owns small durable UI preferences, while IndexedDB stores a debounced lossless PNG snapshot of every layer plus selection geometry/masks and tab metadata. Each open image has an independent document session containing its canvas layers, active layer, history stack and clean checkpoint, selection, zoom, dimensions, file name, and dirty state. Switching tabs swaps the active session without flattening its canvases. Each layer uses an independent `HTMLCanvasElement`; the viewport composites visible layers with Pinta-compatible opacity and blend modes for display, merging, printing, and export. Text remains editable on the canvas until it is finalized to the active layer, at which point it receives a deterministic history entry like native Pinta. History snapshots use `ImageData` for both layer pixels and arbitrary selection masks, which keeps undo deterministic. CPU-heavy adjustments and effects run in a dedicated module worker using transferable pixel buffers, so the React interface remains responsive and the processor can later be replaced by a WebAssembly implementation without changing editor state or dialogs.

The Vite build serves the original Pinta action SVGs directly from `original/Pinta.Resources/icons/hicolor/scalable`, so the web and native editions share the same tool artwork. Optional add-ins use the same typed tool/effect registries and worker boundary as built-in features; only their menu and toolbox visibility is gated by the persisted package registry.

## Optional web add-ins

Open **Add-ins → Add-in Manager** to enable any bundled package. Add-ins are off by default, apply immediately, and remain enabled in that browser until you disable them.

- [Ars Kali: Glitches](https://github.com/hyenaheartbeats/Ars-Kali--Glitches): Chromatic Aberration, Scanlines, Colored Artifacts, Pixel Drag, Row Slice, and Adjustment Noise
- [Block Brush](https://github.com/PintaProject/BlockBrush): a continuous rectangular brush integrated with Pinta Online history and brush-width controls
- [Colored Grayscale](https://github.com/Intedai/ColoredGrayscaleAddin): grayscale rendered through the current primary color
- [More Pixelates](https://github.com/Matthieu-LAURENT39/MorePixelatesAddin): center- or average-sampled hexagonal pixelation with offsets and borders
- [Night Vision Effect](https://github.com/PintaProject/NightVisionEffect): the original green response with optional deterministic sensor noise

Block Brush, More Pixelates, and Night Vision are web ports of MIT/X11-licensed add-ins. Ars Kali and Colored Grayscale use independent implementations based on their publicly described behavior so incompatible source code is not incorporated into this MIT/X11 project. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for attribution and license details.

## Original desktop application

The original C# / GTK Pinta source, solution, tests, native build tooling, translations, installers, and licenses live in [`original/`](original/). Run its native build commands from that directory; see [`original/readme.md`](original/readme.md) for upstream setup and contribution details.

## Parity status

The browser edition covers Pinta's primary document, Edit, View, Image, Layers, Window, and Help workflows; layer blending; OpenRaster/PPM/TGA round-tripping; multi-format export; palette management; adjustments; the complete built-in effects catalog; and a curated set of browser-native optional add-in ports. Arbitrary native Mono.Addins assemblies cannot execute in the browser, so future extensions must be reviewed and ported into the typed web registry. Compatibility hardening across browser-specific media, print, download, and screen-capture permission behavior remains ongoing.
