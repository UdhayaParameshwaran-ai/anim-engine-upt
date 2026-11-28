# Narrascript DSL — v1 specification

Narrascript is the plain-text script the LLM writes. It describes **what is said**, **what is shown**, and **which word each visual change is tied to**. It never contains coordinates, pixel sizes, colors outside the theme, or absolute times.

Scripts are plain text (no required file extension; examples use `.txt`).

## 1. Model

```
Video ── settings (theme, voice, size, lang, fps)
 └─ Scene        a stage: template/layout, elements, transition
     └─ Step     sub-scene on the same stage (new layout/camera, more elements)
         └─ Beat one narration line (`>`) or a pause (`wait`)
             └─ Action   cue anchor + verb chain
```

- Everything before the first `step` line in a scene belongs to an implicit step.
- Elements persist for the whole scene. A new scene clears the stage, except ids listed in `keep=` (they stay as they were) and `carry=` (see below).
- **Zoom into an element.** `in=into:<id>` on a scene: the previous scene zooms into that element of its own (about a second), dissolving as it fills the frame, and this scene starts at once. The id must be declared in the previous scene (else `fade`, NAR309). `carry=` wins when both are set.
- **Carry.** `carry=<id,id>` on a scene continues elements from the previous scene: the scene declares them again (same id and kind), they are on screen from its first moment (never entered), and they glide from where they were to their place in the new layout (and size). The boundary is a cut; the rest of the previous scene clears away just before it. An id the previous scene didn't declare, or of another kind, is dropped (NAR309).
- **Narration is the clock.** Each action is anchored to a word in its beat's narration. The final timing comes from TTS word timings (see the architecture doc, §7–8).

## 2. Lexical rules

- One statement per line. Indentation is ignored.
- A line whose first non-blank character is `#` is a comment.
- Tokens are separated by whitespace. `"..."` is one token (`\"` and `\\` escape inside it).
- Identifiers: `[A-Za-z_][A-Za-z0-9_]*`. Cue ids: `[A-Za-z0-9_]+` (usually `1`, `2`, …).
- Durations are seconds: `0.8` or `0.8s`.

## 3. Statements

The first token decides the statement type.

| Statement | Syntax | Where |
|---|---|---|
| Header | `video <version> ["title"]` | First line, required, once |
| Setting | `theme <look>` · `motion <personality>` · `transitions <family>` · `kit <plain|dashed|bold|soft>` · `voice <name>` · `size <W>x<H> [fps]` · `lang <code>` · `fps <n>` | Before the first scene (video-wide) or inside a scene |
| Scene | `scene <id> ["title"] [template=<t>] [in=<transition>] [out=<transition>] [keep=<id,id>] [carry=<id,id>]` | Top level |
| Step | `step [<id>] ["title"]` | Inside a scene |
| Layout | `layout <name>` | Inside a scene/step (when no template does the layout) |
| Focus | `focus <id>` · `focus reset` | A step's camera, before its first beat |
| Element | `<id> = <kind>[:<name>][@<ver>] ["text" …] [a->b] [key=value …] [@<place>]` | Inside a scene |
| Edge | `<id> = <from> -> <to> ["label"]` | Inside a scene (graph templates) |
| Beat | `> narration with {cues}` | Inside a scene |
| Wait | `wait <seconds>` | Inside a scene (a silent beat) |
| Action | `<anchor> <verb> [targets] [args] [then <verb> [targets] [args] …]` | After a beat or wait |

## 4. Narration and cues

```
> Every plant needs {1}sunlight, {2}water and {3 carbon dioxide}.
```

- `{id}` is a **point cue**: the moment the next word starts.
- `{id words}` is a **span cue**: from the first word's start to the last word's end. The words are spoken normally.
- Braces are removed before TTS, so the remaining text is exactly what is spoken.
- `\{`, `\}` and `\\` give literal characters.
- A cue id must be unique within its beat.

## 5. Actions

**Anchor:** a cue id from the current beat, `start` (beat start) or `end` (end of the beat's speech).

**Targets:** `id`, `id,id,id`, `id.part` (`list.2`, `left.wall`), or `*` (everything visible). Some verbs take none (`clear`, `focus reset`).

**Arguments** (all optional, in any order):

| Arg | Meaning |
|---|---|
| `0.8` / `0.8s` | Duration in seconds |
| `fit` | Duration = length of the anchoring span cue |
| `+0.2` | Delay after the anchor |
| `/0.15` | Stagger between successive targets |
| `->id` | Relation target |
| `@TR`, `@right-of:id` | Destination (for `move`) |
| `key=value` | Verb parameter: `ease`, `color` (theme token), `until=<cue>`, `by`, `style`, … |

**Composition:** several action lines with the same anchor run in parallel. `then` runs the next verb when the previous one ends.

### v1 verbs

| Category | Verb | Notes |
|---|---|---|
| enter | `fade` `pop` `draw` `write` `drop` `stream` | `drop` falls in from above (push onto a stack); `stream` is several packets in a row along a connector (`count=2..8`). | `draw` falls back to `fade` if the element can't be drawn. `write by=char\|word\|line`, `sync=true` reveals words as they are spoken. |
| exit | `hide` `clear` `lift` | `clear` takes no targets; `lift` rises and fades (pop off a stack) |
| emphasis | `highlight` `pulse` `dim` | `highlight style=glow\|marker\|underline`, supports `fit` |
| transform | `move` `scale` `swap` | `move @slot`, `scale by=1.2`, `swap a,b` trades two elements' places along arcs |
| camera | `focus` `frame` | `focus <id>` or `focus reset`; `frame a,b,c` frames several elements together. A dense template scene (8+ things) with no camera lines gets an automatic camera that follows the action and ends on the full view. |
| value | `set` `count` `strike` | `set x to="404 Not Found"` changes an element's text in place (a small bump; the new text from its peak on); `count x from=0 to=1200 suffix=" ms" decimals=0` runs a number in the element's text; `strike x` draws a line across the element and dims it. |
| relation | `clone` `merge` | `clone a,b,c`: copies of the first element fly to the others (declared hidden). `merge a,b,c`: the others fly into the last, which appears. |
| relation | `send` | `send <connector>`: a packet travels along the connector (drawing it first if it isn't shown yet); `back=true` sends it the other way; `fail=true` stops it halfway (red); `wait=<s>` pauses it halfway. Sending along a connector again only moves the packet. |

The registry (`packages/registry`) is the source of truth for verbs, their parameters and defaults.

## 6. Elements, templates and placement

**The LLM never writes positions.** A scene either names a **template** (`template=compare`), which decides the geometry of its slots, or a **layout** (`layout row`), which places elements in declaration order.

- **Named slots:** an element whose id matches a slot name fills that slot (`left`, `right`, `title`, `center`, `main`).
- **Item templates** (`steps`, `cycle`, `timeline`, `hub`, `cards`): the remaining elements fill in declaration order.
- **Graph templates** (`flow`): `node` elements plus `a -> b` edges. A deterministic graph layout positions them.
- **Hints:** `@<slot>` with slots `TL T TR L C R BL B BR`, or relative `@right-of:x` `@left-of:x` `@above:x` `@below:x` `@inside:x`. These are semantic hints only. The layout engine computes the coordinates.

**Element kinds (v1):** `title` `text` `label` `list` `card` `formula` `box` `circle` `arrow` `line` `node` `edge` `icon:<name>` `asset:<name>` `chart:<type>`.

`icon:` and `asset:` names come from the **picture library**. An unknown name is matched through synonyms, or replaced with a labeled placeholder plus a warning.

- **Illustrations** (`asset:leaf`, `asset:cell.plant`, `asset:heart.anatomy`, …) are hand-made, colored, and have parts a script can address (`left.wall`).
- **Icons** (`icon:sun`, `icon:gavel`, `icon:landmark`, `icon:piggy-bank`, …): 16 hand-made ones with colors of their own, plus about 550 from the open-source [Lucide](https://lucide.dev) set (ISC license). `scripts/build-icons.mjs` (`pnpm icons`) generates them from the `lucide-static` dev dependency; it leaves out interface-only icons (alignment, chevrons, panels, text formatting), brand logos and modifier variants. Icon names say what they show, so every scene request lists all of them and the model picks by meaning.

### 6a. Grid scenes (Template Rule Book v2)

`scene <id> "Title" grid=<code>` lays the scene out as an editorial page instead of a template. The full reference is [`rulebook-v2.html`](rulebook-v2.html); the data lives in `packages/registry/src/grid.ts`.

- **Frame:** `title = title "…"` fills the header, `subtitle = text "…"` adds a subtitle, `<id> = footer "note"` adds a footer (brand, note, page number). These choose one of six frame modes; missing zones give their space to the content.
- **Layouts:** 27 approved codes (`L1-01` … `L4-08`) on a 12-column grid with 96 px margins and 32 px gaps.
- **Content:** 1 to 4 elements, filling the slots in declaration order (left to right, top to bottom). That order is also the animation order. Each element takes its whole slot. `@` placements are ignored.
- **Elements:** `stat` `multistat` `gauge` `scorecard` `progress` `body` `quote` `callout` `definition` `proscons` `formula` `bullets` `numbered` `checklist` `chart:bar|line|pie` `table` `comparison` `stepper` `timeline` `flowchart` `funnel` `cycle` `matrix` `image` `video` `avatar` `logo` `map` `icon:<name>` `asset:<name>`. Lists use `;` between items and `|` between the fields of an item, e.g. `timeline "1796|Smallpox;1955|Polio"` or `flowchart "Start>Check;Check>Done:yes"`.
- **Motion:** `draw` plays each element's signature motion (stats count up, bars grow, ticks draw, items enter in turn). `fade`/`pop` show it finished.
- **Theme:** grid scenes default to the monochrome `editorial` theme unless `theme` is set. Highlights there are flat marker blocks, not glows.

| Code | Rule | Check | Auto-fix |
|---|---|---|---|
| NAR420 | R2 | Unknown layout code | Closest code, or a layout with the right slot count |
| NAR421 | R1/R3 | Element count ≠ slot count, or more than 4 | Same-size layout (same family first) |
| NAR422 | — | Element that can't fill a slot | `text`→`body`, `list`→`bullets`, `card`→`definition`, `label`→`callout` |
| NAR423 | R4 | Slot smaller than the element's minimum | Another layout where everything fits (warning if none) |
| NAR424 | R5 | Only support elements | — |
| NAR425 | R6 | Icon/logo/avatar/progress in the largest slot or alone | Another layout (warning if none) |
| NAR426 | R7 | More than 1 callout, 1 icon or 2 charts | — |
| NAR427 | R8 | Same element twice (except stat, charts) (warning) | — |
| NAR428 | R10 | Text or item limits exceeded (warning) | — |
| NAR429 | R11 | Shown order ≠ slot order (warning) | Reorder the declarations |
| NAR430 | — | Both `grid=` and `template=` | Drop `template` |
| NAR431 | — | `@` placement in a grid scene (warning) | Drop it |

## 6b. Looks and motion personalities

A script's visual style comes from two video-wide settings. Neither changes the script's content, layout or timing anchors, so any script can be restyled by changing one line.

- **`theme <look>`** picks a token set: palette, fonts, heading style, corner radius, stroke weight, shadows, emphasis style and how data widgets are filled. Looks: `chalk` `paper` `dark` `light` `editorial` `neo-brutal` `soft-pastel` `tech-neon` `magazine` `bold-pop` `crayon` `midnight-luxe` `blueprint`. Fonts are bundled (Fontsource, OFL), so the preview and the MP4 match on every machine.
- **`kit <name>`** is the decor kit of the video: how the lines and cards a template draws look, besides the look itself. `plain` (default) is the look's own; `dashed` draws connectors and card borders dashed; `bold` thickens connectors and card borders; `soft` draws connectors dotted and cards without a border. The Director picks one per video and avoids the last one.
- **`transitions <family>`** is the video's set of scene transitions, so its scene changes read as one style: `clean` (push, wipe; defocus into a new part), `brand` (wipe, push; panel), `soft` (defocus, iris; defocus), `film` (defocus; zoom), `play` (iris, slats; ripple), `depth` (push, zoom; cube), `doors` (wipe, slats; split). Without it the motion's own family is used (standard: clean, playful: play, corporate: brand, cinematic: film, energetic: doors, minimal: soft, dramatic: depth). The Director picks one per video from those that suit the motion and avoids the last one. Generated scripts never write `motion`, `transitions` or `in=`: the Director chooses them.
- **`motion <personality>`** decides how the verbs move. It rescales default durations and explicit staggers, reinterprets ease names (`out` under *cinematic* is a long exponential ease), and gives enter verbs their own entrance:

| Motion | Feel | `fade` enters by | `pop` |
|---|---|---|---|
| `standard` (default) | balanced | opacity only | 0.6 → 1, spring |
| `playful` | bouncy, overshooting | rising from below | 0.3 → 1, elastic |
| `corporate` | quick, clean | a short rise | 0.94 → 1 |
| `cinematic` | slow, smooth (×1.5) | blurring into focus | 1.08 → 1 with blur |
| `energetic` | fast, punchy (×0.65) | sliding in from the left | 0.2 → 1, snap |
| `minimal` | calm | opacity only | opacity only |
| `dramatic` | weighty (×1.25) | zooming in from depth | 1.6 → 1 with blur |

Narration timing never changes: only default durations scale, and explicit durations, `fit` and `until=` are kept. Unknown names are fixed to the closest one (NAR214).

**Entrances follow the template.** Items of a template enter from the direction their template gives them: out of a hub's center, in toward a `converge` result, out of a `diverge` source or a `process`, along a sequence, up into a row of cards, from each side of a `compare`. How far they travel is the personality's (`energetic` far, `corporate` a little; `minimal` and `dramatic` enter in place).

**No blank openings.** A template scene that has no title element of its own shows its scene title (`scene s "Where bills come from" template=…`) as a small heading. The heading is on screen from the scene's first frame, so the frame is never empty while the narrator starts, and the content moves down to make room for it. Title scenes, grid pages and scenes that declare `title = …` get no extra heading.

**Life between cues.** A frame never sits completely still while the narrator talks (except under `minimal`):
- **Camera:** each scene moves slowly, in on one scene and back out on the next (2.5–6% of the frame, by personality), unless the script uses `focus`.
- **Idle float:** icons and illustrations rise and fall a few pixels once they have appeared, each on its own phase.
- **Group entrances:** several elements entering on one cue come in one after another (0.14 s apart) unless the script sets its own stagger (`/0.3`).
- **Highlight:** the element also lifts to 106% while it is highlighted. Pictures glow; the flat marker block of some looks is kept for text.

**Icons take the look's style.** Each look draws icons its own way: plain line art (`chalk`, `crayon`, `editorial`, `magazine`), on a tinted circle or rounded square (`paper`, `soft-pastel`, `dark`, `light`), outlined (`tech-neon`, `midnight-luxe`, `blueprint`), white on a solid color (`bold-pop`), or as a hard-shadowed block (`neo-brutal`). Items of a template take the look's palette in turn; an icon with a color of its own (water, fire) keeps it.

**Background.** Every video draws on a plain white board, whatever the look; looks differ by ink colors, type, shapes and emphasis. A `bg` line from older scripts is removed with a warning (NAR214).

**Transitions.** The scene transitions are the designer's (`packages/html-templates/designer/phase1/transitions`): `wipe` `push` `zoom` `iris` `slats` `split` `defocus` `cube` `panel` `ripple`, plus `auto` (default) and `cut` (none). A transition plays across the boundary with both scenes on screen: the first 0.6s of it (times the motion's tempo) at the end of the scene being left, the rest at the start of the next scene. `in=` names the boundary's transition, unless the previous scene set `out=`. `auto` takes it from the video's transition family (`transitions <family>`): the family's opener into a title scene (it starts a new part of the video), its step transitions in turn everywhere else. The first scene opens with a cut and the last leaves with a defocus. The old names still compile with a warning (NAR213): `fade` and `blur` become `defocus`, `slide` and `rise` become `push`.

## 6c. Layout variants and knobs

Scene attributes that rearrange a template (or a grid page) without coordinates. The layout engine still computes every box, with the same fitting and overlap checks.

| Template | `variant=` (first is the default) |
|---|---|
| `title` | the designer's openers (`rise` `curtain` `logo` `shine` `card` `cinema` `beam` `weight` `elastic` `depth` `reel` `liquid` `spot` `converge`); nothing to choose, see "Designed templates" below |
| `compare` | `sides` (point against point, no winner) or `verdict` (the right side wins every row: ticks and crosses, or a scale that tips): a family; the motion within it is picked for you |
| `steps` | `rail` `deck` `accordion` `path` `stack` `domino` `orbit` `dolly` `morph` (the designer's HTML motions; 2 to 6 items); nothing to choose |
| `stats` | `figures` (separate figures or a series) or `shares` (parts of a whole, sizes by area): a family |
| `chart` | `bars`, `line` or `ring`: a family (what the numbers are) |
| `ui` | `prompt` `click` `toggle` `drag` `swipe`: each is a different thing to show |
| `cycle` | `ring` `arc` |
| `hub` | `ring` `sides` |
| `timeline` | `camera` `ribbon` `filmstrip` (the designer's HTML motions); nothing to choose |
| `cards` (alias `grid`) | `auto` `feature` (one large item, the rest beside it) `strip` |
| `spotlight` | `center` `left` `right` |
| `flow` | `auto` `down` `across` |
| `converge` | `left` (inputs stacked left, result right) `top` `around` |
| `diverge` | `right` (source left, outputs stacked right) `bottom` `around` |
| `process` | `across` (inputs → process → outputs) `down` `equation` (one line: `A + B → [process] → C + D`) |

- **Flow shapes.** `converge` fills its `result` slot and places the inputs; `diverge` fills `source` and places the outputs; in `process`, items declared before the `process` element are inputs and items after it are outputs (if one side is empty they are split in half, with a warning). Arrows you declare (`a1 = arrow sun->result`) are drawn on your cues; any you leave out, the template draws itself.
- **Templates draw their own structure**, so a scene reads as its shape even when the script only declares the items. Each drawing appears with the item it belongs to, and is skipped where the script already declared a connector between the same two elements.

  | Template | Draws |
  |---|---|
  | `hub` | a spoke from the center to each item |
  | `cycle` | arrows from each item to the next, closing the loop |
  | `steps` | nothing of ours: an HTML page draws the steps (see below) |
  | `cards` | a panel behind each item (one size for all) |
  | `compare` | a panel behind each side and a "vs" between them |
  | `timeline` | the axis and a dot for each event (`alternate`, `line`) |
  | `spotlight` | a leader line from each label to the picture |
  | `converge` `diverge` `process` | the missing arrows into the result, out of the source, through the process |
  | `process variant=equation` | a "+" between the inputs and between the outputs, one arrow in and one out |

  An arrow that would run straight through another element is left out.
- **Pictures fill their cell.** Icons and illustrations grow (icons up to 2.2×, the featured card more) when the layout leaves room. A label is never smaller than its natural size and may be as wide as its picture's cell; every labelled picture in a scene shares one label size.
- **Rings keep room for their lines.** A `cycle` shrinks its items until every arrow between neighbours has a visible length. A `hub` shrinks its center first, but never below its items' size; on a ring, labels may run wider than their cell.
- **List pages** (`bullets`, `numbered`, `checklist`) draw each item as a row card with a marker in the item's color and type sized to fill the row.
- **Variants are chosen by fit.** The layout engine checks the variant on the scene's real content.
  - **A named variant**, or none (the template's first variant), is kept when it lays out cleanly: no overflow, tiny text or overlap.
  - **When it doesn't**, the engine lays out every variant on trial and uses the best clean one. A variant the script named is reported as NAR416 (warning, fixed).
  - **`variant=auto`** scores every variant on trial: content size, use of the frame, balance, and arrows that don't cut through other elements. Among the clean variants within 10% of the best, the scene id picks one, so the choice is stable for the scene and varied across scenes.
  - **The gallery** compiles with `variants: "exact"`, so each tile shows its variant as is.
- **Template cards** (`packages/registry/src/guide.ts`) describe each template: its *shape* (sequence, loop, many-to-one, …), when to use it and when not, and per variant what it is for plus the item counts it lays out cleanly.
  - **The outline prompt** lists shapes → templates. Each planned scene carries `# shape: <shape> · goal: …`, and a template of another shape is routed to the shape's template.
  - **Each scene request** carries only its template's card and example.
  - **The style director** rotates only among variants whose card covers the scene's item count.
  - **The quality test** (`apps/studio/test/quality.test.ts`) holds every variant to its card's item range.
- `theme=daylight-clean|daylight-plain|aurora-night|aurora-plain|auto` picks the designer theme of a scene drawn by a designer's page (`title`, `steps`, `compare`, `timeline`, `stats`, `chart`, `ui`). `auto` (the default) takes the light theme on a dark-ink look and the night theme on a light-ink one. Other templates ignore it.
- `emphasis=first|last|<id>` gives that element more room (the larger side of `compare`, the hero of `grid variant=feature`). In the other templates the element grows by up to 30% about its center, as far as its cell, the safe area and its neighbours allow.
- `frame=close` opens the scene with the camera close on its first item (about 1.6x) and pulls out to the full view as the first sentence begins; it is left alone when the scene moves the camera itself.
- `density=airy|normal|tight` changes spacing and how much of its cell each element fills.
- `mirror=true` flips the scene left↔right; it works on grid pages too, so the 27 rule-book layouts have 54 arrangements.

Bad values are fixed to the closest one or dropped (NAR218). Variants added through the authoring pipeline (`pnpm variant`, see the README) appear in this list once approved (`cards` also has `arch`); a draft variant is refused with NAR218.

## 6c-tech. Software & tech templates

A domain pack for explaining software and technology. With `generate(topic, { domain: "tech" })` (CLI `--domain=tech`, or the Studio's **Software & tech** menu), planning lists these shapes first, prefers their templates, and labels each scene's goal `· depth: simple` (beginners) or `· depth: dense` (developers). They are available in every video.

| Template | Shape | Shows | Variants |
|---|---|---|---|
| `exchange` | interaction | a sequence diagram: 2–5 parties (the items) side by side with dashed lifelines; every arrow declared between two of them is a message, one row each, in declaration order | `lanes`, `compact` |
| `architecture` | architecture | components grouped into zones: `z = zone "Client"` starts a group and the elements declared after it belong to it; the links are arrows you declare | `tiers` (zones as columns), `layers` (zones as rows) |
| `stack` | layers | 2–7 layers, the first declared on top; a `box` fills its band | `bands`, `centered` |
| `structure` | structure | 2–8 value cells (`box "42"`) in one size; pointers are labels placed `@above:<cell>` and moved with `move p @above:c3` | `array` (with indexes), `list` (arrows between nodes, `→ null`), `stack` (grows upward, `← top`), `queue` (`front` / `back`) |
| `code` | code | a `code` or `terminal` panel (slot `code`), with up to 4 notes beside it, or its output | `notes`, `stacked`, `split` |
| `tree` | hierarchy | 3–12 nodes; the lines you declare join each parent to its child (`l1 = line root->src`); leaves spread evenly, parents centred over their children | `down`, `right` |
| `states` | states | a state machine: states are `node`s, transitions are arrows you declare with the event as label; an arrow back to an earlier state curves above the others | `across`, `down` |
| `gitgraph` | branching | `b = zone "main"` starts a branch lane, the commits (`circle "init"`) declared after it are on it; the lines you declare join commits and take their lane's colour; a commit's column follows the links, so a merge comes after both parents | `lanes` |
| `anatomy` | format | the parts of a URL, request, packet or token as one bar (widths follow their text) or as rows; name each part with `label "…" @below:<part>` (`@right-of` for rows) | `bar`, `stacked` |

`title`, `steps`, `compare`, `timeline`, `stats`, `chart` and `ui` are drawn by the designer's HTML pages (`packages/html-templates`), not by our layout. The declared elements are virtual (no box, nothing drawn for them); the compiler adds one page-sized `motion` element that hosts the page, and the page is played so that each item appears when the narration says it. Each variant has measured text limits; a title or detail over them is NAR616.

**Items and what each string means.** `s1 = icon:send "Inject" "A harmless piece enters the arm"` is a step (title, detail). A compare row is `r1 = icon:database "left point" "right point"` between `left = label "…"` and `right = label "…"`. A timeline event is `t1 = label "1796" "First vaccine" "Detail"`; a ribbon event may add a fourth string for its picture slot (a figure like `"10,000+ doses"` that counts up, or a short line of text) and a fifth as its caption. A stat is `s1 = icon:user "Q2" "21k" "+75% vs Q1"` (label, value, change). A chart value is `b1 = label "Jan" "$42k"`. A `ui` action is `q1 = icon:send "Send" "What is DNS?"`.

**Cues: the narration names the item.** There are no action lines for these items (no `pop`, `fade`, `visit`, `mark`). Where the narration says an item, its id goes in braces right before the words: `> First {s1}the runner builds it, then {s2}it runs the tests.` The validator turns each such cue into an invisible action on the item (never printed back); the first cue of an item is where it appears. An item that no cue names is an error (NAR404, with the fix in the message); a cue that names no item and has no action is NAR304. The older form (`{1}` with `1 pop s1`) still works. A `title` template has no cues: its page plays the opening itself.

**Optional slots and scene options.**
- `kicker = text "…"` (any of these templates): the small line above the heading. `title` also takes `subtitle`, `byline` and `brand`.
- `pace=relaxed|normal|snappy`: how long the page's own animations take.
- `highlight=<item id>` (`stats`): the stat that glows (the last by default).
- `metric = text "…"`, `yaxis = text "…"`, `xaxis = text "…"` (`stats`): what the numbers measure. `metric` is a line under the heading (up to 60 characters); `yaxis` (up to 40) is the unit or quantity the motion prints as an axis title, scale, legend or caption ("Bubble size = …", "Square area = …"); `xaxis` (up to 24) names what runs along a series (comet, tubes). Each is optional; the page leaves out what is empty.
- `bg=base|tint|deep|auto` (`title`): its backdrop. A page never plays an exit of its own (there is no `playout`): how a scene ends and the next begins is the script's transition (`in=`, `out=`, the motion preset), the same for every template.
- `theme=` and `variant=` as above. An option on a template whose page does not use it is a warning and is dropped. The pages also list an entrance direction and an order; they only use them for the timeline's arrows, so they are not offered.

**How the page is timed.** After a page loads it is scanned once (`__tpl.measure`) for when each item's text becomes visible, because the designer's own formulas are wrong for several variants. The page opens at its own speed, waits just before its first item, plays each item's animation at its own speed at the item's cue, holds while the narration goes on, and runs into the next item so that it lands on its cue (if the narration is quicker, the page is squeezed). Items a page starts less than a second apart (a bar chart) cannot be shown one at a time: the page plays once from the first cue.

### Designed templates and `variant=`

`title`, `steps`, `compare`, `timeline`, `stats`, `chart` and `ui` are drawn by the designer's pages. Their variants are *motions*, and a writer chooses only what changes the meaning:

- **A family** (`chart`: `bars` `line` `ring`; `stats`: `figures` `shares`; `compare`: `sides` `verdict`). Different families say different things (a ring means shares of a whole, a line a trend), so the writer chooses. The motion within the family is picked for them.
- **A variant** (`ui`): each interaction is a different thing to show (typing and sending, clicking, toggling, dragging, swiping), so the writer chooses it.
- **Nothing** (`title`, `steps`, `timeline`): the motions are the same content in another style, so the writer leaves `variant=` out and the Director picks one.

A script may also name a motion directly (`variant=line-zoom`, `variant=rail`); it is kept. The card sent to the LLM lists only the families (or variants) to choose between, never the motion names.

Which motion a scene gets, when it names none (or a family, or `auto`):

1. **Scope.** A family gives its motions. Nothing or `auto` gives the family of the template's default (a chart is bars, never a line by accident), or all the motions of a set with no families.
2. **Fit.** Only the motions that take this many items **and** every string of the written text (their limits are measured, `packages/html-templates/src/limits.json`; `motionPool`).
3. **Pick.** The Director draws among them with its usual weights (never the same motion twice in a row, recent ones less likely). Without a Director, the compiler uses the default motion when nothing is written and it fits, else a motion from the pool, the same one for the same scene id.

So NAR616 is raised only when *no* motion in the scope takes the text: it names the most any of them takes ("no motion that fits this scene takes more than 40"), or the motion the scene named. Shorter text leaves more motions to choose from; the card says how long a string is for every motion (`safe`) and for at least one (`max`).

**Elements**
- `code "line 1\nline 2" lang=js|py|sql|bash|json|…`: a dark editor panel with line numbers and simple syntax colours. `\n` inside a quoted string is a line break. Each line is a part: `write code.2` types line 2, and `highlight code.2` puts a bar behind it.
- `terminal "$ git status\nOn branch main"`: lines starting with `$ ` are commands; the others are output.
- `zone "Name"`: a dashed group boundary in an `architecture` scene. It appears with its first member unless the script shows it.

Code and terminal panels are dark on every look, so code always reads as code.

## 6d. Composition by intent

When no template fits, `compose=<pattern>` arranges a scene's elements from a description of how they relate:

| Pattern | Arrangement |
|---|---|
| `hero-left` / `hero-right` | the hero on one side, the others stacked beside it |
| `hero-top` | the hero above, the others in a row below |
| `hero-center` | the hero in the middle, the others in columns on both sides |
| `pyramid` | the first element on top, the rest in a row below |
| `columns` / `rows` | side by side / stacked, evenly spaced |
| `z` | a Z reading path: alternating columns, each a step lower |
| `auto` | try every pattern and keep the best |

The hero is the element named by `emphasis=`, else the first picture-like one (asset, icon, chart, card, formula). An element with id `title` keeps the top band. Each pattern becomes linear constraints (inside the safe area, gaps, fixed aspect ratios, alignment, hero/support width ratio, even spacing, a pull to grow pictures while text keeps its natural size), solved with the Cassowary algorithm. Candidates (pattern × hero ratio 1.4/1.8/2.3) are scored for coverage, balance, hierarchy, text readability and even margins; near-ties are broken by the scene id, so a scene always lays out the same way. `compose` can't be combined with `template=` or `grid=` (NAR218).

## 7. Diagnostics (parser, L1)

| Code | Meaning |
|---|---|
| NAR101 | Unknown statement |
| NAR102 | Unterminated string |
| NAR103 | Cue `{` never closed |
| NAR104 | Missing or malformed `video` header |
| NAR105 | Unsupported DSL version |
| NAR106 | Statement outside a scene |
| NAR107 | Action line without a preceding beat |
| NAR108 | Unexpected or invalid argument |
| NAR109 | Duplicate cue id in a beat |
| NAR110 | Invalid identifier |
| NAR111 | `focus` line after a step's first beat |
| NAR112 | (warning) Point cue with no following word |
| NAR113 | Duplicate or late `video` header |

The parser is error-tolerant: a bad line produces a diagnostic and parsing continues with the next line. Diagnostics print as `L<line>:<col> <code> <severity>: <message>`, and that form is sent verbatim in LLM repair prompts. Schema (NAR2xx), reference (NAR3xx) and semantic (NAR4xx) checks belong to the validator (§7a). Timing checks (NAR5xx) belong to the timeline resolver.

## 7a. Diagnostics (validator L2–L4, layout)

Run `pnpm check <file>` to see them. Most come with a deterministic auto-fix. A fixed diagnostic prints with `[fixed: …]` and does not block compilation.

| Code | Layer | Meaning | Auto-fix |
|---|---|---|---|
| NAR201 | schema | Unknown verb | Closest verb, else drop the call |
| NAR202 | schema | Unknown element kind | Closest kind, else placeholder |
| NAR203 | schema | Unknown template | Closest template, else remove it (layout fallback) |
| NAR204 | schema | Unknown layout | Closest layout, else `row` |
| NAR205 | schema | Unknown slot or relation, or a destination on a verb that has none | Closest name, else remove |
| NAR206 | schema | Unknown parameter (warning) | Ignore |
| NAR207 | schema | Bad parameter value | Remove (default applies) |
| NAR208 | schema | Wrong number of texts for the kind | Drop extras / use the id as text |
| NAR209 | schema | Name rule (`icon` needs a name, `text` takes none, bad chart type) | Placeholder / drop the name / `bar` |
| NAR210 | schema | Link rule (`arrow` needs `a->b`, others take none) | Drop the element / drop the link |
| NAR211 | schema | Verb target rule | Drop the call / drop the targets |
| NAR212 | schema | `fit` on a verb that doesn't support it | Remove `fit` |
| NAR213 | schema | Unknown or retired transition | The designer's transition a retired name means (warning), else the closest, else `auto` |
| NAR214 | schema | Bad setting (size, fps, theme, lang, voice) | Remove / closest theme |
| NAR215 | schema | Unknown scene attribute (warning) | Ignore |
| NAR216 | schema | `move` without a destination | Drop the call |
| NAR217 | schema | `fit` anchored on a point cue | Remove `fit` |
| NAR218 | schema | Bad layout knob (`variant`, `emphasis`, `density`, `mirror`) (warning) | Closest value, else ignore |
| NAR301 | reference | Undeclared element (or one declared in a later step) | Closest id, else drop the target |
| NAR302 | reference | Duplicate element id in a scene | Drop the duplicate |
| NAR303 | reference | Anchor is not a cue of this beat | Re-anchor onto the beat's unused cues in order (for cues numbered across the scene), else drop the action |
| NAR304 | reference | Cue with no action (warning) | — |
| NAR305 | reference | Connector endpoint not declared | Closest id, else drop the connector |
| NAR306 | reference | Asset not in the library (warning) | Synonym, closest name, else labeled placeholder |
| NAR307 | reference | `until=` doesn't name a later cue | Remove `until` |
| NAR308 | reference | Focus, `->id` or placement refers to an undeclared element | Closest id / remove |
| NAR309 | reference | `keep=` id not declared in the previous scene | Remove from keep |
| NAR310 | reference | Unknown part (`id.part`) (warning) | Target the whole element |
| NAR401 | semantic | Scene without narration | — |
| NAR402 | semantic | Emphasis/transform on a hidden element (warning) | Insert `fade` first |
| NAR403 | semantic | Hiding something not visible (warning) | Drop the target |
| NAR404 | semantic | Element declared but never shown (warning) | fades in after the first sentence (a connector is drawn after the last) |
| NAR405 | semantic | Too many elements in a scene (warning) | — |
| NAR406 | semantic | Beat longer than 40 words (warning) | — |
| NAR407 | semantic | Template slot problem: missing required slot, wrong kind, too many items | — |
| NAR408 | semantic | Entering an element that is already visible (warning) | — |
| NAR411 | semantic | Element doesn't fill any template slot (warning) | — |
| NAR412 | semantic | Connector appears before its endpoints (warning) | — |
| NAR413 | layout | Element had to shrink below 35% to fit (warning) | — |
| NAR414 | layout | Text had to shrink below 50% (warning) | — |
| NAR415 | layout | Elements overlap (warning) | — |
| NAR416 | layout | The named variant does not fit the content; another variant was used (warning) | best clean variant |

Visibility checks follow narration order (where each cue falls in the sentence), not line order. Endpoints revealed later in the same `then` chain count as present for connectors, so `draw e1 then pop n2` is fine.

## 8. Grammar (EBNF)

```
file     = header NL { line NL } ;
header   = "video" INT [ STRING ] ;
line     = setting | scene | step | layout | focus | decl | beat | wait | action | comment | ;
scene    = "scene" ID [ STRING ] { KEY "=" VAL } ;
step     = "step" [ ID ] [ STRING ] ;
layout   = "layout" ID ;
focus    = "focus" ( ID | "reset" ) ;
decl     = ID "=" ( kind { STRING | link | KEY "=" VAL } [ place ] | link [ STRING ] ) ;
kind     = NAME [ ":" NAME ] [ "@" INT ] ;
link     = ID "->" ID ;
place    = "@" ( SLOT | RELATION ":" ID ) ;
beat     = ">" { TEXT | cue } ;
cue      = "{" CUEID [ " " TEXT ] "}" ;
wait     = "wait" DURATION ;
action   = anchor call { "then" call } ;
anchor   = CUEID | "start" | "end" ;
call     = VERB [ targets ] { arg } ;
targets  = target { "," target } ;
target   = ID [ "." PART ] | "*" ;
arg      = DURATION | "fit" | "+" DURATION | "/" DURATION | "->" ID | place | KEY "=" VAL ;
```

## 9. Versioning

- The header carries the DSL version. v1 is the only supported version today.
- Changes are additive: new verbs, kinds, parameters and statements. An existing verb never changes meaning. Changed behavior becomes a new verb version in the registry.
- Breaking surface changes ship with an AST→AST migration, and the printer re-emits canonical source.
