import type { Action, Beat, Diagnostic, ElementDecl, Place, Scene, Script, Setting, Span, SpeechBeat, Step, VerbCall } from "@anim/dsl";
import {
  AssetLibrary,
  BACKGROUNDS,
  CHART_TYPES,
  COMPONENTS,
  findComponent,
  findTemplate,
  findVerb,
  LAYOUTS,
  MOTIONS,
  partsOf,
  RELATIONS,
  SCENE_ATTRS,
  SLOTS,
  TEMPLATES,
  THEMES,
  TRANSITIONS,
  VERBS,
  type ComponentManifest,
  type ParamSpec,
  type VerbManifest,
} from "@anim/registry";
import { closest } from "./fuzzy.js";
import { checkGrid } from "./grid.js";

export interface ValidateOptions {
  assets?: AssetLibrary;
  /** Apply deterministic fixes to a copy of the script. Default true. */
  autofix?: boolean;
  /** Narration longer than this (words) gets a warning. */
  maxBeatWords?: number;
  /** More elements than this in one scene gets a warning. */
  maxSceneElements?: number;
}

export interface ValidateResult {
  /** The (possibly auto-fixed) script. The input is never mutated. */
  script: Script;
  diagnostics: Diagnostic[];
  /** No unfixed errors remain. */
  ok: boolean;
}

export const ValidateCodes = {
  // L2 schema / type
  UnknownVerb: "NAR201",
  UnknownKind: "NAR202",
  UnknownTemplate: "NAR203",
  UnknownLayout: "NAR204",
  BadPlace: "NAR205",
  UnknownParam: "NAR206",
  BadParamValue: "NAR207",
  TextCount: "NAR208",
  NameRule: "NAR209",
  LinkRule: "NAR210",
  TargetRule: "NAR211",
  FitUnsupported: "NAR212",
  UnknownTransition: "NAR213",
  BadSetting: "NAR214",
  UnknownSceneAttr: "NAR215",
  MissingDestination: "NAR216",
  FitNeedsSpan: "NAR217",
  // L3 reference
  UndeclaredElement: "NAR301",
  DuplicateElement: "NAR302",
  UnknownCue: "NAR303",
  UnusedCue: "NAR304",
  BadLinkEndpoint: "NAR305",
  UnknownAsset: "NAR306",
  BadUntil: "NAR307",
  BadReference: "NAR308",
  BadKeep: "NAR309",
  UnknownPart: "NAR310",
  // L4 semantic
  NoNarration: "NAR401",
  NotVisible: "NAR402",
  HideHidden: "NAR403",
  NeverShown: "NAR404",
  TooManyElements: "NAR405",
  BeatTooLong: "NAR406",
  TemplateSlot: "NAR407",
  AlreadyVisible: "NAR408",
  OutsideTemplate: "NAR411",
  DanglingConnector: "NAR412",
} as const;

const C = ValidateCodes;
const LINK_KINDS = new Set(["arrow", "line", "edge"]);
const ENTER = new Set(VERBS.filter((v) => v.category === "enter").map((v) => v.name));
const NEEDS_VISIBLE = new Set(VERBS.filter((v) => v.category === "emphasis" || v.category === "transform").map((v) => v.name));

export function validate(input: Script, options: ValidateOptions = {}): ValidateResult {
  return new Validator(options).run(input);
}

interface Fix {
  desc: string;
  apply: () => void;
}

class Validator {
  private readonly diags: Diagnostic[] = [];
  private readonly autofix: boolean;
  private readonly assets: AssetLibrary;
  private readonly maxBeatWords: number;
  private readonly maxSceneElements: number;

  constructor(opts: ValidateOptions) {
    this.autofix = opts.autofix ?? true;
    this.assets = opts.assets ?? new AssetLibrary();
    this.maxBeatWords = opts.maxBeatWords ?? 40;
    this.maxSceneElements = opts.maxSceneElements ?? 10;
  }

  run(input: Script): ValidateResult {
    const script = structuredClone(input);
    this.settings(script.settings);
    let prev: { declared: Map<string, ElementDecl>; visible: Set<string> } = { declared: new Map(), visible: new Set() };
    for (const scene of script.scenes) prev = this.scene(scene, prev);
    const ok = !this.diags.some((d) => d.severity === "error" && !d.fixed);
    return { script, diagnostics: this.diags, ok };
  }

  // ------------------------------------------------------------ reporting ---

  private report(code: string, severity: Diagnostic["severity"], message: string, span: Span, fix?: Fix): void {
    const d: Diagnostic = { code, severity, message, span };
    if (fix && this.autofix) {
      fix.apply();
      d.fixed = fix.desc;
    }
    this.diags.push(d);
  }

  private error(code: string, message: string, span: Span, fix?: Fix): void {
    this.report(code, "error", message, span, fix);
  }

  private warn(code: string, message: string, span: Span, fix?: Fix): void {
    this.report(code, "warning", message, span, fix);
  }

  // ------------------------------------------------------------- settings ---

  private settings(settings: Setting[]): void {
    for (const s of [...settings]) {
      const arg = s.args[0];
      switch (s.key) {
        case "size":
          if (!arg || !/^\d+x\d+$/.test(arg) || (s.args[1] !== undefined && !/^\d+$/.test(s.args[1]))) {
            this.error(C.BadSetting, "size must be `<W>x<H> [fps]`, e.g. `size 1920x1080 30`", s.span, drop(settings, s, "removed the size setting"));
          }
          break;
        case "fps":
          if (!arg || !/^\d+$/.test(arg) || +arg < 1 || +arg > 120) {
            this.error(C.BadSetting, "fps must be a whole number from 1 to 120", s.span, drop(settings, s, "removed the fps setting"));
          }
          break;
        case "theme": {
          if (arg && (THEMES as readonly string[]).includes(arg)) break;
          const near = arg ? closest(arg, THEMES) : undefined;
          this.warn(C.BadSetting, `unknown theme \`${arg ?? ""}\` (themes: ${THEMES.join(", ")})`, s.span, {
            desc: near ? `used \`${near}\`` : "removed; default theme applies",
            apply: () => (near ? (s.args = [near]) : remove(settings, s)),
          });
          break;
        }
        case "motion": {
          const names = MOTIONS.map((m) => m.name);
          if (arg && names.includes(arg)) break;
          const near = arg ? closest(arg, names) : undefined;
          this.warn(C.BadSetting, `unknown motion \`${arg ?? ""}\` (motions: ${names.join(", ")})`, s.span, {
            desc: near ? `used \`${near}\`` : "removed; standard motion applies",
            apply: () => (near ? (s.args = [near]) : remove(settings, s)),
          });
          break;
        }
        case "bg": {
          // `bg <kind>[+<kind>…] [seed=<n>]`: unknown kinds go to the closest one, or are dropped.
          const names: readonly string[] = BACKGROUNDS.map((b) => b.name);
          const kindArg = s.args.find((a) => !a.includes("="));
          const kinds = (kindArg ?? "").split("+").filter(Boolean);
          const fixed = kinds.map((k) => (names.includes(k) ? k : closest(k, names))).filter((k): k is string => !!k);
          if (!kinds.length || fixed.length !== kinds.length || fixed.some((k, i) => k !== kinds[i])) {
            this.warn(C.BadSetting, `unknown background \`${kindArg ?? ""}\` (backgrounds: ${names.join(", ")})`, s.span, {
              desc: fixed.length ? `used \`${fixed.join("+")}\`` : "removed; the look's background applies",
              apply: () => (fixed.length ? (s.args = [fixed.join("+"), ...s.args.filter((a) => a.includes("="))]) : remove(settings, s)),
            });
          }
          for (const a of s.args.filter((x) => x.includes("="))) {
            if (!/^seed=\d+$/.test(a)) this.warn(C.BadSetting, `bg takes only \`seed=<whole number>\`, not \`${a}\``, s.span, { desc: "ignored", apply: () => (s.args = s.args.filter((x) => x !== a)) });
          }
          break;
        }
        case "lang":
          if (!arg || !/^[a-z]{2}(-[A-Z]{2})?$/.test(arg)) {
            this.warn(C.BadSetting, "lang must look like `en` or `en-US`", s.span, drop(settings, s, "removed the lang setting"));
          }
          break;
        case "voice":
          if (!arg) this.error(C.BadSetting, "voice needs a name", s.span, drop(settings, s, "removed the voice setting"));
          break;
      }
    }
  }

  // ---------------------------------------------------------------- scene ---

  private scene(scene: Scene, prev: { declared: Map<string, ElementDecl>; visible: Set<string> }) {
    this.settings(scene.settings);
    this.sceneAttrs(scene, prev.declared);

    // Kept elements carry over from the previous scene, still visible if they were.
    const declared = new Map<string, ElementDecl>();
    const keep = (scene.attrs.keep ?? "").split(",").filter(Boolean);
    for (const id of keep) {
      const el = prev.declared.get(id);
      if (el) declared.set(id, el);
    }
    const sceneOwn: ElementDecl[] = [];

    // Declarations, step by step, so a beat can only use elements declared by its step.
    const stepKnown: Set<string>[] = [];
    for (const step of scene.steps) {
      for (const el of [...step.elements]) {
        if (declared.has(el.id)) {
          this.error(C.DuplicateElement, `element \`${el.id}\` is already declared in this scene`, el.span, drop(step.elements, el, "removed the duplicate"));
          continue;
        }
        declared.set(el.id, el);
        sceneOwn.push(el);
      }
      stepKnown.push(new Set(declared.keys()));
    }
    for (const step of scene.steps) for (const el of [...step.elements]) this.element(el, step, declared);
    if (this.autofix) {
      // Forget elements that a fix removed.
      const remaining = new Set(scene.steps.flatMap((s) => s.elements));
      for (const el of [...sceneOwn]) {
        if (remaining.has(el)) continue;
        remove(sceneOwn, el);
        declared.delete(el.id);
        for (const known of stepKnown) known.delete(el.id);
      }
    }

    this.template(scene, sceneOwn);
    for (const step of scene.steps) {
      if (step.layout && !(LAYOUTS as readonly string[]).includes(step.layout.name)) {
        const layout = step.layout;
        const near = closest(layout.name, LAYOUTS);
        this.error(C.UnknownLayout, `unknown layout \`${layout.name}\` (layouts: ${LAYOUTS.join(", ")})`, layout.span, {
          desc: `used \`${near ?? "row"}\``,
          apply: () => (layout.name = near ?? "row"),
        });
      }
      if (step.focus && step.focus.name !== "reset" && !declared.has(step.focus.name)) {
        const focus = step.focus;
        const near = closest(focus.name, declared.keys());
        this.error(C.BadReference, `focus target \`${focus.name}\` is not declared`, focus.span, {
          desc: near ? `used \`${near}\`` : "removed the focus",
          apply: () => (near ? (focus.name = near) : delete step.focus),
        });
      }
    }

    if (sceneOwn.filter((e) => !LINK_KINDS.has(e.kind)).length > this.maxSceneElements) {
      this.warn(C.TooManyElements, `scene has more than ${this.maxSceneElements} elements; consider splitting it`, scene.span);
    }

    // Beats: references first, then the visibility simulation over the fixed actions.
    let hasSpeech = false;
    scene.steps.forEach((step, i) => {
      for (const beat of step.beats) {
        if (beat.type === "speech" && beat.text.trim()) hasSpeech = true;
        this.beat(beat, stepKnown[i]!, declared);
      }
    });
    if (!hasSpeech) this.error(C.NoNarration, `scene \`${scene.id}\` has no narration`, scene.span);

    const visible = new Set([...prev.visible].filter((id) => keep.includes(id)));
    const shown = new Set(visible);
    for (const step of scene.steps) for (const beat of step.beats) this.visibility(beat, visible, shown, declared);
    for (const el of sceneOwn) {
      if (!shown.has(el.id)) this.warn(C.NeverShown, `element \`${el.id}\` is declared but never shown`, el.span);
    }
    return { declared, visible };
  }

  private sceneAttrs(scene: Scene, prevDeclared: Map<string, ElementDecl>): void {
    for (const [key, value] of Object.entries(scene.attrs)) {
      if (!(SCENE_ATTRS as readonly string[]).includes(key)) {
        this.warn(C.UnknownSceneAttr, `unknown scene attribute \`${key}\``, scene.span, { desc: "ignored", apply: () => delete scene.attrs[key] });
      } else if ((key === "in" || key === "out") && !(TRANSITIONS as readonly string[]).includes(value)) {
        const near = closest(value, TRANSITIONS);
        this.error(C.UnknownTransition, `unknown transition \`${value}\` (transitions: ${TRANSITIONS.join(", ")})`, scene.span, {
          desc: `used \`${near ?? "fade"}\``,
          apply: () => (scene.attrs[key] = near ?? "fade"),
        });
      } else if (key === "template" && !findTemplate(value)) {
        const near = closest(value, TEMPLATES.map((t) => t.name));
        this.error(C.UnknownTemplate, `unknown template \`${value}\` (templates: ${TEMPLATES.map((t) => t.name).join(", ")})`, scene.span, {
          desc: near ? `used \`${near}\`` : "removed; the scene falls back to a layout",
          apply: () => (near ? (scene.attrs.template = near) : delete scene.attrs.template),
        });
      } else if (key === "keep") {
        const ids = value.split(",").filter(Boolean);
        const missing = ids.filter((id) => !prevDeclared.has(id));
        if (missing.length) {
          this.error(C.BadKeep, `keep: \`${missing.join(", ")}\` not declared in the previous scene`, scene.span, {
            desc: "removed from keep",
            apply: () => {
              const rest = ids.filter((id) => prevDeclared.has(id));
              if (rest.length) scene.attrs.keep = rest.join(",");
              else delete scene.attrs.keep;
            },
          });
        }
      }
    }
  }

  // -------------------------------------------------------------- element ---

  private element(el: ElementDecl, step: Step, declared: Map<string, ElementDecl>): void {
    let comp = findComponent(el.kind);
    if (!comp) {
      const near = closest(el.kind, COMPONENTS.map((c) => c.kind));
      this.error(C.UnknownKind, `unknown element kind \`${el.kind}\``, el.span, {
        desc: near ? `used \`${near}\`` : "replaced with a placeholder",
        apply: () => {
          if (near) el.kind = near;
          else toPlaceholder(el);
        },
      });
      if (!this.autofix) return;
      comp = findComponent(el.kind)!;
    }

    if (el.kind === "icon" || el.kind === "asset") this.assetName(el);
    else if (comp.named === "none" && el.name !== undefined) {
      this.warn(C.NameRule, `\`${el.kind}\` does not take a name (\`${el.kind}:${el.name}\`)`, el.span, { desc: "removed the name", apply: () => delete el.name });
    }
    if (el.kind === "chart" && !(CHART_TYPES as readonly string[]).includes(el.name ?? "")) {
      this.error(C.NameRule, `chart type must be one of: ${CHART_TYPES.join(", ")}`, el.span, { desc: "used `bar`", apply: () => (el.name = "bar") });
    }
    comp = findComponent(el.kind) ?? comp;

    if (el.texts.length > comp.texts.max) {
      this.warn(C.TextCount, `\`${el.kind}\` takes at most ${comp.texts.max} text(s)`, el.span, {
        desc: "dropped the extra text",
        apply: () => (el.texts = el.texts.slice(0, comp.texts.max)),
      });
    } else if (el.texts.length < comp.texts.min) {
      this.error(C.TextCount, `\`${el.kind}\` needs ${comp.texts.min} text(s), e.g. \`${el.id} = ${el.kind} "..."\``, el.span, {
        desc: `used the id \`${el.id}\` as text`,
        apply: () => el.texts.push(el.id),
      });
    }

    if (comp.link && !el.link) {
      this.error(C.LinkRule, `\`${el.kind}\` needs two endpoints: \`${el.id} = ${el.kind} a->b\``, el.span, drop(step.elements, el, "removed the element"));
      return;
    }
    if (!comp.link && el.link) {
      this.warn(C.LinkRule, `\`${el.kind}\` does not connect elements`, el.span, { desc: "removed the link", apply: () => delete el.link });
    }
    if (el.link) {
      for (const end of ["from", "to"] as const) {
        const id = el.link[end];
        if (declared.has(id) && id !== el.id) continue;
        const link = el.link;
        const near = closest(id, [...declared.keys()].filter((k) => k !== el.id));
        this.error(C.BadLinkEndpoint, `\`${el.id}\` connects to \`${id}\`, which is not declared`, el.span, near
          ? { desc: `used \`${near}\``, apply: () => (link[end] = near) }
          : drop(step.elements, el, "removed the connector"));
      }
    }

    this.params(el.attrs, comp.params, el.span, `\`${el.kind}\``);
    if (el.place) this.place(el.place, el.span, declared, () => delete el.place);
  }

  private assetName(el: ElementDecl): void {
    const kind = el.kind as "icon" | "asset";
    if (!el.name) {
      this.error(C.NameRule, `\`${kind}\` needs a name: \`${el.id} = ${kind}:sun\``, el.span, { desc: "replaced with a placeholder", apply: () => toPlaceholder(el) });
      return;
    }
    const name = el.name;
    const match = this.assets.resolve(kind, name);
    if (match?.via === "exact") return;
    if (match) {
      const target = `${match.manifest.kind}:${match.manifest.name}`;
      this.warn(C.UnknownAsset, `\`${kind}:${name}\` resolved to \`${target}\``, el.span, {
        desc: `used \`${target}\``,
        apply: () => {
          el.kind = match.manifest.kind;
          el.name = match.manifest.name;
        },
      });
      return;
    }
    const near = closest(name, this.assets.all().filter((a) => a.kind === kind).map((a) => a.name));
    this.warn(C.UnknownAsset, `no ${kind} named \`${name}\` in the library`, el.span, {
      desc: near ? `used \`${kind}:${near}\`` : "replaced with a labeled placeholder",
      apply: () => {
        if (near) el.name = near;
        else toPlaceholder(el, name);
      },
    });
  }

  private template(scene: Scene, own: ElementDecl[]): void {
    if (scene.attrs.grid !== undefined) {
      checkGrid(scene, own, { autofix: this.autofix, error: this.error.bind(this), warn: this.warn.bind(this) });
      return;
    }
    const tpl = scene.attrs.template ? findTemplate(scene.attrs.template) : undefined;
    if (!tpl) return;
    const slotNames = new Set(tpl.slots.map((s) => s.name));
    for (const slot of tpl.slots) {
      const el = own.find((e) => e.id === slot.name);
      if (!el) {
        if (slot.required) this.error(C.TemplateSlot, `template \`${tpl.name}\` needs a \`${slot.name}\` element`, scene.span);
      } else if (!slot.accepts.includes(el.kind) && el.kind !== "placeholder") {
        this.error(C.TemplateSlot, `slot \`${slot.name}\` accepts ${slot.accepts.join(", ")}, not \`${el.kind}\``, el.span);
      }
    }
    const free = own.filter((e) => !slotNames.has(e.id) && !e.place && !LINK_KINDS.has(e.kind));
    if (tpl.graph) {
      const nodes = own.filter((e) => e.kind === "node");
      if (nodes.length > tpl.graph.maxNodes) this.error(C.TemplateSlot, `template \`${tpl.name}\` holds at most ${tpl.graph.maxNodes} nodes`, scene.span);
      for (const e of free.filter((e) => e.kind !== "node")) {
        this.warn(C.OutsideTemplate, `\`${e.id}\` is not a node; give it a placement like \`@B\``, e.span);
      }
    } else if (tpl.items) {
      const items = tpl.items;
      for (const e of free) {
        if (!items.accepts.includes(e.kind) && e.kind !== "placeholder") this.error(C.TemplateSlot, `template \`${tpl.name}\` items accept ${items.accepts.join(", ")}, not \`${e.kind}\``, e.span);
      }
      if (free.length > items.max) this.error(C.TemplateSlot, `template \`${tpl.name}\` holds at most ${items.max} items (got ${free.length}); split the scene`, scene.span);
      else if (free.length < items.min) this.warn(C.TemplateSlot, `template \`${tpl.name}\` expects at least ${items.min} items (got ${free.length})`, scene.span);
    } else {
      for (const e of free) this.warn(C.OutsideTemplate, `\`${e.id}\` doesn't fill a slot of \`${tpl.name}\` (slots: ${[...slotNames].join(", ")}); give it a placement`, e.span);
    }
  }

  // ----------------------------------------------------------------- beat ---

  private beat(beat: Beat, known: Set<string>, declared: Map<string, ElementDecl>): void {
    const cueIds = new Set(beat.type === "speech" ? beat.cues.map((c) => c.id) : []);
    if (beat.type === "speech") {
      const words = beat.text.split(/\s+/).filter(Boolean).length;
      if (words > this.maxBeatWords) this.warn(C.BeatTooLong, `beat has ${words} words; keep one idea per beat (≤${this.maxBeatWords})`, beat.span);
    }

    // Writers often number cues across the whole scene (`{1}` in the text, `2 pop x` below it).
    // Pair unknown anchors with this beat's unused cues, both in order of appearance.
    const isUnknown = (a: string) => a !== "start" && a !== "end" && !cueIds.has(a);
    const unknown = [...new Set(beat.actions.map((a) => a.anchor).filter(isUnknown))];
    const anchored = new Set(beat.actions.map((a) => a.anchor));
    const unused = beat.type === "speech" ? beat.cues.map((c) => c.id).filter((id) => !anchored.has(id)) : [];
    const remap = new Map(unknown.slice(0, unused.length).map((a, i) => [a, unused[i]!]));

    for (const action of [...beat.actions]) {
      if (isUnknown(action.anchor)) {
        const where = beat.type === "wait" ? "a `wait` only has `start` and `end`" : `cues here: ${[...cueIds].join(", ") || "none"}`;
        const to = remap.get(action.anchor);
        const fix = to ? { desc: `anchored on cue \`${to}\``, apply: () => (action.anchor = to) } : drop(beat.actions, action, "removed the action");
        this.error(C.UnknownCue, `anchor \`${action.anchor}\` is not a cue of this beat (${where})`, action.span, fix);
        if (!to || !this.autofix) continue;
      }
      for (const call of [...action.calls]) this.call(call, action, beat, known, declared);
      if (!action.calls.length && this.autofix) remove(beat.actions, action);
    }

    if (beat.type === "speech") {
      const used = new Set(beat.actions.flatMap((a) => [a.anchor, ...a.calls.map((c) => c.args.params.until ?? "")]));
      for (const cue of beat.cues) {
        if (!used.has(cue.id)) this.warn(C.UnusedCue, `cue \`${cue.id}\` has no action`, cue.span);
      }
    }
  }

  private call(call: VerbCall, action: Action, beat: Beat, known: Set<string>, declared: Map<string, ElementDecl>): void {
    const verb = findVerb(call.verb);
    if (!verb) {
      const near = closest(call.verb, VERBS.map((v) => v.name));
      this.error(C.UnknownVerb, `unknown verb \`${call.verb}\` (verbs: ${VERBS.map((v) => v.name).join(", ")})`, call.span, near
        ? { desc: `used \`${near}\``, apply: () => (call.verb = near) }
        : drop(action.calls, call, "removed the verb"));
      if (!near || !this.autofix) return;
    }
    const v = findVerb(call.verb)!;

    // Targets.
    const isReset = v.name === "focus" && call.targets.length === 1 && call.targets[0] === "reset";
    if (v.targets === "none" && call.targets.length) {
      this.warn(C.TargetRule, `\`${v.name}\` takes no targets`, call.span, { desc: "removed the targets", apply: () => (call.targets = []) });
    }
    if (!isReset) {
      for (const t of [...call.targets]) this.target(t, call, known, declared);
    }
    if (v.targets === "required" && !call.targets.length) {
      this.error(C.TargetRule, `\`${v.name}\` needs a target`, call.span, drop(action.calls, call, "removed the verb"));
      return;
    }

    // Args.
    const args = call.args;
    const span = beat.type === "speech" ? beat.cues.find((c) => c.id === action.anchor) : undefined;
    const isFirst = action.calls[0] === call;
    if (args.fit && !v.supportsFit) {
      this.warn(C.FitUnsupported, `\`${v.name}\` does not support \`fit\``, call.span, { desc: "removed `fit`", apply: () => delete args.fit });
    } else if (args.fit && isFirst && span?.end === undefined) {
      this.warn(C.FitNeedsSpan, "`fit` needs a span cue like `{1 some words}`", call.span, { desc: "removed `fit`; default duration applies", apply: () => delete args.fit });
    }
    if (args.to !== undefined && !declared.has(args.to)) {
      this.error(C.BadReference, `\`->${args.to}\` is not declared`, call.span, { desc: "removed it", apply: () => delete args.to });
    }
    if (v.name === "move") {
      if (!args.place) {
        this.error(C.MissingDestination, "`move` needs a destination like `@TR` or `@right-of:x`", call.span, drop(action.calls, call, "removed the verb"));
        return;
      }
      this.place(args.place, call.span, declared, () => delete args.place);
    } else if (args.place) {
      this.warn(C.BadPlace, `\`${v.name}\` does not take a destination`, call.span, { desc: "removed it", apply: () => delete args.place });
    }
    const until = args.params.until;
    if (until !== undefined) {
      const cues = beat.type === "speech" ? beat.cues : [];
      const anchorAt = span?.start ?? (action.anchor === "start" ? -1 : Infinity);
      const target = cues.find((c) => c.id === until);
      if (!target || target.start <= anchorAt) {
        this.error(C.BadUntil, `until=${until} must name a later cue in this beat`, call.span, { desc: "removed `until`", apply: () => delete args.params.until });
      }
    }
    this.params(args.params, v.params, call.span, `\`${v.name}\``, ["until"]);
  }

  private target(t: string, call: VerbCall, known: Set<string>, declared: Map<string, ElementDecl>): void {
    if (t === "*") return;
    const [base, part] = t.split(".") as [string, string | undefined];
    if (!known.has(base)) {
      const near = closest(base, known);
      const later = declared.has(base);
      this.error(C.UndeclaredElement, later ? `\`${base}\` is declared in a later step` : `\`${base}\` is not declared${near ? ` (did you mean \`${near}\`?)` : ""}`, call.span, near && !later
        ? { desc: `used \`${near}\``, apply: () => replace(call.targets, t, part ? `${near}.${part}` : near) }
        : { desc: "removed the target", apply: () => remove(call.targets, t) });
      return;
    }
    if (part === undefined) return;
    const el = declared.get(base)!;
    const parts = partsOf(el, this.assets, COMPONENTS);
    if (parts === "any" || parts.includes(part)) return;
    this.warn(C.UnknownPart, `\`${base}\` has no part \`${part}\`${parts.length ? ` (parts: ${parts.join(", ")})` : ""}`, call.span, {
      desc: `targeted \`${base}\` instead`,
      apply: () => replace(call.targets, t, base),
    });
  }

  private place(p: Place, span: Span, declared: Map<string, ElementDecl>, removeIt: () => void): void {
    if (p.kind === "slot") {
      if ((SLOTS as readonly string[]).includes(p.slot)) return;
      const near = closest(p.slot, SLOTS, 1);
      this.error(C.BadPlace, `unknown slot \`@${p.slot}\` (slots: ${SLOTS.join(" ")})`, span, near
        ? { desc: `used \`@${near}\``, apply: () => (p.slot = near) }
        : { desc: "removed the placement", apply: removeIt });
      return;
    }
    if (!(RELATIONS as readonly string[]).includes(p.relation)) {
      const near = closest(p.relation, RELATIONS);
      this.error(C.BadPlace, `unknown relation \`${p.relation}\` (relations: ${RELATIONS.join(", ")})`, span, near
        ? { desc: `used \`${near}\``, apply: () => (p.relation = near) }
        : { desc: "removed the placement", apply: removeIt });
    }
    if (!declared.has(p.ref)) {
      this.error(C.BadReference, `placement refers to \`${p.ref}\`, which is not declared`, span, { desc: "removed the placement", apply: removeIt });
    }
  }

  private params(params: Record<string, string>, specs: Record<string, ParamSpec>, span: Span, owner: string, skip: string[] = []): void {
    for (const [key, value] of Object.entries(params)) {
      if (skip.includes(key)) continue;
      const spec = specs[key];
      if (!spec) {
        const known = Object.keys(specs).filter((k) => !skip.includes(k));
        this.warn(C.UnknownParam, `${owner} has no parameter \`${key}\`${known.length ? ` (parameters: ${known.join(", ")})` : ""}`, span, { desc: "ignored", apply: () => delete params[key] });
        continue;
      }
      const problem = checkValue(value, spec);
      if (problem) this.error(C.BadParamValue, `${owner} ${key}=${value}: ${problem}`, span, { desc: "removed; default applies", apply: () => delete params[key] });
    }
  }

  // ------------------------------------------------------------ visibility ---

  /**
   * Simulates which elements are on stage, in narration order, to catch
   * emphasis on hidden elements (fixed by inserting an enter) and similar.
   */
  private visibility(beat: Beat, visible: Set<string>, shown: Set<string>, declared: Map<string, ElementDecl>): void {
    const order = (a: Action): number => {
      if (a.anchor === "start") return -1;
      if (a.anchor === "end") return Infinity;
      return (beat as SpeechBeat).cues.find((c) => c.id === a.anchor)?.start ?? Infinity;
    };
    const actions = [...beat.actions].sort((a, b) => order(a) - order(b));
    for (const action of actions) {
      // Endpoints revealed later in the same chain (`draw e1 then pop n2`) count as present for connectors.
      const chainEnters = new Set(action.calls.filter((c) => ENTER.has(c.verb)).flatMap((c) => c.targets.map((t) => t.split(".")[0]!)));
      for (const call of [...action.calls]) {
        const v = findVerb(call.verb);
        if (!v) continue;
        if (v.name === "clear") {
          visible.clear();
          continue;
        }
        const targets = call.targets.includes("*") ? [...visible] : call.targets.map((t) => t.split(".")[0]!);
        for (const id of new Set(targets)) this.visit(v, id, call, action, beat, visible, shown, declared, chainEnters);
      }
    }
  }

  private visit(v: VerbManifest, id: string, call: VerbCall, action: Action, beat: Beat, visible: Set<string>, shown: Set<string>, declared: Map<string, ElementDecl>, chainEnters: Set<string>): void {
    if (!declared.has(id)) return;
    if (ENTER.has(v.name)) {
      if (visible.has(id)) this.warn(C.AlreadyVisible, `\`${id}\` is already visible`, call.span);
      const el = declared.get(id)!;
      if (el.link) {
        const missing = [el.link.from, el.link.to].filter((e) => !visible.has(e) && !chainEnters.has(e));
        if (missing.length) this.warn(C.DanglingConnector, `\`${id}\` appears before \`${missing.join("`, `")}\``, call.span);
      }
      visible.add(id);
      shown.add(id);
    } else if (v.name === "hide") {
      if (!visible.has(id)) {
        this.warn(C.HideHidden, `\`${id}\` is not visible, so hiding it does nothing`, call.span, {
          desc: "removed the target",
          apply: () => {
            remove(call.targets, id);
            if (!call.targets.length) remove(action.calls, call);
            if (!action.calls.length) remove(beat.actions, action);
          },
        });
      }
      visible.delete(id);
    } else if (NEEDS_VISIBLE.has(v.name) && !visible.has(id)) {
      this.warn(C.NotVisible, `\`${v.name}\` on \`${id}\` before it appears`, call.span, {
        desc: `inserted \`fade ${id}\` first`,
        apply: () => {
          const fade: VerbCall = { verb: "fade", targets: [id], args: { params: {} }, span: call.span };
          const i = action.calls.indexOf(call);
          if (i > 0) action.calls.splice(i, 0, fade);
          else beat.actions.splice(beat.actions.indexOf(action), 0, { anchor: action.anchor, calls: [fade], span: action.span });
        },
      });
      visible.add(id);
      shown.add(id);
    }
  }
}

// ----------------------------------------------------------------- helpers ---

function checkValue(value: string, spec: ParamSpec): string | undefined {
  switch (spec.type) {
    case "enum":
      return spec.values?.includes(value) ? undefined : `expected one of ${spec.values?.join(", ")}`;
    case "number": {
      const n = Number(value);
      if (value === "" || Number.isNaN(n)) return "expected a number";
      if (spec.min !== undefined && n < spec.min) return `must be ≥ ${spec.min}`;
      if (spec.max !== undefined && n > spec.max) return `must be ≤ ${spec.max}`;
      return undefined;
    }
    case "bool":
      return value === "true" || value === "false" ? undefined : "expected true or false";
    case "color":
      return /^[a-z][a-z0-9-]*$/.test(value) ? undefined : "expected a theme color token like `accent`";
    default:
      return value === "" ? "expected a value" : undefined;
  }
}

function toPlaceholder(el: ElementDecl, label?: string): void {
  const text = el.texts[0] ?? label ?? el.name ?? el.id;
  el.kind = "placeholder";
  delete el.name;
  delete el.version;
  el.texts = [text];
  el.attrs = {};
}

function remove<T>(arr: T[], item: T): void {
  const i = arr.indexOf(item);
  if (i !== -1) arr.splice(i, 1);
}

function replace<T>(arr: T[], item: T, by: T): void {
  const i = arr.indexOf(item);
  if (i !== -1) arr[i] = by;
}

function drop<T>(arr: T[], item: T, desc: string): Fix {
  return { desc, apply: () => remove(arr, item) };
}

export type { ComponentManifest };
