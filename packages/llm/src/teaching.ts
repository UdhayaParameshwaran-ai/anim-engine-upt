/**
 * How a video teaches: the teaching methods the planner chooses from, the audience levels a person picks, the tones
 * and the rhetorical devices. The use case (usecases.ts) decides the pictures; the method decides the order of the
 * ideas and how the words go. The audience level is an input, never a planner decision.
 *
 * Source: the team's "Narration Arc" research (methods, audience profiles, vocabulary levels, tone and devices),
 * with the misconception and prediction findings from Muller (2008) and the prequestion meta-analysis (2024).
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
  /** Methods this audience often needs, which the plan may take instead of the use case's default (with a why). */
  methods: readonly string[];
}

export const AUDIENCES: Record<Level, AudienceCard> = {
  new: {
    level: "new",
    who: "new to the field: has never worked with this topic or its neighbours",
    vocabulary: "accessible: everyday words first; a technical term only after the viewer has seen the thing it names, defined in that sentence, then used the same way every time",
    sentences: "short, one idea at a time",
    depth: "intuitive: what it does and why, every step shown, one familiar comparison welcome",
    methods: ["analogical", "feynman", "discovery"],
  },
  familiar: {
    level: "familiar",
    who: "knows the basics of the field (a student or a junior developer), new to this topic",
    vocabulary: "intermediate: the field's ordinary terms without definitions; this topic's own terms defined where they first appear",
    sentences: "short to moderate",
    depth: "conceptual: how it works and why it is built that way, with one real example",
    methods: [],
  },
  practitioner: {
    level: "practitioner",
    who: "works with this field daily and meets this topic at work",
    vocabulary: "advanced: precise technical names, commands and numbers; no everyday comparisons",
    sentences: "direct and precise",
    depth: "technical: the mechanism, its trade-offs and where it fails in practice",
    methods: ["problem-based", "worked-example", "contrastive"],
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

/** One teaching method (Narration Arc section 3), with its beats in order. */
export interface Method {
  name: string;
  /** When the planner should choose it. */
  when: string;
  /** The beats of the arc, in order; every scene of the video carries one of them. */
  beats: readonly string[];
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
    opens: "a familiar starting point the viewer already understands",
    ends: "the refined, precise version of the idea",
    tone: "conversational",
  },
  {
    name: "socratic",
    when: "reasoning, or a topic where people hold a common wrong idea that a question can expose",
    beats: ["question", "prediction", "evidence", "follow-up", "conclusion"],
    opens: "a question to the viewer, with time to guess",
    ends: "the conclusion the questions led to",
    tone: "curious",
  },
  {
    name: "worked-example",
    when: "a procedure, algorithm or calculation shown step by step on real values",
    beats: ["problem", "steps", "reasoning", "result", "apply"],
    opens: "the concrete problem to solve",
    ends: "a new case the viewer can now solve the same way",
    tone: "authoritative",
  },
  {
    name: "contrastive",
    when: "two or more things set against each other (A vs B, which to choose)",
    beats: ["common-ground", "dimensions", "difference", "when-to-use"],
    opens: "what the options share",
    ends: "when to use each",
    tone: "analytical",
  },
  {
    name: "causal",
    when: "one event leads to another: what happens when, how a system or protocol behaves",
    beats: ["condition", "trigger", "mechanism", "consequence"],
    opens: "the starting situation",
    ends: "the consequence and what it means",
    tone: "conversational",
  },
  {
    name: "problem-based",
    when: "a real problem the viewer meets, with the concepts introduced as the tools that solve it",
    beats: ["problem", "constraints", "investigation", "concepts", "solution"],
    opens: "the problem as the viewer would meet it",
    ends: "the solution, and why it works",
    tone: "investigative",
  },
  {
    name: "discovery",
    when: "an outcome that can be watched before it is explained, an intuitive or surprising behaviour",
    beats: ["observation", "prediction", "experiment", "discovery", "formal"],
    opens: "something to observe, then a prediction to make",
    ends: "the formal rule behind what was observed",
    tone: "curious",
    avoid: ["practitioner"],
  },
  {
    name: "analogical",
    when: "an abstract idea for viewers new to the field, where an everyday thing has the same shape",
    beats: ["familiar", "mapping", "new-concept", "limits"],
    opens: "the familiar everyday thing",
    ends: "where the comparison stops being true",
    tone: "conversational",
    avoid: ["practitioner"],
  },
];

export const findMethod = (name: string | undefined): Method | undefined => METHODS.find((m) => m.name === (name ?? "").trim().toLowerCase());

/** Methods that open by putting a question to the viewer; the others open with a problem, a situation or something familiar. */
const OPENS_WITH_QUESTION = new Set(["socratic", "discovery"]);

/** The planner's menu of methods, for the level the person chose. */
export function methodCatalogue(level: Level = DEFAULT_LEVEL): string {
  return METHODS.filter((m) => !m.avoid?.includes(level))
    .map((m) => `  ${m.name.padEnd(15)} ${m.when}\n${" ".repeat(18)}beats: ${m.beats.join(" → ")} · opens: ${m.opens} · ends: ${m.ends}`)
    .join("\n");
}

/** The audience card as the prompts state it. */
export function audienceLine(level: Level = DEFAULT_LEVEL): string {
  const a = AUDIENCES[level];
  return `AUDIENCE LEVEL: ${level} (${a.who})\n- Vocabulary: ${a.vocabulary}.\n- Sentences: ${a.sentences}.\n- Depth: ${a.depth}.${a.methods.length ? `\n- Methods this audience often needs: ${a.methods.join(", ")}.` : ""}`;
}

export function deviceList(): string {
  return Object.entries(DEVICES).map(([k, v]) => `  ${k.padEnd(14)} ${v}`).join("\n");
}

/** What the plan says about teaching: the method, and per scene its beat, a borrowed method, devices and link. */
export interface TeachingPlan {
  method?: Method;
  /** As written, when it names no known method. */
  methodName?: string;
  why?: string;
  scenes: { id: string; beat?: string; via?: string; devices: string[]; link?: string }[];
  problems: string[];
}

const sceneId = (line: string) => /^\s*scene\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line)?.[1];
const NOTHING = /^(none|-|n\/a|no)$/i;

/**
 * Reads the teaching lines of a plan (`# method: … · why: …` once, `# beat: … · via: … · device: … · link: …` under
 * each scene) and checks them against the method and the audience level. Problems read like diagnostics.
 */
export function teachingOf(outline: string, level: Level = DEFAULT_LEVEL, defaultMethod?: string, sceneRange?: { min: number; max: number }): TeachingPlan {
  const lines = outline.split("\n");
  const methodLine = lines.find((l) => /^\s*#\s*method:/i.test(l));
  const parts = methodLine ? methodLine.replace(/^\s*#\s*method:\s*/i, "").split("·").map((s) => s.trim()) : [];
  const methodName = parts[0]?.split(/\s/)[0]?.toLowerCase();
  const method = findMethod(methodName);
  const why = parts.find((p) => /^why:/i.test(p))?.replace(/^why:\s*/i, "");
  const scenes: TeachingPlan["scenes"] = [];
  for (const l of lines) {
    const id = sceneId(l);
    if (id) {
      scenes.push({ id, devices: [] });
      continue;
    }
    const beat = /^\s*#\s*beat:\s*(.+)$/i.exec(l)?.[1];
    if (!beat || !scenes.length) continue;
    const s = scenes[scenes.length - 1]!;
    const fields = beat.split("·").map((x) => x.trim());
    s.beat = fields[0]?.split(/\s/)[0]?.toLowerCase();
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
  if (method && defaultMethod && method.name !== defaultMethod && !why) problems.push(`method \`${method.name}\` replaces the use case's default \`${defaultMethod}\` without a why:`);
  const missing = scenes.filter((s) => !s.beat).map((s) => s.id);
  if (missing.length) problems.push(`no # beat: line under ${missing.join(", ")}`);
  if (method) {
    const at = scenes.map((s) => (s.beat ? method.beats.indexOf(s.beat) : -2));
    scenes.forEach((s, i) => {
      if (!s.beat || at[i] !== -1) return;
      // A beat of the borrowed method put where the main method's beat belongs.
      const owner = METHODS.find((m) => m !== method && m.beats.includes(s.beat!));
      problems.push(`scene ${s.id}: beat \`${s.beat}\` is not a beat of ${method.name} (${method.beats.join(", ")})${owner ? `; it is ${owner.name}'s: keep a ${method.name} beat and write · via: ${owner.name}` : ""}`);
    });
    const known = at.filter((k) => k >= 0);
    if (known.some((k, i) => i > 0 && k < known[i - 1]!)) problems.push(`beats are out of order (${method.name}: ${method.beats.join(" → ")})`);
    if (scenes[0]?.beat && at[0] !== 0) problems.push(`the first scene's beat is \`${scenes[0].beat}\`; ${method.name} opens with \`${method.beats[0]}\``);
    const last = scenes[scenes.length - 1];
    if (last?.beat && at[at.length - 1] !== method.beats.length - 1) problems.push(`the last scene's beat is \`${last.beat}\`; ${method.name} ends with \`${method.beats[method.beats.length - 1]}\``);
    const used = new Set(known);
    const skipped = method.beats.filter((_, k) => !used.has(k));
    if (skipped.length > 1) problems.push(`beats ${skipped.join(", ")} of ${method.name} have no scene`);
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
  return { ...(method && { method }), ...(methodName && !method && { methodName }), ...(why && { why }), scenes, problems };
}
