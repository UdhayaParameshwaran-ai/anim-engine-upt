# @anim/html-templates

The designer's HTML motion templates, kept exactly as delivered, plus what we need to run them inside our own pipeline.

```
designer/phase1/…      the designer's files, verbatim. Never edited: a new phase is dropped in as designer/phase2/…
adapt/adapt.js         our overlay: shrinks text that overflows its box (never edits the designer's files)
src/prelude.js         runs first inside a page: hands it our data and lets us seek it to an exact time
src/files.mjs          serves the pages (prelude + overlay injected, Google Fonts link answered with local Inter)
src/index.ts           what the compiler needs: variants, limits, themes, the page URL
src/page.ts            scene data -> the page's data, and the time warp that lands each item on its cue
src/limits.json        how much copy each variant takes (generated, see below)
```

## How a scene becomes a page

1. The script is written like any template scene: `scene s "T" template=steps variant=rail`, a `title`, items
   `s1 = icon:send "Title" "Detail"`, and `1 pop s1` on the sentence that says each one.
2. The compiler (`compiler/src/html.ts`) turns the declared elements into *virtual* ones (no box, nothing drawn) and adds one
   `motion` element covering the frame. Its params carry the template, variant and the items as JSON.
3. The engine (`engine/src/motion.ts`) builds an iframe for `motion`, opens the page with the data in the URL fragment, and every
   frame calls `__tpl.seek(t)` with the scene's time, warped so item *i* appears when the script shows it.
4. The renderer and the Studio both serve the pages from `files.mjs`, from the same origin as the host page (so the stage can call
   into the iframe). Nothing goes to the network.

## The contract with a page (`prelude.js`)

| | |
|---|---|
| data | `#<encoded JSON>` in the page URL: `{ key, data, icons }`. The page's `localStorage` is replaced by an in-memory store holding only `data` under `key`. |
| `__tpl.ready` | resolves when the stage is built, fonts are loaded and the overlay has fitted the text |
| `__tpl.seek(t)` | shows the page at `t` seconds. Pure: the same `t` always gives the same frame, in any order |
| `__tpl.duration()` | the page's own length for this data |
| `__tpl.starts(n, pace)` | when each of the `n` items appears, in page time (steps and the sets sharing its kit) |

Seeking goes through the page's scrubber (`.scrub` `input` handler). When the designer exposes a proper API, only `prelude.js` changes.

## Adding a set (steps is the pattern)

1. Describe it in `src/index.ts` (`MotionSet`: folder, storage key, variants with `when` lines) and add it to `MOTION_SETS`.
2. Map its data in `pageData` (`src/page.ts`).
3. Register the template in `registry/src/index.ts` with `html: true`, `variants: SET.variants.map(v => v.id)`, and a guide card in
   `guide.ts` built from the variants (title/detail limits come with them).
4. Measure the limits (below), look at the contact sheets, and record what you saw in `REVIEWED`.

## Tools (all in `scripts/`)

- `html-audit.mjs` — every variant x short/normal/long/max data x theme, flags clipped / off-frame / overlapping text.
- `html-limits.mjs` — grows the copy level by level per variant and writes `src/limits.json`. `--merge <raw.json>` applies the
  hand-checked `REVIEWED` table (`scripts/lib/html-data.mjs`) to an existing sweep.
- `html-shots.mjs <level> <out.png> <set/variant>…` — contact sheet of variants at a copy level, with the overlay on.
- `html-host-test.mjs <set/variant> [theme]` — proves hosting: offline, our data, exact and order-independent seeking.

The automatic checks are noisy for effects done on purpose (rolling digits, camera moves, scrolling strips). Anything they fail is
looked at by eye before it becomes a limit.

## Known issues to raise with the designer

- The shared steps shell caps every set at 6 items, so Bar/Line (listed as 8) show 6; minimums are not enforced.
- Glow Wipe labels wrap and overprint the next row (limits are set from what was seen). (Bubble Pack and Scale Zoom, which used to run
  off the frame / overprint from the 4th item, were fixed in the designer's stats update of 2026-11-27: six items fit.)
- Long item text clips in several variants; `adapt.js` shrinks it, and the validator limits copy per variant, but a fix in the
  pages would be better.
- No per-item start times can be passed in: we read them from the page's timing kit instead.

## Overrides (`patches/`)

The designer's pages stay exactly as delivered. When a page does something we do not want in a video, a small script in `patches/` is
injected in front of that one page (`PATCHES` in `src/files.mjs`) and corrects what it drew after every frame (`__tpl.afterSeek`, see
`src/prelude.js`). An override names the selectors and times it relies on; if the designer updates the page, check them again, or drop
the override.

- `compare-split.js` (comparison / Split Wipe): hides the slider pill with its arrows glyph, and keeps the divider in the middle. The
  page overshoots the middle as it sweeps in and nudges the divider 26px on every row; now it sweeps in once and rests, and each point is
  carried by the row itself.
