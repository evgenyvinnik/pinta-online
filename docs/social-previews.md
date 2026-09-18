# Social share link previews

What a pasted paint.rip link looks like in a chat, a post, or a Slack unfurl.

Before this, every page published the same image — `/about/assets/pinta-online-og.jpg`, a plain
screenshot of the editor with no words on it. At feed thumbnail size that reads as a dark
rectangle, and `/promo/` and `/user-guide/` advertised themselves with a picture of the editor
instead of a picture of what they are. The 24 UI-only locale shells published no card metadata at
all, so a link to `/ru/` unfurled as a bare URL, and a French or Arabic page shared a picture with
no words on it.

## What ships

| Path | Purpose |
| --- | --- |
| `web-assets/social/card.html` | The card layout, and the English copy. Open it with `?card=<id>` to inspect one. |
| `scripts/capture-social-cards.mjs` | Renders each card to a 1200×630 JPEG (`npm run generate:social-cards`). |
| `scripts/seo-copy.mjs` | The reviewed per-locale page copy, moved out of the generator so the cards can be built from it. |
| `web-assets/social/cards/*.jpg` | The twelve cards, served from `/social/` by a `viteStaticCopy` target. |
| `web-assets/social/cards/manifest.json` | Card id → file, alt, dimensions. **Not** served; it is the contract the pages are held to. |

| Page | Card | Headline |
| --- | --- | --- |
| `/` | `editor.jpg` | A little paint. A lot of possibility. |
| `/about/` | `about.jpg` | The Pinta image editor, in your browser. |
| `/promo/` | `promo.jpg` | A design, in the next ten minutes. |
| `/user-guide/` | `user-guide.jpg` | Every feature, explained in order. |
| `/fr/`, `/de/`, `/ar/`, `/he/` | `editor-<locale>.jpg` | That locale's own `<h1>` |
| `/fr/about/` and the other three | `about-<locale>.jpg` | That locale's own features heading |

The layout, palette and lockup are the GitHub preview's (`github-preview.html`), because both
represent the same project in the same places. Every screenshot is real application output from
the about, promo, or visual suites — nothing is mocked or drawn afterwards.

`og:image:type` is published alongside the existing width and height, and `/user-guide/` gained the
`twitter:image:alt` it was missing.

### The manifest is the point

The alt text lives with the copy — in `card.html` for English, in `seo-copy.mjs` for the rest — the
capture script copies it into `manifest.json`, and both `scripts/generate-seo-locales.mjs` and
`tests/e2e/seo.spec.ts` read that file. A card cannot be
renamed, re-described, or dropped without the pages and the tests following it. Regenerate with:

```bash
npm run generate:social-cards
```

Then run `npm run seo:sync`, because the generated locale pages embed the card filename and alt.

### Coverage

`publishes a share card with every link, on every public surface` in `tests/e2e/seo.spec.ts` checks,
for the four English pages, the eight localized ones, and a sample of UI-only shells:

- every `og:` and `twitter:` tag a card needs is present and non-empty;
- `og:url` is the page that was actually shared, and `og:image` is absolute (several crawlers do
  not resolve a relative one);
- the four English cards are four *different* files, and each localized page names its own locale's
  card;
- every image returns real JPEG bytes between 1 KB and 5 MB — above 5 MB X shows no preview, and a
  404 is worse than no card because platforms cache the failure;
- the declared 1200×630 matches the image's actual dimensions.

## Localization

The five SEO locales (`en`, `fr`, `de`, `ar`, `he`) have fully translated pages, and each gets its
own editor and About card — twelve cards in all. **No card contains a new translation.** Each is
built from that locale's existing reviewed copy in `scripts/seo-copy.mjs`: the headline is the
page's own `<h1>`, the description its Open Graph description, the alt text the one the page already
publishes. Change a translation, regenerate, and the card follows; it cannot go stale on its own.

That copy used to live inside `generate-seo-locales.mjs`. It now sits in `seo-copy.mjs`, which both
the generator and the capture script import — importing the generator instead would rewrite every
localized page as a side effect of asking it a question. The move is verbatim: `npm run verify:seo`
reports every generated page byte-identical.

### Right-to-left

Arabic and Hebrew cards mirror as a whole — brand lockup and copy column to the right, screenshot to
the left — because the layout uses logical properties (`inset-inline-start`) rather than `left`. Two
details that had to be right:

- **The tight negative `letter-spacing` comes off for RTL.** It is tuned for Latin display type and
  pulls joined Arabic letterforms into each other.
- **The English credit and the `paint.rip` address keep `dir="ltr"`,** or they render as
  "`.Based on Pinta`". That attribute goes on a `<span>` around the text, never on the positioned
  element: `inset-inline-start` resolves against the element's *own* direction, so putting it on the
  footer moves the footer to the wrong edge and over the screenshot.

### Headlines fit themselves

Translated copy is longer than the English it was written under — German especially — and a headline
that overflows a share card is simply lost off the edge. The template shrinks the display size until
the copy column fits, so one layout serves five languages without a per-locale font size.

### The UI-only shells stay English

The other 24 locales are shells: the editor is translated, the marketing copy is not, and they stay
`noindex` until it is. Being out of the index is not a reason to be unshareable — a link pasted into
a chat is not a search result — so they publish `og:title` (`Pinta Online — <language>`), a
description, and the English **editor** card, the one card with no page copy written on it. They
should not get localized cards: there is no reviewed translation to build them from, and inventing
the copy would be inventing translations.

## Checking a card before it ships

The rendered JPEGs are committed, so a reviewer sees them in the diff. Platform-side debuggers
(Facebook's sharing debugger, X's card validator, LinkedIn's post inspector) only work against the
deployed origin, and they cache aggressively: if a card is replaced at the same URL, re-scrape it
there or the old image keeps appearing for weeks.
