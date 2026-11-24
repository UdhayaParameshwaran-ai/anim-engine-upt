import { compile, report } from "@anim/compiler";
import { print, printScene, type Diagnostic } from "@anim/dsl";
import type { Director } from "@anim/director";
import { AssetLibrary, resolveTemplate, SHAPES, templatesFor, type AssetManifest, type Shape } from "@anim/registry";
import type { ChatMessage, ChatResult, LlmClient, Usage } from "./client.js";
import { briefOf, chooseSystemPrompt, canvasChoicePrompt, canvasOutlinePrompt, castPlan, chosenCanvas, type Domain, pruneCarry, fullPrompt, narrationOf, pictureQuery, decidePrompt, decideSystemPrompt, outlinePrompt, outlineSystemPrompt, repairPrompt, retrieveAssets, sceneKindOf, scenePrompt, sceneSystemPrompt, systemPrompt, type RecentUse } from "./prompt.js";
import { applyDecision, arcBrief, DEFAULT_LEVEL, opensWithQuestion, parseDecision, slotLabel, teachingOf, type Decision, type TeachingPlan } from "./teaching.js";
import { qualityIssues, qualityReport, type SceneArc } from "./quality.js";
import { detectLength, readLengthLine, type Length } from "./length.js";
import { exampleFor, guessUseCase, USE_CASES, useCaseOf, type UseCase } from "./usecases.js";
import { effectiveSpec, type PromptSettings } from "./settings.js";

export interface GenerateOptions {
  client: LlmClient;
  assets?: AssetLibrary;
  /** "outline": plan, then write scenes in parallel. "single": one streamed pass. */
  mode?: "outline" | "single";
  /** Exact scene range; wins over `length`. */
  scenes?: { min: number; max: number };
  /** short | standard | long | deep: scenes, sentences and chapters together. Default: what the topic asks for in words, else standard. */
  length?: Length;
  /** What a person changed about the prompts (audience, tone, notes, length, narration rules, motion hints). Unset fields are the defaults. */
  settings?: PromptSettings;
  /** LLM repair attempts per scene before falling back to auto-fix. */
  maxRepairs?: number;
  /** Scenes written/repaired at once; default the client's limit, else 3. */
  concurrency?: number;
  /** A subject area whose templates planning prefers (see DOMAINS). */
  domain?: Domain;
  /**
   * The whole video as one diagram that grows chapter by chapter (one scene with steps), instead of separate scenes.
   * "auto": a short LLM call decides from the topic.
   */
  canvas?: boolean | "auto";
  /**
   * Decide the use case and the teaching method in a small call before the plan, so the plan is written to the
   * method's beats (one per scene, in order) instead of choosing and following them at once. Default true.
   */
  decideTeaching?: boolean;
  /**
   * With a teaching plan, write the scenes in order: each starts once the scene before has its first draft and reads
   * what the earlier scenes say, so it can pick up where they left off (repairs still overlap). Default true.
   */
  inOrder?: boolean;
  /** One extra LLM pass for a scene that is valid but weak (box-only, placeholders, vague quotes). Default true. */
  qualityRepairs?: boolean;
  /**
   * Styles the video (look, motion, scene arrangements) as it streams,
   * remembering what this user saw before. Without one, the LLM's own style lines stay.
   */
  director?: Director;
  temperature?: number;
  /**
   * Each finished (validated) scene, in order, as soon as it and all earlier
   * scenes are ready, with the video header: `header` plus the scenes so far
   * is a playable script prefix (progressive playback).
   */
  onScene?: (sceneText: string, index: number, header: string) => void;
  onLog?: (message: string) => void;
  /**
   * Every LLM call as it happens: once when it starts (status "running"),
   * again when it ends, and again once its reply has been validated
   * (`check`, `verdict`). The same `id` each time, so consumers upsert.
   */
  onCall?: (call: CallTrace) => void;
}

export type CallKind = "decide" | "outline" | "scene" | "repair" | "quality" | "single" | "choose";

/** One LLM call: what was asked, what came back, how long it took and what it cost. */
export interface CallTrace {
  id: number;
  kind: CallKind;
  /** Scene id the call is about (not for outline/single). */
  scene?: string;
  /** Repair attempt, from 1. */
  attempt?: number;
  status: "running" | "done" | "failed";
  /** Provider and model that served it (a fallback client reports the one that answered). */
  provider?: string;
  model?: string;
  /** Start, in ms since generation began. */
  start: number;
  ms?: number;
  /** Streaming only: ms until the first text arrived. */
  firstTokenMs?: number;
  usage?: Usage;
  /** True when the provider reported no usage and it was estimated from characters (~4 per token). */
  estimated?: boolean;
  /** Which system prompt was sent. */
  system: "outline" | "full" | "scene";
  systemChars: number;
  /** The whole input: the system prompt and every message, in order (earlier turns resent by repairs included). */
  request?: { system: string; messages: ChatMessage[] };
  /** Exactly what the provider received and returned (see ChatResult.wire). */
  wire?: { request: string; response: string };
  /** Messages sent before this call's new user message (conversation context). */
  history: number;
  /** This call's new user message. */
  prompt: string;
  reply?: string;
  /** What triggered a repair or quality pass: the diagnostics or problems sent to the model. */
  reason?: string;
  /** Validation of the reply (scene calls). */
  check?: { errors: number; warnings: number; quality: number };
  /** What happened to the reply, e.g. "kept", "repair needed", "rejected: no better". */
  verdict?: string;
  error?: string;
}

export interface GenerateResult {
  /** Final script: assembled, validated and auto-fixed, in canonical form. */
  script: string;
  /** What the LLM produced after repairs, before auto-fix. */
  raw: string;
  ok: boolean;
  diagnostics: Diagnostic[];
  repairs: number;
  calls: number;
  usage: Usage;
  /** Quality problems left in the final script (see quality.ts). */
  quality: string[];
  /** Every LLM call, in start order. */
  trace: CallTrace[];
  /** Wall time of the whole generation. */
  ms: number;
}

interface Ctx {
  opts: GenerateOptions;
  system: string;
  usage: Usage;
  calls: number;
  repairs: number;
  started: number;
  trace: CallTrace[];
  /** What the video is for (the plan's `# usecase:` line); scenes are written and checked by it. */
  usecase?: UseCase;
  /** The finished example each growing scene was shown, so its wording can be kept out of the scene. */
  examples?: Map<string, string>;
  /** The plan's teaching lines; scenes are written and checked against their place in the arc. */
  teach?: TeachingPlan;
}

interface CallMeta {
  kind: CallKind;
  scene?: string;
  attempt?: number;
  reason?: string;
}

/**
 * Prompt → validated Narrascript. The LLM decides narration, structure,
 * templates, assets and cues; the compiler checks everything, failing
 * scenes go back to the LLM with compact diagnostics, and deterministic
 * auto-fixes handle whatever is left.
 */
export function generate(topic: string, opts: GenerateOptions): Promise<GenerateResult> {
  return run(topic, opts);
}

/** `inherited` carries the trace and counters into the single-pass fallback. */
async function run(topic: string, opts: GenerateOptions, inherited?: Ctx): Promise<GenerateResult> {
  const assets = opts.assets ?? new AssetLibrary();
  // The one-call mode has a single system prompt, so it offers the pictures that match the topic; the outline passes only count them.
  const relevant = (opts.mode ?? "outline") === "single" ? retrieveAssets(topic, assets, 60, opts.domain) : assets.all();
  const ctx: Ctx = inherited
    ? { ...inherited, opts }
    : { opts, system: systemPrompt(relevant, effectiveSpec(opts.settings ?? {}, opts.length ?? detectLength(topic)), opts.settings ?? {}), usage: { prompt: 0, completion: 0 }, calls: 0, repairs: 0, started: performance.now(), trace: [] };
  const settings = opts.settings ?? {};
  const length = settings.length ?? opts.length ?? detectLength(topic);
  // With several scenes the planning step settles the length (it may read it from the request); the one-call mode uses the topic's words.
  let spec = effectiveSpec(settings, length);
  let range = opts.scenes ?? spec.scenes;
  if ((opts.mode ?? "outline") === "single" && (length || settings.scenes)) opts.onLog?.(`length: ${spec.name} (${range.min}–${range.max} scenes)${opts.length || settings.length ? "" : " · from the topic"}`);
  let header = "";
  // The look is set on the header, before the first scene plays; scenes are arranged as they arrive.
  const direct = (h: string) => (opts.director ? opts.director.header(h).trim() : h);
  const arrange = (scene: string) => (opts.director ? opts.director.scene(scene) : scene);
  const emit = orderedEmitter((text, i) => opts.onScene?.(text, i, header));

  let scenes: string[];
  if ((opts.mode ?? "outline") === "outline") {
    // Planning only needs scene types and asset names, not the whole language.
    const recent = opts.director?.recent();
    let canvas = opts.canvas === true;
    if (opts.canvas === "auto") {
      const choice = await chat(ctx, [{ role: "user", content: canvasChoicePrompt(topic, settings) }], { kind: "choose" }, undefined, chooseSystemPrompt(settings));
      canvas = chosenCanvas(choice.text);
      note(ctx, choice.trace, { verdict: canvas ? "one growing diagram" : "several scenes" });
      opts.onLog?.(`shape of the video: ${canvas ? "one growing diagram" : "several scenes"}`);
    }
    const planning = await planOutline(ctx, topic, canvas, recent, relevant);
    const { planned, outline, routed, tracing } = planning;
    spec = planning.spec;
    range = planning.range;
    if (planning.lengthFrom !== "default" || settings.scenes) opts.onLog?.(`length: ${spec.name} (${range.min}–${range.max} scenes) · ${planning.lengthFrom === "request" ? "read from the request" : planning.lengthFrom === "topic words" ? "from the topic" : "set"}`);
    if (tracing.length) opts.onLog?.(`algorithm data scenes become traces: ${tracing.join("; ")}`);
    const named = useCaseOf(outline);
    ctx.usecase = named ?? guessUseCase(topic);
    if (ctx.usecase) opts.onLog?.(`use case: ${ctx.usecase.name}${named ? "" : " (guessed from the topic; the plan named none)"}`);
    if (routed.length) opts.onLog?.(`routed by shape: ${routed.join("; ")}`);
    const brief = briefOf(outline);
    if (!canvas) opts.onLog?.(brief.problems.length ? `brief incomplete: ${brief.problems.join("; ")}` : `brief: ${brief.question} → ${brief.outcome}`);
    const teach = (ctx.teach = canvas ? undefined : teachingOf(outline, settings.level ?? DEFAULT_LEVEL, range));
    if (teach) {
      const arc = `${teach.method?.name ?? teach.methodName ?? "no method"}: ${teach.scenes.map((s) => `${s.id}=${s.beat ?? "?"}${s.via ? `/${s.via}` : ""}`).join(" → ")}`;
      opts.onLog?.(teach.problems.length ? `teaching plan (${arc}) has problems: ${teach.problems.join("; ")}` : `teaching plan: ${arc}`);
    }
    const plan = split(outline);
    // The scene planned with chapters is the growing diagram (its chapters become the steps it is written with).
    // Any scene the plan gives chapters is a growing picture, in a video of separate scenes too.
    const isCanvas = (text: string) => /^\s*#\s*chapter:/m.test(text);
    if (!plan.scenes.length) {
      note(ctx, planned.trace, { verdict: "no scenes; falling back to a single pass" });
      opts.onLog?.("outline had no scenes; falling back to a single pass");
      return run(topic, { ...opts, mode: "single" }, ctx);
    }
    note(ctx, planned.trace, { verdict: `${plan.scenes.length} scenes: ${plan.scenes.map((s) => s.id).join(", ")}${routed.length ? ` · routed ${routed.join("; ")}` : ""}` });
    header = direct(ensureHeader(plan.header, topic));
    opts.onLog?.(`outline: ${plan.scenes.map((s) => s.id).join(", ")}`);
    const written: string[] = [];
    // With a teaching plan, scene i starts once scene i-1 has its first draft, and reads every earlier draft: the arc
    // runs through the narration, not only through the plan. The pool hands scenes out in order, so this never waits
    // on a scene that has not started.
    const inOrder = Boolean(teach?.method) && opts.inOrder !== false;
    const drafts: string[] = [];
    const drafted = plan.scenes.map(() => deferred());
    scenes = await pool(plan.scenes, opts.concurrency ?? opts.client.concurrency ?? 3, async (s, i) => {
      if (inOrder && i > 0) await drafted[i - 1]!.promise;
      try {
        // Earlier scenes: their first drafts in order, else the ones already finished.
        const earlier = narrationOf((inOrder ? drafts : written).slice(0, i).filter((x) => x !== undefined));
        const planned = s.text.split("\n")[0]!;
        // A growing scene is shown a finished one of its kind (one per use case); no other scene gets an example.
        const example = isCanvas(s.text) ? exampleFor(ctx.usecase, /\btemplate=(\S+)/.exec(planned)?.[1]) : "";
        if (example) (ctx.examples ??= new Map()).set(s.id, example);
        const first: ChatMessage = { role: "user", content: scenePrompt(outline, s.id, earlier, isCanvas(s.text), settings, example, teach ? arcBrief(teach, s.id) : "") };
        // Only what this scene's kind needs, and the pictures that match its words.
        // A scene that carries several beats (a short video's merged slot) gets room for each of them.
        const k = teach?.scenes.find((x) => x.id === s.id)?.beats.length ?? 1;
        const room = k > 1 ? { ...spec, sentences: { min: Math.min(8, spec.sentences.min * k), max: Math.min(8, spec.sentences.max * k) } } : spec;
        const system = sceneSystemPrompt(sceneKindOf(planned), retrieveAssets(pictureQuery(topic, s.text), assets, undefined, opts.domain), isCanvas(s.text), room, settings, ctx.usecase);
        const reply = await chat(ctx, [first], { kind: "scene", scene: s.id }, undefined, system);
        // The plan's template or grid layout is binding: a scene line that changed it gets it back.
        const kept = keepPlanned(sceneOnly(clean(reply.text), s.id), planned);
        if (kept.changed) {
          opts.onLog?.(`scene ${s.id}: kept the planned ${kept.changed}`);
          note(ctx, reply.trace, { reason: `kept the planned ${kept.changed}` });
        }
        drafts[i] = kept.text;
        drafted[i]!.resolve();
        // What the plan carries from the previous scene is binding too (a repair may have dropped it).
        const fixed = arrange(bindCarry(await repairLoop(ctx, header, kept.text, [first], s.id, reply.trace, system, sceneArc(teach, s.id, inOrder ? drafts : written)), castPlan(outline).carry.get(s.id) ?? []));
        written[i] = fixed;
        emit(fixed, i);
        return fixed;
      } finally {
        // A scene that failed still lets the next one start.
        drafted[i]!.resolve();
      }
    });
  } else {
    const request: ChatMessage = { role: "user", content: fullPrompt(topic, range, settings) };
    const pending: Promise<string>[] = [];
    let headerText: string | undefined;
    // Validate each scene as soon as the stream moves past it.
    const onSceneText = (text: string) => {
      const i = pending.length;
      pending.push(
        repairLoop(ctx, headerText!, text, [request], sceneIdOf(text)).then(arrange).then((fixed) => {
          emit(fixed, i);
          return fixed;
        }),
      );
    };
    const splitter = streamSplitter((h) => (header = headerText = direct(ensureHeader(h, topic))), onSceneText);
    const streamed = await chat(ctx, [request], { kind: "single" }, (delta) => splitter.push(delta));
    const full = streamed.text;
    splitter.end();
    note(ctx, streamed.trace, { verdict: `${pending.length} scene(s)` });
    headerText ??= direct(ensureHeader(split(clean(full)).header, topic));
    header = headerText;
    scenes = await Promise.all(pending);
    if (!scenes.length) throw new Error(`LLM reply contained no scenes:\n${full.slice(0, 500)}`);
  }

  const raw = `${header}\n\n${scenes.join("\n\n")}\n`;
  const final = compile(raw);
  return {
    script: print(final.script),
    raw,
    ok: final.ok,
    diagnostics: final.diagnostics,
    repairs: ctx.repairs,
    calls: ctx.calls,
    usage: ctx.usage,
    quality: split(raw).scenes.flatMap((sc, _i, all) => qualityIssues(header, sc.text, ctx.usecase?.name, ctx.examples?.get(sc.id), sceneArc(ctx.teach, sc.id, all.map((x) => x.text))).map((q) => `${sc.id}: ${q.message}`)),
    trace: ctx.trace,
    ms: Math.round(performance.now() - ctx.started),
  };
}

/**
 * The planning call and the fixes every plan gets (tidied ids, templates routed by shape, algorithm data scenes as
 * traces, carries pruned). Shared by the whole pipeline and by `plan`.
 */
async function planOutline(ctx: Ctx, topic: string, canvas: boolean, recent: RecentUse | undefined, relevant: AssetManifest[]) {
  const { opts } = ctx;
  const settings = opts.settings ?? {};
  const explicit = settings.length ?? opts.length;
  let length: Length | undefined = explicit;
  let lengthFrom: PlanResult["lengthFrom"] = explicit ? "setting" : "default";
  const level = settings.level ?? DEFAULT_LEVEL;
  // The teaching decision first (a small call), so the plan fills the method's arc instead of inventing one. It also
  // reads how long the request asks the video to be, in any wording; the topic's words are only the fallback.
  let decision: Decision | undefined;
  let asked: { text: string; trace: CallTrace } | undefined;
  if (!canvas && opts.decideTeaching !== false) asked = await chat(ctx, [{ role: "user", content: decidePrompt(topic, settings) }], { kind: "decide" }, undefined, decideSystemPrompt(settings));
  if (!explicit) {
    const read = asked ? readLengthLine(asked.text) : { said: false };
    const words = read.said ? undefined : detectLength(topic);
    length = read.length ?? words;
    lengthFrom = read.length ? "request" : words ? "topic words" : "default";
  }
  const spec = effectiveSpec(settings, length);
  const range = opts.scenes ?? spec.scenes;
  if (asked) {
    decision = parseDecision(asked.text, level, spec.name, range, USE_CASES, guessUseCase(topic)?.name ?? "concept");
    note(ctx, asked.trace, { verdict: decision ? `${decision.usecase} · ${decision.intent} → ${decision.method.name}: ${decision.slots.map(slotLabel).join(" → ")}` : "no decision; the plan chooses" });
  }
  const ask = canvas ? canvasOutlinePrompt(topic, spec.chapters, recent, settings) : outlinePrompt(topic, range, recent, spec, settings, decision);
  const planned = await chat(ctx, [{ role: "user", content: ask }], { kind: "outline" }, undefined, outlineSystemPrompt(relevant, opts.domain, settings, Boolean(decision)));
  const written = clean(planned.text);
  const routed = routeOutline(tidyOutline(decision ? applyDecision(written, decision) : written));
  const tracing = traceForAlgorithms(routed.text, (useCaseOf(routed.text) ?? guessUseCase(topic))?.name);
  return { planned, outline: pruneCarry(tracing.text), routed: routed.changes, tracing: tracing.changes, range, decision, spec, lengthFrom };
}

/** The plan of a video and what it says about teaching, without writing any scene: one LLM call. */
export interface PlanResult {
  /** The outline as the scene writers would get it. */
  outline: string;
  usecase?: UseCase;
  brief: ReturnType<typeof briefOf>;
  teaching: TeachingPlan;
  /** What the fixes changed (routing, traces). */
  changes: string[];
  /** The length the plan was made for, and where it came from. */
  length: Length;
  lengthFrom: "setting" | "request" | "topic words" | "default";
  trace: CallTrace[];
  usage: Usage;
  ms: number;
}

/** Runs only the planning step of `generate` (several separate scenes; the one-growing-diagram plan is not covered). */
export async function plan(topic: string, opts: GenerateOptions): Promise<PlanResult> {
  const ctx: Ctx = { opts, system: "", usage: { prompt: 0, completion: 0 }, calls: 0, repairs: 0, started: performance.now(), trace: [] };
  const r = await planOutline(ctx, topic, false, opts.director?.recent(), (opts.assets ?? new AssetLibrary()).all());
  const usecase = useCaseOf(r.outline) ?? guessUseCase(topic);
  return {
    outline: r.outline,
    ...(usecase && { usecase }),
    brief: briefOf(r.outline),
    teaching: teachingOf(r.outline, opts.settings?.level ?? DEFAULT_LEVEL, r.range),
    changes: [...r.routed, ...r.tracing],
    length: r.spec.name,
    lengthFrom: r.lengthFrom,
    trace: ctx.trace,
    usage: ctx.usage,
    ms: Math.round(performance.now() - ctx.started),
  };
}

/**
 * Validates one scene in isolation and asks the LLM to fix errors, up to
 * maxRepairs times. A scene without errors but with quality problems gets
 * one improvement pass, kept only if it stays error-free and gets better.
 */
async function repairLoop(ctx: Ctx, header: string, text: string, history: ChatMessage[], scene?: string, written?: CallTrace, system = ctx.system, arc?: SceneArc): Promise<string> {
  const ask = async (current: string, report: string, kind: "errors" | "quality", attempt?: number) => {
    ctx.repairs++;
    const meta: CallMeta = { kind: kind === "errors" ? "repair" : "quality", reason: report, ...(scene && { scene }), ...(attempt && { attempt }) };
    const reply = await chat(ctx, [...history, { role: "assistant", content: current }, { role: "user", content: repairPrompt(current, report, kind, ctx.opts.settings ?? {}) }], meta, undefined, system);
    return { text: sceneOnly(clean(reply.text)), trace: reply.trace };
  };
  /** Records how a reply validated on the call that produced it. */
  const judge = (trace: CallTrace | undefined, check: { errors: number; warnings: number }, quality: number, verdict: string) =>
    trace && note(ctx, trace, { check: { errors: check.errors, warnings: check.warnings, quality }, verdict });
  const max = ctx.opts.maxRepairs ?? 2;
  const qualityOn = ctx.opts.qualityRepairs !== false;

  let current = text;
  let last = written;
  let errors = checkScene(header, current);
  const local = localFix(header, current, errors.errorCodes);
  if (local !== undefined) {
    ctx.opts.onLog?.(`fixed scene locally (no LLM call):\n${errors.report}`);
    if (last) note(ctx, last, { reason: errors.report });
    current = local;
    errors = checkScene(header, current);
  }
  for (let attempt = 1; errors.errors && attempt <= max; attempt++) {
    judge(last, errors, 0, "has errors → repair");
    ctx.opts.onLog?.(`repairing scene (attempt ${attempt}):\n${errors.report}`);
    const fixed = await ask(current, errors.report, "errors", attempt);
    current = fixed.text;
    last = fixed.trace;
    errors = checkScene(header, current);
  }
  if (errors.errors) {
    judge(last, errors, 0, "still has errors → auto-fix");
    return current;
  }
  const issues = qualityIssues(header, current, ctx.usecase?.name, ctx.examples?.get(scene ?? ""), arc);
  if (!qualityOn || !issues.length) {
    judge(last, errors, issues.length, "valid");
    return current;
  }
  judge(last, errors, issues.length, "valid but weak → improve");
  const report = qualityReport(issues);
  ctx.opts.onLog?.(`improving scene:\n${report}`);
  const better = await ask(current, report, "quality");
  const after = checkScene(header, better.text);
  const left = qualityIssues(header, better.text, ctx.usecase?.name, ctx.examples?.get(scene ?? ""), arc).length;
  if (after.errors || left >= issues.length) {
    judge(better.trace, after, left, after.errors ? "rejected: introduced errors" : "rejected: no better");
    ctx.opts.onLog?.("the improvement didn't help; keeping the previous version");
    return current;
  }
  judge(better.trace, after, left, "kept");
  return better.text;
}

const REPAIRED_WARNINGS = new Set(["NAR411"]);

/**
 * Compiles a scene with the video header and no auto-fix. Returns the
 * number of errors and warnings, and a report (errors and warnings) with
 * scene-relative line numbers, ready for a repair prompt.
 */
export function checkScene(header: string, sceneText: string): { errors: number; warnings: number; report: string; errorCodes: string[] } {
  const offset = header.split("\n").length;
  const { diagnostics } = compile(`${header}\n${sceneText}\n`, { autofix: false });
  // keep= refers to other scenes, which aren't present when a scene is checked alone.
  const relevant = diagnostics.filter((d) => d.code !== "NAR309" && d.span.line > offset);
  // A warning that degrades the picture (an element that fits no slot lands in a tiny row of clutter) is repaired like an error.
  const errorCodes = relevant.filter((d) => d.severity === "error" || REPAIRED_WARNINGS.has(d.code)).map((d) => d.code);
  const shifted = relevant.map((d) => ({ ...d, span: { ...d.span, line: d.span.line - offset } }));
  return { errors: errorCodes.length, warnings: relevant.length - errorCodes.length, report: report(shifted), errorCodes };
}

/**
 * Errors with a mechanical fix that keeps the writer's intent, applied
 * without asking the LLM: actions anchored to cues the narration never
 * marked (the cue is added to the narration) and template aliases.
 */
const LOCAL_FIXES = new Set(["NAR303", "NAR203"]);

/** The scene with its safe errors fixed by the validator, or undefined when other errors remain. */
function localFix(header: string, sceneText: string, codes: string[]): string | undefined {
  if (!codes.length || !codes.every((c) => LOCAL_FIXES.has(c))) return undefined;
  const fixed = compile(`${header}\n${sceneText}\n`, { autofix: true });
  const scene = fixed.script.scenes[0];
  if (!scene) return undefined;
  const text = printScene(scene).join("\n");
  return checkScene(header, text).errors ? undefined : text;
}

// ------------------------------------------------------------- helpers ---

/** One LLM call, traced: timing, tokens (estimated when the provider reports none), prompt and reply. */
async function chat(
  ctx: Ctx,
  messages: ChatMessage[],
  meta: CallMeta,
  onDelta?: (d: string) => void,
  system = ctx.system,
): Promise<{ text: string; trace: CallTrace }> {
  ctx.calls++;
  const t0 = performance.now();
  const trace: CallTrace = {
    id: ctx.trace.length + 1,
    ...meta,
    status: "running",
    start: Math.round(t0 - ctx.started),
    system: system === ctx.system ? "full" : meta.kind === "outline" || meta.kind === "decide" ? "outline" : "scene",
    systemChars: system.length,
    history: messages.length - 1,
    prompt: messages[messages.length - 1]!.content,
    request: { system, messages: messages.map((m) => ({ ...m })) },
  };
  ctx.trace.push(trace);
  ctx.opts.onCall?.({ ...trace });

  const req = { messages: [{ role: "system" as const, content: system }, ...messages], temperature: ctx.opts.temperature ?? 0.4 };
  let result: ChatResult;
  try {
    result = onDelta
      ? await ctx.opts.client.stream(req, (d) => {
          trace.firstTokenMs ??= Math.round(performance.now() - t0);
          onDelta(d);
        })
      : await ctx.opts.client.chat(req);
  } catch (e) {
    note(ctx, trace, { status: "failed", ms: Math.round(performance.now() - t0), error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  const chars = system.length + messages.reduce((n, m) => n + m.content.length, 0);
  const usage = result.usage ?? { prompt: Math.ceil(chars / 4), completion: Math.ceil(result.text.length / 4) };
  ctx.usage.prompt += usage.prompt;
  ctx.usage.completion += usage.completion;
  note(ctx, trace, {
    status: "done",
    ms: Math.round(performance.now() - t0),
    provider: result.provider,
    model: result.model,
    usage,
    ...(!result.usage && { estimated: true }),
    reply: result.text,
    ...(result.wire && { wire: result.wire }),
  });
  return { text: result.text, trace };
}

/** Updates a call's trace and reports it again. */
function note(ctx: Ctx, trace: CallTrace, patch: Partial<CallTrace>): void {
  Object.assign(trace, patch);
  ctx.opts.onCall?.({ ...trace });
}

function sceneIdOf(text: string): string | undefined {
  return /^\s*scene\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(text)?.[1];
}

/**
 * Repairs common outline slips so planning never fails on form: numeric scene
 * ids (`scene 1` → `scene s1`, which ids can't be), the same id planned twice
 * (`stages`, `stages` → `stages`, `stages2`; scenes are written and repaired by id),
 * `variants=` for `variant=`, and prompt syntax copied literally (`[mirror=true]`,
 * `template=title | grid=L1-01`).
 */
export function tidyOutline(text: string): string {
  const used = new Set<string>();
  return text
    .split("\n")
    .map((l) => {
      if (!/^\s*scene\s/.test(l)) return l;
      let line = l
        .replace(/^(\s*scene\s+)(\d)/, "$1s$2")
        .replace(/\bvariants=/, "variant=")
        // Syntax copied from the prompt: `[mirror=true]` → `mirror=true`.
        .replace(/\[(\w+=[^\]\s]+)\]/g, "$1");
      // `template=title | grid=L1-01`: a scene is one or the other; the template wins.
      if (/\btemplate=\S/.test(line)) line = line.replace(/\s*\|\s*grid=\S+/, "").replace(/\s+grid=\S+/, "");
      line = line.replace(/\s+\|\s+/g, " ");
      const id = sceneIdOf(line);
      if (!id) return line;
      let unique = id;
      for (let n = 2; used.has(unique); n++) unique = `${id}${n}`;
      used.add(unique);
      return unique === id ? line : line.replace(/^(\s*scene\s+)\S+/, `$1${unique}`);
    })
    .join("\n");
}

/**
 * Routes each planned scene by its shape label (`# shape: many-to-one · goal: …`):
 * a template that is unknown or of another shape is replaced with the
 * shape's template, since the shape is the simpler judgement. Scenes
 * without a known shape, and grid pages, stay as planned.
 */
export function routeOutline(text: string): { text: string; changes: string[] } {
  const lines = text.split("\n");
  const changes: string[] = [];
  let scene = -1;
  lines.forEach((l, i) => {
    if (/^\s*scene\s/.test(l)) scene = i;
    const shape = /^\s*#\s*shape:\s*([a-z-]+)/i.exec(l)?.[1]?.toLowerCase();
    if (scene < 0 || !shape || !(shape in SHAPES)) return;
    const line = lines[scene]!;
    const fits = templatesFor(shape as Shape);
    const named = /\btemplate=(\S+)/.exec(line)?.[1];
    if (!fits.length || named === undefined) return;
    const tpl = resolveTemplate(named);
    if (tpl?.name === named && tpl.guide.shape === shape) return;
    // An alias of the right shape keeps its template under its real name; otherwise the shape decides.
    const to = tpl && tpl.guide.shape === shape ? tpl.name : fits[0]!.name;
    // A variant of the old template means nothing to the new one.
    lines[scene] = line.replace(/\btemplate=\S+/, `template=${to}`).replace(/\s+variant=\S+/, "");
    changes.push(`${sceneIdOf(line) ?? "?"}: ${named} → ${to} (shape ${shape})`);
    scene = -1;
  });
  return { text: lines.join("\n"), changes };
}

/**
 * A data scene is a trace: a structure scene (a still row of cells) cannot show the data changing, and a trace
 * with one state is the same still picture, so the plan's structure scenes become trace scenes.
 */
export function traceForAlgorithms(outline: string, _usecase?: string): { text: string; changes: string[] } {
  const changes: string[] = [];
  const all = outline.split("\n");
  // A worked example planned as a grid page (a table of numbers) cannot show the run: it becomes a trace too.
  const example = new Set<number>();
  all.forEach((l, i) => {
    if (!/^\s*scene\s/.test(l) || !/\bgrid=\S+/.test(l)) return;
    if (/^\s*#\s*shape:\s*page\b.*\brole:\s*example\b/i.test(all[i + 1] ?? "")) example.add(i);
  });
  const text = all
    .map((l, i) => {
      if (example.has(i)) {
        changes.push(`${sceneIdOf(l) ?? "?"}: worked example page → trace`);
        return l.replace(/\s+grid=\S+/, " template=trace").replace(/\s+mirror=\S+/, "");
      }
      if (!/^\s*scene\s/.test(l) || !/\btemplate=structure\b/.test(l)) return l;
      changes.push(`${sceneIdOf(l) ?? "?"}: structure → trace`);
      return l.replace(/\btemplate=structure\b/, "template=trace").replace(/\s+variant=\S+/, "");
    })
    .join("\n");
  return { text, changes };
}

/** Sets `carry=` on a written scene line to exactly the planned ids (none: the attribute is removed). */
export function bindCarry(sceneText: string, ids: string[]): string {
  const lines = sceneText.split("\n");
  const i = lines.findIndex((l) => /^\s*scene\s/.test(l));
  if (i < 0) return sceneText;
  const bare = lines[i]!.replace(/\s+carry=\S+/g, "");
  lines[i] = ids.length ? `${bare} carry=${ids.join(",")}` : bare;
  return lines.join("\n");
}

/**
 * Puts the outline's template= or grid= back on a written scene line that
 * changed it (the rest of the line, such as variant= or in=, is kept; a
 * variant of another template is dropped). Returns what was restored.
 */
export function keepPlanned(sceneText: string, plannedLine: string): { text: string; changed?: string } {
  const lines = sceneText.split("\n");
  const i = lines.findIndex((l) => /^\s*scene\s/.test(l));
  if (i < 0) return { text: sceneText };
  const want = /\b(template|grid)=(\S+)/.exec(plannedLine);
  if (!want) return { text: sceneText };
  const line = lines[i]!;
  const has = /\b(template|grid|compose)=(\S+)/.exec(line);
  if (has && has[1] === want[1] && has[2] === want[2]) return { text: sceneText };
  let fixed = line.replace(/\s+(template|grid|compose)=\S+/g, "");
  if (!has || has[1] !== want[1] || has[2] !== want[2]) fixed = fixed.replace(/\s+variant=\S+/, "");
  // After the id and the quoted title, if any.
  const at = /^(\s*scene\s+\S+(?:\s+"[^"]*")?)/.exec(fixed);
  fixed = at ? `${at[1]} ${want[0]}${fixed.slice(at[1]!.length)}` : `${fixed} ${want[0]}`;
  lines[i] = fixed;
  return { text: lines.join("\n"), changed: `${want[0]}${has ? ` (it wrote ${has[0]})` : ""}` };
}

/** Strips markdown fences and any chatter before the script starts. */
export function clean(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => !/^\s*```/.test(l));
  const start = lines.findIndex((l) => /^\s*(video|scene)\s/.test(l));
  return (start >= 0 ? lines.slice(start) : lines).join("\n").trim();
}

/** Splits script text into header lines and scene blocks. */
export function split(text: string): { header: string; scenes: { id: string; text: string }[] } {
  const lines = text.split("\n");
  const header: string[] = [];
  const scenes: { id: string; text: string }[] = [];
  for (const line of lines) {
    const m = /^\s*scene\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (m) scenes.push({ id: m[1]!, text: line });
    else if (scenes.length) scenes[scenes.length - 1]!.text += `\n${line}`;
    else header.push(line);
  }
  return { header: header.join("\n").trim(), scenes: scenes.map((s) => ({ ...s, text: s.text.trim() })) };
}

/** Keeps one scene: from its scene line (preferring `id`) up to the next scene line. */
function sceneOnly(text: string, id?: string): string {
  const { scenes } = split(text);
  const s = (id && scenes.find((x) => x.id === id)) || scenes[0];
  return s ? s.text : text;
}

/** Header lines (video/theme/size/...) without the outline's goal comments; adds `video 1` if missing. */
function ensureHeader(header: string, topic: string): string {
  const lines = header.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (!lines.some((l) => /^\s*video\s/.test(l))) lines.unshift(`video 1 "${topic.replace(/["\n]/g, " ").trim().slice(0, 60)}"`);
  return lines.join("\n");
}

/** Feeds streamed text; reports the header once, then each scene when the next one begins. */
function streamSplitter(onHeader: (h: string) => void, onScene: (text: string) => void) {
  let buffer = "";
  let header: string[] | undefined = [];
  let scene: string[] | undefined;
  let inFence = false;
  const line = (l: string) => {
    if (/^\s*```/.test(l)) {
      inFence = !inFence;
      return;
    }
    if (/^\s*scene\s/.test(l)) {
      if (header) {
        onHeader(header.join("\n"));
        header = undefined;
      }
      if (scene) onScene(scene.join("\n").trim());
      scene = [l];
    } else if (scene) scene.push(l);
    else header?.push(l);
  };
  return {
    push(delta: string) {
      buffer += delta;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        line(buffer.slice(0, nl).replace(/\r$/, ""));
        buffer = buffer.slice(nl + 1);
      }
    },
    end() {
      if (buffer) line(buffer);
      buffer = "";
      if (header) onHeader(clean(header.join("\n")));
      if (scene) onScene(scene.join("\n").trim());
    },
  };
}

/** Calls `fn` for each finished scene in index order, even when they finish out of order. */
function orderedEmitter(fn: (text: string, i: number) => void) {
  const ready = new Map<number, string>();
  let next = 0;
  return (text: string, i: number) => {
    ready.set(i, text);
    while (ready.has(next)) {
      fn(ready.get(next)!, next);
      ready.delete(next++);
    }
  };
}

/**
 * A scene's place in the teaching arc for the narration checks: first or last, the method, its devices and link, and
 * the scenes before it (by position in the plan; `texts` holds each scene's text, in plan order, where known).
 */
function sceneArc(teach: TeachingPlan | undefined, id: string, texts: (string | undefined)[]): SceneArc | undefined {
  const m = teach?.method;
  const i = teach ? teach.scenes.findIndex((s) => s.id === id) : -1;
  if (!m || !teach || i < 0) return undefined;
  const s = teach.scenes[i]!;
  const before = texts.slice(0, i).filter((t): t is string => t !== undefined);
  return {
    first: i === 0,
    last: i === teach.scenes.length - 1,
    method: m.name,
    opens: m.opens,
    opensWithQuestion: opensWithQuestion(m),
    devices: s.devices,
    core: s.beats.some((b) => m.core.includes(b)),
    ...(s.link && { link: s.link }),
    ...(texts[i - 1] !== undefined && { previous: texts[i - 1] }),
    ...(before.length && { earlier: before.join("\n") }),
  };
}

/** A promise with its resolve function outside it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Maps with a concurrency limit, keeping result order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
