import { AssetLibrary, COMPONENTS, LAYOUTS, RELATIONS, SLOTS, TEMPLATES, THEMES, TRANSITIONS, VERBS, type AssetManifest } from "@anim/registry";

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
    return `  ${t.name.padEnd(10)} ${t.summary}${slots ? ` [slots: ${slots}]` : ""}${items}`;
  }).join("\n");
  const kinds = COMPONENTS.filter((c) => c.kind !== "placeholder")
    .map((c) => `  ${(c.named === "required" ? `${c.kind}:<name>` : c.kind).padEnd(13)} ${c.summary}`)
    .join("\n");
  const catalog = assets.map((a) => `${a.kind}:${a.name}${a.parts.length ? `(${a.parts.join(",")})` : ""}`).join(" ");

  return `You write Narrascript: a line-based script language for narrated 2D explainer videos.
Reply with Narrascript only — no prose, no markdown fences.

STATEMENTS (one per line; the first word decides the type)
video 1 "Title"                      first line of a full script
theme ${THEMES.join("|")}
scene <id> "Title" [template=<t>] [in=${TRANSITIONS.join("|")}]
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
- Use only the assets listed below, exactly as written. For anything else use box "Label" or text.
- Parts in parentheses can be targeted as <id>.<part>; list items and chart bars as <id>.1, <id>.2 …

VERBS
${verbs}
ARGS: 0.8 duration · fit (= length of the span cue) · +0.2 delay · /0.15 stagger · until=<cue> · ease=in|out|inout|spring · color=accent|warn|good|cool|muted · move needs @slot or @right-of:<id> · write sync=true reveals words as spoken

TEMPLATES
${templates}
LAYOUTS (only when no template): ${LAYOUTS.join(" ")}
SLOT HINTS: @${SLOTS.join(" @")} · relative: ${RELATIONS.map((r) => `@${r}:<id>`).join(" ")}

ELEMENT KINDS
${kinds}

ASSETS
${catalog}

EXAMPLE
${EXAMPLE}`;
}

/** First pass: plan the scenes without writing narration. */
export function outlinePrompt(topic: string, scenes: { min: number; max: number }): string {
  return `Plan a narrated explainer video about:
${topic}

Output only:
- the "video 1" line and a "theme" line
- one "scene" line per scene (${scenes.min}–${scenes.max} scenes), each with a fitting template=, followed by one comment line "# goal: <what this scene explains and which visuals it uses>"
No elements, narration or actions yet.`;
}

/** Second pass: one complete scene, written against the whole outline. */
export function scenePrompt(outline: string, sceneId: string): string {
  return `Video outline:
${outline}

Write scene "${sceneId}" in full: its scene line, element declarations, narration lines with cues, and actions.
Output only this scene, starting with its "scene" line.`;
}

/** Single pass: the whole script at once (also used for streaming). */
export function fullPrompt(topic: string, scenes: { min: number; max: number }): string {
  return `Write a complete narrated explainer video (${scenes.min}–${scenes.max} scenes) about:
${topic}

Start with the "video 1" line.`;
}

/** Repair: the failing scene plus compact diagnostics with scene-relative line numbers. */
export function repairPrompt(sceneText: string, diagnostics: string): string {
  const numbered = sceneText
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(3)}| ${l}`)
    .join("\n");
  return `This scene has errors. Fix every error and reply with the corrected scene only (no line numbers).

${numbered}

Errors:
${diagnostics}`;
}
