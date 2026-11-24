/**
 * How a video teaches: the teaching methods, the audience levels a person picks, the tones and the rhetorical
 * devices. The use case (usecases.ts) decides the pictures; the method decides the order of the ideas and how the
 * words go. The audience level is an input, never a planner decision.
 *
 * The method comes from the learner's question (the intent the decision call reads from the topic), not from the kind
 * of topic. Each method's arc is written out per video length: a short video merges beats into fewer scenes, a long
 * one runs another round of the method's cycle; the beats that carry the method (its core) are never dropped.
 *
 * Source: the team's "Narration Arc" research (methods, audience profiles, vocabulary levels, tone and devices),
 * with the misconception and prediction findings from Muller (2008), the prequestion meta-analysis (2024) and the
 * expertise reversal effect (Kalyuga): the level changes how much is shown, not the method.
 */

export const LEVELS = ["new", "familiar", "practitioner"] as const;
export type Level = (typeof LEVELS)[number];
export const DEFAULT_LEVEL: Level = "familiar";
export const isLevel = (v: unknown): v is Level => typeof v === "string" && (LEVELS as readonly string[]).includes(v);

/** What the audience level means for the words. Looked up from the person's choice, never guessed by the planner. */
export interface AudienceCard {
  level: Level;
  who: string;
  vocabulary: string;
  sentences: string;
  depth: string;
}

export const AUDIENCES: Record<Level, AudienceCard> = {
  new: {
    level: "new",
    who: "new to the field: has never worked with this topic or its neighbours",
    vocabulary: "accessible: everyday words first; a technical term only after the viewer has seen the thing it names, defined in that sentence, then used the same way every time",
    sentences: "short, one idea at a time",
    depth: "intuitive: what it does and why, every step shown, one familiar comparison welcome",
  },
  familiar: {
    level: "familiar",
    who: "knows the basics of the field (a student or a junior developer), new to this topic",
    vocabulary: "intermediate: the field's ordinary terms without definitions; this topic's own terms defined where they first appear",
    sentences: "short to moderate",
    depth: "conceptual: how it works and why it is built that way, with one real example",
  },
  practitioner: {
    level: "practitioner",
    who: "works with this field daily and meets this topic at work",
    vocabulary: "advanced: precise technical names, commands and numbers; no everyday comparisons",
    sentences: "direct and precise",
    depth: "technical: the mechanism, its trade-offs and where it fails in practice; show only the steps that matter and leave one for the viewer to finish",
  },
};

/** The tones a method can set (Narration Arc 5.3). */
export const TONES = {
  curious: 'wonders with the viewer: "but what happens next?"',
  conversational: 'talks to the viewer: "think about how you use a search engine"',
  analytical: 'weighs things side by side: "there are two important differences"',
  authoritative: 'states the mechanism plainly: "TCP guarantees ordered delivery"',
  investigative: 'follows the evidence: "let\'s find out why this query is slow"',
  reflective: 'points at what changed: "notice what changed between these two examples"',
} as const;
export type Tone = keyof typeof TONES;

/** Rhetorical devices the plan may place on a scene (Narration Arc 5.5). */
export const DEVICES = {
  analogy: "connect the unfamiliar to something familiar, and say where the comparison stops",
  contrast: "set two things side by side to reveal the difference",
  question: "a rhetorical question that makes the next idea wanted",
  prediction: "ask the viewer to guess what happens, pause, then show it",
  misconception: "say the plausible wrong idea, let it fail on the example, then give the right one",
  signposting: "say where the explanation is going next",
  repetition: "repeat the key idea in the same words to anchor it",
  recap: "gather what has been established so far (long videos, mid-way; never the last scene)",
} as const;
export type Device = keyof typeof DEVICES;

/**
 * A slot of an arc: one scene. It holds one beat, several merged beats (`question+prediction`, a short video) or a
 * later round of a beat (`evidence:2`, a long video). `slotLabel` gives the form plans show.
 */
export type Slot = string;

/** One teaching method (Narration Arc section 3), with its beats in order and its arc at each length. */
export interface Method {
  name: string;
  /** When it fits, in a few words (the planner's menu). */
  when: string;
  /** The beats of the arc, in order. */
  beats: readonly string[];
  /** What a scene with each beat does in its narration ("done when": what has to be on screen or said). */
  jobs: Readonly<Record<string, string>>;
  /** What each beat shows: a relation to the rest of the video, not a template. */
  pictures: Readonly<Record<string, string>>;
  /** The arc at each length, one slot per scene; a deep video is the long arc plus more rounds of `cycle`. */
  arcs: { short: readonly Slot[]; standard: readonly Slot[]; long: readonly Slot[] };
  /** Beats every length keeps: without them the method is not taught. */
  core: readonly string[];
  /** The beats a longer video runs again, as a new round. */
  cycle: readonly string[];
  /** What a later round brings, so it never repeats the first. */
  round: string;
  /** How the video opens and ends with this method. */
  opens: string;
  ends: string;
  tone: Tone;
  /** Levels the method does not suit. */
  avoid?: readonly Level[];
}

export const METHODS: readonly Method[] = [
  {
    name: "feynman",
    when: "an abstract or technical idea that can be said simply first and then made precise",
    beats: ["familiar", "simple", "gap", "refine"],
    jobs: {
      familiar: "Start from something the viewer already understands, named plainly; the topic's own terms come later.",
      simple: "Explain the idea in the simplest true words, on the picture: done when the viewer could say it back in one sentence.",
      gap: "Show, on a concrete case, what the simple version leaves out or gets wrong: done when the case visibly breaks it.",
      refine: "Give the precise version in the real terms, and show it handling the case that broke the simple one.",
    },
    pictures: {
      familiar: "the everyday thing itself",
      simple: "the idea's parts on one picture, with few labels",
      gap: "the same picture with the case that breaks the simple version",
      refine: "the same picture, now with the real mechanism added",
    },
    arcs: {
      short: ["familiar+simple", "gap+refine"],
      standard: ["familiar", "simple", "gap", "refine"],
      long: ["familiar", "simple", "gap", "refine", "gap:2", "refine:2"],
    },
    core: ["simple", "gap"],
    cycle: ["gap", "refine"],
    round: "go one step further than the last pass (from the analogy to the real mechanism, then to an exception or a real use); never say the same thing again",
    opens: "a familiar starting point the viewer already understands",
    ends: "the refined, precise version of the idea",
    tone: "conversational",
  },
  {
    name: "socratic",
    when: "a topic whose point is a common wrong belief that the example can refute",
    beats: ["question", "prediction", "evidence", "follow-up", "conclusion"],
    jobs: {
      question: "Put one concrete question about the example to the viewer and leave it open: no answer, no definition.",
      prediction: "Say the guess most people make and why it seems right, ask for the viewer's guess, and pause.",
      evidence: "Show what really happens on the example, step by step: done when the guess visibly holds or fails on screen.",
      "follow-up": "Challenge why the guess seemed right: name the assumption behind it and test it on the example. Never repeat an earlier question.",
      conclusion: "Give the answer the questions led to, and tie it back to the opening question.",
    },
    pictures: {
      question: "the example, stopped just before the outcome",
      prediction: "the outcomes the viewer could pick, side by side",
      evidence: "the example running to its real outcome",
      "follow-up": "the example with the assumption marked, or a case that breaks it",
      conclusion: "the opening picture, now answered",
    },
    arcs: {
      short: ["question+prediction", "evidence+conclusion"],
      standard: ["question", "prediction", "evidence", "follow-up+conclusion"],
      long: ["question", "prediction", "evidence", "follow-up", "evidence:2", "conclusion"],
    },
    core: ["prediction", "evidence"],
    cycle: ["follow-up", "evidence"],
    round: "a new question that challenges an assumption the last answer rested on, then its evidence on the example",
    opens: "a question to the viewer, with time to guess",
    ends: "the conclusion the questions led to",
    tone: "curious",
  },
  {
    name: "worked-example",
    when: "a procedure, algorithm or calculation shown step by step on real values",
    beats: ["problem", "steps", "reasoning", "result", "apply"],
    jobs: {
      problem: "State the concrete problem with its real values; no definition and no rule yet.",
      steps: "Solve it on the real values, one step per sentence, saying the values aloud: done when the example reaches its result on screen.",
      reasoning: "Say why the key step is the right move: the rule behind what the viewer just watched. Point at that one step on the finished run; never replay the run.",
      result: "Show the finished result once and check it; do not retell the steps.",
      apply: "Give a new small case on the same kind of picture, ask the viewer to work it out, pause, then give the answer. Do not restate the procedure.",
    },
    pictures: {
      problem: "the example's data, before anything runs",
      steps: "the same data changing step by step",
      reasoning: "the step that matters, highlighted on the run",
      result: "the run's final state with the answer marked, not a text page",
      apply: "the run's picture with new values, stopped before the answer",
    },
    arcs: {
      short: ["problem+steps", "reasoning+result+apply"],
      standard: ["problem", "steps", "reasoning+result", "apply"],
      long: ["problem", "steps", "reasoning", "result", "steps:2", "apply"],
    },
    core: ["steps"],
    cycle: ["steps"],
    round: "a second, different example in which the viewer does more of the work: name the first step, ask for the next one, pause, confirm",
    opens: "the concrete problem to solve",
    ends: "a new case the viewer can now solve the same way",
    tone: "authoritative",
  },
  {
    name: "contrastive",
    when: "two or more things set against each other (A vs B, which to choose)",
    beats: ["common-ground", "dimensions", "difference", "when-to-use"],
    jobs: {
      "common-ground": "Say what the options share and the job they both do, on one case.",
      dimensions: "Put the options on the same axes, one axis at a time, on the same case: done when every axis shows both options.",
      difference: "Show the one difference that matters most on that case, and what it changes.",
      "when-to-use": "Say when to choose each, as a rule the viewer can apply to their own case.",
    },
    pictures: {
      "common-ground": "both options doing the same job, side by side",
      dimensions: "both options on one axis, side by side, on the same case",
      difference: "the case where the options give different results",
      "when-to-use": "each option next to the situation it suits",
    },
    arcs: {
      short: ["common-ground+dimensions", "difference+when-to-use"],
      standard: ["common-ground", "dimensions", "difference", "when-to-use"],
      long: ["common-ground", "dimensions", "difference", "dimensions:2", "difference:2", "when-to-use"],
    },
    core: ["dimensions", "difference"],
    cycle: ["dimensions", "difference"],
    round: "one more axis the options differ on, shown on the same case",
    opens: "what the options share",
    ends: "when to use each",
    tone: "analytical",
  },
  {
    name: "causal",
    when: "one event leads to another: what happens when, how a system or protocol behaves",
    beats: ["condition", "trigger", "mechanism", "consequence"],
    jobs: {
      condition: "Set up the starting situation, as it is before anything happens.",
      trigger: "Show the single event that starts the chain.",
      mechanism: "Follow the chain on screen: each step causes the next (so, which means, that is why). Done when every step's cause is shown, not just named.",
      consequence: "Show where the chain leads and what that means for the viewer.",
    },
    pictures: {
      condition: "the parts at rest, before anything happens",
      trigger: "the same picture as the event starts",
      mechanism: "the same picture, each step lighting up as it causes the next",
      consequence: "the end state on the same picture",
    },
    arcs: {
      short: ["condition+trigger", "mechanism+consequence"],
      standard: ["condition", "trigger", "mechanism", "consequence"],
      long: ["condition", "trigger", "mechanism", "mechanism:2", "mechanism:3", "consequence"],
    },
    core: ["mechanism"],
    cycle: ["mechanism"],
    round: "the next link of the chain on the same picture: what the last step causes",
    opens: "the starting situation",
    ends: "the consequence and what it means",
    tone: "conversational",
  },
  {
    name: "problem-based",
    when: "a real problem the viewer meets, with the concepts introduced as the tools that solve it",
    beats: ["problem", "constraints", "investigation", "concepts", "solution"],
    jobs: {
      problem: "Show the problem the way the viewer meets it: the real symptom, not the textbook name.",
      constraints: "Say what makes it hard: what any fix has to respect.",
      investigation: "Try the obvious fix or follow the evidence, and show where it fails or what it reveals.",
      concepts: "Bring in the concept as the tool that fixes exactly what the investigation found.",
      solution: "Show the solution working on the original problem, check that it works, and say why.",
    },
    pictures: {
      problem: "the symptom as the viewer sees it (a slow query, an error)",
      constraints: "the same picture with the limits marked",
      investigation: "the attempt running, and where it fails",
      concepts: "the concept placed on the same picture",
      solution: "the original problem, now fixed, with the check",
    },
    arcs: {
      short: ["problem+constraints", "investigation+concepts+solution"],
      standard: ["problem+constraints", "investigation", "concepts", "solution"],
      long: ["problem", "constraints", "investigation", "investigation:2", "concepts", "solution"],
    },
    core: ["investigation", "concepts"],
    cycle: ["investigation"],
    round: "the next hypothesis: try it, and show where it fails or what it reveals",
    opens: "the problem as the viewer would meet it",
    ends: "the solution, and why it works",
    tone: "investigative",
  },
  {
    name: "discovery",
    when: "an outcome the viewer can guess and then watch before it is explained",
    beats: ["observation", "prediction", "experiment", "discovery", "formal"],
    jobs: {
      observation: "Show something to watch before any explanation.",
      prediction: "Ask the viewer what will happen next, then pause so they can guess.",
      experiment: "Run it and show what really happens, with the real output on screen: done when the evidence is visible, not described.",
      discovery: "Point out the pattern in what happened, without running it again.",
      formal: "Name the rule and state it precisely.",
    },
    pictures: {
      observation: "the thing to watch, running",
      prediction: "the moment just before the outcome, with the possible outcomes",
      experiment: "the run and its real output",
      discovery: "the output with the pattern marked",
      formal: "the rule next to the evidence it explains",
    },
    arcs: {
      short: ["observation+prediction", "experiment+discovery+formal"],
      standard: ["observation", "prediction", "experiment", "discovery+formal"],
      long: ["observation", "prediction", "experiment", "discovery", "experiment:2", "formal"],
    },
    core: ["prediction", "experiment"],
    cycle: ["experiment", "discovery"],
    round: "the same experiment under a new condition: ask for a guess, run it, compare with the first run",
    opens: "something to observe, then a prediction to make",
    ends: "the formal rule behind what was observed",
    tone: "curious",
  },
  {
    name: "analogical",
    when: "an abstract idea for viewers new to the field, where an everyday thing has the same shape",
    beats: ["familiar", "mapping", "new-concept", "limits"],
    jobs: {
      familiar: "Start inside the everyday thing and make its rule clear.",
      mapping: "Carry each part of the everyday thing over to the real one, part by part.",
      "new-concept": "Explain the real thing in its own terms, leaning on the mapping: done when the real thing is on screen, not only the comparison.",
      limits: "Say plainly where the comparison stops being true.",
    },
    pictures: {
      familiar: "the everyday thing",
      mapping: "the everyday thing and the real one side by side",
      "new-concept": "the real thing alone, in its own terms",
      limits: "the point where the two pictures differ",
    },
    arcs: {
      short: ["familiar+mapping", "new-concept+limits"],
      standard: ["familiar", "mapping", "new-concept", "limits"],
      long: ["familiar", "mapping", "new-concept", "mapping:2", "new-concept:2", "limits"],
    },
    core: ["mapping", "new-concept"],
    cycle: ["mapping", "new-concept"],
    round: "the next part of the everyday thing, mapped onto the real one and then shown in real terms",
    opens: "the familiar everyday thing",
    ends: "where the comparison stops being true",
    tone: "conversational",
    avoid: ["practitioner"],
  },
];

export const findMethod = (name: string | undefined): Method | undefined => METHODS.find((m) => m.name === (name ?? "").trim().toLowerCase());

/** Methods that open by putting a question to the viewer; the others open with a problem, a situation or something familiar. */
const OPENS_WITH_QUESTION = new Set(["socratic", "discovery"]);
export const opensWithQuestion = (m: Method): boolean => OPENS_WITH_QUESTION.has(m.name);

/**
 * What the learner wants to know: the decision call reads it from the topic, and the method follows from it. One
 * topic can be asked about in several ways ("what is an index?", "why is my query slow?"); the wording decides.
 */
export const INTENTS = {
  what: { asks: "what is it? (a definition, a format, an idea)", method: "feynman" },
  how: { asks: "how does it work? (a mechanism, a procedure that runs, a system at work)", method: "causal" },
  do: { asks: "how do I do it? (commands, code, a workflow to carry out)", method: "worked-example" },
  differ: { asks: "how do they differ, and which to choose?", method: "contrastive" },
  fix: { asks: "why does it fail, and how is it fixed? (a real problem the viewer meets)", method: "problem-based" },
  predict: { asks: "what happens if…? (an outcome the viewer can guess and then watch on screen: what prints, which is faster)", method: "discovery" },
  believe: { asks: "is what most people believe or expect right? (the point of the video is correcting a widely held wrong idea: why X is not what it seems, who really blocks it, why the obvious answer fails)", method: "socratic" },
  evolve: { asks: "how did it come to be? (history, a development over time)", method: "causal" },
} as const;
export type Intent = keyof typeof INTENTS;
export const isIntent = (v: unknown): v is Intent => typeof v === "string" && v in INTENTS;

/**
 * The method for a learner's question, the use case and the level. A running procedure (an algorithm, a how-to) is
 * taught by working an example; a comparison stays contrastive; newcomers meet a "what is it?" through an analogy.
 */
export function methodFor(intent: Intent | undefined, usecase: string | undefined, level: Level = DEFAULT_LEVEL): Method {
  const i: Intent = intent ?? "how";
  let name: string = INTENTS[i].method;
  if (i === "how" && (usecase === "algorithm" || usecase === "howto")) name = "worked-example";
  if (usecase === "comparison" && (i === "what" || i === "how")) name = "contrastive";
  // Newcomers meet an idea through something everyday first: a definition, or how a concept works.
  if (level === "new" && (i === "what" || (i === "how" && usecase === "concept"))) name = "analogical";
  const m = findMethod(name)!;
  return m.avoid?.includes(level) ? findMethod("feynman")! : m;
}

/** The decision call's menu of intents. */
export function intentMenu(): string {
  return (Object.entries(INTENTS) as [Intent, (typeof INTENTS)[Intent]][]).map(([k, v]) => `  ${k.padEnd(8)} ${v.asks}`).join("\n");
}

/** The planner's menu of methods, for the level the person chose. */
export function methodCatalogue(level: Level = DEFAULT_LEVEL): string {
  return METHODS.filter((m) => !m.avoid?.includes(level))
    .map((m) => `  ${m.name.padEnd(15)} ${m.when}\n${" ".repeat(18)}beats: ${m.beats.join(" → ")} · opens: ${m.opens} · ends: ${m.ends}`)
    .join("\n");
}

/** The audience card as the prompts state it. */
export function audienceLine(level: Level = DEFAULT_LEVEL): string {
  const a = AUDIENCES[level];
  return `AUDIENCE LEVEL: ${level} (${a.who})\n- Vocabulary: ${a.vocabulary}.\n- Sentences: ${a.sentences}.\n- Depth: ${a.depth}.`;
}

export function deviceList(): string {
  return Object.entries(DEVICES).map(([k, v]) => `  ${k.padEnd(14)} ${v}`).join("\n");
}

/** The beats a slot holds and its round: `question+prediction`, `evidence:2`, or the forms plans show. */
export function parseSlot(slot: string): { beats: string[]; round: number } {
  const round = Number(/:(\d+)\s*$/.exec(slot)?.[1] ?? /\(round\s+(\d+)\)/i.exec(slot)?.[1] ?? 1);
  const bare = slot.replace(/:\d+\s*$/, "").replace(/\(round\s+\d+\)/i, "");
  return { beats: bare.split("+").map((b) => b.trim().split(/\s/)[0]!.toLowerCase()).filter(Boolean), round };
}

/** A slot as plans show it: `question + prediction`, `evidence (round 2)`. */
export function slotLabel(slot: string): string {
  const { beats, round } = parseSlot(slot);
  return `${beats.join(" + ")}${round > 1 ? ` (round ${round})` : ""}`;
}

/**
 * A deep video: the long arc with more rounds of the method's cycle, until it has `min` scenes. New rounds go after
 * the long arc's last round (or before its last slot when it has none), so the arc still ends the way the method ends.
 */
function deepArc(method: Method, min: number): Slot[] {
  const arc = [...method.arcs.long];
  const rounds = arc.map((s) => parseSlot(s).round);
  let at = rounds.lastIndexOf(Math.max(...rounds));
  at = rounds[at]! > 1 ? at + 1 : arc.length - 1;
  for (let n = Math.max(...rounds) + 1; arc.length < min; n++) {
    for (const b of method.cycle) arc.splice(at++, 0, `${b}:${n}`);
  }
  return arc;
}

/**
 * The method's arc for a video length, one slot per scene. A scene range set by hand (the CLI's --scenes) picks the
 * written arc that fits it, else the nearest one, so the core beats survive any range.
 */
export function arcFor(method: Method, length: string = "standard", range?: { min: number; max: number }): Slot[] {
  const at = (name: string): Slot[] => (name === "deep" ? deepArc(method, Math.max(10, range?.min ?? 10)) : [...method.arcs[name as keyof Method["arcs"]]]);
  let arc = at(["short", "standard", "long", "deep"].includes(length) ? length : "standard");
  if (range && (arc.length < range.min || arc.length > range.max)) {
    const written = (["short", "standard", "long"] as const).map(at);
    arc = written.find((a) => a.length >= range.min && a.length <= range.max)
      ?? (range.min > method.arcs.long.length ? deepArc(method, range.min) : written.reduce((best, a) => (Math.abs(a.length - range.max) <= Math.abs(best.length - range.max) ? a : best)));
  }
  return arc;
}

/** The teaching decision a plan is written to: the use case, what the learner asks, the method and the arc. */
export interface Decision {
  usecase: string;
  intent: Intent;
  method: Method;
  why: string;
  /** The wrong idea the video brings out, when there is one. */
  misconception?: string;
  /** One slot per scene, in order. */
  slots: Slot[];
}

const NOTHING = /^(none|-|n\/a|no)$/i;

/**
 * The decision call's reply (`# usecase:`, `# intent: … · why: …`, `# misconception: …`), checked: an unknown use
 * case falls back to `fallback`, an unknown intent to "how". The method follows from the intent; the arc from the
 * method and the length.
 */
export function parseDecision(reply: string, level: Level, length: string, range: { min: number; max: number } | undefined, usecases: readonly { name: string }[], fallback?: string): Decision | undefined {
  const named = /^\s*#\s*usecase:\s*([a-z-]+)/im.exec(reply)?.[1]?.toLowerCase();
  const uc = usecases.find((u) => u.name === named) ?? usecases.find((u) => u.name === fallback);
  if (!uc) return undefined;
  const m = /^\s*#\s*intent:\s*([a-z]+)\s*(?:·\s*why:\s*(.+))?$/im.exec(reply);
  const said = m?.[1]?.toLowerCase();
  const intent: Intent = isIntent(said) ? said : "how";
  const method = methodFor(intent, uc.name, level);
  const why = m?.[2]?.trim() || `the learner asks ${INTENTS[intent].asks.split(" (")[0]}`;
  const mis = /^\s*#\s*misconception:\s*(.+)$/im.exec(reply)?.[1]?.trim();
  return { usecase: uc.name, intent, method, why, ...(mis && !NOTHING.test(mis) && { misconception: mis }), slots: arcFor(method, length, range) };
}

/**
 * The decided slots fitted to the number of scenes a plan actually wrote, so no beat is lost or repeated: more scenes
 * split a merged slot into its beats (the planner gave each beat a scene) or add a round of the cycle; fewer scenes
 * merge the neighbouring slots that hold the fewest beats.
 */
export function fitSlots(slots: readonly Slot[], n: number, method: Method): Slot[] {
  const out = [...slots];
  const size = (s: Slot) => parseSlot(s).beats.length;
  while (n > 0 && out.length < n) {
    let i = -1;
    out.forEach((s, k) => {
      if (size(s) > 1 && (i < 0 || size(s) > size(out[i]!))) i = k;
    });
    if (i >= 0) {
      const [first, ...rest] = parseSlot(out[i]!).beats;
      out.splice(i, 1, first!, rest.join("+"));
      continue;
    }
    const round = Math.max(...out.map((s) => parseSlot(s).round)) + 1;
    out.splice(out.length - 1, 0, ...method.cycle.map((b) => `${b}:${round}`));
  }
  while (n > 0 && out.length > n && out.length > 1) {
    let at = 1;
    for (let k = 1; k < out.length; k++) if (size(out[k - 1]!) + size(out[k]!) <= size(out[at - 1]!) + size(out[at]!)) at = k;
    const merged = [...parseSlot(out[at - 1]!).beats, ...parseSlot(out[at]!).beats].filter((b, k, all) => all.indexOf(b) === k);
    out.splice(at - 1, 2, merged.join("+"));
  }
  return out;
}

/**
 * Holds a written plan to the decision: the use case and method lines are the decision's, and every scene's beat is
 * its slot by position (the plan may not move, skip or rename beats). A scene without a beat line gets one. A plan
 * with more or fewer scenes than slots gets the slots fitted to its scenes (fitSlots), never a repeated beat.
 */
export function applyDecision(outline: string, decision: Decision): string {
  const count = outline.split("\n").filter((l) => /^\s*scene\s/.test(l)).length;
  const d = count && count !== decision.slots.length ? { ...decision, slots: fitSlots(decision.slots, count, decision.method) } : decision;
  const lines = outline.split("\n").filter((l) => !/^\s*#\s*(usecase|method|misconception):/i.test(l));
  const motion = lines.findIndex((l) => /^\s*motion\s/.test(l));
  const video = lines.findIndex((l) => /^\s*video\s/.test(l));
  lines.splice(motion >= 0 ? motion + 1 : video + 1, 0, `# usecase: ${d.usecase}`, `# method: ${d.method.name} · intent: ${d.intent} · why: ${d.why}`, ...(d.misconception ? [`# misconception: ${d.misconception}`] : []));
  const scenes = lines.map((l, i) => (/^\s*scene\s/.test(l) ? i : -1)).filter((i) => i >= 0);
  const out: string[] = [];
  let k = -1;
  lines.forEach((l, i) => {
    if (/^\s*scene\s/.test(l)) k++;
    const slot = d.slots[Math.min(k, d.slots.length - 1)];
    const label = slot ? slotLabel(slot) : "";
    const last = k === scenes.length - 1;
    if (k >= 0 && slot && /^\s*#\s*beat:/i.test(l)) {
      let beat = l.replace(/^(\s*#\s*beat:\s*)[^·]*/i, `$1${label} `).replace(/ +·/, " ·").trimEnd();
      // The method fixes how the video opens and ends: no question to the viewer in an opening that is not one, no recap at the end.
      const drop = [...(last ? ["recap"] : []), ...(k === 0 && !opensWithQuestion(d.method) ? ["question", "prediction"] : [])];
      if (drop.length) beat = beat.replace(/(·\s*devices?:\s*)([^·]*)/i, (_, p: string, v: string) => `${p}${v.split(/,\s*/).filter((x) => !drop.some((w) => new RegExp(`^${w}\\b`, "i").test(x.trim()))).join(", ")} `).replace(/·\s*devices?:\s*(?=·|$)/i, "").replace(/\s+·/g, " ·").trimEnd();
      out.push(beat);
      return;
    }
    out.push(l);
    // A scene whose comment lines carry no beat gets one after them.
    const end = scenes.find((s) => s > i) ?? lines.length;
    if (k >= 0 && slot && i === end - 1 && !lines.slice(scenes[k]!, end).some((x) => /^\s*#\s*beat:/i.test(x))) out.push(`# beat: ${label}`);
  });
  return out.join("\n");
}

/** How a scene writer carries out a device the plan put on its scene. */
const DEVICE_HOW: Partial<Record<Device, string>> = {
  prediction: "ask the viewer what will happen, in a sentence of its own, then write `wait 1.5` on its own line before the sentence that shows the answer",
  question: "one real question to the viewer that the next sentences answer",
  misconception: "say the plausible wrong idea as the viewer's own reasonable guess, let it fail on the example, then give the right one",
  analogy: "one everyday comparison, mapped onto the real parts, and say where it stops being true",
};

/** The beats of a planned scene (its slot), or none. */
const beatsOf = (s: TeachingPlan["scenes"][number] | undefined): string[] => (s ? (s.beats.length ? s.beats : s.beat ? [s.beat] : []) : []);
/** Whether a planned scene puts a question to the viewer. */
const asksViewer = (s: TeachingPlan["scenes"][number] | undefined): boolean => Boolean(s && (beatsOf(s).some((b) => b === "question" || b === "prediction") || s.devices.some((d) => d === "question" || d === "prediction")));

/**
 * What one scene's writer is told about the teaching plan: the method's voice, the scene's beats with their jobs and
 * pictures, how its first sentence carries on from the scene before, what it leaves for the next scene, and how to
 * carry out its devices. Empty when the plan names no known method or does not plan this scene.
 */
export function arcBrief(plan: TeachingPlan, sceneId: string): string {
  const m = plan.method;
  const i = plan.scenes.findIndex((s) => s.id === sceneId);
  if (!m || i < 0) return "";
  const s = plan.scenes[i]!;
  const beats = beatsOf(s);
  const next = plan.scenes[i + 1];
  const via = s.via ? findMethod(s.via) : undefined;
  const part = (b: string) => `${m.jobs[b] ?? ""}${m.pictures[b] ? ` Picture: ${m.pictures[b]}.` : ""}`.trim();
  const nextFirst = beatsOf(next)[0];
  const lines = [
    `YOUR PART IN THE TEACHING ARC (the video teaches by ${m.name}: ${m.beats.join(" → ")})`,
    `- Voice: ${TONES[m.tone]}.`,
    beats.length > 1
      ? `- This scene carries ${beats.length} beats, in this order:\n${beats.map((b) => `  - ${b}: ${part(b)}`).join("\n")}`
      : `- This scene's beat is ${beats[0] ?? "?"}${beats[0] && m.jobs[beats[0]] ? `: ${part(beats[0])}` : "."}`,
    ...((s.round ?? 1) > 1 ? [`- This is round ${s.round} of ${beats.join(" + ")}: ${m.round}.`] : []),
    ...(via ? [`- It borrows ${via.name} for that: ${via.when}.`] : []),
    i === 0
      ? `- It opens the video: start with ${m.opens}.${OPENS_WITH_QUESTION.has(m.name) ? "" : " Do not open with a question to the viewer."}`
      : `- Its first sentence carries on from the scene before${s.link ? ` (the idea to pick up, not words to say: ${s.link})` : ""}. Never restart cold with a definition, and never mention scenes, beats or the plan.`,
    ...(i > 0 ? ["- Names and numbers already said in earlier scenes are fixed: where the plan says otherwise, keep what was said."] : []),
    ...(i > 0 && asksViewer(plan.scenes[i - 1]) ? ["- The scene before already put its question to the viewer: do not ask it again; any question here is a new one."] : []),
    next
      ? `- Leave the next scene its part (${nextFirst ?? "what comes next"}${nextFirst && m.jobs[nextFirst] ? `: ${m.jobs[nextFirst]!.charAt(0).toLowerCase()}${m.jobs[nextFirst]!.slice(1)}` : ""}); do not do it here.`
      : `- It is the last scene: end with ${m.ends}. No recap of earlier scenes and no list of points to remember.`,
    ...(plan.misconception && (beats.includes("prediction") || s.devices.some((d) => d === "misconception" || d === "prediction")) ? [`- The wrong idea to bring out: ${plan.misconception}`] : []),
    ...s.devices.filter((d): d is Device => d in DEVICES).map((d) => `- ${d}: ${DEVICE_HOW[d] ?? DEVICES[d]}.`),
  ];
  return lines.join("\n");
}

/** What the plan says about teaching: the method, and per scene its beats, a borrowed method, devices and link. */
export interface TeachingPlan {
  method?: Method;
  /** As written, when it names no known method. */
  methodName?: string;
  intent?: string;
  why?: string;
  misconception?: string;
  scenes: { id: string; beat?: string; beats: string[]; round?: number; via?: string; devices: string[]; link?: string }[];
  problems: string[];
}

const sceneId = (line: string) => /^\s*scene\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line)?.[1];

/**
 * Reads the teaching lines of a plan (`# method: … · why: …` once, `# beat: … · via: … · device: … · link: …` under
 * each scene) and checks them against the method and the audience level. Problems read like diagnostics.
 */
export function teachingOf(outline: string, level: Level = DEFAULT_LEVEL, sceneRange?: { min: number; max: number }): TeachingPlan {
  const lines = outline.split("\n");
  const methodLine = lines.find((l) => /^\s*#\s*method:/i.test(l));
  const parts = methodLine ? methodLine.replace(/^\s*#\s*method:\s*/i, "").split("·").map((s) => s.trim()) : [];
  const methodName = parts[0]?.split(/\s/)[0]?.toLowerCase();
  const method = findMethod(methodName);
  const why = parts.find((p) => /^why:/i.test(p))?.replace(/^why:\s*/i, "");
  const intent = parts.find((p) => /^intent:/i.test(p))?.replace(/^intent:\s*/i, "");
  const mis = lines.map((l) => /^\s*#\s*misconception:\s*(.+)$/i.exec(l)?.[1]?.trim()).find(Boolean);
  const scenes: TeachingPlan["scenes"] = [];
  for (const l of lines) {
    const id = sceneId(l);
    if (id) {
      scenes.push({ id, beats: [], devices: [] });
      continue;
    }
    const beat = /^\s*#\s*beat:\s*(.+)$/i.exec(l)?.[1];
    if (!beat || !scenes.length) continue;
    const s = scenes[scenes.length - 1]!;
    const fields = beat.split("·").map((x) => x.trim());
    const slot = parseSlot(fields[0] ?? "");
    s.beats = slot.beats;
    s.beat = slot.beats[0];
    if (slot.round > 1) s.round = slot.round;
    for (const f of fields.slice(1)) {
      const m = /^(via|device|devices|link):\s*(.*)$/i.exec(f);
      if (!m) continue;
      const key = m[1]!.toLowerCase();
      // "none", "-" or "n/a" say there is nothing there.
      const value = NOTHING.test(m[2]!.trim()) ? "" : m[2]!.trim();
      if (key === "via") {
        if (value) s.via = value.split(/\s/)[0]!.toLowerCase();
      } else if (key === "link") {
        if (value) s.link = value;
      } else {
        // "prediction, which node is closest?": a device name, then words the planner added about it. A part of one
        // word is a device (known or not); a longer part that starts with a device keeps it; any other text is a note.
        s.devices = value
          .split(/[,;]/)
          .map((part) => part.trim().toLowerCase())
          .flatMap((part) => {
            const words = part.split(/\s+/).filter(Boolean);
            if (words.length === 1) return NOTHING.test(words[0]!) ? [] : [words[0]!];
            return words[0] && words[0] in DEVICES ? [words[0]] : [];
          });
      }
    }
  }

  // A scene "borrowing" the main method borrows nothing.
  for (const s of scenes) if (method && s.via === method.name) delete s.via;
  const problems: string[] = [];
  if (!methodLine) problems.push("no # method: line");
  else if (!method) problems.push(`unknown method \`${methodName ?? ""}\` (methods: ${METHODS.map((m) => m.name).join(", ")})`);
  if (method?.avoid?.includes(level)) problems.push(`method \`${method.name}\` does not suit the ${level} audience`);
  const missing = scenes.filter((s) => !s.beats.length).map((s) => s.id);
  if (missing.length) problems.push(`no # beat: line under ${missing.join(", ")}`);
  if (method) {
    for (const s of scenes) {
      for (const b of s.beats) {
        if (method.beats.includes(b)) continue;
        // A beat of the borrowed method put where the main method's beat belongs.
        const owner = METHODS.find((m) => m !== method && m.beats.includes(b));
        problems.push(`scene ${s.id}: beat \`${b}\` is not a beat of ${method.name} (${method.beats.join(", ")})${owner ? `; it is ${owner.name}'s: keep a ${method.name} beat and write · via: ${owner.name}` : ""}`);
      }
      if ((s.round ?? 1) > 1 && s.beats.some((b) => !method.cycle.includes(b))) problems.push(`scene ${s.id}: a later round of ${s.beats.join(" + ")}, but ${method.name} repeats only ${method.cycle.join(" → ")}`);
    }
    // The first rounds keep the method's order; later rounds go back into its cycle.
    const known = scenes.filter((s) => (s.round ?? 1) === 1).flatMap((s) => s.beats.map((b) => method.beats.indexOf(b))).filter((k) => k >= 0);
    if (known.some((k, i) => i > 0 && k < known[i - 1]!)) problems.push(`beats are out of order (${method.name}: ${method.beats.join(" → ")})`);
    const first = method.beats[0]!;
    const end = method.beats[method.beats.length - 1]!;
    if (scenes[0]?.beats.length && !scenes[0].beats.includes(first)) problems.push(`the first scene's beat is \`${scenes[0].beats.join(" + ")}\`; ${method.name} opens with \`${first}\``);
    const last = scenes[scenes.length - 1];
    if (last?.beats.length && !last.beats.includes(end)) problems.push(`the last scene's beat is \`${last.beats.join(" + ")}\`; ${method.name} ends with \`${end}\``);
    const used = new Set(scenes.flatMap((s) => s.beats));
    const lost = method.core.filter((b) => !used.has(b));
    if (lost.length && scenes.some((s) => s.beats.length)) problems.push(`${method.name} is not taught without ${lost.join(" and ")}: no scene has it`);
    const asks = scenes[0]?.devices.filter((d) => d === "prediction" || d === "question") ?? [];
    if (!OPENS_WITH_QUESTION.has(method.name) && asks.length) problems.push(`the first scene opens with a ${asks.join(" and a ")}, but ${method.name} opens with ${method.opens}`);
  }
  if (sceneRange && (scenes.length < sceneRange.min || scenes.length > sceneRange.max)) problems.push(`${scenes.length} scenes; the plan asked for ${sceneRange.min}–${sceneRange.max}`);
  for (const s of scenes) {
    if (s.via && !findMethod(s.via)) problems.push(`scene ${s.id}: via \`${s.via}\` is not a method`);
    const bad = s.devices.filter((d) => !(d in DEVICES));
    if (bad.length) problems.push(`scene ${s.id}: unknown device ${bad.join(", ")} (devices: ${Object.keys(DEVICES).join(", ")})`);
  }
  scenes.slice(1).forEach((s) => {
    if (!s.link) problems.push(`scene ${s.id}: no link: saying how it follows from the scene before`);
  });
  if (scenes.at(-1)?.devices.includes("recap")) problems.push("the last scene is a recap; end the way the method ends");
  return { ...(method && { method }), ...(methodName && !method && { methodName }), ...(intent && { intent }), ...(why && { why }), ...(mis && !NOTHING.test(mis) && { misconception: mis }), scenes, problems };
}
