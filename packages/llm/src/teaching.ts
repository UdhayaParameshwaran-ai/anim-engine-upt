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
    depth: "technical: the mechanism, its trade-offs and where it fails in practice",
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
  /** What a scene with each beat does in its narration, as the scene writer is told. */
  jobs: Readonly<Record<string, string>>;
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
      "familiar": "Start from something the viewer already understands, named plainly; the topic's own terms come later.",
      "simple": "Explain the idea in the simplest true words, on the picture.",
      "gap": "Show, on a concrete case, what the simple version leaves out or gets wrong.",
      "refine": "Give the precise version that closes that gap, in the real terms."
    },
    opens: "a familiar starting point the viewer already understands",
    ends: "the refined, precise version of the idea",
    tone: "conversational",
  },
  {
    name: "socratic",
    when: "reasoning, or a topic where people hold a common wrong idea that a question can expose",
    beats: ["question", "prediction", "evidence", "follow-up", "conclusion"],
    jobs: {
      "question": "Put one concrete question to the viewer and leave it open: no answer, no definition.",
      "prediction": "Say the guess most people make and why it seems right, so the viewer commits to it.",
      "evidence": "Show what really happens on the example, step by step, so the guess can be checked against it.",
      "follow-up": "Ask the next question the evidence raises, and answer it.",
      "conclusion": "Give the answer the questions led to, and tie it back to the opening question."
    },
    opens: "a question to the viewer, with time to guess",
    ends: "the conclusion the questions led to",
    tone: "curious",
  },
  {
    name: "worked-example",
    when: "a procedure, algorithm or calculation shown step by step on real values",
    beats: ["problem", "steps", "reasoning", "result", "apply"],
    jobs: {
      "problem": "State the concrete problem with its real values; no definition and no rule yet.",
      "steps": "Solve it on the real values, one step per sentence, saying the values aloud.",
      "reasoning": "Say why the key step is the right move: the rule behind what the viewer just watched.",
      "result": "Show the finished result and check it.",
      "apply": "Give a new small case, ask the viewer to apply the same steps, then give the answer. Do not restate the procedure."
    },
    opens: "the concrete problem to solve",
    ends: "a new case the viewer can now solve the same way",
    tone: "authoritative",
  },
  {
    name: "contrastive",
    when: "two or more things set against each other (A vs B, which to choose)",
    beats: ["common-ground", "dimensions", "difference", "when-to-use"],
    jobs: {
      "common-ground": "Say what the options share and the job they both do.",
      "dimensions": "Put the options on the same axes, one axis at a time, on the same case.",
      "difference": "Show the one difference that matters most, on that case.",
      "when-to-use": "Say when to choose each, as a rule the viewer can apply to their own case."
    },
    opens: "what the options share",
    ends: "when to use each",
    tone: "analytical",
  },
  {
    name: "causal",
    when: "one event leads to another: what happens when, how a system or protocol behaves",
    beats: ["condition", "trigger", "mechanism", "consequence"],
    jobs: {
      "condition": "Set up the starting situation, as it is before anything happens.",
      "trigger": "Show the event that starts the chain.",
      "mechanism": "Follow the chain: each step causes the next (so, which means, that is why).",
      "consequence": "Show where the chain leads and what that means for the viewer."
    },
    opens: "the starting situation",
    ends: "the consequence and what it means",
    tone: "conversational",
  },
  {
    name: "problem-based",
    when: "a real problem the viewer meets, with the concepts introduced as the tools that solve it",
    beats: ["problem", "constraints", "investigation", "concepts", "solution"],
    jobs: {
      "problem": "Show the problem the way the viewer meets it: the real symptom, not the textbook name.",
      "constraints": "Say what makes it hard: what any fix has to respect.",
      "investigation": "Try the obvious fix or follow the evidence, and show where it fails.",
      "concepts": "Bring in the concept as the tool that fixes exactly that failure.",
      "solution": "Show the solution working on the original problem, and why it works."
    },
    opens: "the problem as the viewer would meet it",
    ends: "the solution, and why it works",
    tone: "investigative",
  },
  {
    name: "discovery",
    when: "an outcome that can be watched before it is explained, an intuitive or surprising behaviour",
    beats: ["observation", "prediction", "experiment", "discovery", "formal"],
    jobs: {
      "observation": "Show something to watch before any explanation.",
      "prediction": "Ask the viewer what will happen next and give them a moment to guess.",
      "experiment": "Run it and show what really happens.",
      "discovery": "Point out the pattern in what happened.",
      "formal": "Name the rule and state it precisely."
    },
    opens: "something to observe, then a prediction to make",
    ends: "the formal rule behind what was observed",
    tone: "curious",
    avoid: ["practitioner"],
  },
  {
    name: "analogical",
    when: "an abstract idea for viewers new to the field, where an everyday thing has the same shape",
    beats: ["familiar", "mapping", "new-concept", "limits"],
    jobs: {
      "familiar": "Start inside the everyday thing and make its rule clear.",
      "mapping": "Carry each part of the everyday thing over to the real one, part by part.",
      "new-concept": "Explain the real thing in its own terms, leaning on the mapping.",
      "limits": "Say plainly where the comparison stops being true."
    },
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

/** The teaching decision a plan is written to: the use case, the method and why, and the beat of every scene. */
export interface Decision {
  usecase: string;
  method: Method;
  why: string;
  /** One beat per scene, in order. */
  slots: string[];
}

/**
 * The method's beats spread over a scene count within `range`: one scene per beat when the range allows it, extra
 * scenes going to the middle beats in turn (a long video runs its mechanism over several scenes), never fewer beats
 * than the first and the last.
 */
export function skeleton(method: Method, range: { min: number; max: number }): string[] {
  const beats = [...method.beats];
  const n = Math.max(2, Math.min(Math.max(beats.length, range.min), range.max));
  const counts = beats.map(() => 1);
  const middle = beats.map((_, i) => i).slice(1, -1);
  for (let extra = n - beats.length, k = 0; extra > 0 && middle.length; extra--, k++) counts[middle[k % middle.length]!]!++;
  const slots = beats.flatMap((b, i) => Array<string>(counts[i]!).fill(b));
  // Fewer scenes than beats: keep the first and the last beat, drop from the middle.
  while (slots.length > n) slots.splice(Math.floor(slots.length / 2), 1);
  return slots;
}

/**
 * The decision call's reply (`# usecase: …` and `# method: … · why: …`), checked: an unknown use case falls back to
 * `fallback`, an unknown method or one that does not suit the level to the use case's usual method.
 */
export function parseDecision(reply: string, level: Level, range: { min: number; max: number }, usecases: readonly { name: string; method: string; byLevel?: Partial<Record<Level, string>> }[], fallback?: string): Decision | undefined {
  const named = /^\s*#\s*usecase:\s*([a-z-]+)/im.exec(reply)?.[1]?.toLowerCase();
  const uc = usecases.find((u) => u.name === named) ?? usecases.find((u) => u.name === fallback);
  if (!uc) return undefined;
  const usual = findMethod(uc.byLevel?.[level] ?? uc.method)!;
  const m = /^\s*#\s*method:\s*([a-z-]+)\s*(?:·\s*why:\s*(.+))?$/im.exec(reply);
  let method = findMethod(m?.[1]) ?? usual;
  if (method.avoid?.includes(level)) method = usual;
  const why = method === usual ? (m?.[2]?.trim() || "the usual method for this kind of video and audience") : m?.[2]?.trim() || `chosen over ${usual.name}`;
  return { usecase: uc.name, method, why, slots: skeleton(method, range) };
}

/**
 * Holds a written plan to its decision: the use case and method lines are the decided ones, every scene's beat is
 * the one its place in the skeleton gives it (the planner's via, devices and link stay), a scene without a beat line
 * gets one, and the last scene is never a recap (its ending is the method's).
 */
export function applyDecision(outline: string, d: Decision): string {
  const lines = outline.split("\n").filter((l) => !/^\s*#\s*(usecase|method):/i.test(l));
  const motion = lines.findIndex((l) => /^\s*motion\s/.test(l));
  const video = lines.findIndex((l) => /^\s*video\s/.test(l));
  lines.splice(motion >= 0 ? motion + 1 : video + 1, 0, `# usecase: ${d.usecase}`, `# method: ${d.method.name} · why: ${d.why}`);
  const scenes = lines.map((l, i) => (/^\s*scene\s/.test(l) ? i : -1)).filter((i) => i >= 0);
  const out: string[] = [];
  let k = -1;
  lines.forEach((l, i) => {
    if (/^\s*scene\s/.test(l)) k++;
    const slot = d.slots[Math.min(k, d.slots.length - 1)];
    const last = k === scenes.length - 1;
    if (k >= 0 && slot && /^\s*#\s*beat:/i.test(l)) {
      let beat = l.replace(/^(\s*#\s*beat:\s*)[^·]*/i, `$1${slot} `).replace(/ +·/, " ·").trimEnd();
      // The method fixes how the video opens and ends: no question to the viewer in an opening that is not one, no recap at the end.
      const drop = [...(last ? ["recap"] : []), ...(k === 0 && !opensWithQuestion(d.method) ? ["question", "prediction"] : [])];
      if (drop.length) beat = beat.replace(/(·\s*devices?:\s*)([^·]*)/i, (_, p: string, v: string) => `${p}${v.split(/,\s*/).filter((x) => !drop.some((w) => new RegExp(`^${w}\\b`, "i").test(x.trim()))).join(", ")} `).replace(/·\s*devices?:\s*(?=·|$)/i, "").replace(/\s+·/g, " ·").trimEnd();
      out.push(beat);
      return;
    }
    out.push(l);
    // A scene whose comment lines carry no beat gets one after them.
    const end = scenes.find((s) => s > i) ?? lines.length;
    if (k >= 0 && slot && i === end - 1 && !lines.slice(scenes[k]!, end).some((x) => /^\s*#\s*beat:/i.test(x))) out.push(`# beat: ${slot}`);
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

/**
 * What one scene's writer is told about the teaching plan: the method's voice, this scene's beat and its job, how
 * its first sentence joins the scene before, what it leaves for the next scene, and how to carry out its devices.
 * Empty when the plan names no known method or does not plan this scene.
 */
export function arcBrief(plan: TeachingPlan, sceneId: string): string {
  const m = plan.method;
  const i = plan.scenes.findIndex((s) => s.id === sceneId);
  if (!m || i < 0) return "";
  const s = plan.scenes[i]!;
  const next = plan.scenes[i + 1];
  const via = s.via ? findMethod(s.via) : undefined;
  const job = s.beat ? m.jobs[s.beat] : undefined;
  const lines = [
    `YOUR PART IN THE TEACHING ARC (the video teaches by ${m.name}: ${m.beats.join(" → ")})`,
    `- Voice: ${TONES[m.tone]}.`,
    `- This scene's beat is ${s.beat ?? "?"}${job ? `: ${job}` : "."}${via ? ` It borrows ${via.name} for that: ${via.when}.` : ""}`,
    i === 0
      ? `- It opens the video: start with ${m.opens}.${OPENS_WITH_QUESTION.has(m.name) ? "" : " Do not open with a question to the viewer."}`
      : `- Its first sentence picks up where the scene before left off${s.link ? `: ${s.link}` : ""}. Never restart cold with a definition.`,
    next
      ? `- Leave the next scene its part (${next.beat ?? "what comes next"}${next.beat && m.jobs[next.beat] ? `: ${m.jobs[next.beat]!.charAt(0).toLowerCase()}${m.jobs[next.beat]!.slice(1)}` : ""}); do not do it here.`
      : `- It is the last scene: end with ${m.ends}. No recap of earlier scenes and no list of points to remember.`,
    ...s.devices.filter((d): d is Device => d in DEVICES).map((d) => `- ${d}: ${DEVICE_HOW[d] ?? DEVICES[d]}.`),
  ];
  return lines.join("\n");
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
