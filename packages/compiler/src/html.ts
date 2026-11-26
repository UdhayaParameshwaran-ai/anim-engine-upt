import type { ElementDecl, Scene } from "@anim/dsl";
import { chooseVariant, motionSet, type MotionSet, type PageOptions, type MotionVariant, type SceneData } from "@anim/html-templates";
import type { Box, ElementIR } from "@anim/ir";
import { findTemplate } from "@anim/registry";
import type { LayoutContext, SceneLayout } from "./layout.js";

/**
 * Scenes drawn by one of the designer's HTML pages.
 *
 * The script is written as for any template: elements named after the template's slots (`title`, `left`, `subtitle`...),
 * items (`s1 = icon:send "Title" "Detail"`) and verbs on the items (`1 pop s1`). Here the items are not laid out and drawn by
 * us. They become the data of one page-sized element, `motion`, which hosts the designer's page; the verbs on the items only say
 * *when* each one is spoken (the page is time-warped so the item appears at its cue). So every declared element stays in the
 * scene (verbs, validation and timing keep working) but is `virtual`: it has no box and nothing is drawn for it.
 */

/** The reserved id of the element that hosts the page. */
export const MOTION_ID = "motion";

export interface HtmlScene {
  set: MotionSet;
  variant: MotionVariant;
  /** The declared elements that are items, in order. */
  items: ElementDecl[];
  /** The heading element, when the scene declares one. */
  title?: ElementDecl;
  /** The other slot elements (`left`, `right`, `subtitle`, `kicker`...), by id. */
  named: Map<string, ElementDecl>;
  /** One of the designer's four themes, or `auto` (light or dark by the look's ink). */
  theme: string;
  /** The scene attributes the page can use: pace, bg, highlight, playout. */
  options: PageOptions;
}

export function htmlSceneOf(scene: Scene): HtmlScene | undefined {
  const name = scene.attrs.template;
  const tpl = name ? findTemplate(name) : undefined;
  const set = tpl?.html && name ? motionSet(name) : undefined;
  if (!tpl || !set) return undefined;
  const declared = scene.steps.flatMap((s) => s.elements);
  // Elements named after a slot fill it (the heading, a side name, the byline...); every other declared element is an item.
  const slots = new Set(tpl.slots.map((s) => s.name));
  const title = declared.find((e) => e.id === "title");
  const named = new Map(declared.filter((e) => slots.has(e.id) && e.id !== "title").map((e) => [e.id, e] as const));
  const items = declared.filter((e) => !slots.has(e.id));
  // A variant id is kept; a family (or auto, or nothing) gives the variant that takes this many items and this text.
  const content = { items: items.map((e) => e.texts), slots: Object.fromEntries(declared.filter((e) => slots.has(e.id)).map((e) => [e.id, e.texts[0] ?? ""])) };
  const variant = chooseVariant(set, scene.attrs.variant, content, hash(scene.id + (scene.title ?? "")));
  const a = scene.attrs;
  const options: PageOptions = { ...(a.pace && { pace: a.pace }), ...(a.bg && { bg: a.bg }), ...(a.highlight && { highlight: a.highlight }), ...(a.playout !== undefined && { playout: a.playout !== "false" }) };
  return { set, variant, items, named, theme: a.theme ?? "auto", options, ...(title && { title }) };
}

/** Layout for an HTML scene: nothing to place. Every declared element is virtual (zero size at the centre). */
export function htmlLayout(scene: Scene, ctx: LayoutContext, h: HtmlScene): SceneLayout {
  const boxes = new Map<string, Box>();
  for (const st of scene.steps) for (const e of st.elements) boxes.set(e.id, { x: ctx.width / 2, y: ctx.height / 2, w: 0, h: 0 });
  boxes.set(MOTION_ID, { x: 0, y: 0, w: ctx.width, h: ctx.height });
  return { boxes, decor: [], params: new Map(), diagnostics: [], variant: h.variant.id, destination: () => undefined };
}

/** What the scene gives the page. */
export function sceneData(h: HtmlScene): SceneData {
  return {
    heading: h.title?.texts[0] ?? "",
    items: h.items.map((e) => ({ id: e.id, texts: e.texts, title: e.texts[0] ?? "", detail: e.texts[1] ?? "", icon: e.name ?? "", kind: e.kind })),
    named: Object.fromEntries([...h.named].map(([id, e]) => [id, e.texts])),
    ...(Object.keys(h.options).length && { options: h.options }),
  };
}

/** The element that hosts the page, with the scene's content as its data. */
export function motionElement(h: HtmlScene, canvas: { width: number; height: number }, theme: string, line: number): ElementIR {
  return {
    id: MOTION_ID,
    kind: "motion",
    component: "motion@1",
    texts: [],
    params: { template: h.set.template, variant: h.variant.id, theme, data: JSON.stringify(sceneData(h)), items: h.items.map((e) => e.id).join(",") },
    box: { x: 0, y: 0, w: canvas.width, h: canvas.height },
    layer: "html",
    parts: [],
    step: 0,
    line,
  };
}

function hash(s: string): number {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0;
  return x;
}
