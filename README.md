# Pinta Online

Pinta Online is the browser-native React edition of Pinta. It mirrors the Pinta 3 GTK/libadwaita workspace while keeping the original .NET application intact in [`original/`](original/).

Ported to the web by [Evgeny Vinnik](https://github.com/evgenyvinnik/pinta-online).

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Use `npm run build` for a production bundle in `dist/`, `npm run verify:effects` for deterministic effect-processor checks, and `npm run verify:icons` to confirm every icon name still resolves to a Pinta or GTK icon file — the single-page fallback answers an unknown icon request with `index.html`, so a typo would otherwise render a blank image instead of failing.

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
| Web implementation (React / TypeScript) | 28 | 22,890 | 155 | 2,019 | 25,064 |
| Original implementation (C# / GTK) | 431 | 41,508 | 11,448 | 11,324 | 64,280 |
| Tests, scripts, and supporting code | 90 | 12,011 | 211 | 1,410 | 13,632 |

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

The editor and feature tour each have a canonical page in every language: `/about/` is English, with translated versions such as `/fr/about/` and `/ar/about/`. Every page publishes reciprocal `hreflang` links and uses English as `x-default`; the generated `/sitemap.xml` repeats the complete reciprocal locale clusters, while titles, descriptions, social metadata, visible copy, structured data, and sitemap entries are localized together:

```bash
npm run seo:sync        # regenerate locale HTML pages and sitemap.xml
npm run verify:seo      # fail when committed SEO pages are stale
```

Playwright behavior tests verify locale routes, selection, direction, reciprocal metadata, structured data, and sitemap coverage. The visual suite maintains approved French LTR and Arabic RTL editor captures, an Arabic RTL About capture, and the language dialog.

## Included in the current web build

- Pinta 3-style header, tool options, toolbox, canvas, Layers, History, palette, and status/zoom controls
- Native Pinta palette management with a discoverable add-color control, persistent swatch edits, 1–96 color resizing, default reset, and Paint.NET `.txt`, GIMP `.gpl`, and PaintShop Pro `.pal` import/export; the full primary/secondary color picker supports hue, saturation, value, RGB, hexadecimal, and alpha controls, and the active palette also feeds palette-aware effects
- OpenRaster, PNG, JPEG, WebP, AVIF, GIF, BMP, TIFF, SVG, and ICO plus deterministic P3/P6 Portable Pixmap and raw/RLE true-color, grayscale, or palette-based TGA import by multi-select picker, installed-app launch, or multi-image drag and drop
- Layer-preserving OpenRaster export plus PNG, JPEG, WebP, alpha-aware BMP/TIFF, P3 Portable Pixmap, and 32-bit uncompressed TGA export with format-aware Save / Save As behavior and a separate native-style JPEG quality step
- Brush, pencil, eraser, bucket fill, gradient, color picker, clone stamp, recolor, zoom, and pan
- Editable Line / Curve previews with draggable and keyboard-movable control points, native per-point cardinal-spline tension, right-drag tension editing, path point insertion, dashed strokes, endpoint arrows, commit/cancel controls, and Shift angle constraints
- Shared editable-shape lifecycle across Line / Curve, Rectangle, Rounded Rectangle, and Ellipse tools: multiple same-type drafts remain independently selectable by clicking their outlines, keep their own style settings, survive editable-tool switches, and expose native-style control handles when active. Leaving the shape family finalizes every draft in creation order as one undoable history entry. Bounded shapes support four corner handles, keyboard nudging, live style changes, explicit commit/cancel, and Shift aspect constraints; closed freeform shapes retain outline/fill/dash/antialiasing and right-click color reversal.
- On-canvas multiline text editing with browser-local undo/selection, IME composition, tabs, bidirectional text, font-size shortcuts, font family, variant, size, weight, italic, underline, alignment, fill/outline/background styles, drag-to-position controls, and one independently re-editable Ctrl/Command-click text engine per layer
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
- Operating-system image clipboard integration for Copy, Copy Merged, Cut, and Paste, with an internal fallback, oversized-image decisions, and the native empty-clipboard explanation
- Browser-native New Screenshot capture for a screen, window, or tab, with optional delay and automatic stream shutdown
- Composite print preview with portrait/landscape page setup, fit/actual/custom scaling, margins, centering, an isolated print surface, and browser print integration
- Pinta's complete zoom model: the native 5%–3600% zoom collection, an editable status-bar zoom combo with every preset plus a sticky `Window` entry, Zoom In / Zoom Out stepping that collection, Best Fit, Normal Size, Zoom to Selection, fit-on-open for each new document, and nearest-neighbour rendering above 100% so pixels stay hard-edged
- Persisted orthogonal/axonometric Canvas Grid settings, scroll-synchronized rulers with pixel/inch/centimeter metrics, fullscreen, and F12 tool-window control
- A toolbox that reflows with the window like Pinta's vertical `FlowBox`, resizable and minimizable Layers/History pads with persisted split positions, a recently-used color block, and a status bar that reports the live selection size
- Complete categorized Keyboard Shortcuts and About dialogs plus a searchable Pinta Online user guide, website, issue, and translation destinations
- Source-backed libadwaita dark, light, and follow-the-system color schemes, with responsive tool/sidebar layouts
- Per-tool option scoping matching `Pinta.Tools/SettingNames.cs`, so brush width, antialiasing, alpha blending, fill style, and dash pattern are remembered separately for each tool
- Phone and tablet layouts that collapse the menu bar and secondary toolbar commands into the Main Menu, turn the toolbox into a horizontal strip, start the docked pads closed, and enlarge touch targets; a long press replaces the right-click that sets the secondary color
- i18next localization with 30 selectable UI locales (English plus 29 lazy Pinta-derived catalogs), exact regional locale routing, English fallback for web-only strings, and mirrored RTL editor chrome. Fully reviewed French, German, Arabic, and Hebrew SEO pages join English in the reciprocal `hreflang` cluster
- Lossless IndexedDB workspace restoration for every open document, layer, pixel buffer, active tab, zoom, dirty flag, and selection mask; Zustand persists lightweight theme, panel, ruler, and grid preferences
- Installable offline PWA output with Pinta-derived 192px/512px icons, the original Pinta SVG favicon, service-worker precaching, restoration-safe multi-file installed-app launch handling, File System Access pickers, and save-back-to-source handles with download fallbacks

## Architecture

React owns the editor UI and live document state. Zustand owns small durable UI preferences, while IndexedDB stores debounced lossless PNG snapshots of every layer and history checkpoint plus selection masks, floating pixels, editable text/shape/gradient state, and tab metadata. Each open image has an independent document session containing its canvas layers, active layer, complete history stack and clean checkpoint, selection, zoom, dimensions, file name, dirty state, and—when granted—a writable source handle. Switching tabs swaps the active session without flattening its canvases. Each layer uses an independent `HTMLCanvasElement`; the viewport composites visible layers with Pinta-compatible opacity and blend modes for display, merging, printing, and export. Each layer can retain its own committed text engine until a conflicting pixel edit safely finalizes it. History snapshots use `ImageData` for both layer pixels and arbitrary selection masks, which keeps undo deterministic. CPU-heavy adjustments and effects run in an abortable module worker using transferable pixel buffers; stale live previews are canceled, confirmed renders expose a native-style cancellation dialog, and the processor can later be replaced by WebAssembly without changing editor state or dialogs.

The Vite build serves the original Pinta action SVGs directly from `original/Pinta.Resources/icons/hicolor/scalable`, so the web and native editions share the same tool artwork. Optional add-ins use the same typed tool/effect registries and worker boundary as built-in features; only their menu and toolbox visibility is gated by the persisted package registry.

## Localization coverage

Pinta's `original/po/` directory contains 73 gettext catalogs against a 621-message template, but file presence alone overstates useful coverage. `npm run i18n:sync` measures the translated entries and automatically ships every upstream catalog at or above 90%: 28 catalogs currently qualify. Hebrew remains available as an explicitly preserved existing locale at 70.2%, for 29 lazy-loaded non-English catalogs and 30 UI locales including English. Locale variants use BCP 47 URLs such as `/en-GB/`, `/pt-BR/`, and `/zh-TW/` and are not collapsed to their base language.

The original gettext messages translate the native editor surface. Browser-only strings fall back to English unless a reviewed override exists. SEO is intentionally stricter: only English, French, German, Arabic, and Hebrew currently have fully translated editor metadata and About copy, so only those pages are indexed, listed in the sitemap, and linked through reciprocal `hreflang`. Other locale routes boot the translated editor through `noindex` shells and link to the English About page until their web-specific copy is reviewed. The generated inventory in `src/i18n/locales.generated.json` records source locale, direction, translated count, percentage, threshold, and SEO status so runtime, build inputs, and verification cannot silently drift apart.

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

The browser edition covers Pinta's primary document, Edit, View, Image, Layers, Window, and Help workflows; layer blending; OpenRaster/PPM/TGA/BMP/TIFF round-tripping; multi-format export; palette management; adjustments; the complete built-in effects catalog; and a curated set of browser-native optional add-in ports. Remaining work is queued in the [parity work plan](docs/parity-plan.md), and resilience work in the [reliability work plan](docs/reliability-plan.md). Native edge cases and browser boundaries are tracked in the [functional parity matrix](docs/parity-hardening.md), with behavioral tests for unsaved-close flow, OS clipboard images, writable file handles and installed-app launches, codec variants, per-layer re-editable text, cancellable effect rendering, and page setup. Arbitrary native Mono.Addins assemblies cannot execute in the browser, so future extensions must be reviewed and ported into the typed web registry.
