import { compile } from "@anim/compiler";

/**
 * Quality checks for a scene that compiles: problems the validator lets
 * through because the script is valid, but the video would be weak or
 * misleading. Each issue reads like a diagnostic so it can go straight
 * into a repair prompt.
 */
export interface QualityIssue {
  code: "Q1" | "Q2" | "Q3" | "Q4" | "Q5" | "Q6";
  /** Scene-relative line, when the issue belongs to one element. */
  line?: number;
  message: string;
}

/** Kinds that carry meaning by themselves (a picture, data or a diagram node). */
const VISUAL = new Set(["icon", "asset", "chart", "node", "formula"]);
/** Kinds that only frame or connect. */
const FRAME = new Set(["title", "footer", "arrow", "line", "edge"]);
/** Attributions that name nobody in particular. */
const VAGUE = /^\W*(an?\s+)?(unknown|anonymous|someone|expert|scientist|researcher|atmospheric scientist|professor|doctor|teacher|historian|author|source)s?\W*$/i;

/** Templates whose subject is something that happens (messages, state changes, operations), not just things that exist. */
const STORY_TEMPLATES = new Set(["exchange", "states", "structure", "tree", "gitgraph", "architecture", "steps", "flow", "stack", "cycle", "timeline", "process", "anatomy", "compare", "cards", "hub", "converge", "diverge", "spotlight", "code"]);
/** Verbs that show something happening, not only appearing. */
const STORY_VERBS = new Set(["send", "stream", "visit", "mark", "shake", "drop", "lift", "swap", "move", "frame", "focus", "set", "count", "strike", "clone", "merge"]);

/** A sentence's words, lowercased, without cue marks: what two sentences are compared by. */
const wordsOf = (line: string): Set<string> => new Set(line.replace(/\{\w+\s?/g, " ").replace(/[^a-z0-9' ]/gi, " ").toLowerCase().split(/\s+/).filter(Boolean));
const narrationLines = (text: string): string[] => text.split("\n").filter((l) => l.trimStart().startsWith(">")).map((l) => l.trimStart().slice(1).trim());

/** Narration sentences that say (nearly) what a finished example said: the model copied its wording instead of writing about this topic. */
export function copiedFrom(example: string, sceneText: string): string[] {
  const known = narrationLines(example).map((l) => ({ l, w: wordsOf(l) })).filter((x) => x.w.size >= 5);
  const copied: string[] = [];
  for (const line of narrationLines(sceneText)) {
    const w = wordsOf(line);
    if (w.size < 5) continue;
    if (known.some((k) => [...w].filter((x) => k.w.has(x)).length / new Set([...w, ...k.w]).size >= 0.7)) copied.push(line.replace(/\{\w+\s?/g, "").replace(/\}/g, "").trim());
  }
  return copied;
}

export function qualityIssues(header: string, sceneText: string, usecase?: string, example?: string): QualityIssue[] {
  const offset = header.split("\n").length;
  const { script, diagnostics } = compile(`${header}\n${sceneText}\n`);
  const scene = script.scenes[0];
  if (!scene) return [];
  const issues: QualityIssue[] = [];
  const elements = scene.steps.flatMap((s) => s.elements);

  // Q1: a diagram made only of boxes and words.
  const content = elements.filter((e) => !FRAME.has(e.kind));
  if (!scene.attrs.grid && scene.attrs.template !== "flow" && scene.attrs.template !== "trace" && content.length >= 2 && !content.some((e) => VISUAL.has(e.kind))) {
    issues.push({ code: "Q1", message: `scene \`${scene.id}\` shows only boxes and text; show the ideas with listed icons or assets whose meaning matches their labels` });
  }

  // Q2: assets that will render as grey placeholders.
  for (const d of diagnostics) {
    if (d.code === "NAR306" && d.fixed?.includes("placeholder")) {
      issues.push({ code: "Q2", line: d.span.line - offset, message: `${d.message}; it will render as a grey placeholder, so use a listed asset instead` });
    }
  }

  // Q3: quotes nobody can be held to.
  for (const e of elements) {
    if (e.kind !== "quote") continue;
    const who = e.texts[1]?.trim() ?? "";
    if (!who || VAGUE.test(who)) {
      issues.push({ code: "Q3", line: e.span.line - offset, message: `quote \`${e.id}\` is attributed to ${who ? `"${who}"` : "nobody"}; quote a real, named person's actual words, or use callout/body instead` });
    }
  }
  // Q4: a diagram of something that happens, shown only by things appearing.
  const tpl = scene.attrs.template;
  if (tpl && STORY_TEMPLATES.has(tpl)) {
    const verbs = scene.steps.flatMap((st) => st.beats.flatMap((b) => b.actions.flatMap((a) => a.calls.map((c) => c.verb))));
    if (verbs.length && !verbs.some((v) => STORY_VERBS.has(v))) {
      const hint = tpl === "exchange" ? "show each message with send (a packet travels along it)" : tpl === "structure" ? "operate on the cells (drop, lift, swap, visit, mark)" : tpl === "compare" ? "visit each side as it is described (mark or strike a side only if the narration says it wins or is wrong)" : tpl === "code" ? "visit each line as it is explained (or strike an old line and mark the new one ok)" : "move through it with visit (a ring follows the item being described) and mark";
      issues.push({ code: "Q4", message: `scene \`${scene.id}\` only makes things appear; show what happens: ${hint}` });
    }
  }
  // Q5: an algorithm's data scene that shows a step or two of the run and stops.
  if (usecase === "algorithm" && tpl === "structure") {
    const OPS = new Set(["swap", "visit", "mark", "drop", "lift", "set", "strike", "move"]);
    const verbs = verbsOf(scene);
    const ops = verbs.filter((v) => OPS.has(v)).length;
    if (ops < 6) issues.push({ code: "Q5", message: `scene \`${scene.id}\` shows only ${ops} step(s) of the run; run the example all the way to the finished result: every compare (visit) and swap, then mark the finished values ok` });
    // Every move the narration names must happen on screen.
    const spoken = scene.steps.flatMap((st) => st.beats.flatMap((b) => (b.type === "speech" ? [b.text] : []))).join(" ");
    if (/\bswap(s|ped|ping)?\b/i.test(spoken) && !verbs.includes("swap")) {
      issues.push({ code: "Q5", message: `scene \`${scene.id}\` says things swap but never swaps them; do each swap on screen with swap <a>,<b> right after the visit that compares them` });
    }
  }
  // Q5 for a trace: a run that shows a state or two and stops, or ends without marking the finished values.
  if (usecase === "algorithm" && tpl === "trace") {
    const states = scene.steps.flatMap((st) => st.beats.flatMap((b) => b.actions.flatMap((a) => a.calls.filter((c) => c.verb === "state" && c.state))));
    const first = states[0]?.targets[0];
    const mine = states.filter((c) => c.targets[0] === first);
    if (mine.length < 5) issues.push({ code: "Q5", message: `scene \`${scene.id}\` shows only ${mine.length} state(s) of the run; run the example all the way to the finished result, one state per compare or swap` });
    else if (!mine.at(-1)!.state!.items.some((i) => i.mark === "+")) issues.push({ code: "Q5", message: `scene \`${scene.id}\` ends without marking the finished values; mark them + in the last state` });
  }
  // Q6: wording taken from the finished example the scene was shown.
  if (example) {
    for (const line of copiedFrom(example, sceneText).slice(0, 3)) {
      issues.push({ code: "Q6", message: `scene \`${scene.id}\` repeats the example's wording ("${line.slice(0, 70)}"); say it about this topic, with this topic's own names and values` });
    }
  }
  // Q4 for number pages: a stat or gauge that only appears, when it could count up.
  if (scene.attrs.grid && !verbsOf(scene).some((v) => STORY_VERBS.has(v)) && elements.some((e) => ["stat", "multistat", "gauge", "progress"].includes(e.kind))) {
    issues.push({ code: "Q4", message: `scene \`${scene.id}\` only makes things appear; let the numbers move: count a stat from=0 to=<value> (suffix="%" or prefix="$")` });
  }
  return issues;
}

function verbsOf(scene: { steps: { beats: { actions: { calls: { verb: string }[] }[] }[] }[] }): string[] {
  return scene.steps.flatMap((st) => st.beats.flatMap((b) => b.actions.flatMap((a) => a.calls.map((c) => c.verb))));
}

/** Issues as report lines, matching the diagnostic format used in repair prompts. */
export function qualityReport(issues: QualityIssue[]): string {
  return issues.map((q) => `${q.line ? `L${q.line} ` : ""}${q.code} quality: ${q.message}`).join("\n");
}
