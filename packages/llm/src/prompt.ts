import {
  AssetLibrary,
  COMPONENTS,
  frameMode,
  GRID_ELEMENTS,
  GRID_LAYOUTS,
  LAYOUTS,
  RELATIONS,
  slotRects,
  SLOTS,
  TEMPLATES,
  BACKGROUNDS,
  COMPOSE_PATTERNS,
  MOTIONS,
  THEME_SUMMARIES,
  THEMES,
  TRANSITIONS,
  VERBS,
  type AssetManifest,
} from "@anim/registry";

/**
 * Picks the assets most relevant to a topic: words of the text matched
 * against names, synonyms, tags and descriptions. Keeps the prompt small as
 * the library grows; the LLM may only use names it is shown.
 */
export function retrieveAssets(text: string, assets: AssetLibrary, limit = 40): AssetManifest[] {
  const words = new Set(text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []);
  const stem = (w: string) => w.replace(/ves$/, "f").replace(/(ies|es|s)$/, "");
  const stems = new Set([...words].map(stem));
  const scored = assets.all().map((a) => {
    const fields = [a.name, ...a.name.split("."), ...a.synonyms];
    let score = 0;
    for (const f of fields) if (words.has(f) || stems.has(stem(f))) score += 3;
    for (const t of a.tags) if (words.has(t) || stems.has(stem(t))) score += 2;
    for (const w of a.description.toLowerCase().split(/\W+/)) if (w.length > 3 && stems.has(stem(w))) score += 1;
    return { a, score };
  });
  // Relevant assets first, then the rest of the library (it is small today), stable by name.
  return scored
    .sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name))
    .slice(0, limit)
    .map((s) => s.a);
}

const EXAMPLE = `video 1 "Plant vs Animal Cells"
theme chalk
motion playful

scene compare "Two kinds of cell" template=compare in=fade
title = title "Plant vs Animal Cells"
left  = asset:cell.plant "Plant cell"
right = asset:cell.animal "Animal cell"
> Cells come in {1}two familiar kinds.
start write title
1 draw left,right /0.3
> A {1 plant cell} has a rigid wall and green chloroplasts.
1 highlight left.wall fit
end highlight left.chloroplast 1
> An {1 animal cell} has no wall, so it can change shape.
1 highlight right fit
1 dim left

scene energy "Where the energy comes from" in=fade
layout row
sun = icon:sun "Sunlight"
leaf = asset:leaf "Leaf"
beam = arrow sun->leaf
> Plants run on {1}sunlight, carried {2 straight into the leaf}.
1 pop sun
2 draw beam fit then draw leaf

scene numbers "By the numbers" grid=L3-02 in=fade
title = title "Microscopes changed biology"
chart = chart:bar data=2,40,300 labels=1700,1900,2000
cells = stat "37T" "cells in a human body"
tip = callout "Every living thing is made of cells."
> Each century we found {1}far more kinds of cell.
start write title
1 draw chart
> Your body alone has {1 thirty-seven trillion}.
1 draw cells
end draw tip

scene decide "What next?" template=flow in=slide
n1 = node "Curious about cells?"
n2 = node "Use a microscope"
n3 = node "Read a textbook"
e1 = n1 -> n2 "hands-on"
e2 = n1 -> n3 "theory"
> If you're {1}curious, there are two good paths.
1 pop n1
> Try it {1}hands-on with a microscope, or {2}read a textbook.
1 draw e1 then pop n2
2 draw e2 then pop n3`;

/** The system prompt: the whole language, generated from the registry. */
export function systemPrompt(assets: AssetManifest[]): string {
  const verbs = VERBS.map((v) => `  ${v.name.padEnd(9)} ${v.category.padEnd(9)} ${v.summary}`).join("\n");
  const templates = TEMPLATES.map((t) => {
    const slots = t.slots.map((s) => `${s.name}${s.required ? "" : "?"}`).join(",");
    const items = t.items ? ` items ${t.items.min}-${t.items.max}` : t.graph ? ` nodes ≤${t.graph.maxNodes} + edges` : "";
    return `  ${t.name.padEnd(10)} ${t.summary}${slots ? ` [slots: ${slots}]` : ""}${items} · variants: ${t.variants.join("|")}`;
  }).join("\n");
  // Grid-only elements are listed in the grid section instead.
  const gridOnly = new Set(GRID_ELEMENTS.map((e) => e.kind).filter((k) => !["icon", "asset", "chart", "formula"].includes(k)));
  const kinds = COMPONENTS.filter((c) => c.kind !== "placeholder" && c.kind !== "footer" && !gridOnly.has(c.kind))
    .map((c) => `  ${(c.named === "required" ? `${c.kind}:<name>` : c.kind).padEnd(13)} ${c.summary}`)
    .join("\n");
  const catalog = assets.map((a) => `${a.kind}:${a.name}${a.parts.length ? `(${a.parts.join(",")})` : ""}`).join(" ");

  return `You write Narrascript: a line-based script language for narrated 2D explainer videos.
Reply with Narrascript only — no prose, no markdown fences.

STATEMENTS (one per line; the first word decides the type)
video 1 "Title"                      first line of a full script
theme <look>                         see STYLE
motion <personality>                 see STYLE
scene <id> "Title" [template=<t> [variant=<v>|auto] | compose=<pattern>] [emphasis=first|last|<id>] [density=airy|tight] [mirror=true] [in=<transition>]
step <id> "Title"                    optional sub-scene on the same stage
<id> = <kind>[:<name>] ["text"] [key=value] [@slot]   declares an element (hidden until an action shows it)
<id> = <a> -> <b> ["label"]          graph edge (template=flow)
> Narration with {1}point cues and {2 span cues}.
<anchor> <verb> <targets> [args] [then <verb> <targets> [args]]
wait <seconds>

HOW TIMING WORKS
- Each "> " line is one spoken sentence. Action lines below it are tied to its cues.
- {n} = the moment the next word is spoken. {n some words} = while those words are spoken.
- Anchors: a cue id, "start" (sentence start) or "end" (after the sentence).
- Several action lines on one anchor run together; "then" runs the next verb after the previous.

RULES
- One idea per sentence, at most 25 words. 2–6 sentences per scene.
- Every cue gets at least one action. Every element must be shown by an enter verb (fade, pop, draw, write).
- Show an element before emphasizing or moving it. Draw connectors after (or together with) their endpoints.
- Never write coordinates, sizes or colors. Only durations like 0.8 are allowed as numbers.
- Prefer a template. Element ids that equal slot names fill those slots; other elements fill items in order.
- No template fits? compose=<pattern> arranges 2–6 elements by intent (${COMPOSE_PATTERNS.join("|")}); emphasis=<id> names the hero. An element called title keeps the top band.
- Use only the assets listed below, exactly as written. For anything else use box "Label" or text.
- Parts in parentheses can be targeted as <id>.<part>; list items and chart bars as <id>.1, <id>.2 …
- Connectors join two declared ids with "->" and no spaces: a1 = arrow sun->leaf (never "arrow sun to leaf").
- fit and until= need a span cue {n some words}; on a point cue {n} use a duration or nothing.
- Cue ids restart at 1 on every "> " line, and the actions under a line anchor only on that line's cues.
- Grid elements (stat, bullets, timeline, quote, …) only go in grid= scenes; template scenes use ELEMENT KINDS. A template's name is not an element.

QUALITY
- Show, don't label: use an icon or asset whose meaning matches its label (e.g. icon:sun "Sunlight"). Use box only for abstract ideas no listed asset fits; never fill a scene with boxes alone.
- Be factually correct. Use real, well-known figures; if unsure of a number, describe the trend in words instead of inventing data.
- Never invent quotes or attributions. Quote only real, famous people with words they actually said; otherwise use callout or body.
- Each scene adds something new: don't repeat what other scenes cover.

VERBS
${verbs}
ARGS: 0.8 duration · fit (= length of the span cue) · +0.2 delay · /0.15 stagger · until=<cue> · ease=in|out|inout|spring · color=accent|warn|good|cool|muted · move needs @slot or @right-of:<id> · write sync=true reveals words as spoken

${styleSection()}

TEMPLATES
${templates}
LAYOUTS (only when no template): ${LAYOUTS.join(" ")}
SLOT HINTS: @${SLOTS.join(" @")} · relative: ${RELATIONS.map((r) => `@${r}:<id>`).join(" ")}

ELEMENT KINDS
${kinds}

${gridSection()}

ASSETS
${catalog}

EXAMPLE
${EXAMPLE}`;
}

/**
 * Grid scenes (Template Rule Book v2): the frame, the 27 layouts with their
 * slot sizes, and the 34 elements with their minimum sizes and limits.
 */
function gridSection(): string {
  const mode = frameMode("title", false);
  const layouts = GRID_LAYOUTS.map((l) => `  ${l.code} ${l.name}: ${slotRects(l, mode).map((r) => `${r.w}×${r.h}`).join(" · ")}`).join("\n");
  const elements = GRID_ELEMENTS.map((e) => `  ${e.syntax.padEnd(46)} ${e.role.padEnd(7)} min ${e.minW}×${e.minH} · ${e.limits}`).join("\n");
  return `GRID SCENES (editorial pages): scene <id> "Title" grid=<layout code>
- Use instead of template=. 1 to 4 content elements fill the layout's slots in declaration order (left→right, top→bottom); that order is also the animation order.
- Optional frame: title = title "…" (header), subtitle = text "…", foot = footer "source or note". No @placements.
- Each element fills its whole slot; "draw" plays its built-in motion (counts up, bars grow, items enter in turn).
- Rules: one element per slot; each slot at least the element's minimum size; at least one primary or flex element; icon, logo, avatar and progress never in the largest slot or alone; max 1 callout, 1 icon, 2 charts; no element twice (except stat and charts).
- Lists use ";" between items and "|" between the fields of an item.
LAYOUTS (slot sizes with a title; a subtitle or footer makes them ~50px shorter)
${layouts}
GRID ELEMENTS (syntax · role · minimum slot · limits)
${elements}`;
}

/**
 * System prompt for the outline pass: only what planning needs (scene
 * types, themes, the asset names), about a fifth of the full prompt.
 */
export function outlineSystemPrompt(assets: AssetManifest[]): string {
  const templates = TEMPLATES.map((t) => `  ${t.name.padEnd(10)} ${t.summary} (variants: ${t.variants.join("|")})`).join("\n");
  const layouts = GRID_LAYOUTS.map((l) => `${l.code} ${l.name} (${l.slots.length})`).join(" · ");
  const elements = [...new Set(GRID_ELEMENTS.map((e) => e.kind))].join(" ");
  return `You plan narrated 2D explainer videos written in Narrascript, a line-based script language.
Reply with Narrascript lines only — no prose, no markdown fences.

LINES
video 1 "Title"
theme <look>
motion <personality>
scene <id> "Title" template=<t> [variant=<v>] | grid=<layout code> [mirror=true]
# goal: <one line>

${styleSection()}

TEMPLATES (diagrams)
${templates}

GRID LAYOUTS (editorial pages; number of content slots in brackets; elements: ${elements})
${layouts}

ASSETS AVAILABLE: ${assets.map((a) => `${a.kind}:${a.name}`).join(" ")}

PLANNING RULES
- Tell one story: each scene covers a different point, in a logical order, ending with a takeaway.
- Pick the template or grid that fits the content: processes → steps/flow, comparisons → compare, loops → cycle, numbers/quotes/lists → grid.
- Vary scene types and arrangements (variant=, mirror=true on some grid pages); plan visuals from the assets above.
- Plan only facts you are sure of.`;
}

/** Looks and motion personalities with one line each, so the model can match them to the topic. */
function styleSection(): string {
  const looks = THEMES.map((t) => `  ${t.padEnd(14)} ${THEME_SUMMARIES[t]}`).join("\n");
  const motions = MOTIONS.map((m) => `  ${m.name.padEnd(14)} ${m.summary}`).join("\n");
  return `STYLE (once per video, before the first scene; pick what suits the topic and audience)
theme <look>:
${looks}
motion <personality>:
${motions}
bg <kind>[+<kind>] (optional; default is the look's own): ${BACKGROUNDS.filter((b) => b.name !== "auto").map((b) => b.name).join(" ")}
Scene transitions: in=auto (default) lets the motion choose; or in=${TRANSITIONS.filter((t) => t !== "auto").join("|")}`;
}

/** First pass: plan the scenes without writing narration. */
export function outlinePrompt(topic: string, scenes: { min: number; max: number }): string {
  return `Plan a narrated explainer video about:
${topic}

Output only:
- the "video 1" line, a "theme" line and a "motion" line that suit the topic and audience
- one "scene" line per scene (${scenes.min}–${scenes.max} scenes), each with a fitting template= (diagrams) or grid= (editorial pages of numbers, charts, lists, quotes), followed by one comment line "# goal: <what this scene explains and which visuals it uses>"
No elements, narration or actions yet.`;
}

/**
 * Second pass: one complete scene, written against the whole outline and,
 * when earlier scenes are already written, what they say.
 */
export function scenePrompt(outline: string, sceneId: string, earlier = ""): string {
  const said = earlier ? `\n\nAlready narrated in earlier scenes (don't repeat it; build on it):\n${earlier}` : "";
  return `Video outline:
${outline}${said}

Write scene "${sceneId}" in full: its scene line, element declarations, narration lines with cues, and actions.
Cover only this scene's goal; other scenes cover the rest.
Output only this scene, starting with its "scene" line.`;
}

/** The narration of written scenes, without cues: the context later scenes need. */
export function narrationOf(scenes: string[]): string {
  return scenes
    .map((s) => {
      const id = /^\s*scene\s+(\S+)/.exec(s)?.[1] ?? "?";
      const lines = s
        .split("\n")
        .filter((l) => l.trimStart().startsWith(">"))
        .map((l) => l.trimStart().slice(1).replace(/\{\w+\s?/g, "").replace(/\}/g, "").trim());
      return `${id}: ${lines.join(" ")}`;
    })
    .join("\n");
}

/** Single pass: the whole script at once (also used for streaming). */
export function fullPrompt(topic: string, scenes: { min: number; max: number }): string {
  return `Write a complete narrated explainer video (${scenes.min}–${scenes.max} scenes) about:
${topic}

Start with the "video 1" line.`;
}

/** Repair: the failing scene plus compact diagnostics with scene-relative line numbers. */
export function repairPrompt(sceneText: string, diagnostics: string, kind: "errors" | "quality" = "errors"): string {
  const numbered = sceneText
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(3)}| ${l}`)
    .join("\n");
  const ask =
    kind === "errors"
      ? "This scene has errors. Fix every error and reply with the corrected scene only (no line numbers)."
      : "This scene is valid but has quality problems. Fix them, keep everything else that works, and reply with the improved scene only (no line numbers).";
  return `${ask}

${numbered}

${kind === "errors" ? "Errors" : "Problems"}:
${diagnostics}`;
}
