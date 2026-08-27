# Parity work queue

The command surface, dialogs, tools, and effect catalogue already match native Pinta. What
remains is almost entirely *algorithm fidelity* — effects whose dialogs are correct but whose
render routines are not — plus three platform decisions worth making explicitly.

Across the 46 built-in adjustments and effects:

| State | Count |
| --- | ---: |
| Verified faithful or ported to match | 27 |
| Known divergent | 5 |
| Unread or partially read | 14 |

The 10 bundled add-in effects are audited separately in [`dialog-audit/tools.md`](dialog-audit/tools.md).

## Why the gaps survived this long

[`dialog-audit/effects.md`](dialog-audit/effects.md) compared every effect's dialog, parameters,
ranges, and defaults — and passed them. It never compared what the effects compute.

Sharpen is the clearest case: its range is `1–20` in both, but native treats that number as the
radius of a disc it takes a median over, while the port treated it as the strength of a 3×3
kernel. A matching dialog hid a completely different operation.

Everything below is ordered so the highest-visibility divergence comes first and the two judgement
calls come last. Effort is relative: **S** is an afternoon, **M** is a day, **L** is longer.

---

## Phase 1 — Blur sampling: Fragment, Motion, Radial, Zoom

**Effort M · 4 effects · visible output change**

These four are the last effects still *approximating* rather than porting. They produce the right
kind of blur, but not the same pixels.

| | |
| --- | --- |
| **Native** | Fixed-point iterative stepping — Zoom Blur shrinks with `fx -= ((fx >> 4) * fZ) >> 10` — with nearest-neighbour fetches, out-of-bounds samples skipped, and the original pixel folded into the aggregate. |
| **Web today** | A fixed 65 bilinear samples along a linearly interpolated scale. Different step distribution, different sampling, softer result. |

Fragment, Motion Blur, and Radial Blur share the same shape of problem: native builds an explicit
point list (`Utility.Lerp` along the motion vector, offsets around a circle) and samples
nearest-neighbour.

### Do this

1. Transcribe each `Render` literally into a scratch reference, as with the Gaussian blur.
2. Port into [`src/effects/processor.ts`](../src/effects/processor.ts), then diff byte-for-byte
   against the reference across several sizes, radii, and transparent pixels.
3. Pin a small fixture per effect in [`scripts/verify-effects.mjs`](../scripts/verify-effects.mjs).

---

## Phase 2 — Warp supersampling and the five transforms

**Effort M · 5 effects · transforms unread**

The shared warp base is structurally right — quality² samples, per-sample transform, average — but
two things differ.

| | |
| --- | --- |
| **Native** | `Utility.GetRgssOffsets` — rotated-grid supersampling, which is why native edges resolve cleanly at low quality settings. |
| **Web today** | A uniform grid, `(n + 0.5) / quality - 0.5`. Same sample count, worse distribution, visibly rougher edges. |

Second, and larger: the *base* is verified but the individual `InverseTransform` functions for
Bulge, Dents, Polar Inversion, Tile Reflection, and Twist never were. Given the hit rate elsewhere,
treat them as unknown until read. Frosted Glass and Pixelate sit in the Distort menu but are not
warps in native, so they fall to Phase 3.

### Do this

1. Port `GetRgssOffsets` once, into the shared `processWarp`.
2. Read each of the five transform functions against its web counterpart in the same pass — they
   are short, and they share a caller.
3. Add one fixture per transform; the base's sampling is then covered by all of them.

---

## Phase 3 — Close the ten unread routines

**Effort M–L · unknown state**

These were never opened. This is not a prediction that they are broken — but the audit found a
divergence in roughly one effect in three, so assuming they are clean is not justified.

| Effect | Native entry point | Risk signal |
| --- | --- | --- |
| Align Object | `AlignObjectEffect.MoveObject` | Bespoke stencil and move; no shared primitive to check against |
| Outline Object | `OutlineObjectEffect.Render` | Border walk with a colour-gradient branch |
| Cells | `CellsEffect` | Shares control-point code with Voronoi; gradient handling |
| Voronoi Diagram | `VoronoiDiagramEffect` | Distance metric, colour sorting, seeded point placement |
| Mandelbrot Fractal | `Mandelbrot.Compute` | Julia's structure matched; Mandelbrot's factor/zoom mapping unread |
| Frosted Glass | `FrostedGlassEffect.Render` | Seeded jitter — not a warp, despite the menu placement |
| Pixelate | `PixelateEffect.Render` | Own render, not the warp base; cell origin and averaging unread |
| Soften Portrait | `SoftenPortraitEffect` | Chain read only partially; depends on the blur and brightness fixes |
| Ink Sketch | `InkSketchEffect` | Glow dependency fixed; its own 5×5 kernel and darken blend unverified |
| Dithering fast path | `FindClosestPaletteColor` | Web shortcuts palettes 4–7 to cube rounding; equivalence unproven |

The last row is cheap and worth doing first: confirm native's preset palettes 4–7 really are
uniform RGB cubes, in which case rounding to the nearest multiple is provably identical to a
nearest-colour search and the shortcut stands.

---

## Phase 4 — Two decisions, not bugs

**Effort S · needs a call**

### Pencil Sketch — replicate an upstream quirk?

Native renders brightness/contrast into `dest`, then blurs `src` into the same buffer, overwriting
it. Its own `ColorRange` parameter therefore does nothing. The port blurs the adjusted copy
instead, which is almost certainly what the original author intended.

> **Recommendation: replicate the quirk.** The project's stated thesis is matching the desktop app,
> and a user comparing the two side by side sees a difference they cannot explain. Note it in
> [`parity-hardening.md`](parity-hardening.md) as an upstream defect the port reproduces
> deliberately, so it is not silently "fixed" again later.

### Alpha model — straight vs premultiplied

Native's unary ops (Brightness/Contrast, Posterize, Sepia, Invert, Black and White) run directly on
Cairo's premultiplied surfaces. The port runs them on the canvas's straight-alpha buffers.
Identical wherever alpha is 255; divergent on translucent pixels.

> **Recommendation: keep straight alpha and document it.** Native is not doing this deliberately —
> it is what happens when a Paint.NET op meets a Cairo surface. Matching it would mean a
> premultiply round trip that quantises every translucent pixel for no design reason. This is
> already a row in the parity matrix; leave it there.

---

## Phase 5 — Platform surfaces

**Effort S–M · optional**

None of these block parity; they are listed so the decision is on the record.

| Surface | Status | Suggested action |
| --- | --- | --- |
| Add-in Manager | Bundled card list, not native's Gallery / Installed / Updates switcher with a split detail pane | Optional. Add-ins are bundled, so there is nothing to download — but adopting the switcher shell would make it recognisable to desktop users |
| History memory | Native stores `SurfaceDiff`; the port stores full `ImageData` per step | Worth doing if large images strain memory. Invisible until they do |
| Recent files and last folder | `RecentFileManager` feeds the OS recent-documents list and the chooser's last directory | None. Both are browser-owned; there is no "Open Recent" menu in native to port |

---

## The method that works

Every port that landed cleanly followed the same loop. It is slower than reading and
reimplementing, and it is the only thing that caught the alpha-weighting and truncation details.

1. **Transcribe, do not interpret.** Write the C# out in JavaScript in a scratch file — loops,
   shifts, integer division and all — before touching the real implementation.
2. **Watch the integer semantics.** C# casts truncate; `>> 8` on a large value needs
   `Math.floor(v / 256)` in JS, not `>>`. Most divergences found were exactly this.
3. **Diff byte-for-byte** across several sizes, radii, and transparent pixels — not one happy-path
   image.
4. **Pin a small fixture** in `scripts/verify-effects.mjs` with a comment naming the native
   routine, so the next reimplementation cannot quietly "improve" it.

### One caveat on the fixtures

The Hue/Saturation port was validated against a transcription written by the same pass that wrote
the port, including the HSV conversion. That transcription was checked against Cairo's `ToHsv` and
`FromHsv` afterwards and two real differences were corrected — truncation instead of rounding, and
the deliberate `0.0001` zero-guard — but the step is circular in a way the others are not. If any
effect deserves a second pair of eyes, it is that one.

---

## Already settled

Recorded so this plan stands alone and nothing gets re-litigated.

| Area | Outcome |
| --- | --- |
| Ported to match native, byte-exact | Gaussian Blur, Unfocus, Sharpen, Glow, Brightness/Contrast, Posterize, Sepia, Hue/Saturation, Black and White, Curves luminance |
| Verified faithful, unchanged | Emboss, Relief, Edge Detect, Outline Edge, Median, Reduce Noise, Oil Painting, Levels, Auto Level, Invert Colors, Red Eye Removal, Vignette, Add Noise, Dithering, Feather Object, Clouds / Perlin, Julia |
| Partly corrected by dependency | Ink Sketch and Soften Portrait improved via Glow and Brightness/Contrast, but their own routines are still unread — they appear in Phase 3 |
| Non-effect parity | Zoom model, canvas resampling, toolbox reflow, dock persistence, per-tool settings, status bar, phone and touch layouts, icon references |

## Verification

```bash
npm run verify:effects
```

```bash
npm run test:e2e
```

```bash
npm run test:visual
```
