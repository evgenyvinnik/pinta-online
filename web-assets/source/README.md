# Marketing artwork source

`cosmic-garden.png` is the 800 × 600 source used by the repeatable About and promo screenshot
captures. It is intentionally kept outside the Vite static-copy inputs: visitors receive the
optimized WebP screenshots, not an otherwise-unused one-megabyte source file.

The artwork was generated with OpenAI's built-in image generation tool, then all visible campaign
overlays and editor states were created in Pinta Online by `scripts/capture-about-shots.mjs` and
`scripts/capture-promo-shots.mjs`.

## Generation prompt

> Use case: ads-marketing. Asset type: original base artwork to be edited inside Pinta Online and
> shown in authentic product screenshots. Create an unforgettable surreal editorial illustration
> called “Cosmic Garden”: a luminous koi fish swimming through a circular portal above an alien
> botanical garden, with one tiny astronaut tending an oversized glowing flower. The picture should
> feel imaginative, optimistic, and handcrafted—not like generic stock art. Deep indigo night sky
> with layered hills and a crisp circular moon/portal; foreground leaves, mushrooms, and geometric
> flowers; clear visual zones that will respond well to selections, gradients, color adjustments,
> and artistic effects. Polished screen-print poster mixed with paper-cut collage; flat but richly
> layered shapes, confident silhouettes, subtle grain, sharp edges, tasteful halftone texture.
> Landscape 4:3 composition, strong focal portal slightly right of center, koi sweeping diagonally
> from lower left toward upper right, useful negative space in the upper left for typography added
> later inside Pinta. Luminous, joyful, strange, premium editorial campaign. Midnight indigo,
> electric cyan, coral, saffron, lavender, and mint; strong contrast. No text, letters, logos,
> watermark, software interface, or borders; avoid photorealism; make discrete color regions
> suitable for magic-wand selection; preserve enough detail to demonstrate filters while remaining
> legible as a thumbnail.
