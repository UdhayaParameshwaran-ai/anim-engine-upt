import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parse, print, printScene, type Script } from "@anim/dsl";
import { BACKGROUNDS, findTemplate, MOTIONS, THEMES } from "@anim/registry";

/**
 * The style director: gives every video its own look without touching its
 * content. From the topic's mood it picks a look, a motion personality and
 * a background that suit each other, then varies scene arrangements
 * (template variants, mirrored grid pages). A per-user history makes recent
 * choices less likely, so someone generating many videos keeps getting new
 * ones. Everything is seeded: the same topic and history give the same
 * result.
 */

export interface StyleChoice {
  theme: string;
  motion: string;
  bg: string;
  /** Scene id → layout attributes the director set. */
  scenes: Record<string, Record<string, string>>;
  mood: string;
}

export interface HistoryEntry extends Omit<StyleChoice, "scenes" | "mood"> {
  /** template:variant pairs and mirrored grid codes used. */
  layouts: string[];
  at: number;
}

export interface DirectOptions {
  /** Topic text (the prompt); decides the mood. */
  topic: string;
  /** Past videos of this user, newest last. */
  history?: HistoryEntry[];
  /** Choices the user fixed (brand kit, "make it playful"); never changed. */
  lock?: Partial<Pick<StyleChoice, "theme" | "motion" | "bg">>;
  /** Keep a look/motion the script already names unless it was used recently. Default true. */
  respectScript?: boolean;
}

type Weights = Record<string, number>;

interface Mood {
  name: string;
  words: RegExp;
  looks: Weights;
  motions: Weights;
}

/** Moods by topic keywords; looks and motions that fit each, by weight. */
const MOODS: Mood[] = [
  { name: "kids", words: /\b(kids?|child(ren)?|toddlers?|kindergarten|preschool|cartoon|for beginners|fun facts?|primary school)\b/i, looks: { crayon: 3, "soft-pastel": 2, "bold-pop": 2, chalk: 1.5 }, motions: { playful: 3, energetic: 1.5 } },
  { name: "tech", words: /\b(ai|software|code|coding|computer|data|network|cloud|blockchain|algorithms?|programming|internet|robots?|cyber|api|chips?|quantum)\b/i, looks: { "tech-neon": 3, blueprint: 2, dark: 2, "neo-brutal": 1 }, motions: { energetic: 2.5, dramatic: 1.5, corporate: 1.5, cinematic: 1 } },
  { name: "finance", words: /\b(money|finance|financial|invest(ing|ment)?|stocks?|budget|tax(es)?|banks?|economy|inflation|interest rates?|crypto|savings?|loans?)\b/i, looks: { "midnight-luxe": 2.5, light: 2, magazine: 2, editorial: 2, dark: 1 }, motions: { corporate: 3, minimal: 2, cinematic: 1 } },
  { name: "business", words: /\b(business|startups?|marketing|sales|strategy|management|leadership|teams?|products?|customers?|growth|brand)\b/i, looks: { light: 2.5, "neo-brutal": 2, magazine: 1.5, "bold-pop": 1.5, editorial: 1.5 }, motions: { corporate: 3, energetic: 1.5 } },
  { name: "science", words: /\b(cells?|physics|chemistry|biology|atoms?|molecules?|photosynthesis|gravity|energy|planets?|space|evolution|dna|genes?|electricity|light|sound|weather)\b/i, looks: { chalk: 2, blueprint: 2, paper: 2, "soft-pastel": 1.5, dark: 1.5, "tech-neon": 1 }, motions: { standard: 1.5, playful: 1.5, cinematic: 1.5, corporate: 1 } },
  { name: "health", words: /\b(health|vaccines?|disease|medicine|medical|body|nutrition|diet|sleep|exercise|mental|heart|brain|immune|doctors?)\b/i, looks: { light: 2.5, "soft-pastel": 2, paper: 2, editorial: 1.5 }, motions: { corporate: 2, minimal: 2, standard: 1.5 } },
  { name: "history", words: /\b(history|historical|wars?|ancient|empires?|centur(y|ies)|revolution|medieval|kings?|queens?|civili[sz]ations?)\b/i, looks: { magazine: 3, "midnight-luxe": 2, paper: 2, editorial: 1.5 }, motions: { cinematic: 3, dramatic: 2, minimal: 1 } },
  { name: "nature", words: /\b(nature|climate|oceans?|forests?|animals?|environment|plants?|rivers?|wildlife|earth|ecosystems?)\b/i, looks: { paper: 2, "soft-pastel": 2, chalk: 1.5, magazine: 1.5, dark: 1 }, motions: { cinematic: 2, playful: 1.5, minimal: 1.5, standard: 1 } },
  { name: "culture", words: /\b(art|music|films?|movies?|design|literature|culture|poetry|fashion|architecture)\b/i, looks: { magazine: 3, "midnight-luxe": 2, editorial: 2, "neo-brutal": 1.5, "bold-pop": 1.5 }, motions: { cinematic: 2.5, dramatic: 2, energetic: 1 } },
];
const GENERAL: Mood = { name: "general", words: /$^/, looks: Object.fromEntries(THEMES.map((t) => [t, 1])), motions: Object.fromEntries(MOTIONS.map((m) => [m.name, 1])) };

/** Motions that suit a look (multiplies the mood's weight); unlisted pairs get 1. */
const PAIRS: Record<string, Weights> = {
  crayon: { playful: 2, energetic: 1.3, cinematic: 0.4, dramatic: 0.4, corporate: 0.5 },
  chalk: { playful: 1.5, standard: 1.3, dramatic: 0.6 },
  "soft-pastel": { playful: 1.4, minimal: 1.3, dramatic: 0.5, energetic: 0.7 },
  "bold-pop": { energetic: 1.8, playful: 1.5, minimal: 0.5, cinematic: 0.6 },
  "neo-brutal": { energetic: 1.8, playful: 1.3, cinematic: 0.6, minimal: 0.7 },
  "tech-neon": { energetic: 1.6, dramatic: 1.5, cinematic: 1.3, playful: 0.5 },
  "midnight-luxe": { cinematic: 2, minimal: 1.5, dramatic: 1.3, playful: 0.3, energetic: 0.5 },
  magazine: { cinematic: 1.6, minimal: 1.5, corporate: 1.3, playful: 0.5 },
  editorial: { minimal: 1.6, corporate: 1.5, playful: 0.4 },
  light: { corporate: 1.7, minimal: 1.4, dramatic: 0.6 },
  blueprint: { corporate: 1.4, energetic: 1.3, playful: 0.6 },
};

/** Backgrounds that suit a look besides its own ("auto"). */
const LOOK_BGS: Record<string, string[]> = {
  dark: ["aurora", "mesh", "gradient+grain", "grid"],
  "tech-neon": ["grid", "aurora", "dots", "waves"],
  "midnight-luxe": ["aurora", "grain", "mesh"],
  blueprint: ["dots"],
  chalk: ["grain", "grid"],
  paper: ["grain", "dots", "notebook", "waves"],
  light: ["mesh", "dots", "waves", "gradient"],
  "soft-pastel": ["waves", "dots", "gradient"],
  magazine: ["gradient+grain", "dots"],
  "bold-pop": ["dots", "waves", "mesh"],
  crayon: ["dots", "grain"],
  "neo-brutal": ["grid", "shapes", "solid"],
  editorial: ["solid"],
};

/** Mulberry32. */
function prng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function moodOf(topic: string): Mood {
  let best = GENERAL;
  let bestHits = 0;
  for (const m of MOODS) {
    const hits = topic.match(new RegExp(m.words.source, "gi"))?.length ?? 0;
    if (hits > bestHits) [best, bestHits] = [m, hits];
  }
  return best;
}

/**
 * How fresh a value is given the history (1 = never used). What the last
 * video used is ruled out; older uses multiply by a penalty that fades
 * with age (two videos ago counts strongly, ten videos ago barely).
 */
function novelty(used: (h: HistoryEntry) => boolean, history: HistoryEntry[]): number {
  let k = 1;
  history.forEach((h, i) => {
    const age = history.length - 1 - i;
    if (used(h)) k *= age === 0 ? 0 : 1 - 0.85 * 0.7 ** (age - 1);
  });
  return k;
}

/** Weighted random pick, seeded. If every option is ruled out, the first one is used. */
function pick(weights: Weights, rand: () => number): string {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (!entries.length) return Object.keys(weights)[0]!;
  const total = entries.reduce((x, [, w]) => x + w, 0);
  let r = rand() * total;
  for (const [k, w] of entries) if ((r -= w) <= 0) return k;
  return entries.at(-1)![0];
}

const ALL_LOOKS = new Set<string>(THEMES);
const ALL_MOTIONS = new Set(MOTIONS.map((m) => m.name));

/**
 * Directs one video. Generation streams scenes, so the look is decided on
 * the script header (before the first scene plays) and each scene is
 * arranged as it arrives; `direct()` does both on a whole script.
 */
export class Director {
  private readonly history: HistoryEntry[];
  private readonly rand: () => number;
  private readonly mood: Mood;
  private readonly recentLayouts: string[];
  private last = "";
  private style?: Pick<StyleChoice, "theme" | "motion" | "bg">;
  private readonly scenes: StyleChoice["scenes"] = {};
  private readonly layouts: string[] = [];

  constructor(private readonly opts: DirectOptions) {
    this.history = opts.history ?? [];
    this.rand = prng(hash(opts.topic) ^ (this.history.length * 2654435761));
    this.mood = moodOf(opts.topic);
    this.recentLayouts = this.history.slice(-3).flatMap((h) => h.layouts);
  }

  /** Picks look, motion and background and writes them into the header (any scenes in `source` are kept). */
  header(source: string): string {
    const { script } = parse(source);
    const setting = (key: string) => script.settings.find((x) => x.key === key)?.args[0];
    const { history, rand, mood, opts } = this;
    const recent = (n: number) => history.slice(-n);
    const respect = opts.respectScript ?? true;

    // Look: the user's lock, else the script's own choice if it isn't recent, else the mood's pick.
    const scriptLook = setting("theme");
    let theme = opts.lock?.theme;
    if (!theme && respect && scriptLook && ALL_LOOKS.has(scriptLook) && !recent(3).some((h) => h.theme === scriptLook)) theme = scriptLook;
    if (!theme) {
      const w: Weights = {};
      for (const t of THEMES) w[t] = (mood.looks[t] ?? 0.15) * novelty((h) => h.theme === t, history);
      theme = pick(w, rand);
    }

    const scriptMotion = setting("motion");
    let motion = opts.lock?.motion;
    if (!motion && respect && scriptMotion && ALL_MOTIONS.has(scriptMotion) && !recent(2).some((h) => h.motion === scriptMotion)) motion = scriptMotion;
    if (!motion) {
      const w: Weights = {};
      for (const m of ALL_MOTIONS) w[m] = (mood.motions[m] ?? 0.2) * (PAIRS[theme]?.[m] ?? 1) * novelty((h) => h.motion === m, history);
      motion = pick(w, rand);
    }

    // Background: mostly the look's own; sometimes a fitting alternative, avoiding recent ones.
    let bg = opts.lock?.bg ?? setting("bg");
    if (!bg) {
      const w: Weights = { auto: 2.5 };
      for (const k of LOOK_BGS[theme] ?? []) w[k] = 1;
      for (const k of Object.keys(w)) w[k]! *= novelty((h) => h.theme === theme && h.bg === k, history);
      bg = pick(w, rand);
    }
    if (!bg.split("+").every((k) => BACKGROUNDS.some((x) => x.name === k))) bg = "auto";

    this.style = { theme, motion, bg };
    setSetting(script, "theme", theme);
    setSetting(script, "motion", motion);
    if (bg !== "auto") setSetting(script, "bg", bg);
    for (const scene of script.scenes) this.arrange(scene);
    return print(script);
  }

  /**
   * Arranges one scene (its text starts with the scene line): a template
   * variant (never the same template+variant twice in a row, recent ones
   * less likely) or, for grid pages, a mirror now and then. Explicit
   * choices in the script stay.
   */
  scene(sceneSource: string): string {
    const { script } = parse(`video 1\n${sceneSource}\n`);
    const scene = script.scenes[0];
    if (!scene) return sceneSource;
    this.arrange(scene);
    return printScene(scene).join("\n");
  }

  /** The choices so far. */
  get choice(): StyleChoice {
    if (!this.style) throw new Error("Director.header() must run first");
    return { ...this.style, scenes: this.scenes, mood: this.mood.name };
  }

  /** What to remember about this video. */
  entry(): HistoryEntry {
    return { ...this.choice, layouts: [...this.layouts], at: Date.now() } as HistoryEntry;
  }

  private arrange(scene: Script["scenes"][number]): void {
    const a = scene.attrs;
    const set: Record<string, string> = {};
    const tpl = a.template ? findTemplate(a.template) : undefined;
    if (tpl && a.variant === undefined && tpl.variants.length > 1) {
      const w: Weights = {};
      tpl.variants.forEach((v, i) => {
        const key = `${tpl.name}:${v}`;
        // The default arrangement stays the most likely; repeats are rare.
        w[v] = (i === 0 ? 2 : 1) * (key === this.last ? 0.05 : 1) * (this.recentLayouts.includes(key) ? 0.5 : 1);
      });
      const v = pick(w, this.rand);
      if (v !== tpl.variants[0]) set.variant = v;
    }
    if (a.grid !== undefined && a.mirror === undefined && this.rand() < 0.4) set.mirror = "true";
    Object.assign(a, set);
    if (Object.keys(set).length) this.scenes[scene.id] = set;
    if (tpl) this.last = `${tpl.name}:${a.variant ?? tpl.variants[0]}`;
    const layout = tpl ? this.last : a.grid ? `${a.grid}${a.mirror === "true" ? ":mirror" : ""}` : undefined;
    if (layout) this.layouts.push(layout);
  }
}

/** Chooses look, motion, background and scene arrangements for a whole script. */
export function direct(source: string, opts: DirectOptions): { script: string; choice: StyleChoice; entry: HistoryEntry } {
  const d = new Director(opts);
  const script = d.header(source);
  return { script, choice: d.choice, entry: d.entry() };
}

function setSetting(script: Script, key: string, value: string): void {
  const s = script.settings.find((x) => x.key === key);
  if (s) s.args = [value];
  else script.settings.push({ key, args: [value], span: { line: 1, col: 1, endCol: 1 } });
}

/** What to remember about a directed video. */
export function historyEntry(choice: StyleChoice, source: string): HistoryEntry {
  const { script } = parse(source);
  const layouts = script.scenes.flatMap((s) => {
    const tpl = s.attrs.template ? findTemplate(s.attrs.template) : undefined;
    if (tpl) return [`${tpl.name}:${s.attrs.variant ?? tpl.variants[0]}`];
    if (s.attrs.grid) return [`${s.attrs.grid}${s.attrs.mirror === "true" ? ":mirror" : ""}`];
    return [];
  });
  return { theme: choice.theme, motion: choice.motion, bg: choice.bg, layouts, at: Date.now() };
}

/** Per-user style history in a JSON file (`{ user: HistoryEntry[] }`), capped at the last 30 videos. */
export class StyleHistory {
  constructor(private readonly file: string) {}

  async get(user: string): Promise<HistoryEntry[]> {
    return (await this.all())[user] ?? [];
  }

  async add(user: string, entry: HistoryEntry): Promise<void> {
    const all = await this.all();
    all[user] = [...(all[user] ?? []), entry].slice(-30);
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(all, null, 1));
  }

  private async all(): Promise<Record<string, HistoryEntry[]>> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as Record<string, HistoryEntry[]>;
    } catch {
      return {};
    }
  }
}
