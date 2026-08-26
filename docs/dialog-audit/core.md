# Native Pinta core-dialog audit

> Implementation-status note: the “Web” comparisons below record the web implementation at audit time and are intentionally preserved as gap provenance. Several listed gaps have since been closed. Use the current application, approved Playwright screenshots, and [`../parity-hardening.md`](../parity-hardening.md) for present behavior; use this document as the native layout/source specification.

This audit is the implementation contract for Pinta Online's non-effect, non-tool popup surfaces. It covers every dialog reached from Pinta/File/Edit/View/Image/Layers/Window/Help in the bundled Pinta 3.2 source, including palette workflows and dialogs reached only after an intermediate action such as paste or export. Adjustment/effect dialogs, tool option popovers, and add-in management are deliberately outside this file.

The web comparison was made against commit `866340bd17c670b57d36cdee590ff4b27e69afc3`. The native evidence was regenerated from the bundled `original/` tree in the repository's pinned Linux capture environment: `linux/amd64`, .NET 10, GTK 4, libadwaita, Xvfb/Openbox, English locale, dark scheme, 1440 x 960 main window, and 100% scale.

## Result

- 31 native command/dialog states inventoried.
- 24 actual native dialog/window states captured, plus a second keyboard-shortcuts scroll state (25 actual dialog/window PNG files total).
- 2 explicit negative-state captures prove that Print has no native implementation and New Screenshot is delegated to the operating system.
- 7 menu captures map the opening locations.
- 34 PNG files total are in `tests/visual/native-dialog-references/core/`.
- No native Preferences dialog and no native Language dialog exist in this Pinta revision. Pinta stores preferences in the relevant menu/tool surface and takes its locale from the process/system environment.

Native `Gtk.Dialog` buttons use `GtkExtensions.AddCancelOkButtons`: on Linux/macOS the visual order is **Cancel, OK**; on Windows it is **OK, Cancel**. OK has suggested-action styling and is the Enter/default response. Unless noted otherwise, dialogs are transient for the main window, modal, centered by the window manager, and size to their content. The browser implementation should cap dialogs to the viewport, keep the action row visible, and make only the content region scroll at narrow widths.

## Priority findings

| Severity | Finding | Required parity correction |
| --- | --- | --- |
| Critical | **Resize Image** omits native percentage/absolute modes, reset-to-image-size, and resampling. | Rebuild from the native control order and persisted defaults; do not substitute a preview for required controls. |
| Critical | **Resize Canvas** omits percentage/absolute modes, reset, and maintain-aspect behavior. | Rebuild the upper sizing section and retain the native 3 x 3 anchor control. |
| Critical | **Paste larger than canvas** has no web decision dialog; oversized content is clipped. Empty paste also has no native-style explanation. | Add the Cancel / Preserve / Expand alert before mutation and the empty-clipboard informational alert. |
| High | **Close All** is a different workflow. Native Pinta shows the normal save prompt for each dirty document; web shows one aggregate horizontal dialog. | Reuse the close-document prompt sequentially, preserving Save / Discard / Cancel and cancellation semantics. |
| High | **Close Document** is a wide, icon-led custom bar instead of the compact vertical libadwaita alert. | Match the 310 x 358 hierarchy, stacked responses, suggested Save, destructive Discard, and default focus. |
| High | **Keyboard Shortcuts** is hard-coded and incomplete. Native sections are generated from every registered command and tool. | Generate rows from production registries and use a searchable/sectioned, viewport-filling layout. |
| High | **Canvas Grid** starts at 10 x 10 in web instead of native 64 x 64 and replaces the native angle picker with a plain field. | Use native defaults, enabled-state binding, and the dial/spin angle control. |
| High | **Primary/Secondary color picker** incorrectly shares the palette-edit layout. Native dual-color mode hides palette rows, shows two wells plus swap, and applies changes live. | Split single-color and live dual-color modes while sharing the HSV/RGBA core. |
| High | **Flatten confirmation** is absent. Native warns before saving a multilayer image to a flat format and makes Flatten the default response. | Add an explicit confirmation at the format boundary; decide and document whether web export mutates or only composites. |
| Medium | **Rotate / Zoom Layer** uses a custom image preview and percentage labels rather than native AnglePicker / PointPicker / scale-spin-reset rows. | Match the widgets, order, ranges, reset buttons, and live-canvas preview semantics. |
| Medium | **JPEG Quality** is folded into Save As instead of appearing after the file chooser. | Preserve the native two-stage export flow or document the browser-specific deviation. |

## Exhaustive inventory

### File and application lifecycle

#### C01 — New Image

- **Open:** File -> New or `Ctrl+N`; toolbar New.
- **Native source:** `original/Pinta/Dialogs/NewImageDialog.cs`; opened by `original/Pinta/Actions/File/NewDocumentAction.cs`.
- **Title / evidence:** **New Image**; `dialog-new-image.png` (596 x 357).
- **Layout and control order:** two columns. Left column: Preset dropdown; Width entry + `pixels`; Height entry + `pixels`; Orientation group with portrait icon/radio then landscape icon/radio; Background group with White swatch/radio, optional secondary-color swatch/radio, then Transparent checkerboard/radio. Right column: `Preview` label and aspect-ratio preview.
- **Sizing / state:** non-resizable; 8 px content margin, 10 px principal spacing. Initial width/height are 800 x 600 unless clipboard-derived. Secondary background is hidden when it equals white.
- **Focus / buttons:** Width entry grabs focus; Enter activates OK. Footer is Cancel then suggested OK on Linux/macOS.
- **Web:** `ImageSizeDialog` has a dedicated native-style branch and its approved screenshot is 596 x 358. This is the strongest core match. Keep the platform button-order rule and make all labels localizable.

#### C02 — Open Image File

- **Open:** File -> Open or `Ctrl+O`.
- **Native source:** `original/Pinta/Actions/File/OpenDocumentAction.cs`.
- **Title / evidence:** **Open Image File**; `dialog-open-image.png` (1203 x 925).
- **Layout and control order:** platform `Gtk.FileDialog`: location/sidebar, folder breadcrumb, file list, file-name/search affordances, image-format and all-files filters, Cancel and Open. Multiple selection is enabled via `OpenFilesAsync` and the last valid dialog directory is restored.
- **Sizing / responsiveness:** entirely owned by GTK/desktop portal; resizable and near-workspace size in the reference environment.
- **Focus / buttons:** platform chooser convention; Open is the acceptance/default action.
- **Web:** browser file input is the correct security boundary, but it has no Pinta-owned counterpart to screenshot. Do not fake filesystem navigation; ensure multiple image selection, accepted formats, focus restoration, cancellation, and error reporting are covered.

#### C03 — Save Image File

- **Open:** File -> Save As; also Save for an unsaved image and Save All for each unsaved image.
- **Native source:** `original/Pinta/Actions/File/SaveDocumentImplementationAction.cs`.
- **Title / evidence:** **Save Image File**; `dialog-save-image-as.png` (1203 x 902).
- **Layout and control order:** platform `Gtk.FileChooserNative`: selected filename at top, sidebar and breadcrumb, folder contents, format filter at bottom, Cancel and Save. It starts with `Unsaved Image N.<default extension>`, restores the last directory, and chooses the encoder from the typed extension before falling back to the selected filter.
- **Sizing / responsiveness:** platform-owned, resizable, and large.
- **Focus / buttons:** filename is selected for immediate typing; Save accepts.
- **Web:** custom `SaveAsDialog` is 470 x 204 with Name and Format (plus conditional quality), followed by a download. This is a legitimate browser boundary but not visually identical. Preserve extension-driven format selection and make the browser limitation explicit.

#### C04 — JPEG Quality

- **Open:** after accepting Save Image File with a JPEG extension.
- **Native source:** `original/Pinta/Dialogs/JpegCompressionDialog.cs`; invoked from `original/Pinta.Core/ImageFormats/JpegFormat.cs` through `ModifyCompressionAction`.
- **Title / evidence:** **JPEG Quality**; `dialog-jpeg-quality.png` (159 x 137).
- **Layout and control order:** `Quality:` label, then a horizontal scale from 1 to 100 with the current numeric value drawn on the scale.
- **Sizing / state:** compact content-sized modal; 6 px margin and 3 px spacing. Initial value is the saved JPEG quality setting.
- **Focus / buttons:** Cancel then suggested/default OK.
- **Web:** quality is embedded in Save Image As, so this distinct native stage is missing.

#### C05 — Confirm flatten for a flat format

- **Open:** save a document with more than one layer to a format whose descriptor does not support layers.
- **Native source:** `ConfirmFlatten` in `original/Pinta/Actions/File/SaveDocumentImplementationAction.cs`.
- **Title / evidence:** heading **This format does not support layers. Flatten image?**; `dialog-confirm-flatten.png` (382 x 225).
- **Layout and control order:** libadwaita alert heading; body `Flattening the image will merge all layers into a single layer.`; responses Cancel then suggested Flatten.
- **Focus / buttons:** close response is Cancel; default response is Flatten.
- **Web:** no corresponding confirmation. Export composites layers without this native decision surface.

#### C06 — Close dirty document

- **Open:** File -> Close / `Ctrl+W`, document-tab close, or application exit when the active document is dirty.
- **Native source:** `original/Pinta/Actions/File/CloseDocumentAction.cs`.
- **Title / evidence:** heading **Save changes to image "{name}" before closing?**; `dialog-close-document.png` (310 x 358).
- **Layout and control order:** compact libadwaita alert, centered heading, body `If you don't save, all changes will be permanently lost.`, then full-width stacked Save, Discard, Cancel responses.
- **Focus / buttons:** Save is suggested and default; Discard is destructive; Escape/window close maps to Cancel.
- **Web:** 510 x 190 horizontal icon-and-copy layout with a bottom action row. Behavior exists, but hierarchy, sizing, and button placement are substantially different.

#### C07 — Close All / Quit with dirty documents

- **Open:** Window -> Close All / `Ctrl+Shift+W`, or Quit/Exit.
- **Native source:** `original/Pinta/Actions/Window/CloseAllDocumentsAction.cs`, `original/Pinta/Actions/File/ExitAction.cs`, and C06.
- **Title / evidence:** no special aggregate title; native reuses C06 for each dirty image. `dialog-close-all.png` proves the same 310 x 358 prompt.
- **Control flow:** close the active document; on Save or Discard continue to the next; on Cancel stop immediately. Clean documents close without a prompt.
- **Web:** a custom aggregate `Close all N images?` prompt with Discard All and Save All & Close. This is not the native flow or layout.

#### C08 — New Screenshot

- **Open:** File -> New Screenshot.
- **Native source:** `original/Pinta/Actions/File/NewScreenshotAction.cs` and the XDG screenshot portal XML under `original/Pinta/dbus-xml/`.
- **Title / evidence:** no Pinta-owned dialog. `dialog-new-screenshot.png` is intentionally the native File menu provenance state.
- **Platform behavior:** X11/Linux opens the XDG desktop portal; macOS launches `/usr/sbin/screencapture -iUc`; Windows uses its platform path. Failures use C11/C12.
- **Web:** a 480 x 230 browser-owned delay/capture dialog. It is an intentional web affordance, not a layout to claim as native parity.

#### C09 — Print

- **Open:** File -> Print / `Ctrl+P` in web. The native command is not enabled in this revision.
- **Native source:** `original/Pinta/Actions/File/PrintDocumentAction.cs` is inside `#if false` with a GTK4 TODO.
- **Title / evidence:** no native popup; `dialog-print-image.png` records the native File menu.
- **Web:** a 620 x 554 preview followed by `window.print()` and the browser/OS print dialog. Treat this as a web feature, not a failed native clone.

#### C10 — Progress

- **Open:** internal long-running core operations that use `IProgressDialog`; it has no deterministic menu-only trigger in the capture profile.
- **Native source:** `original/Pinta/Dialogs/ProgressDialog.cs`, registered in `original/Pinta/MainWindow.cs`.
- **Title / evidence:** caller-defined title; no PNG because none of the audited deterministic core commands exposes it long enough to capture.
- **Layout and control order:** caller text label, progress bar, Cancel. Default 400 x 114, modal; 2 px margin and 6 px spacing.
- **Focus / buttons:** only Cancel; response raises `Canceled`.
- **Web:** confirmed effects use a reusable 400 px modal with caller text, a determinate progress bar, percentage, and Cancel. Fractions originate in the isolated effect worker from completed processor rows, pixels, or work units; cancellation terminates the synchronous worker and leaves pixels/history unchanged.

#### C11 — Generic information message

- **Open:** runtime messages such as empty clipboard, restart required, unsupported save format, screenshot handler unavailable, oversized ICO, and permission errors.
- **Native source:** `ShowMessage` in `original/Pinta/Dialogs/ErrorDialog.cs`, routed through `ChromeManager.ShowMessageDialog`.
- **Layout and control order:** libadwaita heading and body, then one OK response. The exact size follows content: `dialog-paste-empty.png` is 346 x 187 and `dialog-restart-pinta.png` is 382 x 208.
- **Focus / buttons:** OK is both default and close response.
- **Web:** blocking explanatory messages use the shared native-style alert shell; empty clipboard is the deterministic reference. Toasts are reserved for successful confirmations and non-blocking status.

#### C12 — Error with bug-report action

- **Open:** load/save/screenshot failures and uncaught UI errors routed through `ChromeManager.ShowErrorDialog`.
- **Native source:** `ShowError` in `original/Pinta/Dialogs/ErrorDialog.cs`; call sites include `WorkspaceManager`, `NewScreenshotAction`, `Main.cs`, and `MainWindow.cs`.
- **Layout and control order:** libadwaita heading and body; suggested `Report Bug...` response then OK. The details string is passed through the handler but is not rendered by this revision.
- **Focus / buttons:** OK is default and close response; Report Bug activates Help -> Report a Bug.
- **Evidence / blocker:** failure-only generic family; not forced because doing so would require corrupt input or environment failure. C11 captures the same message-dialog shell.
- **Web:** the reusable error/report alert mirrors the heading/body, expandable Details diagnostics, suggested `Report Bug...`, and default OK responses. File/save/palette/layer/effect/screenshot/workspace and uncaught asynchronous failures route through it, and reports target the web repository.

### Edit and palette

#### C13 — Empty clipboard

- **Open:** Edit -> Paste or Paste Into New Image when the clipboard has no image.
- **Native source:** `ShowClipboardEmptyDialog` in `original/Pinta/Actions/Edit/PasteAction.cs`.
- **Title / evidence:** **Image cannot be pasted**; `dialog-paste-empty.png` (346 x 187).
- **Layout and control order:** heading, body `The clipboard does not contain an image.`, OK.
- **Web:** paste commands are disabled/return false when the in-app clipboard is empty, so the explanatory popup is absent.

#### C14 — Pasted image larger than canvas

- **Open:** paste an image whose width or height exceeds the canvas.
- **Native source:** `ShowExpandCanvasDialog` in `original/Pinta/Actions/Edit/PasteAction.cs`.
- **Title / evidence:** **Image larger than canvas**; `dialog-paste-expand-canvas.png` (310 x 340).
- **Layout and control order:** heading; explanatory body; stacked Expand, Preserve, Cancel responses.
- **Focus / buttons:** Expand is suggested/default; Preserve keeps the current canvas; Escape/window close cancels.
- **Web:** no decision dialog. The current paste draws into the fixed current-layer canvas, so excess pixels are clipped.

#### C15 — Offset Selection

- **Open:** Edit -> Offset Selection / `Ctrl+Shift+O`; enabled only for an active selection.
- **Native source:** `original/Pinta/Dialogs/OffsetSelectionDialog.cs`; opened by `original/Pinta/Actions/Edit/OffsetSelectionAction.cs`.
- **Title / evidence:** **Offset Selection**; `dialog-offset-selection.png` (412 x 119).
- **Layout and control order:** one `HScaleSpinButtonWidget`: Offset label, range slider, numeric spin from -100 to 100, reset button; footer Cancel, OK.
- **Sizing / focus:** fixed 400 x 100 content target, non-resizable; OK is valid/default even at zero.
- **Web:** 430 x 166 custom header, same range/slider/spin, extra explanatory hint, and OK disabled at zero. Usable, but not the native compact layout or response behavior.

#### C16 — Open Palette File

- **Open:** Edit -> Palette -> Open.
- **Native source:** `HandlerPintaCoreActionsEditLoadPaletteActivated` in `original/Pinta.Core/Actions/EditActions.cs`.
- **Title / evidence:** **Open Palette File**; `dialog-open-palette.png` (1203 x 925).
- **Layout and control order:** platform `Gtk.FileDialog` with Palette files and All files filters, last palette directory, Cancel/Open.
- **Web:** a browser upload input is used. As with C02, do not fake a filesystem chooser; match multiple format filters, cancellation, errors, and focus return.

#### C17 — Save Palette File

- **Open:** Edit -> Palette -> Save As.
- **Native source:** `HandlerPintaCoreActionsEditSavePaletteActivated` in `original/Pinta.Core/Actions/EditActions.cs`.
- **Title / evidence:** **Save Palette File**; `dialog-save-palette.png` (1203 x 902).
- **Layout and control order:** platform save chooser with filename, folder UI, writable palette format filter, Cancel/Save. Missing extensions are appended from the active filter.
- **Web:** compact 430 x 200 custom dialog with filename and format before download. Browser-owned by necessity, but extension/filter semantics should follow native.

#### C18 — Resize Palette

- **Open:** Edit -> Palette -> Set Number of Colors.
- **Native source:** generic `original/Pinta/Dialogs/SpinButtonEntryDialog.cs`, configured by `original/Pinta/Actions/Edit/ResizePaletteAction.cs`.
- **Title / evidence:** **Resize Palette**; `dialog-resize-palette.png` (256 x 104).
- **Layout and control order:** a single horizontal row, `New palette size:` label then spin button; 12 px content margin and 6 px gap.
- **Focus / buttons:** spin activates default OK; Cancel then suggested/default OK.
- **Web:** 430 x 174 with header, unit suffix, and a long hint. Functionality is present, but the layout is over-sized and action label is `Resize` rather than native `OK`.

#### C19 — Edit one palette color

- **Open:** middle-click or Ctrl/Command-click a palette swatch.
- **Native source:** `original/Pinta.Gui.Widgets/Widgets/StatusBarColorPaletteWidget.cs` and `original/Pinta.Gui.Widgets/Widgets/ColorPickerDialog.cs`.
- **Title / evidence:** **Choose Palette Color**; `dialog-edit-palette-color.png` (638 x 508).
- **Layout and control order:** header Reset, collapse toggle, title, Cancel, OK. Body top row: one target swatch; Hue & Sat / Sat & Value toggle group; wheel/square surface with cursor and Show Value; Hex; then Hue, Sat, Value, separator, Red, Green, Blue, separator, Alpha gradient sliders with numeric spin values. Bottom rows show recent colors and the current palette.
- **Sizing / focus:** large mode uses 12 px margins, 6 px spacing, 200 px surface/slider widths, and 50 px target wells; collapse switches to the smaller vertical selector layout. OK grabs focus and is default.
- **Web:** full HSV/RGB/hex/alpha controls now exist and are close in capability. Remaining differences include 790 x 454 proportions, custom surface rendering, and mobile header behavior.

#### C20 — Choose primary and secondary colors

- **Open:** click either overlapping color well in the native status bar.
- **Native source:** same files as C19, configured with `PaletteColors`, `livePalette: true`, and title `Choose Colors`.
- **Title / evidence:** **Choose Colors**; `dialog-primary-secondary-color.png` (638 x 420).
- **Layout and control order:** same picker core, but the first column contains a swap button and two vertically stacked selectable color wells. Because this is live-palette mode, the recent/current palette rows are hidden.
- **State behavior:** selecting either well changes the active slider target; `X`/swap exchanges colors. Changes update the real palette live; Cancel restores the original pair and OK keeps it.
- **Web:** primary/secondary modes share a modal picker containing palette swatches and commit only on OK. This misses the native live-update/cancel-restore contract and the shorter layout.

### View and image geometry

#### C21 — Canvas Grid Settings

- **Open:** View -> Canvas Grid.
- **Native source:** `original/Pinta/Dialogs/CanvasGridSettingsDialog.cs`; state defaults in `original/Pinta.Core/Managers/CanvasGridManager.cs`.
- **Title / evidence:** **Canvas Grid Settings**; `dialog-canvas-grid.png` (295 x 335).
- **Layout and control order:** grid section: Show Grid checkbox; Width spin + pixels; Height spin + pixels. Axonometric section: Show Axonometric Grid checkbox; Width spin + pixels; `AnglePickerWidget` spanning all columns (dial, angle spin, reset). Footer Cancel, OK.
- **Sizing / state:** 12 px margin, 6 px row/column gap. Native defaults are 64 x 64 normal cells, axonometric width 64, angle 30 degrees. Each group's child controls are disabled with its checkbox. Changes preview live; Cancel restores initial values, OK saves.
- **Web:** 470 x 526 with a large preview and plain number inputs; stored defaults are 10 x 10 / 10. It lacks the native angle dial/reset and is much taller.

#### C22 — Restart Pinta after menu-bar preference

- **Open:** View -> Show/Hide -> Menu Bar when the native build exposes the option.
- **Native source:** `original/Pinta/Actions/View/MenuBarToggledAction.cs`.
- **Title / evidence:** **Restart Pinta**; `dialog-restart-pinta.png` (382 x 208).
- **Layout and control order:** heading, `Please restart Pinta for the changes to take effect.`, OK.
- **Web:** DOM menu bars can change immediately, so no restart alert is required. This is a documented platform-specific non-port.

#### C23 — Resize Image

- **Open:** Image -> Resize Image / `Ctrl+R`.
- **Native source:** `original/Pinta/Dialogs/ResizeImageDialog.cs`.
- **Title / evidence:** **Resize Image**; `dialog-resize-image.png` (371 x 292).
- **Layout and control order:** By percentage radio, percentage spin, `%`; By absolute size radio; Width spin + pixels + reset-to-image-size icon; Height spin + pixels; Maintain aspect ratio checkbox; Resampling label + combo (all `ResamplingMode` values); footer Cancel/OK.
- **Sizing / state:** default request 300 x 200, content margin 12 and spacing 6. Last mode, percentage, dimensions, maintain-aspect, and resampling are persisted. Absolute controls are disabled in percentage mode and vice versa.
- **Focus / buttons:** percentage spin grabs focus and activates default OK.
- **Web:** 430 x 346 preview-led dialog containing only Width, Height, and Maintain aspect ratio. Percentage mode, reset, resampling, persisted settings, and native action label are missing.

#### C24 — Resize Canvas

- **Open:** Image -> Resize Canvas / `Ctrl+Shift+R`.
- **Native source:** `original/Pinta/Dialogs/ResizeCanvasDialog.cs`.
- **Title / evidence:** **Resize Canvas**; `dialog-resize-canvas.png` (357 x 403).
- **Layout and control order:** By percentage radio, percentage spin, `%`; By absolute size radio; Width spin + pixels + reset; Height spin + pixels; Maintain aspect ratio; separator; Anchor label; centered 3 x 3 grid of 30 px directional anchor buttons; footer Cancel/OK.
- **Sizing / state:** default request 300 x 200; last mode, percentage, dimensions, aspect, and anchor persist. Default anchor is center. Enable/disable bindings match mode.
- **Focus / buttons:** percentage spin grabs focus; OK is default.
- **Web:** 430 x 412 preview-led dialog has Width, Height, and a dot-style 3 x 3 anchor only. It lacks percentage/absolute mode, reset, maintain aspect, persistence, and native directional anchor icons.

### Layers and Window

#### C25 — Import layer from file

- **Open:** Layers dock menu -> Import from File.
- **Native source:** `HandlePintaCoreActionsLayersImportFromFileActivated` in `original/Pinta.Core/Actions/LayerActions.cs`.
- **Title / evidence:** **Open Image File**; `dialog-layer-import-file.png`. The dialog is the same platform chooser/title/filter family as C02, so this provenance filename is a byte-identical alias of the actual C02 capture.
- **Layout / buttons:** platform file chooser with Image files filter and Cancel/Open; single selection.
- **Web:** browser file input is appropriate. Ensure the chosen image becomes a new named layer and that cancellation does not create history.

#### C26 — Layer Properties

- **Open:** Layers -> Layer Properties / `F4`; layer context menu.
- **Native source:** `original/Pinta/Dialogs/LayerPropertiesDialog.cs`.
- **Title / evidence:** **Layer Properties**; `dialog-layer-properties.png` (349 x 224).
- **Layout and control order:** two-column form: Name entry; Visible checkbox; Blend Mode combo; Opacity row containing 0-100 spin then horizontal 0-100 scale. Footer Cancel/OK.
- **Sizing / state:** explicit 349 x 224; 10 px margins and 6 px grid spacing. All edits preview directly on the active layer. Cancel restores the initial name/visibility/blend/opacity; OK retains changes.
- **Focus / buttons:** Name entry activates default OK; opacity spin also activates default.
- **Web:** 380 x 260 and visually close. It stages changes until OK rather than native live-preview/rollback, but controls and order are substantially complete.

#### C27 — Rotate / Zoom Layer

- **Open:** Layers dock menu -> Rotate / Zoom Layer.
- **Native source:** `original/Pinta/Actions/Layers/RotateZoomLayerAction.cs` using `original/Pinta.Gui.Widgets/Dialogs/SimpleEffectDialog.cs` and the shared angle/point/scale widgets.
- **Title / evidence:** **Rotate / Zoom Layer**; `dialog-rotate-zoom-layer.png` (400 x 321).
- **Layout and control order:** Angle caption + `AnglePickerWidget` (dial, degree spin, reset); Pan caption + `PointPickerWidget` (2D pad, X spin/reset, Y spin/reset); Zoom caption + scale, numeric factor spin, reset. Footer Cancel/OK. There is no miniature image preview.
- **Sizing / state:** reflected effect-data layout, about 400 x 321 in the capture. Angle starts 0, normalized pan starts 0/0 (displayed through the image-center point picker), zoom starts 1.00 with native range 0-16.
- **Behavior:** parameter changes preview on the real layer/canvas; Cancel clears the transform; OK applies once and creates history.
- **Web:** 470 x 454, adds a large checkerboard image preview, displays pan and zoom as percentages, and omits native dial/pad/reset widgets. Underlying normalized transforms are similar, but interaction and layout are not.

#### C28 — Save All

- **Open:** Window -> Save All / `Ctrl+Alt+A`.
- **Native source:** `original/Pinta/Actions/Window/SaveAllDocumentsAction.cs`.
- **Popup behavior:** there is no aggregate dialog. Native iterates documents and invokes C03 (plus C05/C04 as needed) for each unsaved document, stopping on the first cancellation.
- **Web:** should follow the same sequential file-boundary behavior unless the File System Access API already grants handles. Do not invent a single path choice for multiple files.

### Help and configuration

#### C29 — Keyboard Shortcuts

- **Open:** Help -> Keyboard Shortcuts.
- **Native source:** `original/Pinta/Actions/Help/KeyboardShortcutsDialogAction.cs`.
- **Title / evidence:** **Keyboard Shortcuts**; `dialog-keyboard-shortcuts.png` and `dialog-keyboard-shortcuts-bottom.png` (1430 x 950 each).
- **Layout and control order:** libadwaita `ShortcutsDialog`, nearly filling the parent. It dynamically adds sections in this order: Tools, Layers, File, Edit, View, Image, Adjustments, Effects, Window, Help. Tool names are sorted; command labels are sorted within sections; the first registered shortcut is displayed with OS-specific modifier formatting. The native shell provides section navigation/search and a close control.
- **Sizing / responsiveness:** resizable/viewport-filling with internal scrolling; the two captures preserve top and bottom positions.
- **Web:** the list is derived from the same typed shortcut registry that handles production key events, so displayed commands cannot drift from interception behavior. It follows native section order and alphabetical command/tool ordering, fills the viewport responsively, and provides section navigation, search/filtering, and a close control. The shell remains a browser rendering rather than libadwaita's platform widget.

#### C30 — About Pinta

- **Open:** Help -> About.
- **Native source:** `original/Pinta/Actions/Help/AboutDialogAction.cs`.
- **Title / evidence:** **About Pinta**; `dialog-about.png` (360 x 624).
- **Layout and control order:** libadwaita `AboutWindow`: close titlebar button; application icon; Pinta name and version pill; Details row; Support Questions; Report an Issue; Credits; Legal. Details expose description/website; Credits expose developers/translators; Legal exposes copyright and the full MIT/attribution text.
- **Sizing / responsiveness:** 360 x 624 compact navigation window; nested pages remain inside the same window.
- **Web:** the 360 x 624 compact shell reproduces row navigation and keeps Details, Credits, and Legal inside the same window. It exposes upstream developers and locale translator credits, the native license/attributions, web support/issue links, and the linked Evgeny Vinnik web-port credit.

#### C31 — Preferences and language (negative inventory)

- **Open:** none in bundled native Pinta 3.2.
- **Native source evidence:** `AppActions`, `HelpActions`, `ViewActions`, `MainWindow`, and the full dialog subclass search contain no Preferences or Language dialog. Theme, rulers, chrome visibility, grid, and resize defaults live on their relevant menus/dialogs. `original/Pinta.Core/Classes/Translations.cs` obtains locale from the environment/system.
- **Web:** `LanguageDialog` is a necessary web-only enhancement because the browser app changes locale in-process. It should use the shared responsive dialog shell, but there is no native layout to clone. A future Preferences dialog must not be described as a native backport unless upstream adds one.

## Runtime-only variants that reuse audited shells

These are additional messages, not additional layouts:

- `Unsupported palette format` and image load failures -> C12.
- `Pinta does not support saving images in this file format.`, `Image too large`, `Failed to save image`, and permission denied -> C11.
- Screenshot portal/OS failures -> C11 or C12.
- Application startup and unhandled main-window errors -> C12.
- Exit with dirty documents -> repeated C06, not an aggregate exit dialog.

## Capture limitations and provenance notes

- New Screenshot is platform-owned, and its portal could not be made a stable Pinta reference without confusing compositor UI with Pinta-owned UI; the File-menu state is preserved instead.
- Printing is compiled out in this native revision; the File-menu state is the correct negative evidence.
- Progress has no deterministic menu-only trigger and disappears too quickly under normal core operations; its source-defined layout is fully recorded above.
- The detailed Error/Report Bug variant requires deliberately corrupting input or forcing an environmental failure. Its common libadwaita shell is represented by C11, and its exact response setup is source-audited.
- Layer Import uses the same `Open Image File` title and image filter family as normal Open. Its dedicated file is a byte-identical evidence alias rather than a second visually indistinguishable portal run.

## Backport order

1. Resize Image and Resize Canvas control/behavior parity.
2. Paste empty/oversized choice dialogs and browser clipboard integration.
3. Native close-document hierarchy and sequential Close All/Exit flow.
4. Dynamic Keyboard Shortcuts registry and viewport-filling shell.
5. Canvas Grid defaults, angle picker, and live-preview rollback.
6. Dual-color live picker mode, separate from single swatch editing.
7. Flatten confirmation and JPEG post-save stage.
8. Rotate/Zoom native widgets and live canvas preview.
9. Compact Palette Resize, Offset Selection, About, and generic message/error shells.
