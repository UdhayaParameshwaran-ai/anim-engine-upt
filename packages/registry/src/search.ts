import type { AssetManifest } from "./index.js";

/**
 * Finding pictures by meaning. A query is words ("how a load balancer spreads requests across servers");
 * an asset is found through its name, its synonyms, its tags and its description. Words that few assets
 * carry weigh more than words many carry ("balancer" says more than "data"), and an asset whose whole
 * name is in the query ("load-balancer") gets a bonus, so the specific picture beats a generic one.
 *
 * This is the same search the prompts use to shortlist pictures for a scene and the validator uses to
 * replace a name the model invented, so what the model is offered and what a wrong name turns into agree.
 */

/** Words too common to say anything about a picture. */
const STOP = new Set(
  "of to in on at by is it as an or be do if so we up no he she his her him i me my us the and for with from that this how what why who when where are was were its into than then them they their there have has had not but you your our can will one two three four five all any each out off over under about between through show shows scene goal uses using use video explain explains explained step steps first next last also very more most some such like make makes made get gets take takes".split(" "),
);

/** Lower-case word stem: plural endings off ("databases" → "database", "proxies" → "proxy"). */
export function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** The distinct stemmed words of a text (hyphens and dots split words), without stop words and one-letter bits. */
export function tokens(text: string): string[] {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (w.length < 2 || STOP.has(w)) continue;
    out.add(stem(w));
  }
  return [...out];
}

/** Every stemmed word of a text in order, stop words included (a phrase is matched on these). */
function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem);
}

/** True when `phrase` appears in `text` as consecutive words. */
function contains(text: readonly string[], phrase: readonly string[]): boolean {
  for (let i = 0; i + phrase.length <= text.length; i++) if (phrase.every((w, k) => text[i + k] === w)) return true;
  return false;
}

interface Entry {
  asset: AssetManifest;
  /** Words of the name, without the "brand" prefix every logo shares. */
  name: string[];
  synonyms: Set<string>;
  /** Synonyms of several words ("pull request"): they match only as a phrase. */
  phrases: string[][];
  tags: Set<string>;
  description: Set<string>;
}

export interface SearchOptions {
  /** Only this kind of picture. */
  kind?: "icon" | "asset";
  limit?: number;
  /** Hits below this score are left out. */
  minScore?: number;
}

export interface SearchHit {
  asset: AssetManifest;
  score: number;
}

/** A search index over a set of assets: built once, queried many times. */
export class AssetIndex {
  private readonly entries: Entry[];
  /** Word → how many assets mention it anywhere. */
  private readonly df = new Map<string, number>();

  constructor(assets: readonly AssetManifest[]) {
    this.entries = assets.map((asset) => {
      const name = tokens(asset.name).filter((t) => t !== "brand");
      const single = asset.synonyms.filter((s) => words(s).length < 2);
      const phrases = asset.synonyms.map(words).filter((p) => p.length >= 2);
      const synonyms = new Set(single.flatMap(tokens));
      const tags = new Set(asset.tags.flatMap(tokens));
      const description = new Set(tokens(asset.description).filter((t) => !name.includes(t) && !tags.has(t)));
      for (const t of new Set([...name, ...synonyms, ...tags, ...description])) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { asset, name, synonyms, phrases, tags, description };
    });
  }

  private idf(word: string): number {
    return Math.log(1 + this.entries.length / (1 + (this.df.get(word) ?? 0)));
  }

  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    const q = tokens(query);
    if (!q.length) return [];
    const wanted = new Set(q);
    const ordered = words(query);
    const hits: SearchHit[] = [];
    for (const e of this.entries) {
      if (opts.kind && e.asset.kind !== opts.kind) continue;
      let score = 0;
      let named = 0;
      let nameMatches = 0;
      for (const w of q) {
        const weight = this.idf(w);
        if (e.name.includes(w)) {
          named += 4 * weight;
          nameMatches++;
        } else if (e.synonyms.has(w)) score += 3.5 * weight;
        else if (e.tags.has(w)) score += 2 * weight;
        else if (e.description.has(w)) score += weight;
      }
      // One word of a longer name ("push" of stack-push) says less than all of it.
      score += named * (e.name.length ? 0.6 + (0.4 * nameMatches) / e.name.length : 1);
      // A phrase synonym said in the query ("get request", "load balancer"): the strongest signal there is.
      for (const p of e.phrases) if (contains(ordered, p)) score += 24 + 4 * p.length;
      // The whole name is in the query: "load balancer" finds load-balancer before anything that only shares "load".
      if (e.name.length && e.name.every((t) => wanted.has(t))) score += 3 * e.name.length;
      if (score > 0 && score >= (opts.minScore ?? 0)) hits.push({ asset: e.asset, score });
    }
    hits.sort((a, b) => b.score - a.score || a.asset.name.length - b.asset.name.length || a.asset.name.localeCompare(b.asset.name));
    return opts.limit ? hits.slice(0, opts.limit) : hits;
  }
}
