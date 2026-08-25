# Pinta dialog fidelity audit

This directory is the implementation map for Pinta Online's popup and chooser surfaces. The audit was made against the C# application in `original/` on 2026-08-24, before the corresponding web backport in the same change set.

## Coverage

| Surface | Audited coverage | Native evidence | Specification |
| --- | ---: | ---: | --- |
| Core application dialogs and command states | 31 | 34 PNGs | [core.md](core.md) |
| Built-in adjustment and effect dialogs | 43/43 | 43 native GTK PNGs | [effects.md](effects.md) |
| Core tools and shared chooser definitions | 22 tools / 21 popup definitions | 2 native captures + 9 source reconstructions | [tools.md](tools.md) |
| Requested bundled add-ins | 5/5 packages / 8 configurable effects | Included in the tool references | [tools.md](tools.md) |

The 88 evidence images live under `tests/visual/native-dialog-references/`. Source reconstructions are visibly watermarked and are never represented as live native captures.

## Backported web contract

The web implementation now shares a native-style modal grammar: compact Pinta dimensions, segmented spin controls, reset buttons, draggable angle and point pickers, native action order, viewport-bounded scrolling, pinned actions, nested Pinta color picking, and debounced live effect preview. Bespoke layouts are retained for Curves, Levels, Posterize, Align Object, Resize Image/Canvas, Canvas Grid, Rotate/Zoom, Layer Properties, close/flatten/paste alerts, About, and Add-in Manager.

Tool and add-in parity includes the Text outline controls, editable font family, Line arrow size/angle/length, all nine editable dash presets, Slash and Splatter brush controls, Block Brush as a Paintbrush Type, and the audited add-in parameter ranges/defaults/order.

Browser-owned open/save/print permission UI is intentionally not cloned. The audit documents the nearest native state, while automated web screenshots cover the Pinta-owned UI around that platform boundary.

Run `npm run test:visual:update` to regenerate the approved web screenshots, then `npm run test:visual:review` to build `playwright-report/manual-comparison.html`. The report automatically pairs web screenshots with matching evidence from all native-reference subdirectories.
