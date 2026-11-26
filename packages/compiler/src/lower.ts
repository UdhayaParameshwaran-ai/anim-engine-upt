import type { Action, Args, Diagnostic, ElementDecl, Script, Setting } from "@anim/dsl";
import { IR_VERSION, type ActionIR, type BeatIR, type Box, type ElementIR, type SceneIR, type VideoIR } from "@anim/ir";
import { COMPONENTS, findComponent, findMotion, findVerb, KITS, partsOf, VERBS, type AssetLibrary, type MotionProfile, type ParamSpec } from "@anim/registry";
import { htmlSceneOf, motionElement, MOTION_ID, type HtmlScene } from "./html.js";
import { layoutScene, type SceneLayout } from "./layout.js";
import { expandTrace } from "./trace.js";

export const DEFAULTS = {
  width: 1920,
  height: 1080,
  fps: 30,
  theme: "paper",
  motion: "standard",
  voice: "narrator",
  lang: "en",
  transitionIn: "auto",
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
export function lower(script: Script, assets: AssetLibrary, variants: "fit" | "exact" = "fit"): { ir: VideoIR; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const setting = (settings: Setting[], key: string) => settings.find((s) => s.key === key)?.args;
  const size = setting(script.settings, "size");
  const [w, h] = size?.[0]?.split("x").map(Number) ?? [DEFAULTS.width, DEFAULTS.height];
  const motion = findMotion(setting(script.settings, "motion")?.[0]);
  const fps = Number(setting(script.settings, "fps")?.[0] ?? size?.[1] ?? DEFAULTS.fps);
  const ctx = { width: w!, height: h!, assets, variants };

  const lock: Record<string, string> = {};
  const scenes: SceneIR[] = [];
  let prevBoxes = new Map<string, Box>();
  let prevElements = new Map<string, ElementIR>();

  for (const [sceneIndex, written] of script.scenes.entries()) {
    // A trace scene (state lines) becomes cells, pointers and timed actions before anything else sees it.
    const scene = expandTrace(written, { width: w!, height: h! });
    const keepAttr = (scene.attrs.keep ?? "").split(",").filter(Boolean);
    // Carried: declared again here (it gets a place in this scene's layout and moves there from where it was).
    // A carried id this scene doesn't declare stays as it was, like a kept one.
    const declares = new Set(scene.steps.flatMap((st) => st.elements.map((e) => e.id)));
    const carryAttr = (scene.attrs.carry ?? "").split(",").filter((id) => prevElements.has(id));
    const carry = carryAttr.filter((id) => declares.has(id));
    const keep = [...keepAttr, ...carryAttr.filter((id) => !declares.has(id) && !keepAttr.includes(id))];
    const kept = new Map(keep.filter((id) => prevBoxes.has(id)).map((id) => [id, prevBoxes.get(id)!]));
    // A commit is a dot with its label: an icon, box or node declared as a commit would draw a big glyph over the lines.
    if (scene.attrs.template === "gitgraph") {
      for (const st of scene.steps) for (const e of st.elements) if (["icon", "asset", "box", "node"].includes(e.kind)) Object.assign(e, { kind: "circle", name: undefined, version: undefined });
    }
    const layout = layoutScene(scene, ctx, kept);
    diagnostics.push(...layout.diagnostics);

    const elements: ElementIR[] = keep.filter((id) => prevElements.has(id)).map((id) => ({ ...prevElements.get(id)!, step: 0 }));
    scene.steps.forEach((step, si) => {
      for (const el of step.elements) elements.push(lowerElement(el, si, layout, assets, lock));
    });
    // Parameters a layout variant implies (left-aligned headlines, ...).
    for (const el of elements) {
      const extra = layout.params.get(el.id);
      if (extra) el.params = { ...el.params, ...extra };
    }
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
      ...(carry.length && { carry }),
      ...(scene.attrs.frame === "close" && { frame: "close" as const }),
      elements,
      steps: scene.steps.map((step) => ({
        ...(step.id !== undefined && { id: step.id }),
        ...(step.title !== undefined && { title: step.title }),
        ...(step.layout && { layout: step.layout.name }),
        ...(step.focus && { focus: step.focus.name }),
        beats: step.beats.map((beat): BeatIR => {
          const actions = beat.actions.map((a) => lowerAction(a, elements, layout, motion));
          return beat.type === "speech"
            ? { type: "speech", text: beat.text, cues: beat.cues.map((c) => ({ id: c.id, start: c.start, ...(c.end !== undefined && { end: c.end }) })), actions, line: beat.span.line }
            : { type: "wait", seconds: beat.seconds, actions, line: beat.span.line };
        }),
      })),
    };
    const html = htmlSceneOf(scene);
    if (html) hostHtml(ir, html, { width: w!, height: h! }, motion);
    titleFirst(ir);
    furnish(ir, layout, motion);
    scenes.push(ir);
    prevBoxes = layout.boxes;
    prevElements = new Map(elements.map((e) => [e.id, e]));
  }

  boundaries(scenes, script, motion);

  return {
    ir: {
      irVersion: IR_VERSION,
      dslVersion: script.version,
      ...(script.title !== undefined && { title: script.title }),
      canvas: { width: w!, height: h!, fps },
      // Grid scenes are designed for the monochrome editorial theme.
      theme: setting(script.settings, "theme")?.[0] ?? (script.scenes.some((s) => s.attrs.grid !== undefined) ? "editorial" : DEFAULTS.theme),
      motion: motion.name,
      ...(kitOf(script) && { kit: kitOf(script) }),
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
    const found = assets.resolve(el.kind, el.name!);
    // Unknown names are NAR306 errors; without auto-fix (the scene check before a repair) they still need a body.
    if (!found) {
      const { name: _name, version: _version, ...rest } = el;
      return lowerElement({ ...rest, kind: "placeholder", texts: [el.texts[0] ?? el.name ?? el.id], attrs: {} }, step, layout, assets, lock);
    }
    const m = found.manifest;
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

function lowerAction(action: Action, elements: ElementIR[], layout: SceneLayout, motion: MotionProfile): ActionIR {
  return {
    anchor: action.anchor,
    line: action.span.line,
    calls: action.calls.map((call) => {
      const verb = findVerb(call.verb)!;
      const args: Args = call.args;
      const params = typed(args.params, verb.params);
      for (const [k, spec] of Object.entries(verb.params)) if (!(k in params) && spec.default !== undefined) params[k] = spec.default;
      delete params.until;
      delete params.dest;

      let duration: ActionIR["calls"][number]["duration"];
      if (args.duration !== undefined) duration = args.duration;
      else if (args.params.until !== undefined) duration = { until: args.params.until };
      else if (args.fit) duration = "fit";
      else if (verb.name === "write") {
        const chars = Math.max(...call.targets.map((t) => elements.find((e) => e.id === t.split(".")[0])?.texts[0]?.length ?? 0), 0);
        duration = round2(Math.max(DEFAULTS.minWrite, chars / DEFAULTS.writeCps));
      } else duration = round2(verb.defaultDuration * motion.durScale);

      // A move the compiler worked out (trace scenes) carries its destination; a written one names a place.
      const given = verb.name === "move" ? args.params.dest?.split(",").map(Number) : undefined;
      const dest = given && given.length === 4 && given.every(Number.isFinite) ? { x: given[0]!, y: given[1]!, w: given[2]!, h: given[3]! } : verb.name === "move" && args.place && call.targets[0] ? layout.destination(call.targets[0], args.place) : undefined;
      return {
        verb: verb.name,
        verbVersion: verb.version,
        targets: call.targets,
        duration,
        delay: args.delay ?? 0,
        // Several elements entering on one cue come in one after another, not as a block.
        stagger: round2((args.stagger ?? (ENTER.has(verb.name) && call.targets.length > 1 ? 0.14 : 0)) * motion.staggerScale),
        ...(args.to !== undefined && { to: args.to }),
        ...(dest && { dest }),
        params,
      };
    }),
  };
}

const ENTER = new Set(VERBS.filter((v) => v.category === "enter").map((v) => v.name));

/** When an element first appears: step, beat, position of its anchor in the beat, and seconds after the anchor. */
interface Moment {
  step: number;
  beat: number;
  rank: number;
  anchor: string;
  offset: number;
  line: number;
}

/** How long a heading may take to type: it frames the scene, so it should be readable almost at once. */
const TITLE_WRITE = 0.6;
/** A title slide's headline is the content itself: it may take a little longer. */
const HEADLINE_WRITE = 1.0;

/**
 * A scene's own title (the `title` element) is on screen as the scene appears, like the automatic heading:
 * a script that writes it on a later cue, after other content, would leave the frame headless until then.
 * Typing is capped so the title never sits half-written.
 */
function titleFirst(scene: SceneIR): void {
  const title = scene.elements.find((e) => e.id === "title" && e.step === 0);
  if (!title) return;
  const cap = scene.template === "title" ? HEADLINE_WRITE : TITLE_WRITE;
  const beats = scene.steps[0]?.beats ?? [];
  for (const [bi, beat] of beats.entries()) {
    for (const action of beat.actions) {
      const call = action.calls.find((c) => ENTER.has(c.verb) && c.targets.includes("title"));
      if (!call) continue;
      if (typeof call.duration === "number") call.duration = Math.min(call.duration, cap);
      // A scene heading appears whole and quickly: typed text is half a word for the first moments, and a
      // viewer (or a frame taken early) sees a cut-off title. A title slide keeps its typed headline.
      if (scene.template !== "title" && call.verb === "write") {
        const fade = findVerb("fade")!;
        call.verb = "fade";
        call.verbVersion = fade.version;
        call.duration = 0.35;
        call.params = { ease: "out" };
      }
      // Already the first thing of the scene.
      if (bi === 0 && action.anchor === "start" && action.calls[0] === call) return;
      const moved = { ...call, targets: ["title"], delay: -5, stagger: 0 };
      call.targets = call.targets.filter((t) => t !== "title");
      if (!call.targets.length) action.calls.splice(action.calls.indexOf(call), 1);
      if (!action.calls.length) beat.actions.splice(beat.actions.indexOf(action), 1);
      beats[0]!.actions.unshift({ anchor: "start", line: action.line, calls: [moved] });
      return;
    }
  }
}

/**
 * An HTML scene: the declared elements stay (their verbs say when each item is spoken) but nothing is drawn for them; one
 * `motion` element hosts the designer's page and shows from the start of the scene.
 */
function hostHtml(scene: SceneIR, html: HtmlScene, canvas: { width: number; height: number }, motion: MotionProfile): void {
  for (const el of scene.elements) el.params = { ...el.params, virtual: true };
  scene.elements.push(motionElement(html, canvas, html.theme, scene.steps[0]?.beats[0]?.line ?? 0));
  const beat = scene.steps[0]?.beats[0];
  const fade = findVerb("fade")!;
  beat?.actions.unshift({ anchor: "start", line: beat.line, calls: [{ verb: "fade", verbVersion: fade.version, targets: [MOTION_ID], duration: round2(0.01 * motion.durScale), delay: 0, stagger: 0, params: {} }] });
}

const later = (a: Moment, b: Moment) => (a.step - b.step || a.beat - b.beat || a.rank - b.rank || a.offset - b.offset) > 0;

/**
 * Adds what the template draws by itself (layout.decor) to the scene: each
 * decoration becomes an element, shown by an action on the same anchor as
 * the last of the elements it belongs to. A decoration of an element that
 * is never shown is left out.
 */
function furnish(scene: SceneIR, layout: SceneLayout, motion: MotionProfile): void {
  if (!layout.decor.length) return;
  const first = new Map<string, Moment>();
  // Elements kept from the previous scene are on screen from the start.
  const opening: Moment = { step: 0, beat: 0, rank: -1, anchor: "start", offset: 0, line: scene.steps[0]?.beats[0]?.line ?? 0 };
  for (const id of [...scene.keep, ...(scene.carry ?? [])]) first.set(id, opening);
  scene.steps.forEach((step, si) =>
    step.beats.forEach((beat, bi) => {
      const rankOf = (anchor: string) => {
        if (anchor === "start") return -1;
        if (anchor === "end") return 1e6;
        const cue = beat.type === "speech" ? beat.cues.find((c) => c.id === anchor) : undefined;
        return cue ? cue.start : 0;
      };
      for (const action of beat.actions) {
        let elapsed = 0;
        for (const call of action.calls) {
          // clone a,b: the copies (every target after the first) appear, so what is shown with them (a lane's name and line) does too.
          const entering = ENTER.has(call.verb) ? call.targets : call.verb === "clone" ? call.targets.slice(1) : [];
          if (entering.length) {
            entering.forEach((id, k) => {
              const known = Number.isFinite(elapsed);
              const m: Moment = known
                ? { step: si, beat: bi, rank: rankOf(action.anchor), anchor: action.anchor, offset: elapsed + call.delay + k * call.stagger, line: action.line }
                : { step: si, beat: bi, rank: 1e6, anchor: "end", offset: 0, line: action.line };
              if (!first.has(id)) first.set(id, m);
            });
          }
          // A chained call starts when the one before it ends; "fit" and "until" lengths are only known later.
          elapsed = typeof call.duration === "number" ? elapsed + call.delay + call.duration : NaN;
        }
      }
    }),
  );

  for (const d of layout.decor) {
    // A declared element shown with another one (a zone with its first member), unless the script shows it itself.
    if (d.kind === "show") {
      const m = first.get(d.follows[0]!);
      const beat = m && scene.steps[m.step]?.beats[m.beat];
      if (!m || !beat || first.has(d.id)) continue;
      const fade = findVerb("fade")!;
      beat.actions.push({ anchor: m.anchor, line: m.line, calls: [{ verb: "fade", verbVersion: fade.version, targets: [d.id], duration: round2(fade.defaultDuration * motion.durScale), delay: round2(Math.max(0, m.offset - 0.1)), stagger: 0, params: { ease: "out" } }] });
      first.set(d.id, m);
      continue;
    }
    const moments = d.follows.map((id) => first.get(id));
    if (moments.some((m) => !m)) continue;
    // A decoration that belongs to no element (a scene heading) is there from the start.
    const at = moments.length ? (moments as Moment[]).reduce((a, b) => (later(b, a) ? b : a)) : opening;
    const beat = scene.steps[at.step]?.beats[at.beat];
    if (!beat) continue;
    scene.elements.push({
      id: d.id,
      kind: d.kind,
      component: d.kind,
      texts: d.text !== undefined ? [d.text] : [],
      ...(d.link && { link: d.link }),
      params: { ...d.params, auto: true },
      box: layout.boxes.get(d.id) ?? { x: 0, y: 0, w: 0, h: 0 },
      layer: "svg",
      parts: [],
      step: at.step,
      line: at.line,
    });
    // Lines are drawn, numbers pop, panels fade in with their item.
    const verb = findVerb(d.kind === "badge" ? "pop" : d.kind === "panel" || d.kind === "kicker" || d.kind === "caption" || d.kind === "chevron" ? "fade" : "draw")!;
    const params: Record<string, string | number | boolean> = {};
    for (const [k, spec] of Object.entries(verb.params)) if (spec.default !== undefined) params[k] = spec.default;
    delete params.until;
    beat.actions.push({
      anchor: at.anchor,
      line: at.line,
      calls: [
        {
          verb: verb.name,
          verbVersion: verb.version,
          targets: [d.id],
          duration: round2((d.kind === "badge" || d.kind === "panel" ? verb.defaultDuration : 0.6) * motion.durScale),
          // A scene heading is on screen as the scene appears, before the narrator starts.
          delay: d.kind === "kicker" ? -5 : round2(at.offset + (d.kind === "panel" || d.kind === "chevron" ? 0 : 0.12)),
          stagger: 0,
          params,
        },
      ],
    });
  }
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

/**
 * Scene transitions. A new scene starts empty (its elements appear on their
 * cues), so a transition only shows on the scene being left. With the
 * standard personality, `in=` keeps its original meaning (`auto` = fade).
 * With any other personality, a scene's transition (`in=`, or the next one
 * from the personality's set for `auto`) becomes the previous scene's
 * exit, unless that scene chose its own `out=`; the video ends with a fade.
 */
function boundaries(scenes: SceneIR[], script: Script, motion: MotionProfile): void {
  const pick = (name: string, i: number) => (name === "auto" ? motion.transitions[i % motion.transitions.length]! : name);
  // A scene that carries an element on from the previous one meets it with a cut: the element must not fade with its scene.
  const cutAtCarry = () =>
    scenes.forEach((s, i) => {
      if (i > 0 && s.carry?.length) {
        s.transitionIn = "cut";
        scenes[i - 1]!.transitionOut = "cut";
      }
    });
  // `in=into:<id>`: the previous scene zooms into that element, and this one starts at once.
  const intoAtBoundary = () =>
    scenes.forEach((s, i) => {
      if (i > 0 && s.transitionIn.startsWith("into:")) {
        scenes[i - 1]!.transitionOut = s.transitionIn;
        s.transitionIn = "cut";
      }
    });
  if (motion.name === "standard") {
    for (const s of scenes) s.transitionIn = s.transitionIn === "auto" ? "fade" : s.transitionIn;
    intoAtBoundary();
    cutAtCarry();
    return;
  }
  scenes.forEach((s, i) => {
    const wanted = pick(s.transitionIn, i);
    s.transitionIn = i === 0 ? "fade" : wanted.startsWith("into:") ? wanted : "cut";
    if (i > 0 && script.scenes[i - 1]!.attrs.out === undefined) scenes[i - 1]!.transitionOut = wanted;
  });
  const last = scenes.at(-1);
  if (last && script.scenes.at(-1)!.attrs.out === undefined) last.transitionOut = "fade";
  intoAtBoundary();
  cutAtCarry();
}

/** The `kit` setting when it names a known decor kit (and isn't plain). */
function kitOf(script: Script): string | undefined {
  const k = script.settings.find((x) => x.key === "kit")?.args[0];
  return k && k !== "plain" && (KITS as readonly string[]).includes(k) ? k : undefined;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
