# Native Pinta adjustment and effect dialog audit

Audit date: 2026-08-24. Native source: the C# application under `original/` at the same revision as this document. Native reference images: `tests/visual/native-dialog-references/effects/`.

## Scope and result

Pinta registers 9 adjustments and 37 built-in effects. Three adjustments (Auto Level, Black and White, and Invert Colors) do not need configuration windows. Sepia, unlike some older Pinta references, is configurable in this checkout. The complete popup inventory is therefore **43 native dialogs: 6 adjustment dialogs and 36 generic effect dialogs plus the special Align Object dialog (37 effect dialogs total)**. All 43 were opened from the real GTK application and captured.

This audit excludes add-ins because their dialogs are not part of the built-in native catalog. It includes the shared reflective dialog and the four bespoke layouts: Curves, Levels, Posterize, and Align Object. Source paths in the individual entries are relative to `original/Pinta.Effects/`.

## Native dialog grammar

Unless a row says `bespoke`, the command uses `SimpleEffectDialog` (`original/Pinta.Gui.Widgets/Dialogs/SimpleEffectDialog.cs`). The native grammar is important because the web implementation currently flattens several distinct controls into ordinary range inputs.

| Data type | Native widget and behavior |
| --- | --- |
| `int` | Section label, horizontal scale, numeric spin button with minus/plus steppers, and a trailing reset-arrow button. Defaults: range -100…100, step 1, 0 digits unless attributes override them. |
| `double` | Same compound scale/spin/reset widget. Defaults: range -100…100, step .01, 2 digits unless attributes override them. |
| `DegreesAngle` | Section label followed by graphical circular angle dial, -360…360° spin button, and reset-arrow button. |
| `PointI` | Section label and a 2-D graphical point picker with separate X/Y spin controls. Coordinates refer to canvas pixels. |
| `CenterOffset<double>` | Same 2-D point-picker presentation, operating as an offset from canvas center. |
| `RandomSeed` | Section label, then **Reseed** button followed by a spin input. Default range 0…2,147,483,646 unless overridden. The web definitions currently use 2,147,483,647 for unrestricted seeds. |
| `bool` | A single check button. |
| enum | Section label followed by one full-width combo box; enum captions are translated. |
| `Color` | Section label and an 80 px Pinta color well. Clicking it nests the full native **Choose Color** palette/color-picker dialog. |

The simple window has a 400 px width request, is modal and non-resizable, uses 6 px content margins and 12 px vertical spacing, and previews changes live after a 100 ms debounce. Each compound numeric/angle control has its own reset button; there is no dialog-wide reset. On Linux/macOS the bottom action order is **Cancel, OK**, with OK styled as suggested/default; Windows intentionally reverses the platform order to **OK, Cancel**. There is no Apply button and no descriptive icon/intro or generic processing hint in native Pinta.

The current web counterpart is `EffectDialog` in `src/App.tsx`, driven by `src/effects/types.ts`. It uses a 520 px window, header actions **Cancel, Apply**, an icon/description block, a generic processing hint, plain range/number rows, and no per-control reset. Changing a web parameter only updates local form state; the canvas is processed after Apply, so the native live-preview behavior is absent. It also has no height cap or scrolling region, which makes the long Render dialogs overflow shorter screens.

Notation below: `slider(label, min…max, step, default[, digits])`; `angle` is the graphical angle control; `offset`/`point` is the native 2-D picker; `seed` includes Reseed; `select` lists options; `check` gives its default state. Controls are listed in exact native top-to-bottom order.

## Adjustments

### Brightness / Contrast

- Command/source: Adjustments → Brightness / Contrast; `original/Pinta.Effects/Adjustments/BrightnessContrastEffect.cs`; reflective dialog.
- Native size: **400×192** (`adjustment-brightness-contrast.png`).
- Controls: `slider(Brightness, -100…100, 1, 0)`; `slider(Contrast, -100…100, 1, 0)`.
- Actions/preview: per-row reset arrows; live preview; bottom Cancel, OK.
- Web: both values/ranges/defaults exist. **Gap (medium):** wrong 520 px composition, no reset arrows, Apply instead of OK, extra intro/hint.

### Curves

- Command/source: Adjustments → Curves; `original/Pinta.Effects/Dialogs/Effects.CurvesDialog.cs`; bespoke.
- Native size: **313×446** (`adjustment-curves.png`).
- Exact layout: top horizontal row `Transfer Map` label, combo (`RGB`, `Luminosity`, default **Luminosity**), and right-aligned live cursor coordinate `(x, y)`; 256×256 focusable curve grid; next row red/green/blue channel checks (all checked and only visible in RGB mode) plus right-aligned **Reset**; bottom tip `Tip: Right-click to remove control points.`
- Interaction: endpoints (0,0) and (255,255) cannot be removed; left click/drag adds or moves points; right click removes non-endpoints; each map retains its own points. Reset resets only the current transfer map. Live preview is immediate. Bottom Cancel, OK.
- Web: has a custom curve editor with mode and channels. **Gap (high):** it lives inside the generic 520 px intro/hint shell, header Cancel/Apply differs, coordinates/tip/channel visibility and exact 256 px grid/button placement must be checked against this reference, and the native compact 313×446 geometry is not preserved.

### Hue / Saturation

- Command/source: Adjustments → Hue / Saturation; `original/Pinta.Effects/Adjustments/HueSaturationEffect.cs`; reflective.
- Native size: **400×265** (`adjustment-hue-saturation.png`).
- Controls: `slider(Hue, -180…180, 1, 0)`; `slider(Saturation, 0…200, 1, 100)`; `slider(Lightness, -100…100, 1, 0)`.
- Actions/preview: per-row reset arrows; live preview; Cancel, OK.
- Web: parameter parity. **Gap (medium):** generic visual grammar/actions differ and unit suffixes are web-only.

### Levels

- Command/source: Adjustments → Levels; `original/Pinta.Effects/Dialogs/Effects.LevelsDialog.cs`; bespoke title is **Levels Adjustment**.
- Native size: **611×286** (`adjustment-levels.png`).
- Exact content, left to right: `Input Histogram` (130 px histogram); `Input` column with high spin 1…255 default 255, upper color panel, lower color panel, low spin 0…254 default 0, adjacent two-stop vertical gradient; `Output` with adjacent three-stop vertical gradient, then high spin 2…255 default 255, high color panel, gamma spin 0…100 step .1 default 1, mid color panel, low color panel, low spin 0…252 default 0; `Output Histogram` (130 px histogram).
- Bottom action row, exact order: **Auto**, **Reset**, Red, Green, Blue channel checks (all checked), **Cancel**, **OK**. Clicking input/output endpoint color panels opens native Choose Color. Gradient handles can be dragged. Histograms and preview update live.
- Web: custom Levels editor exists. **Gap (critical):** the web layout is a channel/range form rather than the native four-column histogram/gradient/color-panel instrument; it lacks the native Auto/Reset/channel action row and nested color dialogs and uses Cancel/Apply.

### Posterize

- Command/source: Adjustments → Posterize; `original/Pinta.Effects/Dialogs/Effects.PosterizeDialog.cs`; bespoke.
- Native size: **412×300** (`adjustment-posterize.png`; source requests 400×300 plus decorations).
- Controls, exact order: `slider(Red, 2…64, 1, 16)`; `slider(Green, 2…64, 1, 16)`; `slider(Blue, 2…64, 1, 16)`; `check(Linked, true)`. Linked edits synchronize all channels.
- Actions/preview: per-channel reset arrows; live preview; Cancel, OK.
- Web: three channel sliders. **Gap (critical):** web max is 32 and default is 4 (native max 64/default 16), Linked is missing, and native reset/action/layout semantics are absent.

### Sepia

- Command/source: Adjustments → Sepia; `original/Pinta.Effects/Adjustments/SepiaEffect.cs`; reflective.
- Native size: **400×119** (`adjustment-sepia.png`).
- Controls: `slider(Strength, 0…100, 1, 100)`.
- Actions/preview: reset arrow; live preview; Cancel, OK.
- Web: Sepia has no parameters and is applied immediately. **Gap (critical):** the entire current native configuration dialog and variable-strength behavior are missing.

## Effects — Artistic

### Ink Sketch

- Source/size: `Effects/InkSketchEffect.cs`; **400×192** (`artistic-ink-sketch.png`).
- Controls: `slider(Ink Outline, 0…99, 1, 50)`; `slider(Coloring, 0…100, 1, 50)`.
- Web/gap: parameter parity; **medium** shared-dialog/reset/action mismatch.

### Oil Painting

- Source/size: `Effects/OilPaintingEffect.cs`; **400×192** (`artistic-oil-painting.png`).
- Controls: `slider(Brush Size, 1…8, 1, 3)`; `slider(Coarseness, 3…255, 1, 50)`.
- Web/gap: parameter parity; **medium** shared-dialog mismatch.

### Pencil Sketch

- Source/size: `Effects/PencilSketchEffect.cs`; **400×192** (`artistic-pencil-sketch.png`).
- Controls: `slider(Pencil Tip Size, 1…20, 1, 2)`; `slider(Color Range, -20…20, 1, 0)`.
- Web/gap: parameter parity; **medium** shared-dialog mismatch.

All Artistic dialogs live-preview and end with Cancel, OK; every numeric row has a reset arrow.

## Effects — Blurs

### Fragment

- Source/size: `Effects/FragmentEffect.cs`; **400×281** (`blur-fragment.png`).
- Controls: `slider(Fragments, 2…50, 1, 4)`; `slider(Distance, 0…100, 1, 8)`; `angle(Rotation, 0°)`.
- Web/gap: values exist, but Rotation is a plain 0…360 slider rather than the native dial/spin/reset; **high**.

### Gaussian Blur

- Source/size: `Effects/GaussianBlurEffect.cs`; **400×119** (`blur-gaussian-blur.png`).
- Controls: `slider(Radius, 0…200, 1, 2)`.
- Web/gap: web uses 1…30 default 4; **critical numeric mismatch** plus shared-dialog mismatch.

### Motion Blur

- Source/size: `Effects/MotionBlurEffect.cs`; **400×248** (`blur-motion-blur.png`).
- Controls: `angle(Angle, 25°)`; `slider(Distance, 1…200, 1, 10)`; `check(Centered, true)`.
- Web/gap: data parity; angle dial/reset missing; **high**.

### Radial Blur

- Source/size: `Effects/RadialBlurEffect.cs`; **400×387** (`blur-radial-blur.png`).
- Controls: `angle(Angle, 2°)`; `offset(Offset, 0,0)`; `slider(Quality, 1…5, 1, 2)`; wrapped hint `Use low quality for previews, small images, and small angles. Use high quality for final quality, large images, and large angles.`
- Web/gap: Offset is split into two -1…1 sliders and the native 2-D picker and quality hint are missing; angle is plain; **critical layout/control mismatch**.

### Unfocus

- Source/size: `Effects/UnfocusEffect.cs`; **400×119** (`blur-unfocus.png`).
- Controls: `slider(Radius, 1…200, 1, 4)`.
- Web/gap: parameter parity; **medium** shared-dialog mismatch.

### Zoom Blur

- Source/size: `Effects/ZoomBlurEffect.cs`; **400×232** (`blur-zoom-blur.png`).
- Controls: `slider(Amount, 0…100, 1, 10)`; `offset(Offset, 0,0)`.
- Web/gap: offset is two sliders rather than 2-D picker; **high**.

All Blur dialogs are reflective, live-preview, have per-control reset where applicable, and end Cancel, OK.

## Effects — Color

### Dithering

- Source/size: `Effects/DitheringEffect.cs`; **400×265** (`color-dithering.png`).
- Controls, exact order: `select(Error Diffusion Method, Floyd-Steinberg)` with Sierra, Two-Row Sierra, Sierra Lite, Burkes, Atkinson, Stucki, Jarvis-Judice-Ninke, Floyd-Steinberg, Floyd-Steinberg Lite; `select(Palette Source, Preset Palettes)` with Preset Palettes, Current Palette, Recently Used Colors; `select(Palette, OldWindows16)` with raw enum labels BlackWhite, OldMsPaint, OldWindows16, OldWindows20, Rgb3Bit, Rgb666, Rgb6Bit, Rgb12Bit.
- Actions/preview: live preview; Cancel, OK. Native does not conditionally hide Palette when source changes.
- Web/gap: choices largely exist, but labels are prettified and Palette is hidden outside Preset Palettes; generic intro/actions differ; **high** fidelity gap.

## Effects — Distort

### Bulge

- Source/size: `Effects/BulgeEffect.cs`; **400×305** (`distort-bulge.png`).
- Controls: `slider(Amount, -200…100, 1, 45)`; `offset(Offset, 0,0)`; `slider(Radius Percentage, 10…100, 1, 100)`.
- Web/gap: parameters exist but offset is split into sliders; **high**.

### Dents

- Source/size: `Effects/DentsEffect.cs`; **400×670** (`distort-dents.png`).
- Controls: `slider(Scale, 1…200, 1, 25, 2)`; `slider(Refraction, 0…200, 1, 50, 2)`; `slider(Roughness, 0…100, 1, 10, 2)`; `slider(Turbulence, 0…100, 1, 10, 2)` (property is named `Tension`); `seed(Random Noise Seed, 0…255, 0)`; `slider(Quality, 1…5, 1, 2)`; `offset(Center Offset, 0,0)`; `select(Edge Behavior, Wrap)` with Clamp, Wrap, Reflect, Primary, Secondary, Transparent, Original.
- Web/gap: raw parameters exist, but seed is a slider with no Reseed and center is split; **critical** due specialized controls and tall responsive layout.

### Frosted Glass

- Source/size: `Effects/FrostedGlassEffect.cs`; **400×192** (`distort-frosted-glass.png`).
- Controls: `slider(Amount, 1…10, 1, 1)`; `seed(Random Noise Seed, 0…2,147,483,646, 0)`.
- Web/gap: seed is plain range input, unusable at this range and lacks Reseed; **critical control mismatch**.

### Pixelate

- Source/size: `Effects/PixelateEffect.cs`; **400×119** (`distort-pixelate.png`).
- Controls: `slider(Cell Size, 1…100, 1, 2)`.
- Web/gap: parameter parity; **medium** shared-dialog mismatch.

### Polar Inversion

- Source/size: `Effects/PolarInversionEffect.cs`; **400×378** (`distort-polar-inversion.png`).
- Controls: `slider(Amount, -4…4, .1, 0, 2)`; `slider(Quality, 1…5, 1, 2)`; `offset(Center Offset, 0,0)`; `select(Edge Behavior, Reflect)` with the seven shared values.
- Web/gap: center split into sliders; **high**.

### Tile Reflection

- Source/size: `Effects/TileEffect.cs`; **400×427** (`distort-tile-reflection.png`).
- Controls: `angle(Rotation, 30°)` with attribute guidance -45…45; `slider(Tile Size, 2…200, 1, 40)`; `slider(Intensity, -20…20, 1, 8)`; `select(Tile Type, Sharp Edges)` with Sharp Edges, Curved; `select(Edge Behavior, Wrap)`.
- Web/gap: value parity but graphical angle/reset missing; **high**.

### Twist

- Source/size: `Effects/TwistEffect.cs`; **400×451** (`distort-twist.png`).
- Controls: `slider(Amount, -100…100, 1, 30)`; `slider(Radius Percentage, 0…100, 1, 100)`; `slider(Antialias, 0…5, 1, 2)`; `offset(Center Offset, 0,0)`; `select(Edge Behavior, Clamp)`.
- Web/gap: center split into sliders; **high**.

All Distort dialogs live-preview and use per-control reset plus bottom Cancel, OK.

## Effects — Noise

### Add Noise

- Source/size: `Effects/AddNoiseEffect.cs`; **400×338** (`noise-add-noise.png`).
- Controls: `slider(Intensity, 0…100, 1, 64)`; `slider(Color Saturation, 0…400, 1, 100)`; `slider(Coverage, 0…100, 1, 100, 2)`; `seed(Random Noise Seed, 0…2,147,483,646, 0)`.
- Web/gap: web only has Intensity 0…100 default 24 and Color saturation 0…100 default 35; Coverage and Seed are absent. **Critical functional and default/range mismatch.**

### Median

- Source/size: `Effects/MedianEffect.cs`; **400×192** (`noise-median.png`).
- Controls: `slider(Radius, 1…200, 1, 10)`; `slider(Percentile, 0…100, 1, 50)`.
- Web/gap: parameter parity; **medium** shared-dialog mismatch.

### Reduce Noise

- Source/size: `Effects/ReduceNoiseEffect.cs`; **400×192** (`noise-reduce-noise.png`).
- Controls: `slider(Radius, 1…200, 1, 6)`; `slider(Strength, 0…1, .01, .4, 2)`.
- Web/gap: parameter parity; **medium** shared-dialog mismatch.

All Noise dialogs live-preview and end Cancel, OK.

## Effects — Object

### Align Object

- Command/source: Effects → Object → Align Object; `original/Pinta.Effects/Dialogs/Effects.AlignmentDialog.cs`; bespoke.
- Native size: **159×184** (`object-align-object.png`).
- Exact layout: a homogeneous 3×3 icon-toggle grid with 6 px gaps and 12 px outer margins. Order is Top Left, Top Center, Top Right / Center Left, Center (selected by default), Center Right / Bottom Left, Bottom Center, Bottom Right. Each icon has the matching tooltip. No descriptive text.
- Actions/preview: selection is mutually exclusive and previews live; bottom Cancel, OK.
- Web/gap: a 3×3 custom alignment editor exists, but it is wrapped in the generic 520 px icon/description/hint shell and Cancel/Apply header. **Critical visual-size mismatch** despite functional position parity.

### Feather Object

- Source/size: `Effects/FeatherEffect.cs`; **400×232** (`object-feather-object.png`).
- Controls: `slider(Radius, 1…100, 1, 6)`; `slider(Tolerance, 0…255, 1, 20)`; `check(Feather Canvas Edge, false)`.
- Web/gap: parameter parity; **medium** shared-dialog mismatch.

### Outline Object

- Source/size: `Effects/OutlineObjectEffect.cs`; **400×352** (`object-outline-object.png`).
- Controls: `slider(Radius, 0…100, 1, 6)`; `slider(Tolerance, 0…255, 1, 20)`; `check(Alpha Gradient, true)`; `check(Color Gradient, true)`; `check(Outline Border, false)`; `check(Fill Object Background, true)`.
- Web/gap: parameter parity; **medium** shared-dialog mismatch.

## Effects — Photo

### Glow

- Source/size: `Effects/GlowEffect.cs`; **400×265** (`photo-glow.png`).
- Controls: `slider(Radius, 1…20, 1, 6)`; `slider(Brightness, -100…100, 1, 10)`; `slider(Contrast, -100…100, 1, 10)`.
- Web/gap: web Radius extends to 24 rather than native 20; otherwise the three values match. **High numeric/shared-dialog mismatch.**

### Red Eye Removal

- Source/size: `Effects/RedEyeRemoveEffect.cs`; **400×240** (`photo-red-eye-removal.png`).
- Controls: `slider(Tolerance, 0…100, 1, 70)`; `slider(Saturation Percentage, 0…100, 1, 90)`; hint `Hint: For best results, first use selection tools to select each eye.`
- Web/gap: values exist but the essential native usage hint is absent; **high usability mismatch**.

### Sharpen

- Source/size: `Effects/SharpenEffect.cs`; **400×119** (`photo-sharpen.png`).
- Controls: `slider(Amount, 1…20, 1, 2)`.
- Web/gap: web maximum is 10; **high numeric mismatch** plus shared layout.

### Soften Portrait

- Source/size: `Effects/SoftenPortraitEffect.cs`; **400×265** (`photo-soften-portrait.png`).
- Controls: `slider(Softness, 0…10, 1, 5)`; `slider(Lighting, -20…20, 1, 0)`; `slider(Warmth, 0…20, 1, 10)`.
- Web/gap: parameter parity; **medium** shared-dialog mismatch.

### Vignette

- Source/size: `Effects/VignetteEffect.cs`; **400×305** (`photo-vignette.png`).
- Controls: `point(Offset, canvas center on first run)`; `slider(Radius Percentage, 10…400, 1, 50)`; `slider(Strength, 0…1, .01, 1, 2)`.
- Web/gap: web exposes only Amount 0…100 default 55 and Radius 10…100 default 65; Offset is absent and names/ranges/defaults do not match. **Critical functional and layout mismatch.**

All Photo dialogs live-preview, use per-control reset where applicable, and end Cancel, OK.

## Effects — Render

### Cells

- Source/size: `Effects/CellsEffect.cs`; **400×929** (`render-cells.png`).
- Controls, exact order: `select(Distance Metric, Euclidean)` [Euclidean, Manhattan, Chebyshev]; `select(Point Arrangement, Random)` [Random, Circular, Phyllotaxis]; `seed(Random Point Locations, 0)`; `check(Show Points, false)`; `slider(Point Size, 1…16, 1, 4, 2)`; `color(Point Color, black)`; `slider(Number of Cells, 1…1024, 1, 100)`; `slider(Cell Radius, 4…100, 1, 32, 2)`; `select(Color Scheme Source, Preset Gradient)` [Preset Gradient, Selected Colors, Random]; conditionally visible `select(Color Scheme, Black and White)` with the nine preset gradients; conditionally visible when Random `seed(Random Color Scheme Seed, 0)`; `check(Reverse Color Scheme, false)`; `select(Color Scheme Edge Behavior, Clamp)`; `slider(Quality, 1…4, 1, 3)`.
- Special behavior: Point Color opens the complete native color picker. In this source revision Random Point Locations, Point Size, and Point Color remain present regardless of the two check/combo states; only the color-scheme and color-seed widgets have `VisibleWhen`.
- Web/gap: most values exist, but point seed is hidden for non-Random and point size/color are hidden unless Show Points; seed has no Reseed; color uses the browser color input; no scroll/max-height means the dialog can exceed the viewport. **Critical broken/responsive and fidelity mismatch.**

### Clouds

- Source/size: `Effects/CloudsEffect.cs`; **400×378** (`render-clouds.png`).
- Controls: `slider(Scale, 2…1000, 1, 250)`; `slider(Power, 0…100, 1, 50)`; `seed(Random Noise Seed, 0)`; `select(Color Scheme Source, Selected Colors)`; visible for Preset Gradient `select(Color Scheme, Beautiful Italy)`; visible for Random `seed(Random Color Scheme Seed, 0)`; `check(Reverse Color Scheme, false)`.
- Web/gap: data mostly exists, but seed widgets and shared layout differ; **high**.

### Julia Fractal

- Source/size: `Effects/JuliaFractalEffect.cs`; **400×540** (`render-julia-fractal.png`).
- Controls: `slider(Factor, 1…10, 1, 4)`; `slider(Quality, 1…5, 1, 2)`; `slider(Zoom, 0…50, .5, 1, 2)`; `select(Color Scheme Source, Preset Gradient)`; conditional `select(Color Scheme, Bonfire)`; conditional `seed(Random Color Scheme Seed, 0)`; `check(Reverse Color Scheme, false)`; `angle(Angle, 0°)`.
- Web/gap: web Zoom starts at .5 rather than native 0; seed/angle special widgets and native compact order are missing; **high**.

### Mandelbrot Fractal

- Source/size: `Effects/MandelbrotFractalEffect.cs`; **400×580** (`render-mandelbrot-fractal.png`).
- Controls: `slider(Factor, 1…10, 1, 1)`; `slider(Quality, 1…5, 1, 2)`; `slider(Zoom, 0…100, .5, 10, 2)`; `angle(Angle, 0°)`; `select(Color Scheme Source, Preset Gradient)`; conditional `select(Color Scheme, Electric)`; conditional `seed(Random Color Scheme Seed, 0)`; `check(Reverse Color Scheme, false)`; `check(Invert Colors, false)`.
- Web/gap: values mostly exist, but seed/angle widgets differ; **high**.

### Voronoi Diagram

- Source/size: `Effects/VoronoiDiagramEffect.cs`; **400×637** (`render-voronoi-diagram.png`).
- Controls: `select(Distance Metric, Euclidean)`; `slider(Number of Cells, 1…1024, 1, 100)`; `select(Color Sorting, Random)` [Random, Horizontal blue (B), Horizontal green (G), Horizontal red (R), Vertical blue (B), Vertical green (G), Vertical red (R)]; `check(Reverse Color Sorting, false)`; `seed(Random Colors, 0)`; `select(Point Arrangement, Random)`; visible only for Random `seed(Random Point Locations, 0)`; `check(Show Points, false)`; visible only when Show Points `slider(Point Size, 1…16, 1, 4, 2)`; visible only when Show Points `color(Point Color, black)`; `slider(Quality, 1…4, 1, 3)`.
- Web/gap: values/conditions mostly exist, but Reseed, nested Pinta color picker, exact enum ordering, and responsive scrolling are missing; **critical**.

All Render dialogs live-preview and end Cancel, OK. The 929 px native Cells reference demonstrates that the native window is content-sized; the web port must instead preserve the layout inside the browser viewport with a scrollable content body and pinned actions.

## Effects — Stylize

### Edge Detect

- Source/size: `Effects/EdgeDetectEffect.cs`; **400×135** (`stylize-edge-detect.png`).
- Controls: `angle(Angle, 45°)`.
- Web/gap: angle is a range input rather than graphical dial; **high**.

### Emboss

- Source/size: `Effects/EmbossEffect.cs`; **400×135** (`stylize-emboss.png`).
- Controls: `angle(Angle, 0°)`.
- Web/gap: angle dial missing; **high**.

### Outline Edge

- Source/size: `Effects/OutlineEdgeEffect.cs`; **400×192** (`stylize-outline-edge.png`).
- Controls: `slider(Thickness, 1…200, 1, 3)`; `slider(Intensity, 0…100, 1, 50)`.
- Web/gap: parameter parity; **medium** shared-dialog mismatch.

### Relief

- Source/size: `Effects/ReliefEffect.cs`; **400×135** (`stylize-relief.png`).
- Controls: `angle(Angle, 45°)`.
- Web/gap: angle dial missing; **high**.

All Stylize dialogs live-preview and end Cancel, OK.

## Exhaustiveness check

| Native registration group | Registered commands | Configurable dialogs | Captured |
| --- | ---: | ---: | ---: |
| Adjustments | 9 | 6 | 6 |
| Artistic | 3 | 3 | 3 |
| Blurs | 6 | 6 | 6 |
| Color | 1 | 1 | 1 |
| Distort | 7 | 7 | 7 |
| Noise | 3 | 3 | 3 |
| Object | 3 | 3 | 3 |
| Photo | 5 | 5 | 5 |
| Render | 5 | 5 | 5 |
| Stylize | 4 | 4 | 4 |
| **Total** | **46** | **43** | **43** |

The three registered one-click adjustments without a dialog are Auto Level, Black and White, and Invert Colors. Sepia is included in the current configurable and captured counts.

## Highest-severity backport work

1. Make the dialog body viewport-safe and scrollable, with pinned native-order actions. Cells, Voronoi, Mandelbrot, Julia, and Dents are currently at risk of being clipped or unusable.
2. Implement reusable native compound widgets: numeric scale+spin+reset, graphical angle dial, 2-D point/offset picker, seed spin+Reseed, and Pinta color well that opens the full picker.
3. Restore exact native actions and preview semantics: Cancel/OK (not Apply), per-control reset, real canvas live preview while controls move, and no generic intro/hint shell.
4. Backport bespoke Levels, Posterize, Curves, and Align Object layouts rather than forcing them into the generic web shell.
5. Correct functional mismatches: Sepia Strength; Posterize range/default/Linked; Gaussian radius; Add Noise Coverage/Seed and ranges/defaults; Sharpen maximum; Vignette Offset/ranges/defaults; and Cells visibility rules.

## Capture provenance

The PNGs were generated by starting the checked-in GTK Pinta build in the project’s Linux/amd64 Xvfb capture container, navigating the real accessible menus, locating each dialog window, and capturing that window directly. `tests/visual/native/capture.sh` contains the deterministic menu catalog. The adjustment catalog was updated to include the new configurable Sepia dialog so future full native capture runs remain exhaustive.
