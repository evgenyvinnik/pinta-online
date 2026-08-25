# Core native dialog references

These PNGs are evidence for `docs/dialog-audit/core.md`. They were regenerated from the bundled native Pinta 3.2 source using the repository's disposable `linux/amd64` GTK4 capture container, a 1440 x 960 main window, English locale, 100% scale, and forced dark scheme.

The directory contains 27 `dialog-*.png` files and 7 menu-opening maps:

- 25 files are actual native dialogs or platform chooser windows.
- `dialog-keyboard-shortcuts-bottom.png` is a second scroll state of the same native dialog.
- `dialog-new-screenshot.png` and `dialog-print-image.png` are explicit negative/provenance states: screenshot UI is OS-owned and printing is compiled out.
- `dialog-layer-import-file.png` is a byte-identical alias of the captured `Open Image File` chooser because both native actions use that exact title and image chooser family.

Regeneration scenarios are defined in `tests/visual/native/capture.sh`: `dialog-new-image`, `standalone-dialogs-all`, `core-dialog-audit-extra`, `core-jpeg-dialog-audit`, `core-paste-expand-audit`, and `core-color-picker-audit`. The native Docker image includes `xclip` so the paste-expand scenario can own a deterministic large `image/png` clipboard selection.

Do not treat the Linux platform file chooser as Pinta-owned pixels. Its capture records hierarchy, naming, filter behavior, and the boundary at which native Pinta delegates to the desktop.
