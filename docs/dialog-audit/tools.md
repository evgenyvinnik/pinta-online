# Native Pinta tool, flyout, chooser, overflow, and add-in dialog audit

> Implementation-status note: the “Current web mapping and gap” entries below record the web implementation at audit time and are intentionally preserved as gap provenance. Several listed gaps have since been closed. Use the current application, approved Playwright screenshots, and [`../parity-hardening.md`](../parity-hardening.md) for present behavior; use this document and its references as the native specification.

Status: complete source audit of every registered core tool and every UI surface supplied by the five targeted add-ins. This is an implementation specification, not a sample.

## Scope and evidence

The audited native executable is Pinta `3.1.2+b3df1e579f6b3dd23193d2f6877deced20d8063b` from `/Applications/Pinta.app`. The checked-in C# implementation under `original/` was used as the authoritative control/layout source. The five add-in repositories were inspected at these upstream commits:

| Add-in | Upstream commit |
| --- | --- |
| Ars Kali: Glitches | `aab589cda0c213e12e6c3a02388678d0d645ca14` |
| Block Brush | `5df5563f5814bf04cfdd23f64508d99481e01424` |
| Colored Grayscale | `3acdb4417b598611bbae1c19827c5660fa615fb1` |
| More Pixelates | `f5cfb73bfc26d58cb4ec9cd1f28f27afe546182d` |
| Night Vision | `e972fec0850c2602e3e2400931839bc1a9adb14d` |

Current-web comparisons in this audit were made against `src/App.tsx`, `src/styles.css`, `src/editor/tools.ts`, `src/effects/types.ts`, and `src/addins/registry.ts`.

The live native window was captured successfully through its Core Graphics window ID. Programmatic interaction with child GTK popovers was blocked by macOS Accessibility event permission: the window is readable/capturable, but synthetic clicks and System Events cannot drive it. Therefore:

- `native-pinta-3.1.2-base-tool-toolbar.png` and `native-pinta-3.1.2-selection-toolbar-crop.png` are real native captures.
- Every file beginning with `reconstructed-` is explicitly labelled inside the image as a source reconstruction, not a live capture.
- Reconstructions preserve source control order, control kind, labels, conditional visibility, ranges, defaults, and explicit sizes. GTK theme-dependent pixel widths are not asserted where the source does not set them.

Reference images are in `tests/visual/native-dialog-references/tools/`:

| Reference | Contents |
| --- | --- |
| `native-pinta-3.1.2-base-tool-toolbar.png` | Full live Pinta window showing the 48 px tool toolbar and Rectangle Select options |
| `native-pinta-3.1.2-selection-toolbar-crop.png` | Live crop of Tool → Selection Mode → Replace |
| `reconstructed-tool-dropdowns-selection-flood.png` | Selection mode, autoscroll, lasso, flood, eraser, antialiasing flyouts |
| `reconstructed-tool-dropdowns-brush-gradient-picker.png` | Brush, gradient, sampling, after-select, and blending flyouts |
| `reconstructed-shape-flyouts.png` | Shape/fill/dash popups and the complete conditional arrow toolbar |
| `reconstructed-text-choosers.png` | Font family chooser, variant, weight, style, join, and full toolbar order |
| `reconstructed-toolbar-overflow-no-popup-tools.png` | Native overflow contract and explicit no-popup tools |
| `reconstructed-addin-manager.png` | Native Add-in Manager tabs, list/detail split, and per-add-in actions |
| `reconstructed-addin-install-dialogs.png` | Install, uninstall, package-file chooser, and corrupt-package error states |
| `reconstructed-addin-effect-dialogs-1.png` | All six Ars Kali configuration dialogs |
| `reconstructed-addin-effect-dialogs-2.png` | Hexagon Pixelate, Night Vision, and add-ins with no dialog |

The references are reproducible with:

```sh
node scripts/generate-native-tool-dialog-references.mjs
```

## Native popup and overflow contracts shared by tools

These contracts apply before considering any individual tool.

1. **Tool toolbar** — `original/Pinta/MainWindow.cs` requests a height of 48 px. `ToolManager` adds, in order, the `Tool:` label, active tool icon, separator, then a `Gtk.ScrolledWindow` containing the tool's horizontal option box.
2. **Overflow** — `original/Pinta.Core/Managers/ToolManager.cs` uses automatic horizontal scrolling, never a vertical scrollbar, no frame, overlay scrolling, bottom-right placement, and horizontal expansion. Long controls are not compressed or wrapped. The line and text toolbars rely on this.
3. **Icon dropdown** — `original/Pinta.Core/Widgets/ToolBarDropDownButton.cs` is `Gtk.DropDown`. Its closed state is selected icon only unless `New(true)` is used. Every open row is `icon → label → trailing selected checkmark`; the row width is content-driven.
4. **Text combo** — `ToolBarComboBox` is `Gtk.ComboBoxText`. Source-requested widths are noted below. Dash combos are editable; other tool combos are not.
5. **Toolbar spinner** — `Gtk.SpinButton`, focus-on-click false, range and step specified per tool. Editing returns focus to the canvas.
6. **Toolbar slider** — horizontal `Gtk.Scale`, explicit width 150 px, value drawn on the left, integer steps.
7. **Antialias flyout** — `Antialiasing On` (default index 0) then `Antialiasing Off`, icons `AntiAliasingEnabled` / `AntiAliasingDisabled`.
8. **Alpha blending flyout** — `Normal Blending` (default index 0) then `Overwrite`, icons `BlendingNormal` / `BlendingOverwrite`.

The web toolbar is also horizontally scrollable (`.tool-options-bar`), but it hides the scrollbar entirely. That makes overflow nearly undiscoverable for the line and text tools; native GTK reveals overlay-scroll affordance during interaction.

## Exhaustive core tool inventory

Pinta registers exactly **22 core tools** in `original/Pinta.Tools/CoreToolsExtension.cs`. All 22 are accounted for below. “None” means the native tool really has no tool-specific chooser or popup; it is not missing from this audit.

| # | Native tool | Exact native toolbar order after tool icon | Popup/chooser surfaces | Current web mapping and gap |
| ---: | --- | --- | --- | --- |
| 1 | Move Selected Pixels | none | none | Empty options bar segment; parity |
| 2 | Move Selection | none | none | Empty options bar segment; parity |
| 3 | Zoom | none | none | Empty options bar segment; parity |
| 4 | Pan | none | none | Empty options bar segment; parity |
| 5 | Rectangle Select | `Selection Mode` combo → separator → Autoscroll dropdown | Selection Mode, Autoscroll | Controls exist. Web popup rows do not reproduce native icon/checkmark construction; autoscroll labels and icons differ |
| 6 | Ellipse Select | same as Rectangle Select | Selection Mode, Autoscroll | Same gap |
| 7 | Lasso Select | `Selection Mode` combo → separator → `Lasso Mode` dropdown | Selection Mode, Lasso Mode | Controls exist; flyout is browser-select based and lacks native row icons/checkmark |
| 8 | Magic Wand Select | `Flood Mode` dropdown → separator → Tolerance slider → separator → `Selection Mode` combo | Flood Mode, Selection Mode | Semantics exist; selection/flood popups are not native-layout popovers |
| 9 | Paintbrush | `Brush width` spinner → separator → `Type` combo → active-brush options → separator → Antialias dropdown | Brush type; conditional Slash/Splatter controls; Antialias | **Missing Slash Angle and Splatter Minimum/Maximum Size. Block is incorrectly a separate tool instead of a Type item. Brush order differs.** |
| 10 | Pencil | separator → Alpha Blending dropdown | Blending | Mapped |
| 11 | Eraser | `Brush width` spinner → `Type` combo → separator → Antialias dropdown | Eraser Type, Antialias | Mapped semantically; web uses generic native select |
| 12 | Paint Bucket | `Flood Mode` dropdown → separator → Tolerance slider | Flood Mode | Mapped semantically |
| 13 | Gradient | `Gradient` dropdown → separator → `Mode` dropdown → separator → Alpha Blending dropdown | Gradient Type, Color Mode, Blending | All choices mapped; popup construction is not native |
| 14 | Color Picker | `Sampling` label → sample-size dropdown → sample-source dropdown → separator → `After select` label → after-select dropdown | three text-bearing icon dropdowns | Choices mapped. Sample size and after-select are plain browser selects, so open layout/icon/check state is behind native |
| 15 | Text | Font family button → separator → Variant dropdown → separator → font-size spinner → separator → Weight dropdown → Italic → Underline → separator → Left/Center/Right alignment → separator → `Text Style` dropdown → conditional separator/Outline width/Join dropdown → separator → Antialias dropdown | Font dialog, Variant, Weight, Text Style, Join, Antialias | **Outline width and Join are entirely missing. Font chooser is only seven hard-coded families, not the system family dialog. Long toolbar becomes unusable because overflow is hidden.** |
| 16 | Line/Curve | Shape Type → common shape controls → Arrow 1/2 checks → conditional Size/Angle/Length → separator → Antialias | Shape Type, Fill, Dash, Arrow, Antialias | **Arrow Size/Angle/Length missing. Dash is not editable and has only four approximations instead of nine native presets.** |
| 17 | Rectangle | Shape Type → common shape controls → separator → Antialias | Shape Type, Fill, Dash, Antialias | Basic mapping exists; Dash is incomplete/noneditable |
| 18 | Rounded Rectangle | Shape Type → separator → Radius → common shape controls → separator → Antialias | Shape Type, Fill, Dash, Antialias | Basic mapping exists and Radius order is correct; Dash incomplete/noneditable |
| 19 | Ellipse | Shape Type → common shape controls → separator → Antialias | Shape Type, Fill, Dash, Antialias | Basic mapping exists; Dash incomplete/noneditable |
| 20 | Freeform Shape | `Fill Style` dropdown → separator → Brush width → Dash combo → separator → Antialias | Fill, Dash, Antialias | Basic mapping exists; Dash incomplete/noneditable |
| 21 | Clone Stamp | Brush width → separator → Antialias | Antialias only | Mapped |
| 22 | Recolor | Brush width → separator → Tolerance slider → separator → Antialias | Antialias only (Tolerance is a slider, not popup) | Mapped semantically |

### Core tool source map

Shared registration and toolbar hosting come from `original/Pinta.Tools/CoreToolsExtension.cs`, `original/Pinta.Core/Classes/BaseTool.cs`, and `original/Pinta.Core/Managers/ToolManager.cs`. The source owning each registered tool's options is:

| Tool(s) | Owning source, including option-providing base where applicable |
| --- | --- |
| Move Selected Pixels | `original/Pinta.Tools/Tools/MoveSelectedTool.cs`; `BaseTransformTool.cs` |
| Move Selection | `original/Pinta.Tools/Tools/MoveSelectionTool.cs`; `BaseTransformTool.cs` |
| Zoom | `original/Pinta.Tools/Tools/ZoomTool.cs` |
| Pan | `original/Pinta.Tools/Tools/PanTool.cs` |
| Rectangle Select | `original/Pinta.Tools/Tools/RectangleSelectTool.cs`; `SelectTool.cs` |
| Ellipse Select | `original/Pinta.Tools/Tools/EllipseSelectTool.cs`; `SelectTool.cs` |
| Lasso Select | `original/Pinta.Tools/Tools/LassoSelectTool.cs`; `SelectTool.cs` |
| Magic Wand Select | `original/Pinta.Tools/Tools/MagicWandTool.cs`; `FloodTool.cs` |
| Paintbrush | `original/Pinta.Tools/Tools/PaintBrushTool.cs`; `BaseBrushTool.cs`; `original/Pinta.Tools/Brushes/*.cs` |
| Pencil | `original/Pinta.Tools/Tools/PencilTool.cs` |
| Eraser | `original/Pinta.Tools/Tools/EraserTool.cs`; `BaseBrushTool.cs` |
| Paint Bucket | `original/Pinta.Tools/Tools/PaintBucketTool.cs`; `FloodTool.cs` |
| Gradient | `original/Pinta.Tools/Tools/GradientTool.cs` |
| Color Picker | `original/Pinta.Tools/Tools/ColorPickerTool.cs` |
| Text | `original/Pinta.Tools/Tools/TextTool.cs` |
| Line/Curve | `original/Pinta.Tools/Tools/LineCurveTool.cs`; `ShapeTool.cs`; `original/Pinta.Tools/Editable/EditEngines/ArrowedEditEngine.cs` |
| Rectangle | `original/Pinta.Tools/Tools/RectangleTool.cs`; `ShapeTool.cs`; `original/Pinta.Tools/Editable/EditEngines/BaseEditEngine.cs` |
| Rounded Rectangle | `original/Pinta.Tools/Tools/RoundedRectangleTool.cs`; `ShapeTool.cs`; `original/Pinta.Tools/Editable/EditEngines/RoundedLineEditEngine.cs` |
| Ellipse | `original/Pinta.Tools/Tools/EllipseTool.cs`; `ShapeTool.cs`; `original/Pinta.Tools/Editable/EditEngines/BaseEditEngine.cs` |
| Freeform Shape | `original/Pinta.Tools/Tools/FreeformShapeTool.cs`; `ShapeTool.cs`; `original/Pinta.Tools/Editable/EditEngines/BaseEditEngine.cs` |
| Clone Stamp | `original/Pinta.Tools/Tools/CloneStampTool.cs`; `BaseBrushTool.cs` |
| Recolor | `original/Pinta.Tools/Tools/RecolorTool.cs`; `BaseBrushTool.cs` |

## Exact tool popup contents, ranges, and defaults

### Selection tools

Source: `original/Pinta.Core/Classes/SelectionModeHandler.cs`, `SelectTool.cs`, `LassoSelectTool.cs`, `FloodTool.cs`, and `MagicWandTool.cs`.

| Surface | Trigger | Exact rows/order | Type, size, default |
| --- | --- | --- | --- |
| Selection Mode | click the toolbar combo on Rectangle Select, Ellipse Select, Lasso Select, or Magic Wand | `Replace`; `Union (+) (Command + Left Click)`; `Exclude (-) (Right Click)`; `Xor (Command + Right Click)`; `Intersect (Option + Left Click)` on macOS | noneditable `Gtk.ComboBoxText`, requested width 170, default index 0 |
| Autoscroll | click icon after Selection Mode on Rectangle/Ellipse Select | `Autoscroll On`; `Autoscroll Off` | icon-only `Gtk.DropDown`, default index 0 / true |
| Lasso Mode | click icon after `Lasso Mode:` | `Freeform`; `Polygon` | icon-only `Gtk.DropDown`, default index 0 / false |
| Flood Mode | click icon after `Flood Mode:` on Paint Bucket/Magic Wand | `Contiguous`; `Global` | icon-only `Gtk.DropDown`, default index 0 / false |
| Tolerance | inline, not popup | 0–100, step 1, left-side displayed value | 150 px `Gtk.Scale`, default 0 for both flood tools |

Native Autoscroll icons are `EffectsBlursZoomBlur` and `EffectsBlursUnfocus`. The current web substitute icons (`tool-move-selection`, `tool-select-rectangle`) are not correct.

### Paintbrush, eraser, recolor, and clone

Source: `BaseBrushTool.cs`, `PaintBrushTool.cs`, `EraserTool.cs`, `RecolorTool.cs`, `CloneStampTool.cs`, `ToolOptionWidgetService.cs`, and `original/Pinta.Tools/Brushes/*.cs`.

| Surface/control | Exact contents/range/default |
| --- | --- |
| Brush width | spinner 1–100000, step 1, default 2 |
| Paintbrush Type | noneditable combo, requested width 100. Built-in sorted order is `Normal`, `Circles`, `Grid`, `Slash`, `Splatter`, `Squares`. With Block Brush installed, `Block` sorts after `Normal` and before `Circles` |
| Slash option | `Angle:` integer spinner, 0–180, step 1, default 45 |
| Splatter option | `Minimum Size:` integer spinner 1–10000 default 5, then `Maximum Size:` integer spinner 1–10000 default 10 |
| Eraser Type | noneditable combo, requested width 100: `Normal`, `Smooth`; default `Normal` |
| Recolor Tolerance | 0–100 slider, step 1, width 150, default 50 |
| Antialias | shared On/Off flyout, default On |

Built-in `Normal`, `Circles`, `Grid`, `Squares` have no brush-specific popup. Block Brush also has no brush-specific popup.

### Gradient and color picker

Source: `GradientTool.cs` and `ColorPickerTool.cs`.

| Surface | Exact rows/order | Closed state/default |
| --- | --- | --- |
| Gradient | `Linear Gradient`; `Linear Reflected Gradient`; `Linear Diamond Gradient`; `Radial Gradient`; `Conical Gradient` | icon-only; Linear |
| Gradient Mode | `Color Mode`; `Transparency Mode` | icon-only; Color |
| Alpha Blending | `Normal Blending`; `Overwrite` | icon-only; Normal |
| Sampling size | `Single Pixel`; `3 x 3 Region`; `5 x 5 Region`; `7 x 7 Region`; `9 x 9 Region` | icon + visible label (`New(true)`); Single Pixel |
| Sampling source | `Layer`; `Image` | icon + visible label; Layer |
| After select | `Do not switch tool`; `Switch to previous tool`; `Switch to Pencil tool` | icon + visible label; Do not switch |

Changing sample size immediately rebuilds the native cursor outline.

### Editable shapes, fill, dash, and arrows

Source: `BaseEditEngine.cs`, `RoundedLineEditEngine.cs`, `ArrowedEditEngine.cs`, and `DashPatternBox.cs`.

| Surface/control | Exact contents/range/default |
| --- | --- |
| Shape Type | `Open Line/Curve Series`; `Closed Line/Curve Series`; `Ellipse`; `Rounded Line Series`. Icon-only dropdown. The selected tool forces its corresponding item |
| Fill Style | `Outline Shape`; `Fill Shape`; `Fill and Outline Shape`; default Outline |
| Radius | Rounded Rectangle only; spinner 0–100000, step 1, default 20; inserted before Fill Style |
| Outline width | visible for Outline and Fill+Outline; spinner 1–100000, step 1, default 2 |
| Dash | visible when the shape is stroked; editable combo, requested width 50. Presets, preserving spaces: `-`, ` -`, ` --`, ` ---`, `  -`, `   -`, ` - --`, ` - - --------`, ` - - ---- - ----`; default `-` |
| Arrow endpoints | Line only; `Arrow:` then checkboxes `1`, `2`; both default off |
| Arrow Size | inserted only when either endpoint is on; spinner 1–100, step 1, default 10 |
| Arrow Angle | conditional; spinner −89–89, step 1, default 15 |
| Arrow Length | conditional; spinner −100–100, step 1, default 10 |
| Antialias | shared On/Off flyout, default On |

Fill-only state hides Outline width and Dash. Turning on either arrow inserts Size, Angle, and Length immediately after checkbox 2 and before the shared Antialias separator. This conditional insertion is a major parity requirement; merely drawing a fixed arrowhead is insufficient.

### Text choosers

Source: `original/Pinta.Tools/Tools/TextTool.cs`.

| Surface/control | Trigger and exact contents/range/default |
| --- | --- |
| Font family | click `Gtk.FontDialogButton`; modal `Gtk.FontDialog`, `Gtk.FontLevel.Family`, `UseFont=true`, `UseSize=false`; current GTK/system font is the default. This is a full system family chooser, not a fixed list |
| Variant | `Normal`; `Small Caps`; `All Small Caps`; `Petite Caps`; `All Petite Caps`; `Unicase`; `Title Caps`; default Normal |
| Font size | spinner 1–2000, integer step 1; initialized from selected font |
| Weight | `Thin 100`; `Ultralight 200`; `Light 300`; `Semilight 350`; `Book 380`; `Normal 400`; `Medium 500`; `Semibold 600`; `Bold 700`; `Ultrabold 800`; `Heavy 900`; `Ultraheavy 1000`; default Normal 400 |
| Italic / Underline | two icon toggle buttons; defaults off |
| Alignment | three mutually-exclusive icon toggles: Left, Center, Right; default Left |
| Text Style | `Normal`; `Normal and Outline`; `Outline`; `Fill Background`; default Normal |
| Outline width | visible for Normal+Outline or Outline; spinner 1–100000, default 2 |
| Join | visible with Outline width: `Miter Join`; `Round Join`; `Bevel Join`; default Miter |
| Antialias | shared On/Off flyout, default On |

Current closure: Outline width and Join are present conditionally and Join uses the native ordered text chooser. The font-family button now enumerates installed browser fonts when the platform exposes them, with a standards-safe fallback list; unlike GTK, the browser cannot invoke the operating system's native `Gtk.FontDialog`.

## Add-in Manager and child dialogs

Sources: `original/Pinta.Gui.Addins/AddinManagerDialog.cs`, `AddinListView.cs`, `AddinInfoView.cs`, `InstallDialog.cs`, and `StatusProgressBar.cs`.

### Manager window

- `Adw.Window`, transient to the main window.
- Header order: Install from file icon button; Refresh icon button; strict-centered `Adw.ViewSwitcherTitle`.
- Switcher pages, in order: `Gallery`, `Installed`, `Updates`, each with its native icon.
- Each page uses a non-folding, locked `Adw.Flap`: left list content and an end-position detail pane separated vertically.
- List scroller requests 300 × 400 and uses automatic scrolling. Each row is vertically stacked name then dim ellipsized description, with 10 px margins and 6 px spacing.
- Empty state: compact `Adw.StatusPage`, search icon, `No Items Found`.
- Detail pane requests 300 px width and has, in order: title, version, optional download size, optional repository, wrapped expanding description, then toolbar actions.
- Detail actions, in order: enable switch, Install, Update, More Information, Uninstall. Install/Update are suggested actions; Uninstall is destructive and end-aligned.
- Repository refresh overlays an OSD progress bar at the bottom; warnings/errors appear as toasts.

The web manager is a 720 px bundled-add-in card list with Done, Enable all, Disable all, five cards, and immediate switches. That is internally usable but is not native Pinta layout parity. Because web add-ins are bundled rather than downloaded, file installation and Gallery/Updates behavior may remain intentionally unavailable; the visual structure should still be an explicit product choice rather than an accidental divergence.

### Install/uninstall and package errors

| Dialog | Exact layout/sizing |
| --- | --- |
| Install/Uninstall | `Adw.Window`, requested 500 × 250. Header with `Adw.WindowTitle`; expanding vertical scroller of conditional heading/body pairs; bottom-right Cancel then Install/Uninstall buttons with 12 px gaps/margins. Uninstall is destructive |
| Install package file | modal `Gtk.FileDialog`, title `Install Extension Package`, multiple selection. Filters in order: `Extension packages` (`*.mpack`), `All files` (`*`) |
| Invalid package | `Adw.MessageDialog`: heading `Failed to load extension package`; body `The file may be an invalid or corrupt extension package`; single OK response |

## Targeted add-in tool and effect dialogs

The five targeted add-ins create **one brush item, one immediate adjustment, and eight configurable effect dialogs**. Every surface is below.

### Add-in source map

| Package | Repository source files that define the audited UI |
| --- | --- |
| Ars Kali: Glitches | `ArsKaliGlitches/ChromaticAberrationEffect.cs`; `ScanlinesEffect.cs`; `ColoredArtifactsEffect.cs`; `PixelDragEffect.cs`; `RowSliceEffect.cs`; `AdjustmentNoiseEffect.cs` at the commit listed above |
| Block Brush | `BlockBrush/BlockBrush.cs`; `BlockBrushExtension.cs` at the commit listed above |
| Colored Grayscale | `ColoredGrayscale/ColoredGrayscaleEffect.cs`; `ColoredGrayscaleExtension.cs` at the commit listed above |
| More Pixelates | `MorePixelates/HexagonPixelateEffect.cs`; `MorePixelatesExtension.cs` at the commit listed above |
| Night Vision | `NightVisionAddin/NightVisionEffect.cs`; `NightVisionExtension.cs` at the commit listed above |

### Generic native simple-effect layout

The eight effect dialogs use `original/Pinta.Gui.Widgets/Dialogs/SimpleEffectDialog.cs`:

- modal `Gtk.Dialog`, requested width 400 px, non-resizable;
- vertically ordered members, 12 px content spacing, 6 px content margins;
- Cancel then OK on macOS, OK is suggested and default;
- number member: title, horizontal slider, synchronized numeric spinner, 28 × 24 reset-to-initial button;
- boolean: single check row;
- enum/static list: title then full-width combo;
- `RandomSeed`: title then row `Reseed` button (width 88) and expanding seed spinner; default range 0–2147483646 unless attributes override;
- `PointI`: title then point graphic alongside X and Y spinner/reset rows;
- `CenterOffset<double>`: the same point graphic translated to normalized center offset;
- `Color`: title then 80 px Pinta color button. Clicking it opens the full single-color `ColorPickerDialog`.

### Ars Kali: Glitches — six dialogs

Declaration order is native dialog order.

| Effect | Exact native controls, ranges, steps, defaults | Current web gap |
| --- | --- | --- |
| Chromatic Aberration | `Red shift` PointI `(0,0)`; `Green shift` PointI `(0,0)`; `Blue shift` PointI `(0,0)`; `Tile result` checkbox false | **Web replaces three point pickers with six generic sliders, defaults red X to +5/blue X to −5, and defaults tiling on. Layout and defaults are wrong.** |
| Scanlines | four checked checkboxes: `Scanlines`, `Red interlace lines`, `Green interlace lines`, `Blue interlace lines` | Web adds a non-native Line strength slider and renames all four labels |
| Colored Artifacts | `Number of artifacts` int 1–2048 default 128; `Minimum artifact alpha` 0–255 default 64; `Maximum artifact alpha` 0–255 default 255; `Maximum artifact height` double 0–1 step .01 2 digits default .5; `Minimum artifact height` default .2; `Maximum artifact width` default .5; `Minimum artifact width` default .2; Seed default 0 | Web changes order/captions and uses a generic seed row with no Reseed button; each slider also lacks native reset |
| Pixel Drag | `Drag direction` static combo `X`, `Y`, default X; minimum drag length 0–1 step .001 3 digits default .01; maximum drag length same; `# of pixels to drag` 0–4096 default 512; Seed default 0 | Web puts count first, renames values Horizontal/Vertical, and lacks native reset/Reseed controls |
| Row Slice | `Number of slices` 1–128 default 32; left shift 0–1 step .01 default .5; right shift same; Seed default 0 | Semantics mostly present; generic percent scaling and missing reset/Reseed layout |
| Adjustment Noise | Seed only, default 0 | **Web adds a non-native Intensity control and seed default 4242** |

Current closure: all six dialogs now use the native declaration order, captions, ranges, defaults, compound reset controls, and Reseed rows. Chromatic Aberration uses three image-backed `PointI` pickers whose displayed X/Y coordinates span the current image while the untouched `(0,0)` effect defaults remain non-destructive until the user moves a picker, matching `PointPickerWidget` initialization.

### Block Brush — no dialog

Native `BlockBrush` is a `BasePaintBrush` extension. It appears as `Block` in the Paintbrush `Type` combo and receives only shared Brush width and Antialias controls. It is not a separate toolbox tool and has no extra popup. The web currently exposes a separate optional `Block Brush` toolbox tool, so both placement and chooser behavior diverge.

### Colored Grayscale — no dialog

Native `Colored Grayscale` is immediate and uses the current primary color. It has no `EffectData`, `IsConfigurable` override, or dialog. The web immediate command matches this interaction model.

### More Pixelates — one dialog

Hexagon Pixelate control order:

1. `Radius` — int 5–200, step 1, default 20.
2. `Sample mode` — enum combo `Average`, `Center`; default Average.
3. `Offset` — normalized center-offset point picker, default `(0,0)`.
4. `Border Width` — int 0–50, step 1, default 0.
5. `Border Color` — 80 px Pinta color button, black. Clicking opens the complete nested single-color picker.

The web replaces Offset with two generic sliders and Border Color with the browser's `<input type="color">`, bypassing the already-implemented Pinta color dialog. This is one of the clearest nested-dialog fidelity failures.

### Night Vision — one dialog

Control order: `Brightness` double 0–1, default .6, generic .01 step/2 digits; then `Noise` checkbox false. Web renders brightness as 0–100 percent and conditionally adds non-native Noise intensity and Random seed controls.

## Severe current web breakages, ordered for backport

1. **P0 — Text outline controls do not exist.** Native Text Style modes that require an outline cannot configure Outline width or Miter/Round/Bevel Join.
2. **P0 — Line arrows are incomplete.** Native conditional Size, Angle, and Length spinners are absent, so multiple legal native arrow geometries cannot be reproduced.
3. **P0 — Paintbrush-specific configuration is absent.** Slash Angle and Splatter Minimum/Maximum Size are missing. The optional Block Brush is surfaced in the wrong place.
4. **P0 — Hexagon Pixelate nested dialogs are wrong.** Offset must be the native point picker and Border Color must open the full Pinta color picker, not the browser color input.
5. **P1 — Font chooser is not a font chooser.** Seven hard-coded families do not approximate GTK's system-family dialog and may offer fonts not installed while excluding installed fonts.
6. **P1 — Chromatic Aberration is structurally and behaviorally different.** Three point pickers became six sliders, and native defaults changed.
7. **P1 — Long toolbar overflow is undiscoverable.** The scrollbar is forcibly hidden; the affected Text and Line tool controls appear clipped/unusable rather than scrollable.
8. **P1 — Dash editor is reduced.** Native permits free text and nine presets; web has four fixed abstract patterns.
9. **P1 — Generic web selects do not reproduce Pinta flyouts.** Native icon dropdown rows have icon, localized label, and selected checkmark. Plain browser selects lose icons and stable screenshotable layout.
10. **P1 — Add-in effect defaults/control sets drifted.** Adjustment Noise, Scanlines, Night Vision, and Chromatic Aberration all add, remove, rename, or default controls differently from upstream.
11. **P2 — Add-in Manager information architecture is unrelated.** The bundled model can justify different actions, but the native switcher and split-pane layout were not backported.
12. **P2 — Autoscroll icons and labels are incorrect.** The web does not use the native Zoom Blur/Unfocus icon pair or exact `Autoscroll On/Off` text.

## Backport acceptance checklist

The web implementation should not be called dialog-complete until all of these pass:

- Screenshot each closed tool toolbar for all 22 core tools plus enabled Block Brush at desktop width and a constrained mobile/tablet width.
- Screenshot every open flyout listed in this document in English and at least one RTL locale.
- Ensure popup rows use original Pinta icons, localized labels, trailing check state, keyboard arrows, Enter/Space selection, Escape dismissal, outside-click dismissal, focus return, and viewport-edge collision handling.
- Preserve conditional visibility: fill-only hides outline/dash; text outline styles show width/join; enabling either line arrow inserts all three numeric fields; brush type switches Slash/Splatter fields.
- Provide visible or otherwise obvious horizontal overflow affordance without compressing or wrapping Pinta's control sequence.
- Test exact ranges/defaults and persistence for every numeric control.
- Open Hexagon Pixelate Border Color and verify the nested full Pinta color picker, including Cancel preserving the prior value.
- Test all eight configurable add-in dialogs plus the two no-dialog add-in commands/surfaces.
- Verify LTR and RTL order/mirroring for every popup and dialog; numeric ranges and canvas-relative point graphics must remain logically correct.

## Counts

- 22/22 registered core tools accounted for.
- 4 core tools explicitly verified as having no popup or option control at all: Move Selected Pixels, Move Selection, Zoom, and Pan.
- 3 additional core tools have no unique chooser of their own: Pencil exposes only shared Blending, while Clone Stamp and Recolor expose inline/base controls plus shared Antialiasing.
- 21 distinct core tool popup/chooser definitions catalogued when shared surfaces are counted once: Selection Mode, Autoscroll, Lasso Mode, Flood Mode, Eraser Type, Antialias, Blending, Brush Type, Gradient Type, Gradient Mode, sample size, sample source, after-select, Shape Type, Fill Style, Dash, Text Font, Text Variant, Text Weight, Text Style, Text Join.
- 5/5 targeted add-in packages audited.
- 8/8 targeted configurable add-in effect dialogs audited.
- 2 targeted add-in surfaces explicitly verified as having no configuration dialog (Block Brush and Colored Grayscale).
- 4 native add-in-management child surfaces audited: install/uninstall confirmation window, package file chooser, corrupt-package message dialog, and the Add-in Manager itself.
- 11 PNG references produced: two live native captures and nine explicitly-labelled source reconstructions.
