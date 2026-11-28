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
  COLLECTIONS,
  TEMPLATES,
  SHAPES,
  findTemplate,
  isSetIcon,
  motionSet,
  limitsText,
  templatesFor,
  variantChoices,
  COMPOSE_PATTERNS,
  THEME_SUMMARIES,
  THEMES,
  VERBS,
  type AssetManifest,
  type Shape,
  type TemplateManifest,
} from "@anim/registry";
import { LENGTH_SPECS, LENGTHS, lengthSpec, type Length, type LengthSpec } from "./length.js";
import { guessUseCase, playbook, useCaseCatalogue, type UseCase } from "./usecases.js";
import { audienceLine, DEFAULT_LEVEL, deviceList, intentMenu, methodCatalogue, parseSlot, slotLabel, type Decision, type Level } from "./teaching.js";
import { PROMPT_IDS, Slots, type PromptId } from "./prompt-slots.js";
import { DEFAULT_MAX_WORDS, planningAdvice, styleGuide, type PromptSettings } from "./settings.js";

const STANDARD = lengthSpec("standard");
const span = (r: { min: number; max: number }) => `${r.min}–${r.max}`;

/**
 * The pictures offered for a scene: its best matches first (`best` counts them), then the hand-made art and a
 * set of everyday icons (and, in the tech domain, the core of the technology icons), so a scene always has
 * something to show.
 */
export type Shortlist = AssetManifest[] & { best?: number };

/**
 * Picks the pictures most relevant to a text by meaning: the library's search over names, synonyms, tags and
 * descriptions (registry/search.ts). Keeps the prompt small however large the library grows; the model may
 * only use names it is shown. At most 4 of one family (http-get, http-post, … or house, house-plug …) so one
 * idea does not fill the list.
 */
export function retrieveAssets(text: string, assets: AssetLibrary, limit = 36, domain?: Domain): Shortlist {
  const family = new Map<string, number>();
  const found = assets.search(text, { kind: "icon" }).filter((h) => isSetIcon(h.asset));
  // Far behind the best match is noise (a tag shared by chance): leave it out.
  const floor = (found[0]?.score ?? 0) * 0.15;
  const ranked = found
    .filter((h) => h.score >= floor)
    .filter((h) => {
      const f = h.asset.name.startsWith("brand-") ? h.asset.name : h.asset.name.split("-")[0]!;
      family.set(f, (family.get(f) ?? 0) + 1);
      return family.get(f)! <= 4;
    })
    .slice(0, limit)
    .map((h) => h.asset);
  const taken = new Set(ranked.map((a) => a.name));
  const always = assets.all().filter((a) => !taken.has(a.name) && (!isSetIcon(a) || EVERYDAY.has(a.name) || (domain === "tech" && TECH_CORE.has(a.name))));
  const list: Shortlist = [...ranked, ...always];
  list.best = ranked.length;
  return list;
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

/** Icons of the set offered to every scene: people, places, money, time, ideas, direction. */
const EVERYDAY = new Set(
  "users house building-2 factory globe map-pin coins banknote trending-up trending-down chart-line chart-bar calendar book-open graduation-cap rocket target scale handshake shield lock key search flag star trophy truck shopping-cart phone mail brain sprout mountain waves snowflake moon thermometer microscope atom dna pill stethoscope car plane ship cpu wifi smartphone laptop camera megaphone newspaper wrench hammer recycle battery-charging plug timer hourglass circle-alert thumbs-up thumbs-down".split(" "),
);

/** Technology icons offered to every scene of the tech domain: the parts almost any software topic draws. */
const TECH_CORE = new Set(
  "server database cloud-computing network api lock key shield-lock bug code terminal git-branch container cpu memory device-laptop device-mobile router world-www brand-docker brand-github logs dashboard queue-pop-in load-balancer pipeline file-code robot ai".split(" "),
);

/** How to choose a picture: what the model is told next to the list it picks from. */
const PICTURE_GUIDE = `Choose each picture by what it means, not by how it looks:
- Take the most specific one: icon:brand-docker for Docker, icon:database for a database; not a generic box or a loosely related symbol.
- A product, language or service has its logo (icon:brand-…); an idea, a part or a place has a concept icon.
- Give each thing in a scene a different picture; never reuse one for unrelated ideas.
- Copy names exactly as written below. When nothing below fits a thing, write box "Label" (or text), never an invented name.`;

/** What a picture is, in a few words: its description when it has one of its own, what people call it, then a few of its tags. */
function pictureHint(a: AssetManifest): string {
  const own = new Set(a.name.split(/[.-]/));
  const plain = a.name.replace(/-/g, " ");
  const said = a.synonyms.filter((s) => !own.has(s) && s !== plain).slice(0, 2);
  const tags = [...new Set(a.tags)].filter((t) => !own.has(t) && !said.includes(t));
  return [a.description && a.description !== plain ? a.description : "", ...said, ...tags].filter(Boolean).slice(0, 4).join(", ");
}

/**
 * The pictures a script may use, as the prompts list them: illustrations
 * with their parts, then every icon by name. Icon names say what they show,
 * so the model picks by meaning; the list is the same for every topic, which
 * keeps the system prompt cacheable across videos.
 */
export function pictureList(assets: AssetManifest[]): string {
  const best = (assets as Shortlist).best ?? 0;
  const ranked = assets.slice(0, best);
  const rest = assets.slice(best);
  const art = rest.filter((a) => a.kind === "asset").map((a) => `${a.name}${a.parts.length ? `(${a.parts.join(",")})` : ""}`);
  const icons = rest.filter((a) => a.kind === "icon").map((a) => a.name);
  return [
    PICTURE_GUIDE,
    ranked.length ? `Best matches for this scene, most relevant first (icon:<name> — what it shows):\n${ranked.map((a) => `  ${a.name} — ${pictureHint(a) || a.name.replace(/-/g, " ")}`).join("\n")}` : "",
    art.length ? `Illustrations, written asset:<name> (parts in brackets): ${art.join(" ")}` : "",
    icons.length ? `${ranked.length ? "More icons" : "Icons"}, written icon:<name>: ${icons.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const EXAMPLE = `video 1 "Plant vs Animal Cells"
theme chalk

scene compare "Two kinds of cell" template=compare variant=sides
title = title "Plant vs Animal Cells"
left = label "Plant cell"
right = label "Animal cell"
r1 = icon:shield "A rigid cell wall" "No wall, so it can change shape"
r2 = icon:sun "Chloroplasts make food" "Eats food made elsewhere"
> Cells come in two familiar kinds. {r1}A plant cell has a rigid wall and an animal cell does not.
> {r2}Only plants carry chloroplasts, so only they make their own food.

scene energy "Where the energy comes from"
layout row
sun = icon:sun "Sunlight"
leaf = asset:leaf "Leaf"
beam = arrow sun->leaf
> Plants run on {1}sunlight, carried {2 straight into the leaf}.
1 pop sun
2 draw beam fit then draw leaf

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
end draw tip

scene decide "What next?" template=flow
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
export function systemPrompt(assets: AssetManifest[], spec: LengthSpec = STANDARD, settings: PromptSettings = {}): string {
  return baseSystemPrompt(assets, spec, settings);
}

/** What may be written for variant=: the arrangements of a layout template; for a designed one only what changes the meaning (else nothing: the engine picks the motion). */
function variantsOf(t: TemplateManifest): string {
  if (!t.html) return ` · variants: ${t.variants.join("|")}`;
  const choices = variantChoices(motionSet(t.name)!).map((c) => c.id);
  return choices.length ? ` · variant=${choices.join("|")} (by meaning)` : "";
}

function baseSystemPrompt(assets: AssetManifest[], spec: LengthSpec, settings: PromptSettings): string {
  const verbs = VERBS.filter((v) => !v.internal).map((v) => `  ${v.name.padEnd(9)} ${v.category.padEnd(9)} ${v.summary}`).join("\n");
  const templates = TEMPLATES.map((t) => {
    const slots = t.slots.map((s) => `${s.name}${s.required ? "" : "?"}`).join(",");
    return `  ${t.name.padEnd(10)} ${t.guide.useWhen}${slots ? ` [slots: ${slots}]` : ""}${itemsOf(t)}${variantsOf(t)}`;
  }).join("\n");
  // Grid-only elements are listed in the grid section instead.
  const gridOnly = new Set(GRID_ELEMENTS.map((e) => e.kind).filter((k) => !["icon", "asset", "chart", "formula"].includes(k)));
  const kinds = COMPONENTS.filter((c) => c.kind !== "placeholder" && c.kind !== "footer" && !gridOnly.has(c.kind))
    .map((c) => `  ${(c.named === "required" ? `${c.kind}:<name>` : c.kind).padEnd(13)} ${c.summary}`)
    .join("\n");
  const catalog = pictureList(assets);
  const S = new Slots("single.system", settings);

  return S.done(`You write Narrascript: a line-based script language for narrated 2D explainer videos.
Reply with Narrascript only — no prose, no markdown fences.

STATEMENTS (one per line; the first word decides the type)
video 1 "Title"                      first line of a full script
theme <look>                         see STYLE
scene <id> "Title" [template=<t> [variant=<v>|auto] | compose=<pattern>] [emphasis=first|last|<id>] [density=airy|tight] [mirror=true]
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
- Narration is spoken by a voice. Write numbers the usual way (1957, $18M, 60%, 2.5B): they are read aloud correctly. Never put a web address, a file path, a commit hash, an id or code in the narration: say what it is (the repository, the commit, the config file) and show the exact text in the picture. Avoid symbols like -> ~ and slashes between words; write them as words.

RULES
- One idea per sentence, at most ${S.v("max_words", settings.maxWords ?? DEFAULT_MAX_WORDS)} words. ${S.v("sentences", span(spec.sentences))} sentences per scene.
- Every cue gets at least one action. Every element must be shown by an enter verb (fade, pop, draw, write).
- Show an element before emphasizing or moving it. Draw connectors after (or together with) their endpoints.
- Templates draw their own structure, each part appearing with its item: hub spokes, cycle arrows, card panels, the "vs" of a compare, the timeline axis, spotlight leader lines, and the arrows of converge, diverge and process. Declare only the items and show them; declare a connector yourself only in template=flow, in a scene without a template, or to put a label on it.
- Never write coordinates, sizes or colors. Only durations like 0.8 are allowed as numbers.
- Prefer a template. Element ids that equal slot names fill those slots; other elements fill items in order.
- No template fits? compose=<pattern> arranges 2–6 elements by intent (${S.v("compose_patterns", COMPOSE_PATTERNS.join("|"))}); emphasis=<id> names the hero. An element called title keeps the top band.
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
${S.v("verbs", verbs)}
ARGS: 0.8 duration · fit (= length of the span cue) · +0.2 delay · /0.15 stagger · until=<cue> · ease=in|out|inout|spring · color=accent|warn|good|cool|muted · move needs @slot or @right-of:<id> · write sync=true reveals words as spoken

${S.v("style_menu", styleSection())}

TEMPLATES (variant=: leave it out, except where a template lists variant=a|b|c: those mean different things, so choose by what the content is; the engine picks the arrangement or motion within it)
${S.v("templates", templates)}
LAYOUTS (only when no template): ${S.v("layouts", LAYOUTS.join(" "))}
SLOT HINTS: ${S.v("slot_hints", `@${SLOTS.join(" @")} · relative: ${RELATIONS.map((r) => `@${r}:<id>`).join(" ")}`)}

ELEMENT KINDS
${S.v("element_kinds", kinds)}

${S.v("grid_elements", gridSection())}

PICTURES
${S.v("pictures", catalog)}

EXAMPLE
${S.v("example", EXAMPLE)}${S.v("house_style", styleGuide(settings))}`);
}

/** Templates whose links are declared by the script (messages, connections) rather than drawn by the template. */
const LINKED = new Set(["exchange", "architecture", "tree", "states", "gitgraph"]);

/**
 * Story motions a template's scene should use to show what happens, not only what exists. One line per
 * template, sent only with that template's scene call.
 */
const STORY: Record<string, string> = {
  exchange: "- Let the messages tell the story, not only appear: send m1 fail=true (the packet is lost halfway), send m1 wait=1 (the server is busy, then it goes on), stream m1 (steady traffic), shake <party> (a rejection or error), mark <party> as=fail|ok, set <party> to=\"…\" to change a label in place (a status 200 → 503).",
  architecture: "- Show traffic, not only boxes: send l1 along a link, stream l1 for steady load, mark <component> as=fail when it goes down, clone web,web2,web3 (replicas appear as copies), count <label> from=0 to=900 suffix=\"ms\" for a metric, frame a,b,c to bring a group closer (focus reset pulls out).",
  states: "- Move through the machine: visit s1, then visit s2 when the event happens (one ring of \"current state\" travels), send t1 along the transition, mark s3 as=fail|ok on an end state, set s1 to=\"…\" when a state renames itself.",
  tree: "- Walk the tree: visit root, then visit its child, and mark each finished node as=visited (a search or traversal); mark the found node as=ok.",
  trace: "- Write the data, never the motion: after each sentence, give the whole contents of each collection as it is now (`1 arr: 7 2* 9 | i=1`). Marks: * the one being looked at, + done, ~ seen, ! rejected. Pointers are slot numbers (`i=2`). The engine animates the difference between states, so never use swap, move, drop, lift, set or pop on cells. One change per cue (a compare and a swap are two cues). The data must be correct: it is checked against the algorithm and against what you say.",
  structure: "- Operate on the cells: drop c4 to push onto a stack, lift c4 to pop, swap c1,c2 to sort, visit c3 to move a search to a cell, mark c3 as=ok when found, strike c2 to cross out a rejected value, merge c1,c2,c3 to combine cells into the last one.",
  stack: "- Move data through the layers: send a packet along an arrow between layers, mark a layer as=fail where it breaks, drop a new layer onto the stack.",
  flow: "- Follow the path: visit n1, visit n2, … along the route the data takes; mark the end node as=ok|fail.",
  steps: "- Write each step as `s1 = icon:name \"Title\" \"One line of detail\"` and show it where the narration says it, by naming it in braces right before the words: `> First {s1}the runner builds it, then {s2}it runs the tests.` Write no action lines at all in this scene, not even `write title` (no pop, fade, visit, mark, move or pulse): the motion draws and moves everything. Optional: `kicker = text \"How it works\"` above the heading; pace=relaxed|normal|snappy on the scene line. Declare only the slots and the items: no carry=, keep= or emphasis=.",
  ui: "- Write each action as `q1 = icon:send \"Send\" \"What is DNS?\"` (the control and what it types or does) and name each where the narration says it: `> {q1}You type a plain question {q2}and ask a follow-up.` Write no action lines at all in this scene, not even `write title` (no pop). variant= says what is done: prompt (type and send: the second string is the message typed), click (buttons), toggle (settings), drag (a card into a drop zone), swipe (a phone). Each item is one thing the person does, in order; it shows the controls and what is typed, never a result (an order created, a record saved, a payment made) and a clicked button looks done, so it must not stand for something the narration says has not happened yet. Do not use it to label parts of a program or to show output. Optional: `kicker = text \"Try it\"`, pace=relaxed|normal|snappy. Declare only the slots and the items: no carry=, keep= or emphasis=.",
  chart: "- Write each value as `b1 = label \"Jan\" \"$42k\"` (label, value with its unit) and name each where the narration says it: `> {b1}January made forty-two thousand, {b2}February fifty-five.` Write no action lines at all in this scene, not even `write title` (no pop, pulse or mark). variant=bars for categories, variant=line for a trend over time (3 or more points, in order), variant=ring for shares of a whole. Every bar measures the same thing in the same unit: never put a total next to its parts, or a per-second value next to a count. Use a chart for numbers worth comparing, not to replay the steps of a run (that is a trace). The chart plays through once, starting at its first cue. Optional: `kicker = text \"Revenue\"`, pace=relaxed|normal|snappy. Declare only the slots and the items: no carry=, keep= or emphasis=.",
  stats: "- Write each figure as `s1 = icon:name \"Label\" \"21k\" \"+75% vs Q1\"` (label, value with its unit, and optionally how much it changed) and show it where the narration says it, by naming it in braces: `> It began at {s1}twelve thousand, then {s2}reached twenty-one.` Write no action lines at all in this scene, not even `write title` (no pop, count or pulse): the motion rolls the numbers. variant=figures for separate figures or a series; variant=shares when the figures are parts of a whole or sizes to compare by area. The last stat glows; highlight=s2 on the scene line picks another. All the figures of one scene share one unit and scale, because the motions size, fill and rank them against each other (never 5 MB next to 2 TB, or a count next to a percentage); write a value as a plain number with its unit (`2.5B`, `$18M`, `45%`), never as a time like 2:08. Say what the numbers measure, because the motions print it as the axis, scale or legend: `yaxis = text \"Active users (thousands)\"` (the unit or quantity), and for a series over time `xaxis = text \"Quarter\"` (what runs along it); `metric = text \"Active users per quarter, in thousands\"` is a line under the heading. Optional: `kicker = text \"Growth\"`, pace=relaxed|normal|snappy. Declare only the slots and the items: no carry=, keep= or emphasis=.",
  gitgraph: "- Walk the history in order: pop each commit and draw the line to it, then visit that commit (the ring follows the latest commit); mark the merge commit as=ok, and shake a commit where there is a conflict.",
  title: "- Write the headline as `title = title \"…\"`, the subtitle as `subtitle = text \"…\"`, and a kicker, byline or brand only when they help; at most one icon. A designed motion plays the opening, so there are no action lines and no cues. Options on the scene line: bg=base|tint|deep sets its backdrop, pace=relaxed|normal|snappy sets how fast it moves. The title never leaves by itself: the scene transition takes it away. Declare only the slots: no carry=, keep= or emphasis=.",
  compare: "- Name the sides with `left = label \"…\"` and `right = label \"…\"`, then one row per point: `r1 = icon:name \"what is true of the left\" \"what is true of the right\"`, and show each row where the narration says it, by naming it in braces: `> A session {r1}keeps state on the server; a token {r2}carries it with the user.` Write no action lines at all in this scene, not even `write title` (no pop, strike, mark or visit). variant=sides (the usual choice) sets the two options point against point with no winner, right for a trade-off. variant=verdict only when the narration says the right side wins (it is the better, newer or correct one): it ticks the right and crosses the left on every row, so never use it for a trade-off. Optional: `kicker = text \"Before vs after\"`, pace=relaxed|normal|snappy. Declare only the slots and the items: no carry=, keep= or emphasis=.",
  cycle: "- Go round the loop: after each step appears, visit it (the ring moves c1 → c2 → c3), and visit the first one again when the cycle closes; pulse the step being named.",
  timeline: "- Write each event as `t1 = label \"1796\" \"First vaccine\" \"One line of detail\"` (date, title, detail) in date order and show it where the narration reaches its date, by naming it in braces: `> The first vaccine came in {t1}1796, and polio in {t2}1955.` Write no action lines at all in this scene, not even `write title` (no pop, visit or mark). A ribbon event may add a fourth string for its picture slot: a figure (\"10,000+ doses\", it counts up) or a short line of text, and a fifth as its caption; the other variants ignore them. Optional: `kicker = text \"History\"`, pace=relaxed|normal|snappy. Declare only the slots and the items: no carry=, keep= or emphasis=.",
  hub: "- Show what the centre does: pop the centre, then each spoke; pulse the centre once all the spokes are in; mark a spoke as=ok or as=fail when the narration judges it.",
  cards: "- Pop each card in turn and pulse or visit the one being named. Mark a card as=ok or strike it only when the narration picks it or rules it out.",
  spotlight: "- Point at the parts: write each label while you pulse the main picture, and highlight the label being spoken, so the eye follows the narration.",
  converge: "- Bring the inputs together: pop each input in turn; when the last one is in, pulse the result (or mark it as=ok) to show they combine; count the result if it holds a number.",
  diverge: "- Spread out the outputs: fade the source, pop each output and pulse the source as it appears, so each output reads as coming from it; mark the main output as=ok.",
  process: "- Follow the transformation: pop the inputs, then pop the process and visit it while it works, then pop the output and mark it as=ok (visit only after the process is shown).",
  anatomy: "- Walk along the parts: as each part and its name appear, visit that part (the ring moves from one part to the next); highlight the part being named.",
  code: "- Pick the code animation that fits what the scene does. Explaining code that is already written: put anim=walk on the code element, then visit code.1, visit code.3 … (one line is lit with a ▶, the rest stay dim). Building code up: write code.1, write code.2 … (typed, with a caret). Fixing code: keep the old and the new line, strike code.2 (old, crossed out in red) and mark code.3 as=ok (new, green +). A config or data file: look=tabs file=\"ci.yml\" anim=lines, and write code.N brings each line in whole. Commands: use terminal, write the command line and fade its output line. look=light suits a bright page; three lines or fewer show as a small card. Vary this from one video to the next: do not walk every snippet.",
  grid: "- Let the numbers move: count a stat from=0 to=<value> (suffix=\"%\", prefix=\"$\"); pulse a chart bar (<id>.3) when it is named; highlight list items one at a time (<id>.2); mark a checklist item as=ok or strike a rejected one. Show each element first.",
};

/** The built-in story-motion hint of each template (what a person's own hint replaces). */
export const STORY_HINTS: Readonly<Record<string, string>> = STORY;

/** Extra rules when the scene is the whole video: one diagram that grows, chapter by chapter. */
const canvasRules = (spec: LengthSpec) => [
  "- This one scene is the whole video: a single diagram that grows chapter by chapter on one stage, and a camera follows the action. Declare EVERY element of the whole diagram first, before the first step line (the layout is solved once, for all of it, so nothing jumps).",
  '- Then one chapter per planned "# chapter:" line: a line  step <chapter-id> "Short title"  followed by that chapter\'s narration lines and actions. A chapter shows only its own part of the diagram (pop or draw the elements it adds); never hide or clear what earlier chapters showed, and never re-declare elements after a step line.',
  `- Each chapter is ${span(spec.chapterSentences)} sentences (one idea each, as in any scene) and ends with something new on screen that the next chapter builds on. The video should run about as long as a video of several scenes.`,
];

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
export function sceneSystemPrompt(kind: SceneKind, assets: AssetManifest[], canvas = false, spec: LengthSpec = STANDARD, settings: PromptSettings = {}, usecase?: UseCase): string {
  return baseSceneSystemPrompt(kind, assets, canvas, spec, settings, usecase);
}

function baseSceneSystemPrompt(kind: SceneKind, assets: AssetManifest[], canvas: boolean, spec: LengthSpec, settings: PromptSettings, usecase?: UseCase): string {
  if ("free" in kind) return baseSystemPrompt(assets, spec, settings);
  const verbs = VERBS.filter((v) => !v.internal).map((v) => `  ${v.name.padEnd(9)} ${v.category.padEnd(9)} ${v.summary}`).join("\n");
  const grid = "grid" in kind;
  const flow = !grid && kind.template.name === "flow";
  const trace = !grid && kind.template.name === "trace";
  const gridOnly = new Set(GRID_ELEMENTS.map((e) => e.kind).filter((k) => !["icon", "asset", "chart", "formula"].includes(k)));
  const kinds = COMPONENTS.filter((c) => c.kind !== "placeholder" && c.kind !== "footer" && !gridOnly.has(c.kind) && (flow || !["node", "edge"].includes(c.kind)) && (trace || !COLLECTIONS.includes(c.kind as (typeof COLLECTIONS)[number])))
    .map((c) => `  ${(c.named === "required" ? `${c.kind}:<name>` : c.kind).padEnd(13)} ${c.summary}`)
    .join("\n");
  const sceneLine = grid ? `scene <id> "Title" grid=<layout> [mirror=true]` : `scene <id> "Title" template=${kind.template.name} [emphasis=first|last|<id>] [density=airy|tight] [mirror=true]`;
  const words = settings.maxWords ?? DEFAULT_MAX_WORDS;
  const key = grid ? "grid" : kind.template.name;
  const hint = settings.motionHints?.[key] ?? STORY[key];
  const note = settings.templateNotes?.[key];
  // What is specific to this template; the rules every scene shares are written out in the prompt itself.
  const rules = [
    ...(grid
      ? []
      : flow
        ? [`- Nodes are joined by edges: e1 = n1 -> n2 "label". Draw an edge after (or together with) its two nodes.`]
        : LINKED.has(kind.template.name)
          ? [
              "- Element ids that equal slot names fill those slots; other elements fill items in order.",
              kind.template.name === "exchange"
                ? '- The parties are the items. Every message is an arrow you declare between two parties, in time order: m1 = arrow browser->server "GET /". Show a message with send (a packet travels along it): 1 send m1. The template draws the lifelines.'
                : kind.template.name === "tree" ? '- Every node is an item; join each parent to its child with a line you declare: l1 = line root->src. The template places the levels.' : kind.template.name === "states" ? '- Every state is a node: s1 = node "Idle". Every transition is an arrow you declare with the event as its label: t1 = arrow s1->s2 "connect". An arrow back to an earlier state curves by itself.' : kind.template.name === "gitgraph" ? '- A zone starts a branch lane: main = zone "main"; the commits declared after it (c1 = circle "init") are on it. Join each commit to the next with a line you declare (l1 = line c1->c2), including the line where a branch splits off or merges back.' : '- A zone ("zone \\"Client\\"") starts a group: the elements declared after it belong to it until the next zone; it appears with its first member. Declare the links: l1 = arrow web->api "HTTPS"; draw them, or send a packet along one: 1 send l1.',
              "- Page elements (stat, bullets, quote, …) never go in a template scene; use ELEMENT KINDS.",
            ]
          : [
            "- Element ids that equal slot names fill those slots; other elements fill items in order.",
            "- The template draws its own structure, each part appearing with its item (spokes, loop arrows, card panels, the \"vs\", the timeline axis, leader lines, the arrows into or out of a result). Declare only the items and show them; declare an arrow yourself only to put a label on it.",
            "- Page elements (stat, bullets, quote, …) never go in a template scene; use ELEMENT KINDS.",
          ]),
    ...(!grid && kind.template.name === "code" ? ['- Code and terminal text is one quoted string with \\n between lines: code "a = 1\\nprint(a)" lang=py. Keep the real indentation of the code: spaces right after \\n ("def f(x):\\n    return x"). Lines are parts: write code.2 types line 2, highlight code.2 marks it.'] : []),
    ...(!grid && kind.template.name === "anatomy" ? ['- Every part is a box with its exact text: p1 = box "https://". Name each part with a label placed under it: n1 = label "protocol" @below:p1 (variant=stacked: @right-of:p1). Show a part and its name together.'] : []),
    ...(trace ? ["- Declare each collection once, before the narration, with an optional caption: id = row | stack | queue | set | pairs | chain | buckets n=5 | heap | plot | ring | lanes to=30 | net \"2 3 1\" | graph \"A-B A-C B-D:4\" | tree \"R>A R>B A>C\" (row: array cells with slot numbers; stack: last on top; queue: front on the left; set: a panel of values; pairs: key:value rows; chain: a linked list, each node with an arrow to the next and null at the end; buckets: a hash table, one numbered row per bucket; graph and tree are drawn from their edges, and a state lists the nodes to show; heap: values written like an array and drawn as a tree, so a swap moves values along it; plot \"(x-3)^2\" from=0 to=9: a curve with points on it, a state lists x values and each point is joined to the one before (a descent, a search); ring: items name:angle on a circle, 0 to 359 clockwise from the top, and `| k->B` draws a clockwise walk; net \"2 3 1\": a neural network from its layer sizes, nodes named x1.. (inputs), a1.. b1.. (hidden), y1.. (outputs), each joined to the whole next layer, a state lists nodes with `x1:2` values and marks (`*` the forward pass layer by layer, `!` the blame travelling back); lanes to=30: a time axis with parallel lanes, a lane written as its name and its segments `label:start-end` in seconds, e.g. `t: poll: a:0-1 b:5-6 push: c:0-30`, a mark colouring a segment (! red for a failure)). The first collection is the main picture, the others are panels beside it.", "- Chains: a chain state lists named nodes in order (`l: a:3 b:8 c:15`); `/` starts a detached chain below (`/ d:10`), and `| d->c` adds an arrow from a named node. Moving a node into the chain rewires the arrows. Buckets: write each bucket as its number and its nodes (`h: 2: 12 7 4: 9`). Graph and tree: list the nodes shown, with a mark or a value (`g: A+ B* C:3`); a tree node appears when it is listed, so insert one node per cue.", "- A state line is `<cue> <collection>: item item … | pointer=slot`: the whole contents of the collection at that moment. A value is `7`, a named cell `b:7` (needed for repeated values that move apart and for pairs), text in quotes. Marks follow an item: `*` being looked at, `+` done, `~` seen, `!` rejected. Pointers name a slot number (`i=2`, `mid=3`).", "- The first state line shows the collection: never fade, pop, draw or write it, and never write swap, move, drop, lift or set on its cells. You may highlight or pulse a whole collection.", "- One change per cue: a compare and a swap are two cues in the sentence. Every state line follows a cue of the sentence above it."] : []),
    ...(trace ? ["- Make the picture carry the example, not just the shape: use the real values and names from the narration (the key, the word, the address, the amount), name each cell with `id:value` when a bare number would be ambiguous, and write exactly what the sentence says (a pattern such as `c[ao]t` is one cell per character or token, not the matched word). `chain` is for linked lists only (it draws `null`), `row` for arrays, `graph`/`tree` when things point at each other (references, dependencies, hierarchies: draw the edges). Put every step of the story in a state; if a sentence says two things happen, show both before moving on. Pick the kind by the picture the topic needs: a neural network or any layered model is `net \"2 3 1\"` (values on x1, a1, y1; mark the forward pass `*` and the blame travelling back `!`); anything that happens over seconds (polling against push, a token bucket refilling, 30-second windows, timeouts, cold starts, retries) is `lanes to=<seconds>` with one lane per actor and `label:start-end` segments; a function against its input (gradient descent, a cost curve) is `plot`; things that point at each other (object references, dependencies, a tree of decisions) are `graph` or `tree` with every edge declared. Shapes to copy (not their topics): references and reachability: `refs = graph \"root-A A-B D-E E-D\"`, then `1 refs: root A B D E` and `2 refs: root+ A+ B+ D! E!` (live marked +, garbage marked !); a bucket refilling against requests: `t = lanes to=10`, then `1 t: requests: r1:0-1 r2:1-2 refill: tick:5-6+`; a network: `n = net \"2 3 1\"`, then `1 n: x1:2 x2:3 a1:1.2* a2:0.4*`."] : []),
    ...(!grid && kind.template.name === "structure" ? ["- Each value is a box: c1 = box \"42\". Every box is a value cell, so never make a box or icon for an operation (push, pop, insert) or a target: show an operation by popping in, hiding or moving cells, and name a target with a label @above:<cell>. A pointer is a label placed above a cell: p = label \"i\" @above:c1; move it with: move p @above:c3."] : []),
    ...(hint ? [hint] : []),
    ...(note ? [`- For this template: ${note.replace(/\n+/g, " ")}`] : []),
    ...(canvas ? canvasRules(spec) : []),
  ];
  const S = new Slots("scene.system", settings);
  return S.done(`You write one scene of Narrascript: a line-based script language for narrated 2D explainer videos.
Reply with Narrascript only — no prose, no markdown fences.

STATEMENTS (one per line; the first word decides the type)
${S.v("scene_line", sceneLine)}
<id> = <kind>[:<name>] ["text"] [key=value]   declares an element (hidden until an action shows it)${S.v("edge_line", flow ? `\n<id> = <a> -> <b> ["label"]          edge between two nodes` : "")}
> Narration with {1}point cues and {2 span cues}.
<anchor> <verb> <targets> [args] [then <verb> <targets> [args]]
wait <seconds>

HOW TIMING WORKS
- Each "> " line is one spoken sentence. Its action lines come right under it, before the next "> " line.
- {n} = the moment the next word is spoken. {n some words} = while those words are spoken.
- Cue ids restart at 1 on every "> " line; each action uses a cue of the sentence just above it.
- Anchors: a cue id, "start" (sentence start) or "end" (after the sentence).
- Several action lines on one anchor run together; "then" runs the next verb after the previous.
- Narration is spoken by a voice. Write numbers the usual way (1957, $18M, 60%, 2.5B): they are read aloud correctly. Never put a web address, a file path, a commit hash, an id or code in the narration: say what it is (the repository, the commit, the config file) and show the exact text in the picture. Avoid symbols like -> ~ and slashes between words; write them as words.

SHAPE OF A SCENE (each sentence, then its own actions)
scene heat "How water rises" template=steps
sun = icon:sun "Sunlight" "Light warms the sea surface"
sea = icon:waves "Warm sea" "Warm water starts to rise"
cloud = icon:cloud "Clouds" "Rising vapour cools and condenses"
> The {1}sun warms the {2 surface of the sea}.
1 pop sun
2 pop sea
> The warm water rises and {1}cools into clouds.
1 pop cloud
${S.v("playbook", playbook(usecase, settings))}
${S.v("audience_level", audienceLine(settings.level ?? DEFAULT_LEVEL))}
RULES
- One idea per sentence, at most ${S.v("max_words", words)} words. ${S.v("sentences", span(canvas ? spec.chapterSentences : spec.sentences))} sentences per ${canvas ? "chapter" : "scene"}.
- Every cue gets at least one action. Every element must be shown by an enter verb (fade, pop, draw, write).
- Show an element before emphasizing or moving it.
- Never write coordinates, sizes or colors. Only durations like 0.8 are allowed as numbers.
- Keep the scene line's template= or grid= exactly as planned.
${S.v("template_rules", rules.join("\n"))}
- Use only the pictures listed under PICTURES, exactly as written. For anything else use box "Label" or text.
- Parts in parentheses can be targeted as <id>.<part>; list items and chart bars as <id>.1, <id>.2 …
- fit and until= need a span cue {n some words}; on a point cue {n} use a duration or nothing.
- Cue ids restart at 1 on every "> " line, and the actions under a line anchor only on that line's cues.
- Every action number under a sentence needs its {n} marker in that sentence: "1 pop a" needs {1} in the line above.

QUALITY
- Show, don't label: give each thing the picture that means it (icon:sun "Sunlight", icon:gavel "Law"), and a different picture for each thing in a scene. Never reuse one icon for unrelated ideas. Use box only for abstract ideas no listed picture fits.
- Be factually correct. Use real, well-known figures; if unsure of a number, describe the trend in words instead of inventing data.
- Never invent quotes or attributions. Quote only real, famous people with words they actually said; otherwise use callout or body.

VERBS
${S.v("verbs", verbs)}
ARGS: 0.8 duration · fit (= length of the span cue) · +0.2 delay · /0.15 stagger · until=<cue> · ease=in|out|inout|spring · color=accent|warn|good|cool|muted · write sync=true reveals words as spoken

${S.v("elements", grid ? gridPageSection(kind.grid) : `ELEMENT KINDS\n${kinds}`)}

PICTURES
${S.v("pictures", pictureList(assets))}${S.v("house_style", styleGuide(settings))}`);
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
${EXAMPLE_PAGE}`;
}

const EXAMPLE_PAGE = `scene numbers "By the numbers" grid=L3-02
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
export function outlineSystemPrompt(assets: AssetManifest[], domain?: Domain, settings: PromptSettings = {}, decided = false): string {
  const S = new Slots("outline.system", settings);
  const level = settings.level ?? DEFAULT_LEVEL;
  // Each layout with its slot sizes, and each page element with the smallest slot it needs:
  // enough to plan a page whose content fits.
  const mode = frameMode("title", false);
  const layouts = GRID_LAYOUTS.map((l) => `  ${l.code} ${l.name}: ${slotRects(l, mode).map((r) => `${r.w}×${r.h}`).join(" · ")}`).join("\n");
  const seen = new Set<string>();
  const elements = GRID_ELEMENTS.filter((e) => !seen.has(e.kind) && seen.add(e.kind))
    .map((e) => `${e.kind} ${e.minW}×${e.minH}`)
    .join(" · ");
  return S.done(`You plan narrated 2D explainer videos written in Narrascript, a line-based script language.
Reply with Narrascript lines only — no prose, no markdown fences.

LINES
video 1 "Title"
theme <look>
scene <id> "Title" template=<template>      a diagram
scene <id> "Title" grid=<layout code>        an editorial page (add mirror=true to some)
# usecase: <name>                           once, right after the theme line: what this video is (see USE CASES)
# question: <what the video answers>        the BRIEF: three comment lines right after the usecase line, written before any scene
# example: <the one concrete case the video follows, with its real values, or "none">
# outcome: <what the viewer can see, say or do at the end>
# method: <method> · why: <one line>             the TEACHING METHOD, right after the brief (see TEACHING)
# shape: <shape> · role: <role> · goal: <one line>   one comment line under each scene line; grid pages use shape: page
# beat: <beat> [· via: <method>] [· device: <device>, …] · link: <how it follows from the scene before>   a second comment line under each scene line (see TEACHING)
<role> is one of: problem, idea, example, limit, takeaway, context, result, misconception. Use the ones the story needs; no video needs all of them, and none is required. The roles together must answer the question and reach the outcome.
<id> is one short lowercase word (intro, stages, recap), never a number. A scene has template= or grid=, never both.

USE CASES (decide what the video is for, write it on the "# usecase:" line, and plan the pictures the way that use case says)
${S.v("usecases", useCaseCatalogue())}

${S.v("teaching", teachingSection(level, decided))}

${S.v("style_menu", styleSection())}

SCENE SHAPES → TEMPLATES (diagrams). First decide the shape of what the scene explains, then take a template of that shape.
${S.v("shape_table", shapeTable(domain))}

GRID LAYOUTS (editorial pages: each slot's size; one element per slot)
${S.v("layouts", layouts)}
PAGE ELEMENTS (the smallest slot each needs): ${S.v("page_elements", elements)}
Plan a page only when its content fits the slots: one element per slot, each slot at least its element's size, at least one chart, stat, body, bullets, quote, table or similar, and at most one icon.

PICTURES: ${S.v("pictures", `${assets.filter((a) => a.kind === "asset").length ? `illustrations of ${assets.filter((a) => a.kind === "asset").map((a) => a.name).join(", ")}; ` : ""}${assets.filter((a) => a.kind === "icon").length} icons`)} of everyday things (people, places, money, law, science, nature, weather, transport, food, tools) and of technology (servers, databases, networks, security, code and developer tools, git, AI, and the logos of common products such as Docker, GitHub, AWS and Python). The scene writer picks them; plan scenes around things that can be pictured.

${S.v("domain_plan", domain ? `${DOMAINS[domain].plan}\n\n` : "")}PLANNING RULES
- Teach, don't list: the video answers one question and builds toward it. Every scene has a job, and its goal says it: the problem, the idea, the worked example, the limit or trade-off, the takeaway.
- A scene may be ONE GROWING PICTURE: when the video follows one example or one system that changes step by step (a run, a conversation, a request path, a branching history, a state machine, or two options applied one after the other to the same data), plan it as a single scene whose goal says what the finished picture shows, then 3 to 6 comment lines under it, "# chapter: <id> · <what this chapter adds or changes, and what it says>". The picture stays on screen and changes chapter by chapter. It counts as one scene of the budget; use at most one. Every other scene brings new items: never show the same items in two separate scenes.
- Diagrams: label the scene's shape, then write the template shown after → for that shape (template=<template name>, never the shape name). Check its "not if".
- Decide the brief first (question, example, outcome), then the method, then give each scene a role and a beat. Choose templates last: they carry the roles, they are not the plan.
- The video opens and ends the way its method says. template=title is only ever the first scene.
- Grid pages (shape: page) are for numbers, quotes, bullet text, charts and tables, with at most one icon. Several pictures of equal weight → template=cards.
- Vary scene types across the video; mirror=true on some grid pages. Leave variant= out unless the template lists what to choose between (a chart: bars, line or ring, by what the numbers are); the engine picks the arrangement that fits.
- Plan only facts you are sure of.${S.v("house_style", styleGuide(settings))}`);
}

/**
 * What the planner knows about teaching: the audience level it was given, the devices, and (when the method is not
 * decided before the plan) the methods to choose from. A decided plan gets its arc in the request instead.
 */
export function teachingSection(level: Level = DEFAULT_LEVEL, decided = false): string {
  const methods = decided
    ? ""
    : `METHODS (one for the whole video; its beats are the arc of the video)
${methodCatalogue(level)}
- Choose the method that fits what the learner asks about this topic, and say why on the "# method:" line.
- Every scene gets one beat of the method on its "# beat:" line, in the method's order: the first scene has the first beat, the last scene the last beat.
`;
  return `TEACHING (how the explanation is told; the use case decides the pictures)
${audienceLine(level)}
The audience level is given by the person: plan for it; never write it in the plan.

${methods}- One scene may borrow another method for its beat (· via: analogical): methods combine, but the main method keeps the arc.
- Only socratic and discovery open with a question to the viewer. The others open with what their "opens" says: a problem, a situation, common ground, something familiar; their first scene has no question or prediction device.
- link: the idea the scene picks up from the one before ("the server already answered", "the run starts at A"), never beat names or "the last scene". The first scene has none.
- device: the devices the scene's narration uses, only where they help (most scenes need none or one):
${deviceList()}
- A prediction gives the viewer time to answer before the picture shows it.
- The last scene ends the way the method ends; it is never a recap.`;
}

/** What recent videos drew and how they looked, oldest first. */
export interface RecentUse {
  templates?: string[];
  looks?: string[];
  motions?: string[];
}

/** One line for the planner: the looks of the last videos, so it picks others when they fit equally well. */
function lookNote(recent: RecentUse): string {
  const looks = [...new Set(recent.looks ?? [])];
  if (!looks.length) return "";
  return `
The viewer's recent videos used the looks ${looks.join(", ")}. Choose a different look where another fits the topic equally well.
`;
}

/**
 * Looks with one line each, so the model can match them to the topic. How things move (the motion personality) and how scenes
 * change (the transitions) are not the writer's: the Director picks them for the whole video, so the model writes neither.
 */
function styleSection(): string {
  const looks = THEMES.map((t) => `  ${t.padEnd(14)} ${THEME_SUMMARIES[t]}`).join("\n");
  return `STYLE (once per video, before the first scene; pick what suits the topic and audience)
theme <look>:
${looks}
How things move and how one scene gives way to the next are chosen for you: write no motion line, and no in= or out= on a scene.`;
}

/** First pass: plan the scenes without writing narration. */
/**
 * First pass: plan the scenes without writing narration. With `decided`, the use case, the method and every scene's
 * beat are already chosen (decidePrompt), and the plan fills that arc in.
 */
export function outlinePrompt(topic: string, scenes: { min: number; max: number }, recent: RecentUse = {}, spec: LengthSpec = STANDARD, settings: PromptSettings = {}, decided?: Decision): string {
  const guess = guessUseCase(topic);
  const level = settings.level ?? DEFAULT_LEVEL;
  const advice = planningAdvice(spec, settings);
  const S = new Slots("outline.user", settings);
  // The templates the last videos leaned on (most used first): a nudge, never a rule.
  const counts = new Map<string, number>();
  for (const t of recent.templates ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  const often = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  const variety = often.length ? `
The viewer's recent videos leaned on these templates: ${often.join(", ")}. Prefer others where they fit the idea equally well.
` : "";
  return S.done(`Plan a narrated explainer video about:
${S.v("topic", topic)}

Audience level: ${S.v("level", level)}.
${S.v("variety", variety + lookNote(recent))}${S.v("planning_advice", advice ? `${advice}\n` : "")}${decided ? S.v("teaching_plan", decidedBlock(decided)) : S.v("usecase_hint", guess ? `Likely use case: ${guess.name} (change it if the topic is really something else).\n` : "")}${S.v("house_style", styleGuide(settings))}
Output only:
- the "video 1" line and a "theme" line that suits the topic and audience
- right after the "theme" line, one comment line "# usecase: ${decided ? decided.usecase : "<name>"}"${decided ? "" : " from USE CASES"}
- then the brief: "# question: …", "# example: …" (one concrete case with its real values, or none), "# outcome: …"
- then the method: "# method: ${decided ? `${decided.method.name} · why: ${decided.why}` : "<method> · why: <one line>"}"
- one "scene" line per scene (${S.v("scenes", decided ? `exactly ${decided.slots.length}` : `${scenes.min}–${scenes.max}`)} scenes), each with a fitting template= (diagrams) or grid= (editorial pages of numbers, charts, lists, quotes), followed by one comment line "# shape: <shape> · role: <role> · goal: <what this scene explains and what it shows>" and one comment line "# beat: <${decided ? "its slot from the list above, word for word" : "beat of the method"}> [· via: <method>] [· device: <devices>] · link: <how it follows from the scene before>" (the first scene has no link)
- optional, only when something really stays in view from one scene to the next (a client, a server, a database; at most 3): after the "theme" line one comment line naming it, "# cast: client = icon:smartphone "Client"; server = icon:server "Server"", and "· carry: client, server" at the end of the comment line of every later scene it stays in. A carried thing keeps its picture and moves into the new scene's layout instead of disappearing.
No elements, narration or actions yet.`);
}

/**
 * Second pass: one complete scene, written against the whole outline and,
 * when earlier scenes are already written, what they say.
 */
export function scenePrompt(outline: string, sceneId: string, earlier = "", canvas = false, settings: PromptSettings = {}, example = "", arc = ""): string {
  const S = new Slots("scene.user", settings);
  const said = earlier ? `\n\nAlready narrated in earlier scenes (don't repeat it; build on it):\n${earlier}` : "";
  const plan = castPlan(outline);
  const here = plan.carry.get(sceneId) ?? [];
  const ahead = plan.carry.get(plan.order[plan.order.indexOf(sceneId) + 1] ?? "") ?? [];
  const recurring = [...new Set([...here, ...ahead])].filter((id) => plan.cast.has(id));
  const castBlock = recurring.length
    ? `\n\nRecurring elements, the same thing in several scenes: declare each exactly as written (same id, picture and label):\n${recurring.map((id) => `  ${id} = ${plan.cast.get(id)}`).join("\n")}`
    : "";
  const carried = here.length
    ? `\nCarried from the previous scene (${here.join(", ")}): they are already on screen when this scene starts. Declare them here, never show them (no pop, fade, draw or write on them), and use them: send along their links, highlight, mark. Put carry=${here.join(",")} on the scene line.`
    : "";
  const line = outline.split("\n").find((l) => sceneLineId(l) === sceneId);
  const tpl = line ? findTemplate(/\btemplate=(\S+)/.exec(line)?.[1] ?? "") : undefined;
  const grid = line ? gridCard(/\bgrid=(\S+)/.exec(line)?.[1] ?? "") : undefined;
  const card = tpl ? `\n\n${templateCard(tpl)}` : grid ? `\n\n${grid}` : "";
  return S.done(`Video outline:
${S.v("outline", outline)}${S.v("earlier_scenes", said)}${S.v("template_card", card)}${S.v("scene_example", example ? `

A finished scene of this kind, for its pattern only (never copy its topic or numbers):
${example}` : "")}${S.v("recurring", castBlock)}${S.v("carried", carried)}${S.v("arc", arc ? `\n\n${arc}` : "")}

${S.v("task", canvas
    ? `Write scene "${sceneId}" in full: its scene line, ALL element declarations, then one step per "# chapter:" line with its narration lines (with cues) and actions.
Output only this scene, starting with its "scene" line.`
    : `Write scene "${sceneId}" in full: its scene line, element declarations, narration lines with cues, and actions.
Cover only this scene's goal; other scenes cover the rest.
Output only this scene, starting with its "scene" line.`)}`);
}

/** The decided teaching plan, as the plan request states it: the method and the beat of every scene, in order. */
/** The arc a plan fills in: one numbered slot per scene, each beat with its job and the picture it needs. */
function decidedBlock(d: Decision): string {
  const m = d.method;
  const list = d.slots
    .map((slot, i) => {
      const { beats, round } = parseSlot(slot);
      const where = i === 0 ? ` (the video opens with ${m.opens})` : i === d.slots.length - 1 ? ` (the video ends with ${m.ends})` : "";
      const again = round > 1 ? `\n     round ${round}: ${m.round}` : "";
      return `  ${i + 1}. ${slotLabel(slot)}${where}${again}\n${beats.map((b) => `     ${b}: ${m.jobs[b] ?? ""} Picture: ${m.pictures[b] ?? "the scene's own"}.`).join("\n")}`;
    })
    .join("\n");
  return `THE TEACHING PLAN IS DECIDED: use case ${d.usecase}, method ${m.name} (${d.why}).${d.misconception ? `\nThe wrong idea to bring out: ${d.misconception}` : ""}
Write exactly ${d.slots.length} scene lines, one per numbered slot, in this order (a slot with several beats is ONE scene); each scene's "# beat:" line starts with its slot, word for word:
${list}
The jobs and pictures are for you: never copy their wording into the plan's lines, titles or goals; the "# beat:" line holds only the slot. A slot with several beats is one scene that does them in order. A later round brings something new, never a repeat. Only the scene that runs the example lists its step-by-step values; later scenes' goals name the step or result they point at, not the run again. A scene may borrow another method for its beat (· via: <method>).
Choose each scene's template for the picture its beats need. A beat is the scene's job, not its name: the scene id and title say what the scene is about ("The cheapest road first", never "The Problem" or "Steps").
`;
}

/** The system prompt of the call that decides how a video teaches: what kind of video it is and the method. */
export const DECIDE_SYSTEM = "You decide how a narrated explainer video teaches its topic: what kind of video it is, what the learner wants to know, the wrong idea to bring out, and how long the request asks it to be. Reply with exactly four lines, nothing else.";

export function decideSystemPrompt(settings: PromptSettings = {}): string {
  return new Slots("decide.system", settings).done(DECIDE_SYSTEM);
}

/**
 * The teaching decision, made before the plan: the use case (it decides the pictures) and the method (it decides the
 * order of the ideas), for the audience level the person chose. A small call: no pictures, templates or layouts.
 */
export function decidePrompt(topic: string, settings: PromptSettings = {}): string {
  const level = settings.level ?? DEFAULT_LEVEL;
  const guess = guessUseCase(topic);
  const S = new Slots("decide.user", settings);
  return S.done(`Topic: ${S.v("topic", topic)}

${S.v("audience_level", audienceLine(level))}

USE CASES (what kind of video this is: it decides the pictures)
${S.v("usecases", useCaseCatalogue(false))}
${S.v("usecase_hint", guess ? `\nLikely use case, from the topic's words: ${guess.name} (change it only if the topic is really something else).\n` : "")}
WHAT THE LEARNER ASKS (the intent: it decides how the video teaches)
${S.v("intents", intentMenu())}
Take the intent the topic's own words ask: "how X works" asks how, "X vs Y" asks differ, "why is my X slow" asks fix, "what prints first" or "what happens if" asks predict, "what is X" asks what. Take believe when the video's point is correcting what most people wrongly believe or expect about it ("why more threads do not always make code faster", "why HTTPS does not hide which site you visit", "does deleting a file erase it"), even when the words say how or what; a topic that only has a minor misconception on the side is still how or what. How long the video should be never changes the use case or the intent.
${S.v("house_style", styleGuide(settings))}
${S.v("lengths", lengthMenu())}

Reply with exactly these four lines:
# usecase: <name>
# intent: <intent> · why: <one line: what this learner wants to know about the topic>
# misconception: <the wrong idea most viewers at this level hold about it, in one sentence, or none>
# length: <none | short | standard | long | deep>`);
}

/** The lengths the decision call reads the request against, with the words that point to each. */
function lengthMenu(): string {
  const words: Record<Length, string> = {
    short: '"briefly", "quick", "in short", "in a nutshell", a minute or less',
    standard: '"a normal explanation", about two minutes',
    long: '"in detail", "a detailed explanation", "a long narration", about three minutes',
    deep: '"in depth", "deep dive", "a complete guide", "everything about", five minutes or more',
  };
  return `HOW LONG (only what the request itself asks for)
${LENGTHS.map((l) => `  ${l.padEnd(9)} ${LENGTH_SPECS[l].summary}: ${words[l]}`).join("\n")}
Write "none" when the request says nothing about length or detail. Words that are part of the topic's name are not about length: long polling, quick sort, short-circuit evaluation, long division, a short position.`;
}

/** The system prompt of the call that decides between one growing diagram and several scenes. */
export const CANVAS_CHOICE_SYSTEM = "You decide how a narrated explainer video about a software topic is best shown. Reply with one word.";

/** Asks whether a topic is one system that a single growing diagram can walk through, or needs several different pictures. */
export function canvasChoicePrompt(topic: string, settings: PromptSettings = {}): string {
  const S = new Slots("choose.user", settings);
  return S.done(`Topic: ${S.v("topic", topic)}

Answer "diagram" if the topic is ONE system or process whose parts build on each other, so a single diagram can grow while the narration walks through it: the path of a request through servers, a protocol's states, a hierarchy, a pipeline, a branching history, an architecture.
Answer "scenes" if explaining it needs several different pictures: a comparison of two things, a concept with unrelated parts, a data format or the anatomy of something, a how-to with code, history, advice, a list of separate ideas.
A diagram needs at least four things that interact or follow one another. When unsure, answer scenes: it is the safer choice.
Reply with one word: diagram or scenes.`);
}

/** The system prompt of that call: the person's version, or the built-in one. */
export function chooseSystemPrompt(settings: PromptSettings = {}): string {
  return new Slots("choose.system", settings).done(CANVAS_CHOICE_SYSTEM);
}

/** True when the reply chose one growing diagram. */
export function chosenCanvas(reply: string): boolean {
  // The first of the two words in the reply is the answer.
  return /\b(diagram|scenes)\b/i.exec(reply)?.[1]?.toLowerCase() === "diagram";
}

/**
 * Planning for a video that is one growing diagram: a single scene whose template draws the whole
 * system, and the chapters that build it up (each becomes a step of that scene).
 */
export function canvasOutlinePrompt(topic: string, chapters: { min: number; max: number }, recent: RecentUse = {}, settings: PromptSettings = {}): string {
  const counts = new Map<string, number>();
  for (const t of recent.templates ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  const often = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  const variety = often.length ? `\nThe viewer's recent videos leaned on these templates: ${often.join(", ")}. Prefer others where they fit equally well.\n` : "";
  const S = new Slots("canvas.outline", settings);
  return S.done(`Plan a narrated explainer video about:
${S.v("topic", topic)}

The body of the video is ONE diagram that grows chapter by chapter on a single stage, with a camera that follows the action: not separate slides. A short title scene opens it and a short closing page ends it.
${S.v("variety", variety + lookNote(recent))}${S.v("house_style", styleGuide(settings))}
Output only:
- the "video 1" line, a "theme" line and a "motion" line that suit the topic and audience
- right after the "motion" line, one comment line "# usecase: <name>" from USE CASES
- exactly three "scene" lines, each followed by its comment line "# shape: <shape> · goal: <…>":
  1. scene intro "Title" template=title: the headline as a statement, with 1–3 pictures of the topic (shape: intro)
  2. scene main "Title" template=<the template whose picture is the whole system>: the diagram that grows (goal: what the finished diagram shows)
  3. scene recap "Title" grid=L2-08: the one idea to remember (shape: page)
- right after scene main's comment line, ${S.v("chapters", `${chapters.min}–${chapters.max}`)} comment lines, in order: "# chapter: <id> · <what this chapter adds to the diagram and what it says>"
No elements, narration or actions yet.`);
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
export function fullPrompt(topic: string, scenes: { min: number; max: number }, settings: PromptSettings = {}): string {
  const S = new Slots("single.user", settings);
  return S.done(`Write a complete narrated explainer video (${S.v("scenes", `${scenes.min}–${scenes.max}`)} scenes) about:
${S.v("topic", topic)}

Start with the "video 1" line.`);
}

/** Repair: the failing scene plus compact diagnostics with scene-relative line numbers. */
export function repairPrompt(sceneText: string, diagnostics: string, kind: "errors" | "quality" = "errors", settings: PromptSettings = {}): string {
  const S = new Slots(kind === "errors" ? "repair" : "improve", settings);
  const numbered = sceneText
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(3)}| ${l}`)
    .join("\n");
  const ask =
    kind === "errors"
      ? "This scene has errors. Fix every error and reply with the corrected scene only (no line numbers)."
      : "This scene is valid but has quality problems. Fix them, keep everything else that works, and reply with the improved scene only (no line numbers).";
  return S.done(`${ask}

${S.v("scene", numbered)}

${kind === "errors" ? "Errors" : "Problems"}:
${S.v("diagnostics", diagnostics)}`);
}

/**
 * What an outline says about recurring things: the cast (`# cast: id = icon:name "Label"; …`), and per
 * scene the ids it carries over from the previous scene (`· carry: a, b` on its comment line). The
 * first scene carries nothing.
 */
export function castPlan(outline: string): { cast: Map<string, string>; carry: Map<string, string[]>; order: string[] } {
  const cast = new Map<string, string>();
  const carry = new Map<string, string[]>();
  const order: string[] = [];
  let scene: string | undefined;
  for (const line of outline.split("\n")) {
    const id = sceneLineId(line);
    if (id) {
      scene = id;
      order.push(id);
      continue;
    }
    const decl = /^\s*#\s*cast:\s*(.+)$/i.exec(line)?.[1];
    if (decl) {
      for (const part of decl.split(";")) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(part);
        if (m) cast.set(m[1]!, m[2]!);
      }
    }
    const ids = /·\s*carry:\s*([A-Za-z0-9_,\s]+?)\s*(?:·|$)/i.exec(line)?.[1];
    if (scene && ids && order.length > 1) {
      const list = ids.split(/[,\s]+/).filter(Boolean);
      if (list.length) carry.set(scene, list);
    }
  }
  return { cast, carry, order };
}

/** Templates whose items are pictures: a recurring picture can be one of their items (not a flowchart's node, a grid page, a code panel). */
const CARRY_TEMPLATES = new Set(["compare", "steps", "cycle", "timeline", "hub", "cards", "spotlight", "converge", "diverge", "process", "exchange", "architecture", "stack"]);

/**
 * Drops the `· carry:` of a scene when it or the scene before it can't hold a recurring picture
 * (a flowchart, a page, code...): the carried thing would have nowhere to be.
 */
export const ROLES = ["problem", "idea", "example", "limit", "takeaway", "context", "result", "misconception"] as const;

/** The plan's brief (question, example, outcome) and each scene's role, with what is missing from it. */
export function briefOf(outline: string): { question?: string; example?: string; outcome?: string; roles: string[]; problems: string[] } {
  const field = (k: string) => new RegExp(`^\\s*#\\s*${k}:\\s*(.+)$`, "im").exec(outline)?.[1]?.trim();
  const question = field("question");
  const example = field("example");
  const outcome = field("outcome");
  const roles = outline.split("\n").filter((l) => /^\s*#\s*shape:/i.test(l)).map((l) => /\brole:\s*([a-z]+)/i.exec(l)?.[1]?.toLowerCase() ?? "");
  const problems: string[] = [];
  if (!question) problems.push("no # question: line");
  if (!outcome) problems.push("no # outcome: line");
  if (!example) problems.push("no # example: line");
  if (roles.some((r) => !(ROLES as readonly string[]).includes(r))) problems.push("a scene has no valid role");
  else if (roles.length && !roles.includes("takeaway") && !roles.includes("example")) problems.push("no scene is an example or a takeaway");
  return { question, example, outcome, roles, problems };
}

export function pruneCarry(outline: string): string {
  const lines = outline.split("\n");
  const kinds: (string | undefined)[] = [];
  const at: number[] = [];
  lines.forEach((l, i) => {
    if (sceneLineId(l) === undefined) return;
    kinds.push(/\btemplate=(\S+)/.exec(l)?.[1]);
    at.push(i);
  });
  at.forEach((start, k) => {
    const end = at[k + 1] ?? lines.length;
    const ok = k > 0 && CARRY_TEMPLATES.has(kinds[k] ?? "") && CARRY_TEMPLATES.has(kinds[k - 1] ?? "");
    if (ok) return;
    for (let i = start + 1; i < end; i++) lines[i] = lines[i]!.replace(/\s*·\s*carry:[^·]*/i, "");
  });
  return lines.join("\n");
}

function sceneLineId(line: string): string | undefined {
  return /^\s*scene\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line)?.[1];
}

/** A subject area with templates of its own: planning prefers them and picks a depth. */
export type Domain = "tech";

export const DOMAINS: Record<Domain, { label: string; shapes: Shape[]; plan: string }> = {
  tech: {
    label: "Software & tech concepts",
    shapes: ["interaction", "architecture", "layers", "structure", "code", "hierarchy", "states", "branching", "format"],
    plan: `DOMAIN: software & tech concepts
- Prefer the tech templates where they fit: exchange (messages between parties: a request, a handshake, a login), architecture (a system's components in zones), stack (layers built on each other), structure (array, linked list, stack, queue and what happens to them), code (real code, a query or terminal commands), tree (folders, DNS, the DOM), states (a state machine), gitgraph (Git branches and merges), anatomy (the parts of a URL, a request, a packet), steps variant=pipeline (CI/CD, ETL). Use the general templates for the rest: compare for A vs B, steps for a procedure, cards for kinds or tools, timeline for history, flow for decisions, a grid page for numbers.
- Pick the depth from the topic and audience and write it at the end of every goal: "· depth: simple" for beginners (everyday words, short labels, at most 4 messages or 6 lines of code) or "· depth: dense" for developers (real protocol, command and API names; real code up to 14 lines; more parts).
- Show the mechanism: what travels where, what is stored where, what each line does. Avoid scenes that only list words.`,
  },
};

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
export function shapeTable(domain?: Domain): string {
  const first = domain ? DOMAINS[domain].shapes : [];
  return [...first, ...(Object.keys(SHAPES) as Shape[]).filter((s) => !first.includes(s))]
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
 * How a designed template is cued and what else a scene can ask of it: its items appear where the narration names them (no action
 * lines), plus the scene options its page really has.
 */
function designedCues(t: TemplateManifest): string {
  const options = ["pace=relaxed|normal|snappy (how long its own animations take)"];
  if (t.name === "title") options.push("bg=base|tint|deep (its backdrop)");
  if (t.name === "stats") options.push("highlight=<item id> (the stat that glows; the last by default)");
  const named = t.items && t.items.max > 0 && t.name !== "title";
  return `${named ? "Cues: name each item in braces where the narration says it ({id}, right before the words) and write no action lines at all in the scene (not even `write title`). Until the first item is named the page shows only its heading and frame, so name the first item in the scene's first or second sentence, then the others as the narration reaches them. " : "No cues and no action lines: the page plays the opening itself. "}Scene options: ${options.join("; ")}.`;
}

/** The variants part of a designed template's card: what to choose (if anything), and how much text the motions take. */
function designedVariants(t: TemplateManifest): string {
  const set = motionSet(t.name)!;
  const choices = variantChoices(set);
  if (!choices.length) {
    const l = limitsText(set);
    return `Variants: leave variant= out; the engine picks the motion. Text: ${l.safe} fit every motion; ${l.max} fit some; longer is an error. Shorter text leaves more motions to choose from.`;
  }
  const lines = choices.map((c) => `  ${c.id.padEnd(9)} ${c.when} (${limitsText(set, c.id).safe} fit every motion)`);
  return `Variant (choose by what the content is; the engine picks the motion within it, and replaces one that does not fit the text):
${lines.join("\n")}`;
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
${t.html ? `${designedCues(t)}
${designedVariants(t)}` : `Variants (leave variant= out unless one clearly suits the content; the engine replaces one that does not fit):\n${variants.join("\n")}`}
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

/**
 * Every editable prompt as it is without edits, with the parts the program generates left as {{slots}}:
 * what the Studio shows as the default of each prompt, to edit or to come back to.
 */
export function defaultPrompts(assets: AssetManifest[], domain?: Domain): Record<PromptId, { text: string; slots: string[] }> {
  const tokens: PromptSettings = { tokens: true };
  const kind = sceneKindOf('scene s "S" template=exchange');
  const text: Record<PromptId, string> = {
    "outline.system": outlineSystemPrompt(assets, domain, tokens),
    "outline.user": outlinePrompt("", { min: 2, max: 4 }, {}, undefined, tokens),
    "canvas.outline": canvasOutlinePrompt("", { min: 4, max: 6 }, {}, tokens),
    "choose.system": chooseSystemPrompt(tokens),
    "decide.system": decideSystemPrompt(tokens),
    "decide.user": decidePrompt("", tokens),
    "choose.user": canvasChoicePrompt("", tokens),
    "scene.system": sceneSystemPrompt(kind, assets, false, undefined, tokens),
    "scene.user": scenePrompt("", "s", "", false, tokens),
    repair: repairPrompt("", "", "errors", tokens),
    improve: repairPrompt("", "", "quality", tokens),
  };
  return Object.fromEntries(PROMPT_IDS.map((id) => [id, { text: text[id], slots: [...new Set([...text[id].matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map((m) => m[1]!))] }])) as Record<PromptId, { text: string; slots: string[] }>;
}
