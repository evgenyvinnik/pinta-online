# Pinta Online

Pinta Online is the browser-native React edition of Pinta. It mirrors the Pinta 3 GTK/libadwaita workspace while keeping the original .NET application intact in the repository root.

## Run locally

```bash
cd web
npm install
npm run dev
```

Open the local URL printed by Vite. Use `npm run build` for a production bundle in `web/dist`, and `npm run verify:effects` for deterministic effect-processor checks.

## Included in the first web milestone

- Pinta 3-style header, tool options, toolbox, canvas, Layers, History, palette, and status/zoom controls
- Native Pinta palette management with persistent swatch edits, 1–96 color resizing, default reset, and Paint.NET `.txt`, GIMP `.gpl`, and PaintShop Pro `.pal` import/export; the active palette also feeds palette-aware effects
- OpenRaster/PNG/JPEG/WebP/GIF/BMP plus native-codec P3 Portable Pixmap and uncompressed true-color TGA import by picker or drag and drop
- Layer-preserving OpenRaster export plus PNG, JPEG, WebP, P3 Portable Pixmap, and 32-bit uncompressed TGA export with format-aware Save / Save As behavior and quality controls
- Brush, pencil, eraser, bucket fill, gradient, color picker, clone stamp, recolor, zoom, and pan
- Editable Line / Curve previews with draggable and keyboard-movable control points, native per-point cardinal-spline tension, right-drag tension editing, path point insertion, dashed strokes, endpoint arrows, commit/cancel controls, and Shift angle constraints
- Shared editable-shape lifecycle across Line / Curve, Rectangle, Rounded Rectangle, and Ellipse tools: multiple same-type drafts remain independently selectable by clicking their outlines, keep their own style settings, survive editable-tool switches, and expose native-style control handles when active. Leaving the shape family finalizes every draft in creation order as one undoable history entry. Bounded shapes support four corner handles, keyboard nudging, live style changes, explicit commit/cancel, and Shift aspect constraints; closed freeform shapes retain outline/fill/dash/antialiasing and right-click color reversal.
- On-canvas multiline text editing with font family, variant, size, weight, italic, underline, alignment, fill/outline/background styles, and drag-to-position controls
- Rectangle, ellipse, freeform-lasso, and contiguous magic-wand selections with Replace, Union, Exclude, Xor, and Intersect modes, native modifier overrides, select-all, deselect, erase, cut, copy, paste into a new layer, crop, move-selection, and move-selected-pixels workflows
- Adjustable magic-wand and recolor tolerances, plus Ctrl/Command-click clone-source placement and offset sampling
- Layer create, duplicate, delete, merge, reorder, visibility, rename, thumbnails, opacity, and all 16 native Pinta blend modes
- Native Layers-pad workflows including import-from-file, active-relative insertion, horizontal/vertical layer flips, Rotate / Zoom Layer with angle/pan/scale preview, and Image → Flatten, all with deterministic undo/redo history
- Branch-aware undo/redo history
- Multi-document image tabs with independent layers, history, selection, zoom, dimensions, file names, and dirty state
- Native-order tab insertion, keyboard tab cycling, optional tab visibility, and Save / Discard / Cancel close confirmation
- Image flips, 90°/180° rotations, high-quality image resizing, and nine-position anchored canvas resizing
- Pinta-style new-image, resize-image, and resize-canvas dialogs with presets, aspect locking, orientation, background choice, live preview, and size validation
- Worker-backed Auto Level, Black and White, Brightness / Contrast, Curves, Hue / Saturation, Invert Colors, Levels, Posterize, and Sepia adjustments
- Native-style Curves editing with RGB/luminosity transfer maps, natural cubic spline control points, channel toggles, reset/removal gestures, and a five-control per-channel Levels editor
- Complete worker-backed Artistic, Blur, Color, Distort, Noise, Object, Photo, Render, and Stylize submenus—including fractals, Clouds, Cells, Voronoi, Align/Feather/Outline Object, Ink Sketch, Dithering, Dents, Median, Red Eye Removal, and Relief—with Pinta-style conditional parameter dialogs
- Selection-aware effect application with deterministic undo/redo history
- Dark and light themes, fullscreen, keyboard shortcuts, and responsive tool/sidebar layouts

## Architecture

React owns the editor UI and document state. Each open image has an independent document session containing its canvas layers, active layer, history stack and clean checkpoint, selection, zoom, dimensions, file name, and dirty state. Switching tabs swaps the active session without flattening or serializing its canvases. Each layer uses an independent `HTMLCanvasElement`; the viewport composites visible layers with Pinta-compatible opacity and blend modes for display, merging, and export. Text remains editable on the canvas until it is finalized to the active layer, at which point it receives a deterministic history entry like native Pinta. History snapshots use `ImageData`, which keeps undo deterministic. CPU-heavy adjustments and effects run in a dedicated module worker using transferable pixel buffers, so the React interface remains responsive and the processor can later be replaced by a WebAssembly implementation without changing editor state or dialogs.

The Vite build serves the original Pinta action SVGs directly from `Pinta.Resources/icons/hicolor/scalable`, so the web and native editions share the same tool artwork.

## Parity status

The browser edition now covers the main Pinta document workflow, UI shell, layer blending, OpenRaster/PPM/TGA round-tripping, multi-format export, palette management, adjustments, and complete built-in effects catalog. Full native feature parity is still an active porting effort. The largest remaining areas are browser-appropriate equivalents for native add-ins and printing, plus compatibility hardening across browser-specific image decoders.
