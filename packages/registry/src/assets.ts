import type { AssetManifest } from "./index.js";

/**
 * Seed entries of the semantic SVG library. Manifests only for now; the SVG
 * files land with the engine. Names are meanings, not file names.
 */
export const SEED_ASSETS: readonly AssetManifest[] = [
  icon("sun", ["weather", "energy", "light"], ["sunlight", "sunshine", "light"], "the sun with rays"),
  icon("droplet", ["water", "liquid"], ["water", "drop", "rain"], "a single water drop"),
  icon("wind", ["weather", "air", "gas"], ["air", "oxygen", "breeze"], "flowing air lines"),
  icon("cube", ["shape", "block", "molecule"], ["block", "box3d", "sugar", "glucose"], "a 3D cube"),
  icon("bolt", ["energy", "electricity"], ["lightning", "electricity", "power"], "a lightning bolt"),
  icon("server", ["computing", "network"], ["computer", "backend", "host"], "a rack server"),
  icon("user", ["people"], ["person", "human", "customer"], "a person"),
  icon("database", ["computing", "storage"], ["db", "storage"], "a database cylinder"),
  icon("cloud", ["weather", "computing"], ["cloud-computing"], "a cloud"),
  icon("flame", ["fire", "energy", "heat"], ["fire", "heat"], "a flame"),
  icon("heart", ["health", "body", "love"], ["love", "health"], "a heart symbol"),
  icon("check", ["status"], ["tick", "done", "correct"], "a check mark"),
  icon("cross", ["status"], ["x", "wrong", "no"], "a cross mark"),
  icon("lightbulb", ["idea"], ["idea", "bulb", "insight"], "a light bulb"),
  icon("clock", ["time"], ["time", "watch"], "a clock face"),
  icon("gear", ["process", "settings"], ["cog", "settings", "process"], "a gear"),
  asset("leaf", ["plant", "biology"], ["foliage"], ["blade", "vein", "stem"], "a green leaf"),
  asset("tree", ["plant", "nature"], [], ["trunk", "crown", "roots"], "a tree"),
  asset("cell.plant", ["biology", "cell"], ["plant-cell"], ["wall", "membrane", "nucleus", "chloroplast", "vacuole"], "plant cell cross-section"),
  asset("cell.animal", ["biology", "cell"], ["animal-cell"], ["membrane", "nucleus", "mitochondria"], "animal cell cross-section"),
  asset("heart.anatomy", ["biology", "body"], ["human-heart"], ["left-atrium", "right-atrium", "left-ventricle", "right-ventricle", "valve"], "anatomical human heart"),
  asset("earth", ["planet", "geography"], ["globe", "world", "planet"], [], "planet earth"),
];

function icon(name: string, tags: string[], synonyms: string[], description: string): AssetManifest {
  return { name, version: "1.0.0", kind: "icon", file: `icons/${name}.svg`, tags, synonyms, aspect: 1, drawable: true, parts: [], description };
}

function asset(name: string, tags: string[], synonyms: string[], parts: string[], description: string): AssetManifest {
  return { name, version: "1.0.0", kind: "asset", file: `assets/${name.replace(/\./g, "/")}.svg`, tags, synonyms, aspect: 1, drawable: true, parts, description };
}

export interface AssetMatch {
  manifest: AssetManifest;
  via: "exact" | "synonym" | "kind";
}

/** Resolves semantic names written by the LLM to library entries. */
export class AssetLibrary {
  private readonly byName = new Map<string, AssetManifest>();
  private readonly bySynonym = new Map<string, AssetManifest>();

  constructor(manifests: readonly AssetManifest[] = SEED_ASSETS) {
    for (const m of manifests) this.byName.set(m.name, m);
    for (const m of manifests) {
      for (const s of m.synonyms) if (!this.byName.has(s) && !this.bySynonym.has(s)) this.bySynonym.set(s, m);
    }
  }

  /**
   * Exact name of the requested kind first, then a synonym, then the same
   * name under the other kind (`icon:leaf` → asset `leaf`).
   */
  resolve(kind: "icon" | "asset", name: string): AssetMatch | undefined {
    const n = name.toLowerCase();
    const exact = this.byName.get(n);
    if (exact && exact.kind === kind) return { manifest: exact, via: "exact" };
    const syn = this.bySynonym.get(n);
    if (syn) return { manifest: syn, via: "synonym" };
    if (exact) return { manifest: exact, via: "kind" };
    return undefined;
  }

  all(): AssetManifest[] {
    return [...this.byName.values()];
  }
}

/** Minimal element shape needed to work out its parts. */
export interface PartsInput {
  kind: string;
  name?: string;
  texts: readonly string[];
  attrs: Readonly<Record<string, string>>;
}

/**
 * Addressable parts of an element (`id.part`): named parts of an asset or
 * component, numbered items (list/chart), or numbered `[bracketed]` words
 * in text. "any" means the count is only known at render time (formula).
 */
export function partsOf(el: PartsInput, assets: AssetLibrary, components: readonly { kind: string; parts?: readonly string[] | "items" | "words" }[]): string[] | "any" {
  if (el.kind === "icon" || el.kind === "asset") {
    return el.name ? [...(assets.resolve(el.kind, el.name)?.manifest.parts ?? [])] : [];
  }
  const p = components.find((c) => c.kind === el.kind)?.parts;
  if (!p) return [];
  if (Array.isArray(p)) return [...p];
  const text = el.texts[0] ?? "";
  let n: number;
  if (p === "items") {
    if (el.kind === "chart") n = (el.attrs.data ?? "").split(",").filter(Boolean).length;
    else if (el.kind === "scorecard") n = Number(el.attrs.max ?? 5) || 5;
    else if (el.kind === "flowchart") n = flowNodes(text).length;
    else if (el.kind === "comparison" || el.kind === "matrix") n = items(el.texts[1] ?? "").length;
    else if (el.kind === "formula") return "any";
    else n = items(text).length;
  } else {
    n = (text.match(/\[[^\]]+\]/g) ?? []).length;
  }
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

function items(text: string): string[] {
  return text.split(";").map((s) => s.trim()).filter(Boolean);
}

/** Node names of a flowchart spec `A>B;B>C:label`, in order of first appearance. */
export function flowNodes(spec: string): string[] {
  const nodes: string[] = [];
  for (const edge of items(spec)) {
    const [from, rest = ""] = edge.split(">").map((s) => s.trim()) as [string, string?];
    const to = rest.split(":")[0]!.trim();
    for (const n of [from, to]) if (n && !nodes.includes(n)) nodes.push(n);
  }
  return nodes;
}
