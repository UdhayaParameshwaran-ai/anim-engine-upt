import { motionSet, motionVariant, pageData, templateUrl, timing, warpTime, THEMES, type Measured, type Outro, type SceneData } from "@anim/html-templates";
import type { ElementIR } from "@anim/ir";
import { ICONS } from "./art.js";
import type { Instance } from "./components.js";
import type { Theme } from "./theme.js";

/** Where the designer's pages are served from: the host (renderer, Studio) answers requests under this prefix. */
export const DEFAULT_TEMPLATE_BASE = "https://tpl.anim.local";

interface Frame extends Window {
  __tpl?: { ready: Promise<boolean>; seek(t: number): boolean; duration(): number; starts(n: number, pace: string): number[] | null; measure?(items: string[][]): (Measured | null)[] | null };
}

const light = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return true;
  const n = parseInt(m[1]!, 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.6;
};

/**
 * Our icon artwork as the designer's pages want it: stroke only (their icons are outlines drawn on by animation), every shape
 * carrying `pathLength="1"` so a dash offset draws it.
 */
export function strokeIcon(markup: string): string {
  return markup
    .replace(/\sdata-(?:fill|part)="[^"]*"/g, "")
    .replace(
      /<(path|circle|rect|ellipse|polygon|polyline|line)\b([^>]*?)(\/?)>/g,
      (_m, tag: string, attrs: string, close: string) => `<${tag}${attrs.replace(/\s(?:pathLength|style)="[^"]*"/g, "")} pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:0"${close}>`,
    );
}

/** One of the four designer themes for a look: dark ink means a light page. */
export function pageTheme(want: string, theme: Theme): string {
  if ((THEMES as readonly string[]).includes(want)) return want;
  return light(theme.fg) ? "aurora-night" : "daylight-clean";
}

/**
 * Hosts a designer page for a `motion` element: an iframe the size of the video, shown by the stage's own time. The page is
 * built once; every frame the stage tells it what time it is (through `tick`), warped so each item lands on its cue.
 */
export function buildMotion(doc: Document, el: ElementIR, theme: Theme, inst: Instance, base: string): HTMLElement {
  const set = motionSet(String(el.params.template));
  const div = doc.createElement("div");
  div.dataset.id = el.id;
  div.dataset.kind = el.kind;
  Object.assign(div.style, { position: "absolute", left: "0px", top: "0px", width: `${el.box.w}px`, height: `${el.box.h}px`, overflow: "hidden", transformOrigin: "50% 50%", pointerEvents: "none" });
  if (!set) return div;
  const variant = motionVariant(set, String(el.params.variant));
  const scene = JSON.parse(String(el.params.data ?? "{}")) as SceneData;
  const frame = doc.createElement("iframe");
  frame.setAttribute("scrolling", "no");
  frame.setAttribute("tabindex", "-1");
  Object.assign(frame.style, { position: "absolute", left: "0", top: "0", width: `${el.box.w}px`, height: `${el.box.h}px`, border: "0", background: "transparent" });
  // The page draws icons from its own small set; ours are passed in, as stroke-only markup it can animate.
  const icons: Record<string, string> = {};
  for (const it of scene.items) if (it.icon && ICONS[it.icon]) icons[it.icon] = strokeIcon(ICONS[it.icon]!);
  const hash = encodeURIComponent(JSON.stringify({ key: variant.key, data: pageData(set, scene), icons }));
  frame.src = `${templateUrl(base, set, variant, pageTheme(String(el.params.theme ?? "auto"), theme))}#${hash}`;
  div.append(frame);

  let cues: (number | undefined)[] = [];
  let starts: number[] | null = null;
  let spans: number[] | null = null;
  let exit: { leave: number; gone: number } | null = null;
  let sceneEnd = 0;
  const page = () => frame.contentWindow as Frame | null;
  inst.ready = new Promise<void>((resolve) => {
    frame.addEventListener("load", () => {
      const w = page();
      Promise.resolve(w?.__tpl?.ready)
        .then(() => {
          // When each item really arrives is measured on the page (it varies by variant and by text); the designer's formula is the fallback.
          const formula = w?.__tpl?.starts(scene.items.length, "normal") ?? null;
          let measured: (Measured | null)[] | null = null;
          try {
            measured = w?.__tpl?.measure?.(scene.items.map((it) => it.texts)) ?? null;
          } catch {
            measured = null;
          }
          ({ starts, spans } = timing(measured, formula));
          // A title that plays out leaves as the scene ends. Its exit is the designer's own: titles-core.js gives it out = 0.8 x max(0.8, pace)
          // seconds, ending 0.3s before the page does (pace: relaxed 1.35, normal 1, snappy 0.72).
          if (scene.options?.playout) {
            const d = w?.__tpl?.duration() ?? 0;
            const pace = ({ relaxed: 1.35, normal: 1, snappy: 0.72 } as Record<string, number>)[scene.options.pace ?? "normal"] ?? 1;
            const out = 0.8 * Math.max(0.8, pace);
            if (d > out + 0.3) exit = { leave: d - 0.3 - out, gone: d - 0.3 };
          }
        })
        .catch(() => undefined)
        .then(() => resolve());
    });
  });
  inst.setCues = (c) => {
    cues = c;
  };
  inst.setSceneEnd = (s) => {
    sceneEnd = s;
  };
  inst.tick = (t) => {
    const outro: Outro | null = exit && sceneEnd > 0 ? { ...exit, end: sceneEnd } : null;
    page()?.__tpl?.seek(warpTime(t, cues, starts, spans, outro));
  };
  return div;
}
