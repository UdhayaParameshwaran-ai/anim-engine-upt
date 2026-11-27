import { compile } from "@anim/compiler";
import { findTemplate } from "@anim/registry";

/**
 * Quality checks for a scene that compiles: problems the validator lets
 * through because the script is valid, but the video would be weak or
 * misleading. Each issue reads like a diagnostic so it can go straight
 * into a repair prompt.
 */
export interface QualityIssue {
  code: "Q1" | "Q2" | "Q3" | "Q4" | "Q5" | "Q6" | "Q7" | "Q8" | "Q9" | "Q10" | "Q11" | "Q12" | "Q13" | "Q14" | "Q15" | "Q16" | "Q17" | "Q18";
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

/** A scene's place in the teaching arc, for the narration checks (Q11–Q14). */
export interface SceneArc {
  first: boolean;
  last: boolean;
  method: string;
  /** How the method opens, and whether that is a question to the viewer. */
  opens: string;
  opensWithQuestion: boolean;
  devices: string[];
  /** How the plan says this scene follows from the one before. */
  link?: string;
  /** The scene before (its script text) and every earlier scene's, for the link and the ending. */
  previous?: string;
  earlier?: string;
  /** The scene carries a beat the method cannot be taught without (the run, the evidence, the experiment). */
  core?: boolean;
}

/** Plan words that must never be spoken: beat names used as nouns, and talk about scenes. */
const SCAFFOLD = /\b(next|last|previous|this|earlier|following) scene\b|\bthe (gap|follow-up|refine|beat|prediction|guess|steps|evidence|investigation|mapping) (showed|shows|ended|raised|set|gave|left)\b/i;

const STOP = new Set("the a an and or but so of to in on at for with by is are was were be it its this that these those then than as from into now each one two only not no can will would could should has have had do does did what which who how why when where you your we our they their there here just also more most very".split(" "));
const contentWords = (s: string) => new Set(s.toLowerCase().replace(/\{\w+\s?/g, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const trigrams = (s: string) => {
  const w = s.toLowerCase().replace(/\{\w+\s?/g, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(w.slice(i, i + 3).join(" "));
  return out;
};
/** Words a spoken sentence opens with when it carries on from what came before. */
const CARRIES_ON = /^(so|but|and|that|this|these|those|now|then|which|because|still|yet|once|with|back|here|instead|after|before|meanwhile|even|only|remember|again|at this|at that)\b/i;

/**
 * Things a voice cannot say well: a web address, an address with a domain, a file path, a commit hash or id. (Numbers, units and
 * acronyms are fine: the speech step reads them out; see packages/tts spoken.ts.)
 */
export function unspeakable(line: string): string | undefined {
  const text = line.replace(/\{\w+\s?/g, " ").replace(/\}/g, " ");
  return (
    /\bhttps?:\/\/\S+|\bwww\.\S+/i.exec(text)?.[0] ??
    /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i.exec(text)?.[0] ??
    /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|org|net|dev|app|ai|co|so|xyz|gov|edu)(?:\/\S*)?\b/i.exec(text)?.[0] ??
    /(?:^|\s)\/[\w.-]+(?:\/[\w.-]+)+/.exec(text)?.[0]?.trim() ??
    /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i.exec(text)?.[0]
  );
}

/** Narration checks against the scene's place in the teaching arc. */
function arcIssues(sceneId: string, sceneText: string, arc: SceneArc): QualityIssue[] {
  const said = narrationLines(sceneText).map((l) => l.replace(/\{\w+\s?/g, "").replace(/\}/g, "").trim());
  if (!said.length) return [];
  const issues: QualityIssue[] = [];
  const asks = said.some((l) => /\?\s*$/.test(l));
  // Q11: only methods that open with a question put one to the viewer in the first scene.
  if (arc.first && !arc.opensWithQuestion && asks) {
    issues.push({ code: "Q11", message: `scene \`${sceneId}\` opens the video with a question, but ${arc.method} opens with ${arc.opens}; say it as a statement, no question to the viewer` });
  }
  // Q12: a later scene restarts cold: its first sentence neither carries on nor picks up the scene before or the planned link.
  if (!arc.first && (arc.previous || arc.link)) {
    const first = said[0]!;
    const words = [...contentWords(first)];
    const before = contentWords(narrationLines(arc.previous ?? "").slice(-2).join(" "));
    const link = contentWords(arc.link ?? "");
    const picksUp = words.filter((w) => before.has(w)).length >= 2 || words.filter((w) => link.has(w)).length >= 2;
    if (!CARRIES_ON.test(first) && !picksUp) {
      issues.push({ code: "Q12", message: `scene \`${sceneId}\` starts cold ("${first.slice(0, 60)}"); its first sentence should pick up where the scene before left off${arc.link ? `: ${arc.link}` : ""}` });
    }
  }
  // Q13: a planned prediction is a question the viewer gets time to answer before the reveal.
  if (arc.devices.includes("prediction") && (!asks || !/^\s*wait\s+\d/m.test(sceneText))) {
    issues.push({ code: "Q13", message: `scene \`${sceneId}\` is planned with a prediction: ask the viewer what will happen in a sentence of its own, then put \`wait 1.5\` on its own line before the sentence that shows the answer` });
  }
  // Q14: the last scene ends the way the method ends, not by repeating earlier lines.
  if (arc.last && arc.earlier) {
    const mine = [...trigrams(said.join(" "))];
    const before = trigrams(narrationLines(arc.earlier).join(" "));
    const repeated = mine.filter((t) => before.has(t)).length / Math.max(1, mine.length);
    if (repeated > 0.3) issues.push({ code: "Q14", message: `scene \`${sceneId}\` repeats ${Math.round(repeated * 100)}% of its phrases from earlier scenes; end the way ${arc.method} ends instead of recapping` });
  }
  // Q15: the plan's words spoken aloud ("the gap showed…", "the next scene shows…").
  const scaffold = said.find((l) => SCAFFOLD.test(l));
  if (scaffold) issues.push({ code: "Q15", message: `scene \`${sceneId}\` speaks about the plan ("${scaffold.slice(0, 70)}"); say what happens in the topic itself, never "the next scene" or beat names` });
  // Q16: the same question to the viewer as the scene before asked.
  if (arc.previous) {
    const before = narrationLines(arc.previous).map((l) => l.replace(/\{\w+\s?/g, "").replace(/\}/g, "").trim()).filter((l) => /\?\s*$/.test(l)).map(contentWords);
    const again = said.filter((l) => /\?\s*$/.test(l)).find((q) => {
      const w = [...contentWords(q)];
      return w.length >= 2 && before.some((b) => w.filter((x) => b.has(x)).length / w.length >= 0.6);
    });
    if (again) issues.push({ code: "Q16", message: `scene \`${sceneId}\` asks the viewer again what the scene before asked ("${again.slice(0, 70)}"); build on that question instead of repeating it` });
  }
  // Q17: a scene the method cannot do without, written as a sentence or two.
  if (arc.core && said.length < 3) issues.push({ code: "Q17", message: `scene \`${sceneId}\` carries a beat ${arc.method} cannot be taught without, but has only ${said.length} sentence${said.length === 1 ? "" : "s"}; show it in full on the example` });
  return issues;
}

export function qualityIssues(header: string, sceneText: string, usecase?: string, example?: string, arc?: SceneArc): QualityIssue[] {
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
  // (A designed template draws its own motion from the narration's cues; there is no verb for a script to add.)
  if (tpl && STORY_TEMPLATES.has(tpl) && !findTemplate(tpl)?.html) {
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
  // Q18: an address, a path or an id in the narration: the voice would read it out character by character.
  for (const line of narrationLines(sceneText)) {
    const bad = unspeakable(line);
    if (bad) {
      issues.push({ code: "Q18", message: `scene \`${scene.id}\` has "${bad.slice(0, 50)}" in its narration, which the voice would read out letter by letter; say what it is instead (the repository, the commit, the config file) and show the exact text in the picture` });
      break;
    }
  }
  if (arc) issues.push(...arcIssues(scene.id, sceneText, arc));
  return issues;
}

function verbsOf(scene: { steps: { beats: { actions: { calls: { verb: string }[] }[] }[] }[] }): string[] {
  return scene.steps.flatMap((st) => st.beats.flatMap((b) => b.actions.flatMap((a) => a.calls.map((c) => c.verb))));
}

/** Issues as report lines, matching the diagnostic format used in repair prompts. */
export function qualityReport(issues: QualityIssue[]): string {
  return issues.map((q) => `${q.line ? `L${q.line} ` : ""}${q.code} quality: ${q.message}`).join("\n");
}
