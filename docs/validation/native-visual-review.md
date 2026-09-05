# Native versus web: first expanded visual pass

Reviewed by Codex on 4 September 2026 using stored PNGs from commit
`4bd4207907a067d45f7876c0790c75afe8cc5d20`. This is a visual inspection of **15 pairs**, not a
fresh execution, functional sign-off, or review of all 194 web screenshots. No baseline was approved.

Rebuild the gallery with `npm run test:visual:review`. The web side is
`tests/visual/__screenshots__/chromium/<name>.png`; the native side is
`tests/visual/pinta-reference/<name>.png`, except the color dialog noted below.
Use actual-pixel mode or open the PNGs when comparing sizes: fit-to-column scales the two sides
independently. Font rasterization, window borders and focus/hover state are not by themselves
evidence of a missing function.

| Pair name (without `.png`) | Observation | Disposition |
| --- | --- | --- |
| `workspace-default-dark` | Core regions and 800×600 canvas present. Web adds the requested top menu, uses a different toolbox column distribution and puts layer thumbnails before names instead of after. | Browser adaptation / fidelity difference; no claim of identical layout. |
| `workspace-default-light` | Same region coverage; stronger web canvas shadow and distinct dock backgrounds. | Cosmetic fidelity difference, not missing functionality. |
| `workspace-selection` | Web has Rectangle Select active, handles and a blue tint; native has Paintbrush active and Select All. | **Capture mismatch.** Reproduce the same selected tool and command before judging handles/tint. |
| `workspace-rulers-and-grid` | Web shows a blank canvas with a large grid. Native has text, the Text tool and no comparable visible large grid. | **Capture mismatch.** Reset document/tool, grid settings and zoom before recapture. Not valid evidence of grid parity. |
| `menubar-edit` | Common editing commands present; web exposes a top menu and expands palette commands, native uses a submenu from the header menu. | Requested menu adaptation; verify command semantics separately. |
| `menu-image` | Common command set present. Web's counter-clockwise rotation label wraps where native's stays on one line. | **Visual follow-up:** inspect menu width at 100% and long locales; wrapping is visible, not clipped in this reference. |
| `dialog-new-image` | Preset, dimensions, orientation, background, preview and actions are present in the same broad arrangement. | No missing control observed. Radio styles, padding and text weight differ. |
| `dialog-resize-image` | Percentage/absolute, dimensions, aspect lock, resampling and actions present. Disabled-state styling and focus differ. | No missing control observed; behavior needs its existing separate tests. |
| `dialog-resize-canvas` | Size controls and nine-point anchor present. Native separates Anchor below a divider; web puts its label beside the grid. | **Visual follow-up:** anchor grouping and spacing differ. |
| `dialog-layer-properties` | Name, visibility, blend and opacity present. Web opacity shows a numeric percentage and slider; native also shows visible minus/plus stepper buttons. | **Control-parity follow-up:** reproduce on current app and restore native-style opacity stepping if still absent. |
| `dialog-primary-secondary-color` | Both contain color pair, wheel, HSV/RGB/alpha and actions. Swap location, gradients and hex presentation differ. Native black retains Hue 240/Sat 100; web black is Hue 0/Sat 0. | **Needs matched color state** before judging HSV behavior. Review hex/alpha and grouping separately. Native evidence is `native-dialog-references/core/dialog-primary-secondary-color.png`. |
| `adjustment-curves` | Graph and actions present. Web wraps “Transfer Map” and its coordinate readout onto multiple lines; native fits both on one line. Hover/crosshair states also differ. | **Visual follow-up:** fix header sizing after reproducing; match pointer state before judging crosshair behavior. |
| `adjustment-levels` | Histograms, input/output ranges, gamma, channels and actions present. Grid, handles and channel label styling differ. | No missing control observed; use a populated identical image to compare histogram output. |
| `tool-text` | Font, size, style, alignment and fill controls occur in the same broad sequence. | No missing option observed in this strip; does not certify text editing behavior. |
| `tool-magic-wand` | Flood, tolerance and selection mode present and ordered alike. Native displays a numeric tolerance beside its slider; the stored web strip does not. | **Control-parity follow-up:** inspect numeric feedback/accessibility and current implementation. |

## Next review batch

1. Reproduce the four control/layout follow-ups (Layer Properties, Curves, Magic Wand, Image menu)
   on a fresh build; add focused tests before changing UI. Address Resize Canvas grouping if strict
   native layout remains the target. Do not approve a changed web screenshot just because it renders.
2. Repair the selection/grid capture scenarios before generating new native evidence. Docker must
   be running; do not overwrite known references with unrelated native states.
3. Review all remaining built-in effect dialogs and both scroll states, then the bundled add-in
   references (some are source reconstructions, not screenshots of running add-ins).
4. Review long-string locales and RTL/constrained views separately. An English native capture
   cannot certify the full direction/locale/viewport cross-product.

These observations deliberately remain open. “No missing control observed” is narrower than
“matches Pinta,” and a filename match is only a way to find candidate evidence.

## Fresh reproduction, 5 September

A production web build was opened at 1440×960 in dark mode. The Layer Properties dialog still
has a plain percentage input instead of visible minus/plus buttons; the Magic Wand tolerance
still has a slider without a visible numeric output; the 313-pixel Curves dialog still wraps
both its label and coordinate output. The corresponding source is
`src/components/dialogs/layerDialogs.tsx`, `src/components/NativeToolOptions.tsx` and the
`.curves-toolbar` rules in `src/styles.css`. These are confirmed current-web findings, not
just observations of historical web PNGs. No editor behavior was changed during validation.

Docker's cached `pinta-online-native-capture:gtk4` image was then used to rerun
`standalone-dialogs-all` and `adjustment-dialogs-all` with a fresh native profile and dark theme,
writing to `playwright-report/native-fresh/`. The existing native build was reused
(`PINTA_NATIVE_SKIP_BUILD=1`); this is not a clean-source-build proof. Its `Pinta.dll` SHA-256 was
`4998ca4ec838b637004469dc49f4e7e1248b4f641a28fa67f8a2377cb62a10e8`.

The adjustment batch completed with six PNGs. The core batch produced 11 PNGs before failing to
find the Keyboard Shortcuts accessibility node. Do not report that batch as passed, and do not
approve its outputs automatically. The fresh Layer Properties and Curves images were inspected:
native still shows the opacity stepper, and its Curves header fits on one line. Approved web and
native baseline directories were left untouched.
