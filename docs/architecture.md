# Prompt → Explainer Video: Architecture & Implementation Plan

## Context

We are building a system that turns a natural-language prompt into a **narrated 2D explainer video** made from SVG/HTML visuals, with narration and animation tightly synchronized. STT is out of scope. Pipeline under design:

**Prompt → LLM → Animation DSL (custom, token-lean) → Compiler/Validator → TTS → Timeline Resolver → Animation Engine → Live playback / MP4**

Hard constraint from the user: the DSL must be a **custom text language, not JSON or YAML**, because those formats waste tokens on quotes, braces, keys and indentation. That suits the problem anyway. A line-based language can be parsed while it streams, which "live" output needs and partial JSON can't do well. It is also the format LLMs write most reliably: something that reads like a screenplay.

This is a greenfield project (no existing code), so the plan covers architecture, the DSL, and a phased build.

---

## 1. Core design decisions (summary)

| # | Decision | Why |
|---|---|---|
| D1 | **Narration is the master clock.** Visual actions are anchored to *words in the narration*, never to absolute times. | If TTS takes 6s instead of 5s, every anchor moves with its word. Nothing drifts. |
| D2 | **Cue markers live inline in the narration text** (`{1}`, `{2 key phrase}`). | The LLM places a visual event at the exact semantic moment while writing the sentence, so sync is decided by meaning, not arithmetic. |
| D3 | **Custom line-based DSL ("Narrascript")** for LLM output: a plain text script string, no special file extension (`.nar` in this doc is just a label; store as a text/DB field or `.txt`). It compiles to an **internal JSON IR** that no LLM ever writes. | Token-lean and streamable for the LLM. Strongly typed and tool-friendly inside the system. |
| D4 | **The LLM composes. It never draws.** It picks registered components, layouts and named primitives. It does not write coordinates, raw SVG/CSS/JS, easing curves or absolute times. | Reliability and determinism, and every output can be validated. |
| D5 | **Every primitive expands into property tweens.** The engine core only interpolates typed properties. | New primitives are pure functions. The engine core never changes. |
| D6 | **The engine is a pure function `render(timeline, t)`.** | Seeking, pause, step and frame-exact video export come for free. Live and video share one engine. |
| D7 | **The browser is the runtime for both outputs.** Live uses an audio-clock-driven rAF loop. Video uses headless Chromium stepping frames, piped to ffmpeg. | One animation system, not two. |
| D8 | **The pipeline is staged and content-addressed** (DSL → IR → audio+timings → resolved timeline → frames), and each stage is cached by input hash. | Reproducible re-renders. Editing one beat re-synthesizes one scene only. |

---

## 2. Overall architecture

```
                ┌────────────────────────── Authoring side ──────────────────────────┐
 Prompt ──► [LLM Orchestrator] ──streams .nar──► [Parser] ─► AST ─► [Validator+AutoFix] ─► IR
              ▲   │  (outline → per-scene gen)                        │ diagnostics
              │   └─ catalog retrieval from [Component Registry] ◄────┘ (repair loop)
              └────────── compact error report (scene-scoped) ─────────┘

                ┌────────────────────────── Timing side ─────────────────────────────┐
 IR ──► [Narration Extractor] ─► plain text + cue char-offsets
          ─► [TTS Gateway] ─(provider adapter)─► audio + word/char timings (normalized)
          ─► [Aligner] (fills gaps: interpolation / forced alignment)
          ─► [Timeline Resolver] ─► ResolvedTimeline (absolute, frame-quantized, stateless)

                ┌────────────────────────── Output side ─────────────────────────────┐
 ResolvedTimeline + assets ─► [Engine (browser)] ─► Live player (audio-clock)
                                               └─► Headless renderer (frame-step) ─► ffmpeg ─► MP4
                                               └─► Studio (debug: timeline, inspector, DSL editor)
```

**Core components (TypeScript monorepo):**

| Package | Responsibility |
|---|---|
| `packages/nar` | Lexer, error-tolerant parser, AST with source spans, printer/formatter, migrations |
| `packages/registry` | Component, primitive and layout manifests (single source of truth for validator, engine *and* LLM prompt) |
| `packages/validate` | Semantic checks, auto-fixes, diagnostics |
| `packages/ir` | IR types, AST→IR lowering, layout resolution |
| `packages/tts` | Provider-neutral interface, adapters, cache, aligner |
| `packages/timeline` | Resolver (anchors → absolute tweens), conflict rules, quantization |
| `packages/engine` | Browser scene graph, property evaluator, primitives, players |
| `packages/llm` | Prompt builder, streaming generation, repair loop |
| `apps/studio` | Vite + React debugging/preview UI |
| `apps/render` | Node + Playwright + ffmpeg video exporter |
| `apps/api` | Job orchestration (prompt → artifacts), artifact store |

---

## 3. Data flow (one job)

1. **Outline pass** (LLM, small output): scene list with titles and intents, written in `.nar` header and `scene` lines only.
2. **Catalog retrieval**: embed the outline, fetch the top-K matching components/icons, and render them as a compact catalog block (about 1 token per entry name).
3. **Scene generation** (LLM, streaming; scenes can run in parallel): full `.nar` per scene.
4. **Incremental parse.** Each completed `>` beat line or scene goes through validation and lowering to IR immediately.
5. **Repair.** Errors trigger a scene-scoped repair prompt (≤2 attempts). Anything left gets a deterministic auto-fix (placeholder or drop) plus a warning.
6. **TTS per scene**: plain narration with cue markers stripped and cue char-offsets recorded. Request word/char timestamps. Cache key = hash(text, voice, provider, settings).
7. **Align**: normalize provider timings and resolve each cue to a time (with a precision tag).
8. **Resolve the timeline**: anchors become absolute times; apply durations, chains and conflict rules; bake from/to values; quantize to frames.
9. **Play or render.** Live: playback starts as soon as scene 1 is resolved while later scenes are still generating. Video: render frames deterministically.

**Artifacts persisted per job:** `prompt`, `model+params`, `video.nar` (artifact of record), `ir.json`, `registry.lock`, `audio/*.wav + timings.json`, `timeline.json`, `out.mp4`. Rendering from these is fully deterministic. LLM and TTS non-determinism is frozen into artifacts.

---

## 4. DSL design: requirements first

### 4.1 What the language must express (derived from explainer-video semantics)

An explainer is a **sequence of statements**. Each statement (a sentence or phrase) is accompanied by **visual changes that happen at specific semantic moments inside it**. So the atomic unit is not "an animation at time t". It is:

> **Beat** = one narration utterance + the visual actions bound to moments (words/phrases) within it.

From that:

| Requirement | Concept it forces |
|---|---|
| Visuals appear when a concept is *mentioned* | Point cues bound to a word boundary |
| Emphasis lasts while a phrase is *spoken* | Span cues bound to a word range (duration = speech) |
| Some visuals must finish even if narration is short | Animation-driven holds (silence inserted, speech never stretched) |
| Visuals persist across sentences | Elements are declared on a **stage** (scene) and outlive beats |
| Stages change (new diagram) or evolve (zoom into part) | **Scene** (new stage) vs **Step** (sub-scene: same stage, new layout/camera) |
| Ordered or simultaneous motion | `then` chains (sequential), multiple lines on the same cue (parallel), stagger |
| No coordinates from the LLM | Layout templates + named slots + relative placement |
| Reliable generation | Small closed vocabulary, short ids, positional args, one statement per line |
| Determinism | No free-form code, no absolute times, everything resolvable by a pure compiler |
| Evolution | Version header, registry-driven verbs/kinds, unknown-construct tolerance |

### 4.2 Why not JSON/YAML, and why line-based custom
- **Tokens:** a typical beat is ~45 tokens in `.nar` vs ~150–180 in equivalent JSON (see §5.4). That's 3–4× fewer, which means faster first-frame latency for live output and lower cost.
- **Streaming:** each line is a complete statement, so the parser acts on it the moment the newline arrives. JSON is only valid at the closing brace.
- **LLM reliability:** it reads like a screenplay, a format models already know. Errors stay local to one line and are recoverable per line. A JSON brace error invalidates the whole document.
- **Validation is not lost.** The grammar is small and strict, and the *IR* is JSON-schema'd internally. We get schema rigor without paying LLM tokens for it.
- **Grammar-constrained decoding** is possible later (GBNF/Lark grammars for providers that support CFG). The grammar is LL(1)-ish and line-oriented.

### 4.3 DSL principles
1. **Narration-first.** Text is the timeline skeleton.
2. **Semantic anchors, never timestamps.** Times exist only as optional *durations/offsets* relative to anchors.
3. **Closed vocabulary from the registry.** The verbs, kinds, layouts and slots the LLM may use are generated from the registry, so the prompt can't ask for something the engine lacks.
4. **Structure from keywords, not indentation.** Indentation is cosmetic and ignored, which removes a whole class of LLM errors.
5. **Defaults everywhere.** Durations, easing, colors and sizes come from the theme and primitive presets. The LLM writes intent only.
6. **One statement per line**, so errors are local.
7. **Ids are short and semantic** (`sun`, `leaf`, `a1`).

---

## 5. The DSL: Narrascript (`.nar`)

### 5.1 Conceptual model (hierarchy)

```
Video ── settings (theme, voice, size, fps, lang)
 └─ Scene*            new stage: element set, layout, transition in/out
     ├─ Element*      declared visual (component instance + placement)
     └─ Step*         sub-scene: optional layout/camera change; elements persist  (implicit default step)
         └─ Beat*     one narration line ( > ... ) with inline cues
             └─ Action*   anchor + verb chain on targets
```

- **Scene** = a stage. Entering a scene clears the stage (except `keep` ids) and applies the transition.
- **Step** = a sub-scene. It stays on the same stage and can relayout, refocus the camera, or add elements. In the debugger it is the unit for "replay this part".
- **Beat** = narration utterance + actions. Every `>` line starts a new beat, with no `beat` keyword needed.
- **Cue** = a named moment in a beat's narration: point `{n}` or span `{n words}`.
- **Action** = `anchor verb targets args [then verb …]`.

### 5.2 Syntax by example

```nar
video 1 "How Photosynthesis Works"
theme chalk
voice narrator
size 1920x1080 30

scene need "What a plant needs" in=fade
layout row
sun   = icon:sun
water = icon:droplet
co2   = text "CO₂"
leaf  = asset:leaf @C
a1    = arrow sun->leaf
a2    = arrow water->leaf
a3    = arrow co2->leaf

> Every plant needs three ingredients: {1}sunlight, {2}water, and {3}carbon dioxide.
1 pop sun
2 pop water
3 write co2
> All three flow into the {1 leaf}.
1 draw leaf
1 draw a1,a2,a3 /0.15
end pulse leaf

step inside "Inside the leaf"
focus leaf
chl = label "chloroplast" @right-of:leaf
> Inside each leaf are tiny factories called {1 chloroplasts}.
1 write chl then highlight leaf fit
wait 0.5

scene output "What it makes" in=slide
layout split
eq   = formula "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂" @T
sug  = icon:cube "glucose" @L
oxy  = icon:wind "oxygen" @R
> Using light energy, the plant builds {1}sugar and releases {2}oxygen.
start write eq 1.2
1 pop sug
2 pop oxy then move oxy @TR
> That {1 sugar} is the plant's food.
1 highlight sug fit
1 dim eq,oxy
```

### 5.3 Language reference (MVP)

**Lines** (the first token decides the kind; `#` starts a comment):

| Line | Form | Meaning |
|---|---|---|
| header | `video <ver> "title"` | DSL version + title (first line, required) |
| setting | `theme|voice|size|lang <args>` | Video/scene-level settings (scope = where they appear) |
| scene | `scene <id> "title" [in=<tr>] [out=<tr>] [keep=<ids>]` | New stage |
| step | `step [<id>] ["title"]` | Sub-scene |
| layout | `layout <name>` | `center|row|col|grid|split|stack|cycle` |
| decl | `<id> = <kind>[:<name>] ["text"] [k=v…] [@place]` | Declare element (hidden until an enter verb) |
| beat | `> narration with {n} and {n words}` | New beat |
| action | `<anchor> <verb> <targets> [args] [then <verb> …]` | Anchored actions |
| wait | `wait <dur>` | Silent beat (hold) |
| camera | `focus <id>` / `focus reset` | Shortcut actions at step start |

**Cues:** `{1}` is a point cue at the start of the next word. `{1 sugar molecule}` is a span from the start of the first word to the end of the last; the words are spoken normally and the braces are stripped before TTS. `\{` escapes.

**Anchors:** a cue id (`1`, `2`…), `start` (beat start), or `end` (end of the beat's speech).

**Targets:** `id`, `id,id,id`, sub-part `list.2` / `heart.valve`, or `*` (all visible).

**Args (all optional, positional or k=v):**
- `0.6` duration (seconds). `fit` means duration = span length. `until=3` means end at cue 3.
- `+0.2` delay from the anchor. `/0.15` stagger between multiple targets.
- `@slot` / `@right-of:id` destination for `move`. `->id` for relations.
- `ease=in|out|inout|spring` (presets only). `color=accent|warn|…` (theme tokens only).

**Composition:** multiple action lines on the same anchor run in **parallel**. `then` runs **sequentially** (the next verb starts when the previous ends).

**Placement:** elements without `@` fill the current layout's slots in declaration order. Slots are `TL T TR L C R BL B BR` plus relative `@right-of:x`, `@below:x`, `@inside:x`. The **layout engine** turns these into coordinates. The LLM never writes numbers for position.

### 5.4 Token comparison (same beat)

`.nar` (≈45 tokens):
```
> All three flow into the {1 leaf}.
1 draw leaf
1 draw a1,a2,a3 /0.15
end pulse leaf
```
JSON equivalent (≈170 tokens):
```json
{"type":"beat","narration":"All three flow into the leaf.","cues":[{"id":"1","span":[24,28]}],
 "actions":[{"anchor":"1","verb":"draw","targets":["leaf"]},
 {"anchor":"1","verb":"draw","targets":["a1","a2","a3"],"stagger":0.15},
 {"anchor":"end","verb":"pulse","targets":["leaf"]}]}
```
JSON also forces the LLM to *count character offsets*, which it does badly. Inline cues remove that error class entirely.

### 5.5 Grammar (EBNF sketch)

```
file     = header NL { line NL } ;
header   = "video" INT [ STRING ] ;
line     = setting | scene | step | layout | decl | beat | action | wait | camera | comment | ;
scene    = "scene" ID [ STRING ] { attr } ;
step     = "step" [ ID ] [ STRING ] ;
decl     = ID "=" kind [ STRING ] { attr } [ place ] ;
kind     = NAME [ ":" NAME ] [ "@" VER ] ;
place    = "@" ( SLOT | REL ":" ID ) ;
beat     = ">" { TEXT | cue } ;
cue      = "{" CUEID [ " " TEXT ] "}" ;
action   = anchor verbcall { "then" verbcall } ;
anchor   = CUEID | "start" | "end" ;
verbcall = VERB targets { arg } ;
targets  = target { "," target } ;   target = ID [ "." PART ] | "*" ;
arg      = DUR | "+" DUR | "/" DUR | "fit" | "->" ID | place | KEY "=" VAL ;
wait     = "wait" DUR ;
```
Parser: hand-written, line-oriented, recursive descent within a line. **Error-tolerant**: a bad line becomes an `ErrorNode` with a span, and parsing continues. All AST nodes carry source spans for diagnostics and Studio highlighting.

### 5.6 Internal IR (not LLM-facing)
The lowered, fully explicit JSON: elements carry resolved component+version, resolved geometry (layout applied), and default params. Actions are expanded into primitive invocations with all defaults filled. Cues hold narration char offsets. The IR is JSON-schema validated and is the input contract for TTS and the resolver.

---

## 6. Narration model

- Each beat has `text` (cues stripped), `cueOffsets: {id → [charStart, charEnd?]}`, and an optional `pauseAfter`.
- **TTS unit = scene** (one request per scene, beats joined with sentence breaks). Prosody stays natural across sentences while an edit stays scoped to one scene. Fallback is per-beat synthesis when a provider lacks timestamps over long text.
- Captions/subtitles come free from word timings.
- Future: `*word*` → SSML emphasis, `{.4}` → SSML break, per-beat voice/speaker for dialogue, phoneme-level timing for character lip-sync.

---

## 7. Synchronization model (the core)

### 7.1 Strategy evaluation

| Strategy | Verdict |
|---|---|
| Absolute timestamps | ❌ Breaks whenever TTS duration differs. Banned from the DSL. |
| Duration-based sequencing | ⚠️ Fine *within* an animation, wrong as the sync mechanism |
| Sentence-level sync | ✅ Coarse layer: beat boundaries |
| Word/phrase-level semantic cues | ✅ **Primary mechanism**: cues bind to word boundaries/spans |
| Relative offsets | ✅ Small `+0.2` nudges from an anchor |
| Event/dependency (`then`, `until=`) | ✅ Chains and cross-cue spans |
| Parallel/sequential groups | ✅ Same-anchor lines are parallel, `then` is sequential |
| TTS-generated timing | ✅ The ground truth that resolves every anchor |
| Dynamic timing | ✅ `fit`/`until` durations stretch to speech. Holds insert silence when needed. |

**Chosen combination: a hierarchical anchor model.**
`Scene → Step → Beat (sentence anchors) → Cue (word/phrase anchors) → Action (offset + duration/fit/chain)`.
Every time in the system is *derived* from audio timings plus durations. Nothing is authored in absolute time.

### 7.2 Clock rules
1. **Speech is never time-stretched** (in MVP). Narration audio is the master clock.
2. **Animations are elastic.** They adapt to speech via `fit`/`until`, and preset durations compress when crowded (down to a floor of ~150ms).
3. **Silence is the only thing inserted.** Silence goes in only when an action explicitly must finish (`wait`, an `end`-anchored action longer than the trailing pad, or a scene transition).
4. **Precision degrades gracefully.** Each cue time carries `precision: word|interpolated|sentence`, and the validator warns on low precision.

### 7.3 Why it survives the "5s → 6s" case
Cue `{2}` sits before the word "water". Whatever time TTS speaks "water" at, the cue resolves to it. Spans resize with speech. `end` actions follow the last word. Beat boundaries come from audio, so a longer sentence pushes the following beats later automatically.

---

## 8. Timeline model & resolution

### 8.1 Resolved timeline (engine input)
```
ResolvedTimeline {
  fps, durationFrames, scenes[{id, t0, t1, steps[{id,t0,t1}]}],
  audio[{src, t0, gainEnvelope?}],
  cues[{beat, id, t, tEnd?, precision}],     // for debugger + captions
  words[{text, t0, t1}],
  tracks[{el, prop, t0, t1, from, to, ease}], // baked, stateless tweens
  layers / initial element states
}
```
**Stateless, baked from/to values.** The resolver simulates property values in time order and writes explicit `from` values into each tween. The engine then never needs history, so seeking anywhere is O(log n) lookup + interpolation.

### 8.2 Resolution algorithm (deterministic, single forward pass per scene)
1. **Place audio.** Scene audio starts at scene t0 (after the transition-in). Beat t0/t1 come from the timings of the beat's first and last words.
2. **Resolve anchors.** `cue → word time` via char-offset mapping. Missing word timing → proportional interpolation within the beat (by characters/syllables), marked `interpolated`.
3. **Build the action DAG.** Nodes = verb calls, edges = `then` / `until=` / anchor. Topologically sort it. A cycle is an error (only possible with future named anchors).
4. **Compute durations** in priority order: explicit > `fit`/`until` > preset. Apply delay and stagger.
5. **Hold check.** If the latest *must-finish* action ends after the beat speech end + tail pad, insert silence (shift all later audio/beats). This is the only time-insertion operation.
6. **Expand primitives** into property tweens.
7. **Conflict resolution per (element, property)**, in a deterministic order:
   - Overlapping tweens: **the later start wins** and takes over from the current interpolated value (handoff). Emit a warning if more than 50% of the earlier tween is lost.
   - Crowding: compress the preset duration to fit before the next cue on the same property, down to the floor. Below the floor → truncate + warn.
   - Emphasis on a hidden element → auto-insert the default enter verb (auto-fix, warning).
8. **Bake** from/to values by simulation.
9. **Quantize** every time to frame boundaries (`round(t*fps)`), with ties broken by declaration order.
10. Emit the timeline + a **sync report** (precision, holds inserted, compressions, truncations).

Priority when constraints collide: **speech > explicit user constraints (`wait`, explicit durations) > `fit`/`until` > presets.**

---

## 9. SVG/HTML element model

- **Single stage**: one root `<svg viewBox="0 0 1920 1080">` for vector content, plus a synchronized **HTML overlay layer** (absolutely positioned, same transform matrix) for rich text, cards and formulas (KaTeX). Camera = one transform applied to both layers.
- **Element** = component instance with a uniform **animatable property set**:
  `opacity, x, y, scale, rotate, draw (0–1 stroke progress), reveal (0–1 clip/char progress), tint/highlight (theme color token mix), visible`.
  Components may expose extra typed props (e.g., chart `progress`, counter `value`).
- **Sub-parts**: components declare named parts (`list.2`, `heart.valve`) that are animatable like elements.
- **Ports**: anchor points (`n,s,e,w,center`) so `arrow a->b` auto-routes between element edges and re-routes when its endpoints move.
- **Theme**: color tokens, fonts, stroke widths and motion presets. The LLM only names tokens.

---

## 10. Animation primitive architecture

A primitive is a **pure expansion function**:
```ts
interface Primitive {
  name: string; version: number;
  category: 'enter'|'exit'|'emphasis'|'transform'|'relation'|'camera';
  params: ParamSchema;              // validated at compile time
  defaultDuration: number; mustFinish: boolean;
  expand(target: ElementState, params, t0, dur): Tween[]; // property tweens only
}
```
The engine core only knows how to interpolate typed properties. Adding a primitive = adding one expansion function + manifest, and the prompt catalog updates automatically.

**MVP primitive set (12):**

| Category | Verbs |
|---|---|
| enter | `fade` (opacity), `pop` (scale+opacity, spring), `draw` (stroke progress, falls back to fade for non-stroke content), `write` (text char reveal) |
| exit | `hide` (fade out), `clear` (all scene elements out) |
| emphasis | `highlight` (tint + glow, supports `fit`), `pulse` (scale bump), `dim` (others to 30% opacity) |
| transform | `move` (to slot/relative), `scale` |
| camera | `focus` (zoom/pan to an element's bounds), `focus reset` |

Arrows and connectors are elements animated with `draw`. Scene transitions (`fade`, `slide`, `cut`) are scene attributes.
**Future:** `morph` (path interpolation, flubber-style), `swap`, `trace` (dot along path), `count` (number ticker), `typewriter`, `shake`, `orbit`, `follow-path`, `rotate`, chart-specific (`grow`), character poses, plus user-defined macros (`def name(args) …`) that expand to primitive chains.

---

## 11. Asset / template architecture

**How much LLM freedom? A layered answer (ranked by reliability):**

| Tier | LLM does | MVP? |
|---|---|---|
| 1. Parametric primitives | `text`, `label`, `box`, `circle`, `arrow`, `line`, `formula`, `list`, `card` with text/params | ✅ |
| 2. Select assets | `icon:<name>` (one open stroke icon set, ~1–2k icons, ideal for `draw`), `asset:<name>` (curated illustrations) | ✅ |
| 3. Configure components | `chart:bar data=3,5,8 labels=A,B,C`, `flow`, `timeline`, `cycle` diagrams | ✅ (bar chart + cycle/flow only) |
| 4. Compose templates | Scene templates (`use compare a b`, `use process 4`) that expand to decls + layout | Future |
| 5. Generate raw SVG | A sandboxed `sketch` path sub-language, sanitized and rasterization-tested | Future, opt-in |

**Registry manifest per component:** `id, version, kind(svg|html), params schema, parts[], ports[], defaultSize, drawable(bool), tags[], description (≤10 words, used in the LLM catalog)`. Implementation = a TS module rendering an SVG/HTML fragment from params.

**Unknown asset** → placeholder component (rounded box with the label text) + warning. The video still renders.
**Retrieval**: tags + description get embedded. Per job, inject the top-K relevant entries (one line each: `icon:sun icon:droplet asset:leaf …`) into the prompt, not the whole catalog.
**Lockfile**: `registry.lock` pins component versions used by a job, so re-renders are byte-identical.

### 11A. Positioning rule & template-first composition (confirmed requirement)

**Rule: the LLM never decides coordinates, sizes or pixel values.** It picks a **template**, fills the template's **named slots** with **semantic assets/text** in the DSL, and cues animations. Every position is computed deterministically by the template's layout function.

Three layers, all referenced by name from the DSL:
1. **Scene templates** (layout + structure): `title`, `compare`, `steps`, `cycle`, `flow` (graph), `timeline`, `hub` (hub-and-spoke), `grid`, `chart`, `focus` (one big visual + labels). Each template has a manifest listing its slots, their kinds and how many items it can hold, plus a `layout(slots, measuredContent, canvas, theme) → boxes` function. Graph templates use a deterministic layout library (ELK/dagre) to place nodes.
2. **Semantic SVG library**: assets named by meaning (`sun`, `leaf`, `heart`, `server`, `cell.plant`). Each has a manifest with tags, synonyms, parts, ports, aspect ratio and whether it can be drawn with `draw`. The resolver maps the name the LLM wrote to an asset through synonyms and embeddings (`sunlight` → `sun`), and falls back to a labeled placeholder.
3. **Primitives** (text, label, box, arrow…) for small parts inside slots.

DSL shape:
```
scene why "Plant vs animal cell" template=compare
left  = asset:cell.plant "Plant cell"
right = asset:cell.animal "Animal cell"
> A {1 plant cell} has a wall; an {2 animal cell} does not.
1 draw left
2 draw right
```
```
scene decide "Should I learn to code?" template=flow
n1 = node "Should I learn to code?"
n2 = node "Pick one language"
n3 = node "Try a free tutorial"
e1 = n1 -> n2 "yes"
e2 = n1 -> n3 "not sure"
> Start with one question: {1}should I learn to code?
1 pop n1
> If {1}yes, pick one language. If {2}not sure, try a tutorial.
1 draw e1 then pop n2
2 draw e2 then pop n3
```
Element ids that match slot names (`left`, `right`, `title`) fill those slots. Item templates (`steps`, `cycle`, `grid`) fill in declaration order. Graph templates take nodes and edges. Validation: wrong slot kind, too many items, or an unknown template → error, then the repair loop.

**HyperFrames (github.com/heygen-com/hyperframes, Apache-2.0) as a reference:**
- Its registry blocks (e.g., `flowchart`) are **hardcoded HTML with absolute px positions and fixed GSAP timings** (a 12s duration). We cannot use them as-is: we'd have to edit HTML, which breaks our "LLM writes DSL only" rule.
- **What we take**: the visual design and motion style of its blocks (we rebuild them as parameterized templates whose positions are computed by layout and whose animation steps are exposed as parts the DSL can cue); its `registry-item.json` manifest shape (name, type, tags, dimensions, files, preview), extended with `slots`, `params`, `parts`, `ports`; and its frame-seek-in-headless-Chrome + FFmpeg render approach, which matches §16.
- **Decision: we build our own renderer and engine** (§15–16). No runtime dependency on HyperFrames. It is a design reference only.

---

## 12. LLM generation architecture

**LLM responsibilities**
- ✅ Narration text (script quality, pacing: one idea per beat)
- ✅ Scene/step structure and titles
- ✅ Element choice (from the catalog), layout choice, slot hints
- ✅ Cue placement (semantic sync), action verbs, emphasis, transitions
- ⚠️ Optional duration hints only (`0.8`, `fit`)
- ❌ Coordinates, absolute times, colors beyond theme tokens, easing curves, raw SVG/CSS/JS

**Prompt structure** (built from the registry, cacheable prefix):
1. Grammar cheat-sheet (~500 tokens)
2. Verb/layout/slot vocabulary (auto-generated)
3. Style rules ("1 idea per beat; every visual must be cued; ≤6 elements per step; prefer `fit` highlights on key terms")
4. 2–3 few-shot `.nar` examples
5. Retrieved catalog subset
6. Outline + target scene

**Flow**: outline pass → per-scene streaming generation (parallel for video, sequential/streamed for live) → incremental parse → repair loop.
**Repair loop**: diagnostics are rendered compactly (`L14: unknown element 'sunn' (did you mean 'sun')`) and only the failing scene is resent. Max 2 attempts. Then deterministic auto-fix.
**Model**: a Claude model (e.g. `claude-sonnet-5-5` for generation, Haiku for repairs/outline if latency matters), temperature low, with prompt caching on the static prefix. Provider is abstracted behind `LlmClient`.
**Future**: grammar-constrained decoding (GBNF) for local/open models. A fine-tuned small model on an accumulated `.nar` corpus.

---

## 13. Validation architecture (layered; each layer has its own codes)

| Layer | When | Checks | Example code |
|---|---|---|---|
| L1 Syntax | parse | Malformed line, unclosed cue brace, bad header/version | `NAR101` |
| L2 Schema/type | AST→IR | Unknown verb/kind/layout/slot, param types, duration ranges | `NAR201` |
| L3 Reference | AST→IR | Undeclared element, duplicate id, cue used in text but no action (and vice versa), missing asset, `->` to unknown id, `until` to a missing cue | `NAR301` |
| L4 Semantic/static | IR | Scene without narration, emphasis before enter, hide of a hidden element, element never shown, too many elements per step, layout overflow, beat too long (>40 words) | `NAR401` |
| L5 Timing | post-resolve | Truncated/compressed tweens, low cue precision, crowded cues (<200ms apart on the same element), excessive holds, scene length bounds | `NAR501` |
| L6 Runtime | render | Asset load failure, text overflow measured in the real DOM, font missing | `NAR601` |

**Severities:** `error` (blocks; goes to the repair loop), `fixable` (auto-fixed deterministically, recorded), `warn` (reported in Studio).
**Auto-fix catalog (MVP):** fuzzy-match ids/verbs (edit distance ≤2), placeholder for unknown assets, insert missing enter, drop orphan actions/cues, clamp durations, fall back to the default layout.

---

## 14. TTS abstraction

```ts
interface TtsProvider {
  id: string;
  capabilities: { timing: 'char'|'word'|'sentence'|'none'; ssml: boolean; maxChars: number; };
  synthesize(req: { text: string; voice: string; ssml?: string; settings }): Promise<{
    audio: Uint8Array; format: 'wav'|'mp3'; sampleRate: number;
    timings?: { unit: 'char'|'word'|'sentence'; items: { start: number; end: number; t0: number; t1: number }[] };
  }>;
}
```
- **Adapters**: ElevenLabs (char alignment), Azure (word boundary events), Google (SSML `<mark>`), Polly (speech marks), OpenAI-style (no timing). Mock provider: deterministic `60ms/char`, used for tests and offline dev.
- **Aligner** turns any granularity into word-level timings: char → words; sentence → proportional per-syllable interpolation; none → forced alignment (WhisperX/aeneas worker) or interpolation. Output is normalized `WordTiming[]` with a precision tag.
- **Cue mapping**: cue char-offset → containing/next word → `t0` (point) or `[t0 first, t1 last]` (span).
- **Cache**: content-addressed by `hash(text, voice, provider, model, settings)`. Audio + timings are stored as artifacts. Re-renders never call TTS again.
- **Future**: phoneme/viseme timing for lip-sync, multi-speaker, SSML prosody from `*emphasis*`.

---

## 15. Animation engine architecture (browser)

- **Load**: ResolvedTimeline + IR elements → instantiate component modules → build the SVG/HTML DOM once (all elements present, initial state applied, mostly hidden). Preload fonts/assets and wait until ready before t=0.
- **Evaluate**: `evaluate(t)` uses a per-(el,prop) sorted tween index (binary search) to find the active/last tween, interpolates with the easing preset, and returns a property map. `apply(map)` writes attributes/transforms (batched, only for dirty values).
- **Pure & stateless**: no CSS transitions, no WAAPI timers, no `Date.now`, no `Math.random` (a seeded PRNG if ever needed). Rendering at time t depends only on (timeline, t).
- **Clocks** (pluggable):
  - `AudioClock` (live): t = `audioEl.currentTime` (or a WebAudio context time) read each rAF. Audio is the master, so A/V cannot drift.
  - `FrameClock` (export): t = frame/fps, advanced by the renderer.
- **Controls**: play/pause = clock start/stop. Seek = set t + evaluate (instant, stateless). Restart scene = seek(scene.t0). Step = seek to next/prev cue/beat. Cancel = drop the timeline and rebuild.
- **Progressive/live mode**: the timeline is append-only per scene. The player buffers and starts once scene 1 is resolved. If generation falls behind, the player holds on the last frame of the current scene (with a subtle idle loop) until the next scene arrives.

---

## 16. Rendering/output architecture: **both, from one engine**

| Mode | How |
|---|---|
| Live (browser) | Engine + AudioClock, scenes streamed in as they resolve |
| Video (MP4) | `apps/render`: Playwright headless Chromium loads the same engine bundle with FrameClock. For each frame: `seek(f/fps)` → await fonts/images ready → screenshot (CDP `Page.captureScreenshot` / `HeadlessExperimental.beginFrame` for deterministic compositing) → pipe raw frames to `ffmpeg` with the concatenated, silence-padded audio track → H.264/AAC MP4. Frames can be sharded across workers by range and concatenated. |
| Future | In-browser export via WebCodecs. Lottie/SVG export. Interactive pause-and-ask mode. |

Determinism guarantees: pinned Chromium version, embedded fonts, frame-quantized timeline, locked registry, cached audio. Golden-frame tests enforce it.

---

## 17. Preview & debugging (Studio)

- **DSL editor** (Monaco + `.nar` language mode): syntax highlighting, live diagnostics from the validator, hover docs from the registry, autocomplete of ids/verbs, recompile-on-edit (mock TTS for instant feedback, real TTS on demand).
- **Timeline panel**: rows for narration (waveform + word chips), cues (vertical markers with labels), scenes/steps/beats, and one track per element showing tween bars, color-coded by category. Sync-report flags (compressed, truncated, interpolated precision) appear inline.
- **Transport**: play/pause, frame step, prev/next cue, prev/next beat, replay scene/step, playback rate, loop region.
- **Inspector**: at the current t, shows the active scene/step/beat, current narration word, element property values, which tween drives each property, and the source line (click → jumps to the editor span).
- **Overlay**: element ids/bounds/ports on the canvas.
- **Artifacts view**: prompt, raw LLM output, repair attempts, IR, lockfile, TTS timings JSON.
- **Mismatch finder**: lists cues with low precision, actions whose visual peak lands >250ms from their word, and cues whose action was truncated.

---

## 18. Error handling & reliability

| Failure | Handling |
|---|---|
| Malformed LLM output | Per-line error nodes → scene-scoped repair (≤2) → auto-fix → render with warnings. Never hard-fail a whole video for a fixable scene. |
| Unsupported verb/asset | Fuzzy match → fallback verb (`fade`) / placeholder asset + warning |
| Whole scene unusable | Fallback "title card" scene with narration only (still synced captions) |
| TTS failure/timeout | Retry with backoff → secondary provider → mark job degraded |
| No timing metadata | Aligner fallback (forced alignment or interpolation), precision flagged |
| Asset load failure at render | Placeholder + L6 warning |
| Render crash mid-video | Frame-range sharding allows resuming from the last completed shard |

Reproducibility: every stage's output is content-addressed. `re-render(jobId)` uses stored artifacts only.

---

## 19. Versioning & evolution

- **DSL version** in the header (`video 1`). The parser supports N and N-1. **Migrations** are AST→AST transforms (`nar migrate`), and the printer re-emits canonical source.
- **Additive-first rule**: new verbs, kinds, args and line types are additive. Existing verbs **never change semantics**. A changed behavior becomes `verb@2` in the registry, while the old version stays resolvable.
- **Unknown-construct tolerance**: unknown `k=v` args → warning + ignored. Unknown line types under a newer minor version → skipped with a warning.
- **Feature detection**: the engine publishes a capability manifest (`verbs@versions, kinds, layouts, ir version`). The validator checks a document against a target engine. The LLM prompt is generated from the same manifest.
- **Component/template versioning**: semver per component. `registry.lock` per job. Optional explicit pin in source (`icon:sun@2`).
- **IR version** is independent of the DSL version, which lets the surface syntax evolve without touching the engine contract.

---

## 20. Testing strategy

| Level | Tests |
|---|---|
| Parser | Golden AST snapshots, round-trip (parse→print→parse), error-recovery cases, fuzzing on a corpus of real LLM outputs + mutations |
| Validator | One fixture per diagnostic code, auto-fix snapshots |
| Resolver | Property tests: determinism (same input → identical output), monotonic times, frame alignment, no unresolved anchors; "5s→6s" invariance (scale mock TTS speed, assert each cue stays on its word); conflict rule fixtures |
| TTS | Adapter contract tests against recorded responses. Mock provider for everything else. |
| Engine | `evaluate(t)` unit tests per primitive. Golden-frame pixel diffs at chosen t (Playwright). Seek-equivalence: `seek(t)` == play-to-t. |
| E2E | Prompt eval set (~50 topics): valid-on-first-try rate, repair rate, auto-fix rate, sync-report score, LLM-as-judge rubric for pedagogy/visual relevance. Tracked over prompt/model changes. |

---

## 21. MVP scope vs future

**MVP (establishes the architecture correctly)**
- `.nar` v1: header/settings, scene, step, layout, decl, beat with point/span cues, actions with `then`/parallel/stagger/`fit`/`until`/delay, `wait`
- 12 primitives (§10), 7 layouts, 9 slots + 3 relative placements, scene transitions `cut|fade|slide`
- Components: text/label/title, box/circle, arrow/line with ports, list (parts), card (HTML), formula (KaTeX, HTML layer), bar chart, one icon set, ~20 curated illustrations, placeholder
- Parser + validator L1–L5 + auto-fixes, IR + layout engine
- TTS: interface + one timed provider (ElevenLabs or Azure) + mock + aligner (char/word/interpolation), scene-level synthesis, cache
- Resolver (full algorithm §8.2), sync report
- Engine with AudioClock + FrameClock. Live player (non-streaming first, then progressive). MP4 renderer.
- Studio: editor + diagnostics, timeline panel, transport, inspector
- LLM: outline + per-scene generation, catalog retrieval (tag-based first, embeddings next), repair loop
- Eval harness with ~20 prompts

**Future**
- Macros/scene templates (`def`, `use`), named action anchors (`#id` / `id.end`)
- `morph`, `trace`, `count`, path-follow, rotate, charts beyond bar, 3D-ish parallax camera
- Characters with poses and lip-sync (phoneme timing), multi-speaker dialogue
- SSML prosody from markup, background music + ducking, SFX cues
- Sandboxed generative SVG (`sketch`), image generation for backgrounds
- Grammar-constrained decoding, fine-tuned generator model
- Interactive mode (pause, ask, branch), WebCodecs export, collaborative Studio editing
- Speech time-stretch (bounded ±8%) as an optional resolver strategy

---

## 22. Implementation phases

| Phase | Deliverable | Exit criteria |
|---|---|---|
| P0 (wk 1) | Monorepo, `.nar` grammar spec doc, registry manifest format, IR schema | Spec reviewed. Example `.nar` files hand-written for 3 topics. |
| P1 (wk 2–3) | Parser + printer + validator L1–L4, AST→IR, layout engine | All hand examples compile. Diagnostics are clean. |
| P2 (wk 3–4) | TTS interface, mock + 1 real provider, aligner, cache. Resolver + sync report. | 5s→6s invariance test passes. Timelines deterministic. |
| P3 (wk 4–6) | Engine (components, 12 primitives, evaluator, clocks), live player | Hand-written examples play in sync in the browser. Seek works. |
| P4 (wk 6–7) | Headless renderer + ffmpeg | MP4 export matches the live preview (golden frames) |
| P5 (wk 7–8) | LLM orchestrator, catalog retrieval, repair loop, eval harness | ≥85% scenes valid after repair. End-to-end prompt→MP4. |
| P6 (wk 8–9) | Studio (editor, timeline, inspector), progressive live streaming | Debug any sync issue from Studio alone |

---

## 23. Verification (end-to-end)

1. `nar check examples/photosynthesis.nar` → 0 errors. Diagnostics fixtures pass (`pnpm test`).
2. `nar build examples/photosynthesis.nar --tts mock` → `timeline.json`. Re-run → byte-identical hash.
3. Run with mock TTS at 1.0× and 1.2× speed → assert every cue's time equals its word's start (invariance test).
4. Open Studio → play: each visual enters on its cued word. Click a cue → seek is exact. Step beat by beat.
5. `nar render --out out.mp4` → watch: A/V sync within one frame. Golden-frame diff vs the live preview at 10 sampled timestamps.
6. `api: POST /jobs {prompt:"Explain how a bill becomes law"}` → valid `.nar`, repair report, MP4. Run the 20-prompt eval and record validity/repair/sync scores.
