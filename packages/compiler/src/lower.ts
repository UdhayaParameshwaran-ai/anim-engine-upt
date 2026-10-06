import type { Action, Args, Diagnostic, ElementDecl, Script, Setting } from "@anim/dsl";
import { IR_VERSION, type ActionIR, type BeatIR, type Box, type ElementIR, type SceneIR, type VideoIR } from "@anim/ir";
import { COMPONENTS, findComponent, findVerb, partsOf, type AssetLibrary, type ParamSpec } from "@anim/registry";
import { layoutScene, type SceneLayout } from "./layout.js";

export const DEFAULTS = {
  width: 1920,
  height: 1080,
  fps: 30,
  theme: "paper",
  voice: "narrator",
  lang: "en",
  transitionIn: "fade",
  transitionOut: "cut",
  /** Characters per second for `write` without an explicit duration. */
  writeCps: 30,
  minWrite: 0.4,
} as const;

/**
 * Lowers a *validated* script to VideoIR: resolves components and asset
 * versions, runs layout, and fills every default so later stages never
 * consult the registry for defaults.
 */
export function lower(script: Script, assets: AssetLibrary): { ir: VideoIR; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const setting = (settings: Setting[], key: string) => settings.find((s) => s.key === key)?.args;
  const size = setting(script.settings, "size");
  const [w, h] = size?.[0]?.split("x").map(Number) ?? [DEFAULTS.width, DEFAULTS.height];
  const fps = Number(setting(script.settings, "fps")?.[0] ?? size?.[1] ?? DEFAULTS.fps);
  const ctx = { width: w!, height: h!, assets };

  const lock: Record<string, string> = {};
  const scenes: SceneIR[] = [];
  let prevBoxes = new Map<string, Box>();
  let prevElements = new Map<string, ElementIR>();

  for (const [sceneIndex, scene] of script.scenes.entries()) {
    const keep = (scene.attrs.keep ?? "").split(",").filter(Boolean);
    const kept = new Map(keep.filter((id) => prevBoxes.has(id)).map((id) => [id, prevBoxes.get(id)!]));
    const layout = layoutScene(scene, ctx, kept);
    diagnostics.push(...layout.diagnostics);

    const elements: ElementIR[] = keep.filter((id) => prevElements.has(id)).map((id) => ({ ...prevElements.get(id)!, step: 0 }));
    scene.steps.forEach((step, si) => {
      for (const el of step.elements) elements.push(lowerElement(el, si, layout, assets, lock));
    });
    if (scene.attrs.grid !== undefined) {
      // Editorial frame: left-aligned header, footer with brand and page number.
      for (const el of elements) {
        if ((el.id === "title" || el.id === "subtitle") && ["title", "text", "label"].includes(el.kind)) {
          el.params = { ...el.params, align: "left", ...(el.id === "subtitle" && { tone: "muted" }) };
        }
        if (el.kind === "footer") el.params = { ...el.params, page: sceneIndex + 1, brand: script.title ?? "" };
      }
    }

    const ir: SceneIR = {
      id: scene.id,
      ...(scene.title !== undefined && { title: scene.title }),
      ...(scene.attrs.template !== undefined && { template: scene.attrs.template }),
      transitionIn: scene.attrs.in ?? DEFAULTS.transitionIn,
      transitionOut: scene.attrs.out ?? DEFAULTS.transitionOut,
      keep,
      elements,
      steps: scene.steps.map((step) => ({
        ...(step.id !== undefined && { id: step.id }),
        ...(step.title !== undefined && { title: step.title }),
        ...(step.layout && { layout: step.layout.name }),
        ...(step.focus && { focus: step.focus.name }),
        beats: step.beats.map((beat): BeatIR => {
          const actions = beat.actions.map((a) => lowerAction(a, elements, layout));
          return beat.type === "speech"
            ? { type: "speech", text: beat.text, cues: beat.cues.map((c) => ({ id: c.id, start: c.start, ...(c.end !== undefined && { end: c.end }) })), actions, line: beat.span.line }
            : { type: "wait", seconds: beat.seconds, actions, line: beat.span.line };
        }),
      })),
    };
    scenes.push(ir);
    prevBoxes = layout.boxes;
    prevElements = new Map(elements.map((e) => [e.id, e]));
  }

  return {
    ir: {
      irVersion: IR_VERSION,
      dslVersion: script.version,
      ...(script.title !== undefined && { title: script.title }),
      canvas: { width: w!, height: h!, fps },
      // Grid scenes are designed for the monochrome editorial theme.
      theme: setting(script.settings, "theme")?.[0] ?? (script.scenes.some((s) => s.attrs.grid !== undefined) ? "editorial" : DEFAULTS.theme),
      voice: setting(script.settings, "voice")?.[0] ?? DEFAULTS.voice,
      lang: setting(script.settings, "lang")?.[0] ?? DEFAULTS.lang,
      scenes,
      lock: Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b))),
    },
    diagnostics,
  };
}

function lowerElement(el: ElementDecl, step: number, layout: SceneLayout, assets: AssetLibrary, lock: Record<string, string>): ElementIR {
  const comp = findComponent(el.kind)!;
  let component: string;
  if (el.kind === "icon" || el.kind === "asset") {
    const m = assets.resolve(el.kind, el.name!)!.manifest;
    component = `${m.kind}:${m.name}`;
    lock[component] = el.version ?? m.version;
  } else {
    component = el.name ? `${el.kind}:${el.name}` : el.kind;
    lock[el.kind] = el.version ?? String(comp.version);
  }
  const parts = partsOf(el, assets, COMPONENTS);
  return {
    id: el.id,
    kind: el.kind,
    component,
    texts: el.texts,
    ...(el.link && { link: el.link }),
    params: typed(el.attrs, comp.params),
    box: layout.boxes.get(el.id) ?? { x: 0, y: 0, w: 0, h: 0 },
    layer: comp.layer,
    parts: parts === "any" ? [] : parts,
    step,
    line: el.span.line,
  };
}

function lowerAction(action: Action, elements: ElementIR[], layout: SceneLayout): ActionIR {
  return {
    anchor: action.anchor,
    line: action.span.line,
    calls: action.calls.map((call) => {
      const verb = findVerb(call.verb)!;
      const args: Args = call.args;
      const params = typed(args.params, verb.params);
      for (const [k, spec] of Object.entries(verb.params)) if (!(k in params) && spec.default !== undefined) params[k] = spec.default;
      delete params.until;

      let duration: ActionIR["calls"][number]["duration"];
      if (args.duration !== undefined) duration = args.duration;
      else if (args.params.until !== undefined) duration = { until: args.params.until };
      else if (args.fit) duration = "fit";
      else if (verb.name === "write") {
        const chars = Math.max(...call.targets.map((t) => elements.find((e) => e.id === t.split(".")[0])?.texts[0]?.length ?? 0), 0);
        duration = round2(Math.max(DEFAULTS.minWrite, chars / DEFAULTS.writeCps));
      } else duration = verb.defaultDuration;

      const dest = verb.name === "move" && args.place && call.targets[0] ? layout.destination(call.targets[0], args.place) : undefined;
      return {
        verb: verb.name,
        verbVersion: verb.version,
        targets: call.targets,
        duration,
        delay: args.delay ?? 0,
        stagger: args.stagger ?? 0,
        ...(args.to !== undefined && { to: args.to }),
        ...(dest && { dest }),
        params,
      };
    }),
  };
}

/** Converts string params to their declared types. */
function typed(raw: Record<string, string>, specs: Record<string, ParamSpec>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    const t = specs[k]?.type;
    out[k] = t === "number" ? Number(v) : t === "bool" ? v === "true" : v;
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
