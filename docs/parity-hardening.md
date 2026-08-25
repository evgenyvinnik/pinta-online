# Functional parity hardening

Visual reference screenshots define Pinta Online's layout contract, but behavioral parity is verified separately. This matrix records the browser implementation used at native or operating-system boundaries and the deterministic test that protects it.

| Area | Pinta Online behavior | Fallback or boundary | Verification |
| --- | --- | --- | --- |
| Unsaved documents | Save opens Save As; closing an unsaved multilayer document proceeds through Save As and the flat-format confirmation before closing | A canceled picker leaves the document open and dirty | `routes an unsaved close through Save As and flatten confirmation before closing` |
| Clipboard | Copy, Copy Merged, and Cut publish `image/png`; Paste reads image clipboard items; oversized images retain Expand / Preserve / Cancel | Browsers without clipboard-read permission retain the in-app image clipboard; an empty or text-only clipboard opens Pinta's explanatory alert | `imports and exports PNG images through the operating-system clipboard bridge`; `explains an empty clipboard instead of silently ignoring paste` |
| File integration | Files opened by the File System Access picker or installed-PWA launch queue retain their `FileSystemFileHandle`; Save writes back to that exact file | Browser file inputs and unsupported browsers use download-based Save / Save As | `keeps native file handles attached to their tabs and saves back in place` |
| Portable Pixmap | P3 text and P6 binary RGB decode, including comments, 8/16-bit samples, scaling, and truncation/range validation | Export stays P3 for broad compatibility and inspectability | `npm run verify:image-codecs` |
| Targa | Raw or RLE true-color, grayscale, grayscale-alpha, palette indices, 15/16/24/32-bit color, and all origin flags decode | Export stays deterministic uncompressed 32-bit BGRA | `npm run verify:image-codecs` |
| Text editing | Multiline selection/caret behavior comes from a focused textarea; browser-local undo, clipboard, IME composition, tabs, bidi direction, formatting shortcuts, and bracket size shortcuts are preserved | The most recently committed text can be re-entered with Ctrl/Command-click while its history checkpoint is current; any later pixel edit safely finalizes it | `supports native text sizing, tab input, bidirectional content, and IME-safe commits` |
| Printing | Pinta owns composite preview, portrait/landscape, fit/actual/custom scale, margins, centering, and the isolated print-only surface | Paper, printer, PDF destination, and driver options remain browser/OS-owned | `applies page setup to the isolated browser print surface` |

## Deliberate platform boundaries

Pinta Online does not imitate a filesystem browser, printer-driver window, screen-capture permission prompt, or browser permission prompt. Those surfaces must remain owned by the browser or operating system for security. The application preserves Pinta's command flow and state on both sides of each boundary, including cancellation and failure paths.

Native Mono.Addins assemblies also cannot execute in the browser. Reviewed add-ins are ported into the typed tool/effect registry and remain opt-in.

Run the full behavioral contract with `npm run test:e2e`, codec fixtures with `npm run verify:image-codecs`, and the pinned visual contract with `npm run test:visual`.
