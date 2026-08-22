# Pinta Online

Pinta Online is the browser-native React edition of Pinta. It mirrors the Pinta 3 GTK/libadwaita workspace while keeping the original .NET application intact in [`original/`](original/).

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Use `npm run build` for a production bundle in `dist/`, and `npm run verify:effects` for deterministic effect-processor checks.

## Deployment

Pushes to `master` automatically build and deploy the web application to GitHub Pages at [paint.rip](https://paint.rip). The deployment type-checks the application before publishing the `dist/` bundle and can also be started manually from GitHub Actions.

See [`docs/github-pages.md`](docs/github-pages.md) for the repository configuration, exact DNS records, domain verification, and HTTPS rollout checklist.

## Visual regression testing

The Playwright screenshot suite covers the editor workspaces, every tool-options state, menus, dialogs, confirmations, adjustments, and parameterized effects. Canonical screenshots are rendered with a pinned Chromium version in the matching Playwright Docker image:

```bash
npm run test:visual:update  # deliberately create or replace approved baselines
npm run test:visual         # compare the current UI with approved baselines
```

To compare against the native application, place native Pinta captures in `tests/visual/pinta-reference/` using the same filenames as the approved web screenshots, then run `npm run test:visual:review`. See [`tests/visual/README.md`](tests/visual/README.md) for the capture checklist, local authoring commands, CI behavior, and baseline review policy.

## Included in the current web build

- Pinta 3-style header, tool options, toolbox, canvas, Layers, History, palette, and status/zoom controls
- Native Pinta palette management with persistent swatch edits, 1–96 color resizing, default reset, and Paint.NET `.txt`, GIMP `.gpl`, and PaintShop Pro `.pal` import/export; the active palette also feeds palette-aware effects
- OpenRaster/PNG/JPEG/WebP/GIF/BMP plus native-codec P3 Portable Pixmap and uncompressed true-color TGA import by picker or drag and drop
- Layer-preserving OpenRaster export plus PNG, JPEG, WebP, P3 Portable Pixmap, and 32-bit uncompressed TGA export with format-aware Save / Save As behavior and quality controls
- Brush, pencil, eraser, bucket fill, gradient, color picker, clone stamp, recolor, zoom, and pan
- Editable Line / Curve previews with draggable and keyboard-movable control points, native per-point cardinal-spline tension, right-drag tension editing, path point insertion, dashed strokes, endpoint arrows, commit/cancel controls, and Shift angle constraints
- Shared editable-shape lifecycle across Line / Curve, Rectangle, Rounded Rectangle, and Ellipse tools: multiple same-type drafts remain independently selectable by clicking their outlines, keep their own style settings, survive editable-tool switches, and expose native-style control handles when active. Leaving the shape family finalizes every draft in creation order as one undoable history entry. Bounded shapes support four corner handles, keyboard nudging, live style changes, explicit commit/cancel, and Shift aspect constraints; closed freeform shapes retain outline/fill/dash/antialiasing and right-click color reversal.
- On-canvas multiline text editing with font family, variant, size, weight, italic, underline, alignment, fill/outline/background styles, and drag-to-position controls
- Rectangle, ellipse, freeform-lasso, and contiguous magic-wand selections with Replace, Union, Exclude, Xor, and Intersect modes, native modifier overrides, select-all, deselect, erase, fill, invert, expand/contract offset, cut, copy, Copy Merged, paste into the current layer, paste into a new layer, paste into a new image, crop, move-selection, and move-selected-pixels workflows; selection masks are preserved in undo/redo snapshots
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
- Selection-aware effect application with deterministic undo/redo history
- Browser-native New Screenshot capture for a screen, window, or tab, with optional delay and automatic stream shutdown
- Composite print preview, one-page scale-to-fit print stylesheet, and browser print integration
- Native-style Best Fit, Normal Size, Zoom to Selection, persisted orthogonal/axonometric Canvas Grid settings, scroll-synchronized rulers with pixel/inch/centimeter metrics, fullscreen, and F12 tool-window control
- Complete categorized Keyboard Shortcuts and About dialogs plus native Pinta help, website, issue, and translation destinations
- Dark and light themes and responsive tool/sidebar layouts

## Architecture

React owns the editor UI and document state. Each open image has an independent document session containing its canvas layers, active layer, history stack and clean checkpoint, selection, zoom, dimensions, file name, and dirty state. Switching tabs swaps the active session without flattening or serializing its canvases. Each layer uses an independent `HTMLCanvasElement`; the viewport composites visible layers with Pinta-compatible opacity and blend modes for display, merging, printing, and export. Text remains editable on the canvas until it is finalized to the active layer, at which point it receives a deterministic history entry like native Pinta. History snapshots use `ImageData` for both layer pixels and arbitrary selection masks, which keeps undo deterministic. CPU-heavy adjustments and effects run in a dedicated module worker using transferable pixel buffers, so the React interface remains responsive and the processor can later be replaced by a WebAssembly implementation without changing editor state or dialogs.

The Vite build serves the original Pinta action SVGs directly from `original/Pinta.Resources/icons/hicolor/scalable`, so the web and native editions share the same tool artwork.

## Original desktop application

The original C# / GTK Pinta source, solution, tests, native build tooling, translations, installers, and licenses live in [`original/`](original/). Run its native build commands from that directory; see [`original/readme.md`](original/readme.md) for upstream setup and contribution details.

## Parity status

The browser edition covers Pinta's primary document, Edit, View, Image, Layers, Window, and Help workflows; layer blending; OpenRaster/PPM/TGA round-tripping; multi-format export; palette management; adjustments; and the complete built-in effects catalog. The intentional remaining boundary is native add-in hosting, which is not directly portable to a sandboxed browser. Compatibility hardening across browser-specific media, print, download, and screen-capture permission behavior remains ongoing.
