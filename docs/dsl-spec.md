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
- Elements persist for the whole scene. A new scene clears the stage, except ids listed in `keep=`.
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
| Setting | `theme <look>` · `motion <personality>` · `voice <name>` · `size <W>x<H> [fps]` · `lang <code>` · `fps <n>` | Before the first scene (video-wide) or inside a scene |
| Scene | `scene <id> ["title"] [template=<t>] [in=<transition>] [out=<transition>] [keep=<id,id>]` | Top level |
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
| enter | `fade` `pop` `draw` `write` | `draw` falls back to `fade` if the element can't be drawn. `write by=char\|word\|line`, `sync=true` reveals words as they are spoken. |
| exit | `hide` `clear` | `clear` takes no targets |
| emphasis | `highlight` `pulse` `dim` | `highlight style=glow\|marker\|underline`, supports `fit` |
| transform | `move` `scale` | `move @slot`, `scale by=1.2` |
| camera | `focus` | `focus <id>` or `focus reset` |

The registry (`packages/registry`) is the source of truth for verbs, their parameters and defaults.

## 6. Elements, templates and placement

**The LLM never writes positions.** A scene either names a **template** (`template=compare`), which decides the geometry of its slots, or a **layout** (`layout row`), which places elements in declaration order.

- **Named slots:** an element whose id matches a slot name fills that slot (`left`, `right`, `title`, `center`, `main`).
- **Item templates** (`steps`, `cycle`, `timeline`, `hub`, `grid`): the remaining elements fill in declaration order.
- **Graph templates** (`flow`): `node` elements plus `a -> b` edges. A deterministic graph layout positions them.
- **Hints:** `@<slot>` with slots `TL T TR L C R BL B BR`, or relative `@right-of:x` `@left-of:x` `@above:x` `@below:x` `@inside:x`. These are semantic hints only. The layout engine computes the coordinates.

**Element kinds (v1):** `title` `text` `label` `list` `card` `formula` `box` `circle` `arrow` `line` `node` `edge` `icon:<name>` `asset:<name>` `chart:<type>`.

`icon:` and `asset:` names come from the **semantic SVG library** (`sun`, `leaf`, `cell.plant`). An unknown name is matched through synonyms, or replaced with a labeled placeholder plus a warning.

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
| NAR213 | schema | Unknown transition | Closest transition, else `fade` |
| NAR214 | schema | Bad setting (size, fps, theme, lang, voice) | Remove / closest theme |
| NAR215 | schema | Unknown scene attribute (warning) | Ignore |
| NAR216 | schema | `move` without a destination | Drop the call |
| NAR217 | schema | `fit` anchored on a point cue | Remove `fit` |
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
| NAR404 | semantic | Element declared but never shown (warning) | — |
| NAR405 | semantic | Too many elements in a scene (warning) | — |
| NAR406 | semantic | Beat longer than 40 words (warning) | — |
| NAR407 | semantic | Template slot problem: missing required slot, wrong kind, too many items | — |
| NAR408 | semantic | Entering an element that is already visible (warning) | — |
| NAR411 | semantic | Element doesn't fill any template slot (warning) | — |
| NAR412 | semantic | Connector appears before its endpoints (warning) | — |
| NAR413 | layout | Element had to shrink below 35% to fit (warning) | — |
| NAR414 | layout | Text had to shrink below 50% (warning) | — |
| NAR415 | layout | Elements overlap (warning) | — |

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
