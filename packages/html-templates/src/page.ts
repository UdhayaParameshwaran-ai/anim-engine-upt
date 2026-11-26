import type { MotionSet } from "./index.js";

/** One item of a scene: the strings the script gave it, the icon it names, and what kind of element it was. */
export interface SceneItem {
  /** The element's id in the script. */
  id?: string;
  /** Its quoted strings in order (a step: title, detail; a timeline event: date, title, detail...). */
  texts: string[];
  /** The icon name (`icon:send` -> "send"), or "". */
  icon: string;
  kind?: string;
  /** Kept for readers of older data: the first and second string. */
  title?: string;
  detail?: string;
}

/** What a scene gives the page: its heading, its items, and the elements that fill named slots (left, right, subtitle...). */
export interface SceneData {
  heading: string;
  items: SceneItem[];
  /** Strings of the elements whose ids are slot names: `left`, `right`, `subtitle`, `kicker`, `byline`, `brand`. */
  named?: Record<string, string[]>;
}

const text = (i: SceneItem, n: number) => i.texts?.[n] ?? (n === 0 ? i.title : n === 1 ? i.detail : undefined) ?? "";

/** "$12.5k" -> { prefix: "$", value: "12.5", suffix: "k" }. */
export function parseValue(s: string): { prefix: string; value: string; suffix: string } {
  const m = /^\s*([^\d\-.]*)(-?[\d.,]+)\s*(.*)$/.exec(s);
  if (!m) return { prefix: "", value: "", suffix: s.trim() };
  return { prefix: m[1]!.trim(), value: m[2]!.replace(/,/g, ""), suffix: m[3]!.trim() };
}

/** "+45% vs Q3" -> { delta: "45", label: "vs Q3" }; "-12% vs last year" -> { delta: "-12", label: "vs last year" }. */
export function parseDelta(s: string): { delta: string; label: string } {
  const m = /^\s*([+\-−]?)\s*(\d+(?:\.\d+)?)\s*%?\s*(.*)$/.exec(s);
  if (!m) return { delta: "", label: s.trim() };
  return { delta: `${m[1] === "-" || m[1] === "−" ? "-" : ""}${m[2]}`, label: m[3]!.trim() };
}

const shell = (heading: string, items: unknown[]) => ({ pace: "normal", motion: "default", order: "forward", kicker: "", heading, items });

/** The data object the designer's page reads, from what a scene gives it. */
export function pageData(set: MotionSet, data: SceneData): unknown {
  const items = data.items;
  const named = data.named ?? {};
  switch (set.kind) {
    case "steps":
    case "interaction":
      return shell(data.heading, items.map((i) => ({ title: text(i, 0), detail: text(i, 1), icon: i.icon || "star" })));
    case "compare":
      // Item 1 holds the side names; every other item is a row: the left point, the right point, and an icon for the aspect.
      return shell(data.heading, [
        { title: named.left?.[0] ?? "Before", detail: named.right?.[0] ?? "After" },
        ...items.map((i) => ({ title: text(i, 0), detail: text(i, 1), icon: i.icon || "star" })),
      ]);
    case "chart":
      return shell(data.heading, items.map((i) => ({ title: text(i, 0), detail: text(i, 1) })));
    case "timeline":
      return { kicker: "", heading: data.heading, pace: "normal", motion: "default", order: "forward", items: items.map((i) => ({ date: text(i, 0), title: text(i, 1), detail: text(i, 2), image: "" })) };
    case "stats":
      return {
        pace: "normal", motion: "rise", order: "forward", kicker: "", heading: data.heading,
        items: items.map((i, k) => {
          const v = parseValue(text(i, 1));
          const d = parseDelta(text(i, 2));
          return { label: text(i, 0), value: v.value, prefix: v.prefix, suffix: v.suffix, delta: d.delta, deltaLabel: d.label, icon: i.icon || "user", highlight: k === items.length - 1 };
        }),
      };
    case "title":
      return {
        pace: "normal", bg: "auto", playout: false,
        kicker: named.kicker?.[0] ?? "", title: data.heading, subtitle: named.subtitle?.[0] ?? "", byline: named.byline?.[0] ?? "", brand: named.brand?.[0] ?? "",
        icon: items[0]?.icon || "star",
      };
  }
}

/**
 * Maps scene time to the page's own time so that each item appears when it is spoken.
 *   cues     scene-local seconds at which each item is shown (undefined: the script never shows it)
 *   starts   the page's own time at which each item appears
 * Before the first item the page runs at its own speed, ending at the first cue; between items it is stretched or squeezed
 * to fit the narration; after the last item it runs at its own speed again (the caller holds the last frame).
 */
export function warpTime(t: number, cues: readonly (number | undefined)[], starts: readonly number[] | null): number {
  if (!starts) return t;
  const a: { c: number; s: number }[] = [];
  cues.forEach((c, i) => {
    const s = starts[i];
    if (c === undefined || s === undefined) return;
    const last = a[a.length - 1];
    if (!last || (c > last.c + 0.01 && s > last.s + 0.01)) a.push({ c, s });
  });
  if (!a.length) return t;
  const first = a[0]!;
  if (t <= first.c) return Math.max(0, first.s - (first.c - t));
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1]!;
    const q = a[i]!;
    if (t <= q.c) return p.s + ((t - p.c) / (q.c - p.c)) * (q.s - p.s);
  }
  const end = a[a.length - 1]!;
  return end.s + (t - end.c);
}
