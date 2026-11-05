import { findGridLayout, resolveTemplate } from "@anim/registry";
import type { QualityIssue } from "./quality.js";

/**
 * What the plan says about one scene. The outline is the one place where
 * the story is decided: what each scene says (narration), what it shows
 * (items) and so how long it runs. Scene calls only turn a brief into
 * Narrascript, so they can run in parallel without knowing about each other.
 */
export interface SceneBrief {
  id: string;
  /** The scene line as planned. */
  line: string;
  template?: string;
  grid?: string;
  shape?: string;
  goal?: string;
  /** What the scene shows, in order (`# items: a | b | c`). */
  items: string[];
  /** What the narrator says, one sentence per entry (`> …` lines). */
  narration: string[];
  /** How the scene hands over to the next one (`# next: …`). */
  next?: string;
}

/** Sentences per scene the plan may give (the scene rules ask for 2–6). */
export const NARRATION_LINES = { min: 1, max: 6 } as const;
/** Words per narration sentence. */
export const SENTENCE_WORDS = 25;

/** Reads the scene briefs out of an outline. */
export function parseBriefs(outline: string): SceneBrief[] {
  const briefs: SceneBrief[] = [];
  for (const raw of outline.split("\n")) {
    const l = raw.trim();
    const scene = /^scene\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(l);
    if (scene) {
      briefs.push({
        id: scene[1]!,
        line: l,
        ...optional("template", /\btemplate=(\S+)/.exec(l)?.[1]),
        ...optional("grid", /\bgrid=(\S+)/.exec(l)?.[1]),
        items: [],
        narration: [],
      });
      continue;
    }
    const b = briefs.at(-1);
    if (!b) continue;
    const shape = /^#\s*shape:\s*([a-z-]+)\s*(?:·\s*)?(?:goal:\s*(.*))?$/i.exec(l);
    if (shape) {
      b.shape = shape[1]!.toLowerCase();
      if (shape[2]?.trim()) b.goal = shape[2].trim();
      continue;
    }
    const items = /^#\s*items?:\s*(.*)$/i.exec(l);
    if (items) {
      b.items = items[1]!.split(/\s*[|;]\s*/).map((s) => s.trim()).filter(Boolean);
      continue;
    }
    const next = /^#\s*next:\s*(.*)$/i.exec(l);
    if (next) {
      b.next = next[1]!.trim();
      continue;
    }
    if (l.startsWith(">")) {
      const text = plainNarration(l.slice(1));
      if (text) b.narration.push(text);
    }
  }
  return briefs;
}

/**
 * Problems with a plan that are cheaper to fix in the plan than in N scene
 * calls: missing or overlong narration, item counts the template can't hold,
 * the same thing shown or said in two scenes, and a title scene after the
 * first. Each problem is one line, ready for a replan prompt.
 */
export function checkPlan(briefs: SceneBrief[], scenes: { min: number; max: number }): string[] {
  const problems: string[] = [];
  if (briefs.length < scenes.min || briefs.length > scenes.max) problems.push(`plan ${scenes.min}–${scenes.max} scenes, not ${briefs.length}`);

  briefs.forEach((b, i) => {
    const n = b.narration.length;
    if (!n) problems.push(`scene ${b.id}: no narration; write its ${NARRATION_LINES.min + 1}–5 sentences as "> " lines under it`);
    else if (n > NARRATION_LINES.max) problems.push(`scene ${b.id}: ${n} narration sentences; keep at most ${NARRATION_LINES.max} (move the rest to another scene or cut them)`);
    for (const s of b.narration) {
      const words = wordsOf(s).length;
      if (words > SENTENCE_WORDS) problems.push(`scene ${b.id}: "${s.slice(0, 50)}…" has ${words} words; split it (at most ${SENTENCE_WORDS})`);
    }
    if (b.grid) {
      // A grid page holds one content element per slot (its title and footer are extra).
      const layout = findGridLayout(b.grid);
      if (layout && b.items.length > layout.slots.length)
        problems.push(`scene ${b.id}: ${b.items.length} items, but grid=${layout.code} has ${layout.slots.length} slot(s); pick a layout with more slots or show fewer things`);
      return;
    }
    const tpl = b.template ? resolveTemplate(b.template) : undefined;
    if (!tpl) return;
    if (tpl.name === "title") {
      if (i > 0) problems.push(`scene ${b.id}: template=title is only for the first scene; give it the template of its shape`);
      else if (tpl.items && b.items.length > tpl.items.max + tpl.slots.length)
        problems.push(`scene ${b.id}: ${b.items.length} items, but template=title holds at most ${tpl.items.max} besides its title`);
      return;
    }
    if (!b.items.length) {
      problems.push(`scene ${b.id}: no "# items:" line; list what it shows`);
      return;
    }
    // Slot fills (a hub's centre, a converge's result) are among the planned items.
    const slots = tpl.slots.filter((s) => s.name !== "title").length;
    const most = tpl.items ? tpl.items.max + slots : tpl.graph ? tpl.graph.maxNodes : slots;
    const least = tpl.items ? tpl.items.min + tpl.slots.filter((s) => s.required && s.name !== "title").length : slots;
    if (b.items.length > most) problems.push(`scene ${b.id}: ${b.items.length} items, but template=${tpl.name} holds at most ${most}; drop some or split the scene`);
    else if (b.items.length < least) problems.push(`scene ${b.id}: ${b.items.length} item(s), but template=${tpl.name} needs at least ${least}`);
  });

  // The same thing in two scenes: the video says it twice. The opening may preview
  // what is coming and the last scene may recall it; the scenes between show each thing once.
  const shownIn = new Map<string, string>();
  briefs.forEach((b, i) => {
    if (briefs.length > 2 && (i === 0 || i === briefs.length - 1)) return;
    for (const item of b.items) {
      const key = itemKey(item);
      if (!key) continue;
      const earlier = shownIn.get(key);
      if (earlier && earlier !== b.id) problems.push(`"${item}" is shown in both ${earlier} and ${b.id}; show it once`);
      else shownIn.set(key, b.id);
    }
  });
  const saidIn = new Map<string, string>();
  for (const b of briefs) {
    for (const s of b.narration) {
      const key = wordsOf(s).join(" ");
      const earlier = saidIn.get(key);
      if (earlier) problems.push(`"${s.slice(0, 50)}" is said in both ${earlier} and ${b.id}`);
      else saidIn.set(key, b.id);
    }
  }
  return problems;
}

/**
 * Whether a written scene says what the plan says (cue markers and
 * punctuation aside). Small edits are fine; a rewritten, dropped or added
 * sentence is a quality issue, so the improvement pass asks for the plan's words.
 */
export function narrationDrift(brief: SceneBrief | undefined, sceneText: string): QualityIssue | undefined {
  if (!brief?.narration.length) return undefined;
  const planned = brief.narration.flatMap(wordsOf);
  const spoken = sceneText
    .split("\n")
    .filter((l) => l.trimStart().startsWith(">"))
    .flatMap((l) => wordsOf(plainNarration(l.trimStart().slice(1))));
  const kept = lcs(planned, spoken) / Math.max(planned.length, spoken.length, 1);
  if (kept >= 0.9) return undefined;
  return {
    code: "Q4",
    message: `the narration differs from the plan (${Math.round(kept * 100)}% of its words kept); speak the planned sentences word for word, in order, one "> " line each, and only add {n} cues:\n${brief.narration.map((s) => `> ${s}`).join("\n")}`,
  };
}

/** Narration text without cue markers: `{1}word` → `word`, `{2 some words}` → `some words`. */
export function plainNarration(text: string): string {
  return text.replace(/\{\w+\s?/g, "").replace(/\}/g, "").replace(/\s+/g, " ").trim();
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

/** An item label reduced to what makes it the same thing: case, articles and plurals aside. */
function itemKey(item: string): string {
  return wordsOf(item.replace(/\(.*?\)/g, ""))
    .filter((w) => !["a", "an", "the", "of"].includes(w))
    .map((w) => (w.length > 3 ? w.replace(/(ies)$/, "y").replace(/(?<!s)s$/, "") : w))
    .join(" ");
}

/** Length of the longest common subsequence of two word lists. */
function lcs(a: string[], b: string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    const row = [0];
    for (let j = 0; j < b.length; j++) row.push(x === b[j] ? prev[j]! + 1 : Math.max(prev[j + 1]!, row[j]!));
    prev = row;
  }
  return prev[b.length]!;
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}
