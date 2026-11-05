import {
  AssetLibrary,
  COMPONENTS,
  frameMode,
  GRID_ELEMENTS,
  GRID_LAYOUTS,
  findGridLayout,
  LAYOUTS,
  RELATIONS,
  slotRects,
  SLOTS,
  TEMPLATES,
  SHAPES,
  findTemplate,
  isSetIcon,
  templatesFor,
  COMPOSE_PATTERNS,
  MOTIONS,
  THEME_SUMMARIES,
  THEMES,
  TRANSITIONS,
  VERBS,
  type AssetManifest,
  type Shape,
  type TemplateManifest,
} from "@anim/registry";

/**
 * Picks the assets most relevant to a topic: words of the text matched
 * against names, synonyms, tags and descriptions. Keeps the prompt small as
 * the library grows; the LLM may only use names it is shown.
 */
export function retrieveAssets(text: string, assets: AssetLibrary, limit = 30): AssetManifest[] {
  const words = new Set((text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).flatMap((w) => [w, ...w.split("-")]).filter((w) => w.length > 2 && !STOP.has(w)));
  const stem = (w: string) => w.replace(/ves$/, "f").replace(/(ies|es|s)$/, "");
  const stems = new Set([...words].map(stem));
  const hit = (w: string) => w.length > 2 && (words.has(w) || stems.has(stem(w)));
  const scored = assets.all().map((a) => {
    const fields = new Set([a.name, ...a.name.split(/[.-]/), ...a.synonyms]);
    let score = 0;
    for (const f of fields) if (hit(f)) score += 3;
    for (const t of new Set(a.tags)) if (hit(t)) score += 2;
    for (const w of new Set(a.description.toLowerCase().split(/\W+/))) if (w.length > 3 && !fields.has(w) && hit(w)) score += 1;
    return { a, score };
  });
  // Matches first; then the hand-made art and a set of everyday icons, so a scene always has
  // something to show (icons of the set that match nothing are left out).
  // The best matches (at most 3 of one family: house, house-plug, house-plus …), then all hand-made art and the everyday icons.
  const family = new Map<string, number>();
  const ranked = scored
    .filter((s) => s.score > 0 && isSetIcon(s.a))
    .sort((x, y) => y.score - x.score || x.a.name.length - y.a.name.length || x.a.name.localeCompare(y.a.name))
    .filter((s) => {
      const f = s.a.name.split("-")[0]!;
      family.set(f, (family.get(f) ?? 0) + 1);
      return family.get(f)! <= 3;
    })
    .slice(0, limit);
  const always = scored.filter((s) => !isSetIcon(s.a) || (EVERYDAY.has(s.a.name) && s.score === 0));
  return [...ranked, ...always].map((s) => s.a);
}

/** The words a scene's pictures are searched by: the topic, the scene's title and goal, without the plan's markup. */
export function pictureQuery(topic: string, planned: string): string {
  const plan = planned
    .replace(/\b(template|grid|variant|in|mirror|emphasis|density)=\S+/g, " ")
    .replace(/#\s*shape:\s*\S+/g, " ")
    .replace(/\bgoal:/g, " ")
    .replace(/^\s*scene\s+\S+/gm, " ");
  return `${topic}\n${plan}`;
}

/** Words too common to say anything about a scene. */
const STOP = new Set(
  "the and for with from that this how what why who when where are was were its into than then them they their there have has had not but you your our can will one two three four five all any each out off over under about between through show shows scene goal uses using use video explain explains explained make makes made shape sequence loop compare many one-to-many many-to-one transform hub collection timeline focus graph page template title steps cycle cards spotlight converge diverge process flow grid together combine combines into".split(" "),
);
/** Icons of the set offered to every scene: people, places, money, time, ideas, direction. */
const EVERYDAY = new Set(
  "users house building-2 factory globe map-pin coins banknote trending-up trending-down chart-line chart-bar calendar book-open graduation-cap rocket target scale handshake shield lock key search flag star trophy truck shopping-cart phone mail brain sprout mountain waves snowflake moon thermometer microscope atom dna pill stethoscope car plane ship cpu wifi smartphone laptop camera megaphone newspaper wrench hammer recycle battery-charging plug timer hourglass circle-alert thumbs-up thumbs-down".split(" "),
);

/**
 * The pictures a script may use, as the prompts list them: illustrations
 * with their parts, then every icon by name. Icon names say what they show,
 * so the model picks by meaning; the list is the same for every topic, which
 * keeps the system prompt cacheable across videos.
 */
export function pictureList(assets: AssetManifest[]): string {
  const art = assets.filter((a) => a.kind === "asset").map((a) => `${a.name}${a.parts.length ? `(${a.parts.join(",")})` : ""}`);
  const icons = assets.filter((a) => a.kind === "icon").map((a) => a.name);
  return [
    art.length ? `Illustrations, written asset:<name> (parts in brackets): ${art.join(" ")}` : "",
    icons.length ? `Icons, written icon:<name>: ${icons.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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
    return `  ${t.name.padEnd(10)} ${t.guide.useWhen}${slots ? ` [slots: ${slots}]` : ""}${itemsOf(t)} · variants: ${t.variants.join("|")}`;
  }).join("\n");
  // Grid-only elements are listed in the grid section instead.
  const gridOnly = new Set(GRID_ELEMENTS.map((e) => e.kind).filter((k) => !["icon", "asset", "chart", "formula"].includes(k)));
  const kinds = COMPONENTS.filter((c) => c.kind !== "placeholder" && c.kind !== "footer" && !gridOnly.has(c.kind))
    .map((c) => `  ${(c.named === "required" ? `${c.kind}:<name>` : c.kind).padEnd(13)} ${c.summary}`)
    .join("\n");
  const catalog = pictureList(assets);

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
- Templates draw their own structure, each part appearing with its item: hub spokes, cycle arrows, step numbers and the arrows between steps, card panels, the "vs" of a compare, the timeline axis, spotlight leader lines, and the arrows of converge, diverge and process. Declare only the items and show them; declare a connector yourself only in template=flow, in a scene without a template, or to put a label on it.
- Never write coordinates, sizes or colors. Only durations like 0.8 are allowed as numbers.
- Prefer a template. Element ids that equal slot names fill those slots; other elements fill items in order.
- No template fits? compose=<pattern> arranges 2–6 elements by intent (${COMPOSE_PATTERNS.join("|")}); emphasis=<id> names the hero. An element called title keeps the top band.
- Use only the pictures listed under PICTURES, exactly as written. For anything else use box "Label" or text.
- Parts in parentheses can be targeted as <id>.<part>; list items and chart bars as <id>.1, <id>.2 …
- Connectors join two declared ids with "->" and no spaces: a1 = arrow sun->leaf (never "arrow sun to leaf").
- fit and until= need a span cue {n some words}; on a point cue {n} use a duration or nothing.
- Cue ids restart at 1 on every "> " line, and the actions under a line anchor only on that line's cues.
- Grid elements (stat, bullets, timeline, quote, …) only go in grid= scenes; template scenes use ELEMENT KINDS. A template's name is not an element.

QUALITY
- Show, don't label: give each thing the picture that means it (icon:sun "Sunlight", icon:gavel "Law", icon:landmark "Congress"), and a different picture for each thing in a scene. Never reuse one icon for unrelated ideas. Use box only for abstract ideas no listed picture fits; never fill a scene with boxes alone.
- Be factually correct. Use real, well-known figures; if unsure of a number, describe the trend in words instead of inventing data.
- Never invent quotes or attributions. Quote only real, famous people with words they actually said; otherwise use callout or body.
- Each scene adds something new: don't repeat what other scenes cover.

VERBS
${verbs}
ARGS: 0.8 duration · fit (= length of the span cue) · +0.2 delay · /0.15 stagger · until=<cue> · ease=in|out|inout|spring · color=accent|warn|good|cool|muted · move needs @slot or @right-of:<id> · write sync=true reveals words as spoken

${styleSection()}

TEMPLATES (variant=: usually leave it out; the engine picks the arrangement that fits the content)
${templates}
LAYOUTS (only when no template): ${LAYOUTS.join(" ")}
SLOT HINTS: @${SLOTS.join(" @")} · relative: ${RELATIONS.map((r) => `@${r}:<id>`).join(" ")}

ELEMENT KINDS
${kinds}

${gridSection()}

PICTURES
${catalog}

EXAMPLE
${EXAMPLE}`;
}

/** What one scene call writes: a template diagram, a grid page, or (no plan for it) anything. */
export type SceneKind = { template: TemplateManifest } | { grid: string } | { free: true };

/** The planned kind of a scene, from its outline line. */
export function sceneKindOf(line: string | undefined): SceneKind {
  const tpl = line ? findTemplate(/\btemplate=(\S+)/.exec(line)?.[1] ?? "") : undefined;
  if (tpl) return { template: tpl };
  const grid = line ? /\bgrid=(\S+)/.exec(line)?.[1] : undefined;
  if (grid && findGridLayout(grid)) return { grid };
  return { free: true };
}

/**
 * The system prompt for one scene call: the core of the language, plus only
 * what this scene's kind needs. A template scene gets no grid section and no
 * other templates (its card and example come with the request); a grid page
 * gets the page rules and only the page elements that fit its layout. A
 * scene with no planned kind gets the whole language. Pictures are the ones
 * matching the scene's words.
 */
export function sceneSystemPrompt(kind: SceneKind, assets: AssetManifest[]): string {
  if ("free" in kind) return systemPrompt(assets);
  const verbs = VERBS.map((v) => `  ${v.name.padEnd(9)} ${v.category.padEnd(9)} ${v.summary}`).join("\n");
  const grid = "grid" in kind;
  const flow = !grid && kind.template.name === "flow";
  const gridOnly = new Set(GRID_ELEMENTS.map((e) => e.kind).filter((k) => !["icon", "asset", "chart", "formula"].includes(k)));
  const kinds = COMPONENTS.filter((c) => c.kind !== "placeholder" && c.kind !== "footer" && !gridOnly.has(c.kind) && (flow || !["node", "edge"].includes(c.kind)))
    .map((c) => `  ${(c.named === "required" ? `${c.kind}:<name>` : c.kind).padEnd(13)} ${c.summary}`)
    .join("\n");
  const sceneLine = grid ? `scene <id> "Title" grid=<layout> [mirror=true] [in=<transition>]` : `scene <id> "Title" template=${kind.template.name} [emphasis=first|last|<id>] [density=airy|tight] [mirror=true] [in=<transition>]`;
  const rules = [
    "- One idea per sentence, at most 25 words. 2–6 sentences per scene.",
    "- Every cue gets at least one action. Every element must be shown by an enter verb (fade, pop, draw, write).",
    "- Show an element before emphasizing or moving it.",
    "- Never write coordinates, sizes or colors. Only durations like 0.8 are allowed as numbers.",
    "- Keep the scene line's template= or grid= exactly as planned.",
    ...(grid
      ? []
      : flow
        ? [`- Nodes are joined by edges: e1 = n1 -> n2 "label". Draw an edge after (or together with) its two nodes.`]
        : [
            "- Element ids that equal slot names fill those slots; other elements fill items in order.",
            "- The template draws its own structure, each part appearing with its item (spokes, loop arrows, step numbers and the arrows between steps, card panels, the \"vs\", the timeline axis, leader lines, the arrows into or out of a result). Declare only the items and show them; declare an arrow yourself only to put a label on it.",
            "- Page elements (stat, bullets, quote, …) never go in a template scene; use ELEMENT KINDS.",
          ]),
    "- Use only the pictures listed under PICTURES, exactly as written. For anything else use box \"Label\" or text.",
    "- Parts in parentheses can be targeted as <id>.<part>; list items and chart bars as <id>.1, <id>.2 …",
    "- fit and until= need a span cue {n some words}; on a point cue {n} use a duration or nothing.",
    "- Cue ids restart at 1 on every \"> \" line, and the actions under a line anchor only on that line's cues.",
  ];
  return `You write one scene of Narrascript: a line-based script language for narrated 2D explainer videos.
Reply with Narrascript only — no prose, no markdown fences.

STATEMENTS (one per line; the first word decides the type)
${sceneLine}
<id> = <kind>[:<name>] ["text"] [key=value]   declares an element (hidden until an action shows it)${flow ? `\n<id> = <a> -> <b> ["label"]          edge between two nodes` : ""}
> Narration with {1}point cues and {2 span cues}.
<anchor> <verb> <targets> [args] [then <verb> <targets> [args]]
wait <seconds>

HOW TIMING WORKS
- Each "> " line is one spoken sentence. Its action lines come right under it, before the next "> " line.
- {n} = the moment the next word is spoken. {n some words} = while those words are spoken.
- Cue ids restart at 1 on every "> " line; each action uses a cue of the sentence just above it.
- Anchors: a cue id, "start" (sentence start) or "end" (after the sentence).
- Several action lines on one anchor run together; "then" runs the next verb after the previous.

SHAPE OF A SCENE (each sentence, then its own actions)
scene heat "How water rises" template=steps
sun = icon:sun "Sunlight"
sea = icon:waves "Warm sea"
cloud = icon:cloud "Clouds"
> The {1}sun warms the {2 surface of the sea}.
1 pop sun
2 pop sea
> The warm water rises and {1}cools into clouds.
1 pop cloud

RULES
${rules.join("\n")}

QUALITY
- Show, don't label: give each thing the picture that means it (icon:sun "Sunlight", icon:gavel "Law"), and a different picture for each thing in a scene. Never reuse one icon for unrelated ideas. Use box only for abstract ideas no listed picture fits.
- Be factually correct. Use real, well-known figures; if unsure of a number, describe the trend in words instead of inventing data.
- Never invent quotes or attributions. Quote only real, famous people with words they actually said; otherwise use callout or body.

VERBS
${verbs}
ARGS: 0.8 duration · fit (= length of the span cue) · +0.2 delay · /0.15 stagger · until=<cue> · ease=in|out|inout|spring · color=accent|warn|good|cool|muted · write sync=true reveals words as spoken

${grid ? gridPageSection(kind.grid) : `ELEMENT KINDS\n${kinds}`}

PICTURES
${pictureList(assets)}`;
}

/** What writing a grid page needs: the page rules, and the elements that fit some slot of its layout, with an example page. */
function gridPageSection(code: string): string {
  const layout = findGridLayout(code)!;
  const rects = slotRects(layout, frameMode("title", false));
  const fits = GRID_ELEMENTS.filter((e) => rects.some((r) => e.minW <= r.w && e.minH <= r.h));
  return `PAGE RULES
- 1 to 4 content elements fill the layout's slots in declaration order (left→right, top→bottom); that order is also the animation order.
- Optional frame: title = title "…" (header), subtitle = text "…", foot = footer "source or note". No @placements.
- Each element fills its whole slot; "draw" plays its built-in motion (counts up, bars grow, items enter in turn).
- One element per slot; at least one primary or flex element; icon, logo, avatar and progress never in the largest slot or alone; max 1 callout, 1 icon, 2 charts; no element kind twice (except stat and charts).
- Lists use ";" between items and "|" between the fields of an item.

PAGE ELEMENTS that fit this layout (syntax · role · minimum slot · limits)
${fits.map((e) => `  ${e.syntax.padEnd(46)} ${e.role.padEnd(7)} min ${e.minW}×${e.minH} · ${e.limits}`).join("\n")}

EXAMPLE PAGE
scene numbers "By the numbers" grid=L3-02
title = title "Microscopes changed biology"
chart = chart:bar data=2,40,300 labels=1700,1900,2000
cells = stat "37T" "cells in a human body"
tip = callout "Every living thing is made of cells."
> Each century we found {1}far more kinds of cell.
start write title
1 draw chart
> Your body alone has {1 thirty-seven trillion}.
1 draw cells
end draw tip`;
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
  // Each layout with its slot sizes, and each page element with the smallest slot it needs:
  // enough to plan a page whose content fits.
  const mode = frameMode("title", false);
  const layouts = GRID_LAYOUTS.map((l) => `  ${l.code} ${l.name}: ${slotRects(l, mode).map((r) => `${r.w}×${r.h}`).join(" · ")}`).join("\n");
  const seen = new Set<string>();
  const elements = GRID_ELEMENTS.filter((e) => !seen.has(e.kind) && seen.add(e.kind))
    .map((e) => `${e.kind} ${e.minW}×${e.minH}`)
    .join(" · ");
  return `You plan narrated 2D explainer videos written in Narrascript, a line-based script language.
Reply with Narrascript lines only — no prose, no markdown fences.

LINES
video 1 "Title"
theme <look>
motion <personality>
scene <id> "Title" template=<template>      a diagram
scene <id> "Title" grid=<layout code>        an editorial page (add mirror=true to some)
# shape: <shape> · goal: <one line>          one comment line under each scene line; grid pages use shape: page
<id> is one short lowercase word (intro, stages, recap), never a number. A scene has template= or grid=, never both.

${styleSection()}

SCENE SHAPES → TEMPLATES (diagrams). First decide the shape of what the scene explains, then take a template of that shape.
${shapeTable()}

GRID LAYOUTS (editorial pages: each slot's size; one element per slot)
${layouts}
PAGE ELEMENTS (the smallest slot each needs): ${elements}
Plan a page only when its content fits the slots: one element per slot, each slot at least its element's size, at least one chart, stat, body, bullets, quote, table or similar, and at most one icon.

PICTURES: ${assets.filter((a) => a.kind === "asset").length ? `illustrations of ${assets.filter((a) => a.kind === "asset").map((a) => a.name).join(", ")}; ` : ""}${assets.filter((a) => a.kind === "icon").length} icons of everyday things (people, places, money, law, science, nature, weather, technology, transport, food, tools). The scene writer picks them; plan scenes around things that can be pictured.

PLANNING RULES
- Tell one story: each scene covers a different point, in a logical order, ending with a takeaway.
- Every scene brings new items: never show the same things in two scenes (say it once, with the best-fitting template).
- Diagrams: label the scene's shape, then write the template shown after → for that shape (template=<template name>, never the shape name). Check its "not if".
- Open and end the video the way the request asks. template=title is only ever the first scene.
- Grid pages (shape: page) are for numbers, quotes, bullet text, charts and tables, with at most one icon. Several pictures of equal weight → template=cards.
- Vary scene types across the video; mirror=true on some grid pages. Leave variant= out: the engine picks the arrangement that fits.
- Plan only facts you are sure of.`;
}

/** One way to open or end a video, as the plan request words it. */
export interface ArcPart {
  name: string;
  ask: string;
}

/**
 * Ways to open and to end a video. Each plan is asked for one of each (the
 * topic picks, see storyArc), so videos don't all share one skeleton of
 * title scene, diagrams, bullet page.
 */
export const OPENINGS: readonly ArcPart[] = [
  { name: "title", ask: "a title scene (template=title): the headline as a statement, with 1–3 pictures of the topic" },
  { name: "question", ask: "a title scene (template=title) whose headline is the question this video answers, with one picture" },
  { name: "cold", ask: "no title scene: open on the first idea itself, as a diagram whose template has a title (compare, steps, cards, converge, diverge or process), so the viewer is inside the topic at once" },
  { name: "number", ask: "one striking, well-known number about the topic on a grid page (grid=L2-04: a stat, with a callout beside it); if you are not sure of a real number, open with a title scene instead" },
];
export const CLOSINGS: readonly ArcPart[] = [
  { name: "bullets", ask: "a grid page with the three points to remember (bullets)" },
  { name: "recap", ask: "a diagram that pulls the main ideas into one picture (hub, cycle, steps or converge), not a page of text" },
  { name: "checklist", ask: "a grid page with a checklist of what the viewer can now do or look for" },
  { name: "takeaway", ask: "a grid page with the one idea to remember (grid=L2-08: a definition, with a callout under it)" },
];

export interface StoryArc {
  open: ArcPart;
  close: ArcPart;
}

/** The opening and ending for a topic: stable for the topic, varied across topics. `pick` names them instead. */
export function storyArc(topic: string, pick: { open?: string; close?: string } = {}): StoryArc {
  let h = 2166136261;
  for (const ch of topic.trim().toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h >>>= 0;
  return {
    open: OPENINGS.find((o) => o.name === pick.open) ?? OPENINGS[h % OPENINGS.length]!,
    close: CLOSINGS.find((c) => c.name === pick.close) ?? CLOSINGS[(h >>> 8) % CLOSINGS.length]!,
  };
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
Scene transitions: in=auto (default) lets the motion choose; or in=${TRANSITIONS.filter((t) => t !== "auto").join("|")}`;
}

/** First pass: plan the scenes without writing narration. */
export function outlinePrompt(topic: string, scenes: { min: number; max: number }, arc: StoryArc = storyArc(topic)): string {
  return `Plan a narrated explainer video about:
${topic}

Open with ${arc.open.ask}.
End with ${arc.close.ask}.

Output only:
- the "video 1" line, a "theme" line and a "motion" line that suit the topic and audience
- one "scene" line per scene (${scenes.min}–${scenes.max} scenes), each with a fitting template= (diagrams) or grid= (editorial pages of numbers, charts, lists, quotes), followed by one comment line "# shape: <shape> · goal: <what this scene explains and what it shows>"
No elements, narration or actions yet.`;
}

/**
 * Second pass: one complete scene, written against the whole outline and,
 * when earlier scenes are already written, what they say.
 */
export function scenePrompt(outline: string, sceneId: string, earlier = ""): string {
  const said = earlier ? `\n\nAlready narrated in earlier scenes (don't repeat it; build on it):\n${earlier}` : "";
  const line = outline.split("\n").find((l) => sceneLineId(l) === sceneId);
  const tpl = line ? findTemplate(/\btemplate=(\S+)/.exec(line)?.[1] ?? "") : undefined;
  const grid = line ? gridCard(/\bgrid=(\S+)/.exec(line)?.[1] ?? "") : undefined;
  const card = tpl ? `\n\n${templateCard(tpl)}` : grid ? `\n\n${grid}` : "";
  return `Video outline:
${outline}${said}${card}

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

function sceneLineId(line: string): string | undefined {
  return /^\s*scene\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line)?.[1];
}

/** How much a template holds, for planning: " [2–5 items + result]". */
function capacity(t: TemplateManifest): string {
  const slots = t.slots.filter((s) => s.required && s.name !== "title").map((s) => s.name);
  const items = t.items ? `${t.items.min}–${t.items.max} items` : t.graph ? `up to ${t.graph.maxNodes} nodes` : "";
  const parts = [items, ...slots.map((s) => `${s}`)].filter(Boolean);
  return parts.length ? ` [${parts.join(" + ")}]` : "";
}

function itemsOf(t: TemplateManifest): string {
  return t.items ? ` items ${t.items.min}-${t.items.max}` : t.graph ? ` nodes ≤${t.graph.maxNodes} + edges` : "";
}

/**
 * Shape → templates: what the outline pass chooses from. A shape with one
 * template is one line (the shape says when); with several, each template
 * says when it is the one. "not if" points to the neighbouring shape.
 */
export function shapeTable(): string {
  return (Object.keys(SHAPES) as Shape[])
    .map((shape) => {
      const tpls = templatesFor(shape);
      if (!tpls.length) return "";
      if (tpls.length === 1) return `  ${shape.padEnd(12)} ${SHAPES[shape]} → template=${tpls[0]!.name}${capacity(tpls[0]!)} (not if ${tpls[0]!.guide.avoidWhen})`;
      return [`  ${shape.padEnd(12)} ${SHAPES[shape]}:`, ...tpls.map((t) => `    → template=${t.name}${capacity(t)}: ${t.guide.useWhen} (not if ${t.guide.avoidWhen})`)].join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Everything about one template that writing a scene needs: when to use it,
 * its slots and items, what each variant is for, and a worked example. Sent
 * with the scene request, not in the shared system prompt (which stays cached).
 */
export function templateCard(t: TemplateManifest): string {
  const slots = t.slots.map((s) => `${s.name}${s.required ? "" : " (optional)"}`).join(", ");
  const items = t.items ? ` Every other element is an item (${t.items.min}–${t.items.max}), in declaration order.` : "";
  const variants = t.variants.map((v) => `  ${v.padEnd(11)} ${t.guide.variants[v]?.when ?? t.summary}`);
  return `TEMPLATE ${t.name} (shape: ${t.guide.shape})
Use when: ${t.guide.useWhen}. Not when: ${t.guide.avoidWhen}.
${t.summary}.${slots ? ` Slots: ${slots}; an element whose id is the slot name fills it.` : ""}${items}
Variants (leave variant= out unless one clearly suits the content; the engine replaces one that does not fit):
${variants.join("\n")}
Example:
${t.guide.example}`;
}

/**
 * What writing one grid page needs: its slots in fill order with their
 * sizes, which elements fit each slot, and the page rules that drafts break
 * most (slot count, a primary element in the largest slot, one icon).
 */
export function gridCard(code: string): string | undefined {
  const layout = findGridLayout(code);
  if (!layout) return undefined;
  const rects = slotRects(layout, frameMode("title", false));
  const largest = rects.reduce((best, r, i) => (r.w * r.h > rects[best]!.w * rects[best]!.h ? i : best), 0);
  const slots = rects.map((r, i) => {
    const fits = [...new Set(GRID_ELEMENTS.filter((e) => e.minW <= r.w && e.minH <= r.h && (i !== largest || e.role !== "support")).map((e) => e.kind))];
    return `  slot ${i + 1}: ${r.w}×${r.h}${i === largest && rects.length > 1 ? " (largest: a primary or flex element)" : ""} · fits: ${fits.join(" ")}`;
  });
  return `GRID PAGE ${layout.code} ${layout.name}
Exactly ${rects.length} content element${rects.length > 1 ? "s" : ""}, declared in slot order (also the animation order); add title = title "…" for the header. No @placements.
${slots.join("\n")}
Rules: at least one primary or flex element (chart, stat, body, bullets, quote, table, …); at most 1 icon, 1 callout, 2 charts; no element kind twice except stat and charts. Pictures of several things belong in template=cards, not on a grid page.`;
}
