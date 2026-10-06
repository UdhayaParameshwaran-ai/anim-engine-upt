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
| Setting | `theme <name>` · `voice <name>` · `size <W>x<H> [fps]` · `lang <code>` · `fps <n>` | Before the first scene (video-wide) or inside a scene |
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

The parser is error-tolerant: a bad line produces a diagnostic and parsing continues with the next line. Diagnostics print as `L<line>:<col> <code> <severity>: <message>`, and that form is sent verbatim in LLM repair prompts. Reference checks (NAR2xx–3xx), semantic checks (NAR4xx) and timing checks (NAR5xx) belong to later layers.

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
