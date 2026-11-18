import { compile } from "@anim/compiler";

/**
 * Quality checks for a scene that compiles: problems the validator lets
 * through because the script is valid, but the video would be weak or
 * misleading. Each issue reads like a diagnostic so it can go straight
 * into a repair prompt.
 */
export interface QualityIssue {
  code: "Q1" | "Q2" | "Q3" | "Q4" | "Q5" | "Q6" | "Q7" | "Q8" | "Q9" | "Q10";
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

  // Q9: a grid page of only sentences (bullets, a checklist, a paragraph, a callout) repeats the narration. The closing
  // recap of a video may be one; a limit, a cost or a comparison has to show the case.
  if (scene.attrs.grid) {
    const TEXT = new Set(["bullets", "numbered", "checklist", "list", "body", "callout", "definition", "proscons", "title", "kicker", "footer", "caption"]);
    const parts = elements.filter((e) => e.id !== "title");
    const closing = /recap|remember|takeaway|wrap|summary|check|conclusion|final|end|outro/i.test(`${scene.id} ${scene.title ?? ""}`);
    if (parts.length && parts.every((e) => TEXT.has(e.kind)) && !closing) {
      issues.push({ code: "Q9", message: `scene \`${scene.id}\` is a page of sentences that repeats the narration; show the case instead: a number that moves (stat, gauge, chart with the real values), a table of the actual rows, or a trace/compare scene of the example` });
    }
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
  // Q7: a trace drawn as flat rows when the narration is about links, time or layers: the picture needs another kind.
  if (tpl === "trace") {
    const kinds = new Set(scene.steps.flatMap((st) => st.elements.map((e) => e.kind)));
    const flat = ["row", "stack", "queue", "set", "pairs"].some((k) => kinds.has(k)) && !["graph", "tree", "net", "lanes", "plot", "heap", "ring", "chain", "buckets"].some((k) => kinds.has(k));
    if (flat) {
      const said = narrationLines(sceneText).join(" ");
      if (/\b(points? to|pointing|links? to|references?|reachable|unreachable|depends? on|dependenc|parent|child(ren)?)\b/i.test(said)) {
        issues.push({ code: "Q7", message: `scene \`${scene.id}\` talks about things pointing at each other but draws a flat row, so no link is visible; declare the objects as \`graph "A-B B-C"\` (or \`tree\`) and mark nodes in each state` });
      } else if (/\b(neurons?|hidden layer|input layer|output layer|weights?)\b/i.test(said) && /\blayers?\b|neural|network/i.test(said)) {
        issues.push({ code: "Q7", message: `scene \`${scene.id}\` explains a layered network but draws a flat row; declare \`n = net "2 3 1"\` and list nodes with values (x1:2 a1:1.2 y1:1.8)` });
      } else if ((said.match(/\b(seconds?|per second|window|refill|timeout|polling|cold start|every \d+)\b/gi) ?? []).length >= 3) {
        issues.push({ code: "Q7", message: `scene \`${scene.id}\` is about events over time but draws a flat row; declare \`t = lanes to=<seconds>\` and write each lane's segments as \`label:start-end\`` });
      }
    }
  }
  // Q8: numbers the narration says out loud that appear nowhere on screen: the picture has to carry the worked example.
  {
    const spoken = narrationLines(sceneText).join(" ").replace(/\{\w+\s?/g, " ").replace(/,(?=\d)/g, "");
    const shown = sceneText.split("\n").filter((l) => !l.trimStart().startsWith(">")).join(" ").replace(/,(?=\d)/g, "");
    const nums = [...new Set(spoken.match(/\d+(?:\.\d+)?/g) ?? [])];
    const onScreen = (n: string) => new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}([^\\d]|\\.(?!\\d)|$)`).test(shown);
    const missing = nums.filter((n) => !onScreen(n));
    if (nums.length >= 2 && missing.length >= 2) {
      issues.push({ code: "Q8", message: `scene \`${scene.id}\` says ${missing.slice(0, 5).join(", ")} but those numbers appear nowhere on screen; put the worked example's real values in the picture (a cell, a label, a state item, a stat) so the viewer sees what the narration says` });
    }
  }
  // Q10: the narration says something fails, is cut, lost or blocked, and nothing on screen shows it.
  if (scene.attrs.template && !["trace", "title"].includes(scene.attrs.template)) {
    const said = narrationLines(sceneText).join(" ");
    const calls = scene.steps.flatMap((st) => st.beats.flatMap((b) => b.actions.flatMap((a) => a.calls)));
    const shown = calls.some((c) => c.verb === "strike" || c.verb === "shake" || c.verb === "hide" || c.args.params.fail !== undefined || c.args.params.as === "fail" || JSON.stringify(c.args).includes("fail"));
    if (/\b(crash(es|ed)?|fail(s|ed|ure)?|cut|broken|breaks?|lost|drops?|dropped|blocked|rejected|down|stale)\b/i.test(said) && calls.length >= 3 && !shown) {
      issues.push({ code: "Q10", message: `scene \`${scene.id}\` says something fails, breaks, is lost or blocked, but nothing on screen shows it; show it: \`mark <id> as=fail\`, \`strike <id>\`, \`shake <id>\`, or \`send ... fail=true\` for a message that does not arrive` });
    }
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
