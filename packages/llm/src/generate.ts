import { compile, report } from "@anim/compiler";
import { print, printScene, type Diagnostic } from "@anim/dsl";
import type { Director } from "@anim/director";
import { AssetLibrary, resolveTemplate, SHAPES, templatesFor, type Shape } from "@anim/registry";
import type { ChatMessage, ChatResult, LlmClient, Usage } from "./client.js";
import { type Domain, fullPrompt, narrationOf, pictureQuery, outlinePrompt, outlineSystemPrompt, repairPrompt, retrieveAssets, sceneKindOf, scenePrompt, sceneSystemPrompt, storyArc, systemPrompt } from "./prompt.js";
import { qualityIssues, qualityReport } from "./quality.js";

export interface GenerateOptions {
  client: LlmClient;
  assets?: AssetLibrary;
  /** "outline": plan, then write scenes in parallel. "single": one streamed pass. */
  mode?: "outline" | "single";
  scenes?: { min: number; max: number };
  /** LLM repair attempts per scene before falling back to auto-fix. */
  maxRepairs?: number;
  /** Scenes written/repaired at once; default the client's limit, else 3. */
  concurrency?: number;
  /** A subject area whose templates planning prefers (see DOMAINS). */
  domain?: Domain;
  /** How the video opens and ends (names from OPENINGS and CLOSINGS); by default the topic picks. */
  arc?: { open?: string; close?: string };
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

export type CallKind = "outline" | "scene" | "repair" | "quality" | "single";

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
  // Icon names say what they show, so the model picks by meaning from the whole list.
  const relevant = assets.all();
  const ctx: Ctx = inherited
    ? { ...inherited, opts }
    : { opts, system: systemPrompt(relevant), usage: { prompt: 0, completion: 0 }, calls: 0, repairs: 0, started: performance.now(), trace: [] };
  const range = opts.scenes ?? { min: 2, max: 4 };
  let header = "";
  // The look is set on the header, before the first scene plays; scenes are arranged as they arrive.
  const direct = (h: string) => (opts.director ? opts.director.header(h).trim() : h);
  const arrange = (scene: string) => (opts.director ? opts.director.scene(scene) : scene);
  const emit = orderedEmitter((text, i) => opts.onScene?.(text, i, header));

  let scenes: string[];
  if ((opts.mode ?? "outline") === "outline") {
    // Planning only needs scene types and asset names, not the whole language.
    const arc = storyArc(topic, opts.arc);
    opts.onLog?.(`story: opens with ${arc.open.name}, ends with ${arc.close.name}`);
    const planned = await chat(ctx, [{ role: "user", content: outlinePrompt(topic, range, arc) }], { kind: "outline" }, undefined, outlineSystemPrompt(relevant, opts.domain));
    const routed = routeOutline(tidyOutline(clean(planned.text)));
    const outline = routed.text;
    if (routed.changes.length) opts.onLog?.(`routed by shape: ${routed.changes.join("; ")}`);
    const plan = split(outline);
    if (!plan.scenes.length) {
      note(ctx, planned.trace, { verdict: "no scenes; falling back to a single pass" });
      opts.onLog?.("outline had no scenes; falling back to a single pass");
      return run(topic, { ...opts, mode: "single" }, ctx);
    }
    note(ctx, planned.trace, { verdict: `${plan.scenes.length} scenes: ${plan.scenes.map((s) => s.id).join(", ")}${routed.changes.length ? ` · routed ${routed.changes.join("; ")}` : ""}` });
    header = direct(ensureHeader(plan.header, topic));
    opts.onLog?.(`outline: ${plan.scenes.map((s) => s.id).join(", ")}`);
    const written: string[] = [];
    scenes = await pool(plan.scenes, opts.concurrency ?? opts.client.concurrency ?? 3, async (s, i) => {
      // Earlier scenes that are already written (all of them when scenes run one at a time).
      const earlier = narrationOf(written.slice(0, i).filter((x) => x !== undefined));
      const first: ChatMessage = { role: "user", content: scenePrompt(outline, s.id, earlier) };
      // Only what this scene's kind needs, and the pictures that match its words.
      const planned = s.text.split("\n")[0]!;
      const system = sceneSystemPrompt(sceneKindOf(planned), retrieveAssets(pictureQuery(topic, s.text), assets));
      const reply = await chat(ctx, [first], { kind: "scene", scene: s.id }, undefined, system);
      // The plan's template or grid layout is binding: a scene line that changed it gets it back.
      const kept = keepPlanned(sceneOnly(clean(reply.text), s.id), planned);
      if (kept.changed) {
        opts.onLog?.(`scene ${s.id}: kept the planned ${kept.changed}`);
        note(ctx, reply.trace, { reason: `kept the planned ${kept.changed}` });
      }
      const fixed = arrange(await repairLoop(ctx, header, kept.text, [first], s.id, reply.trace, system));
      written[i] = fixed;
      emit(fixed, i);
      return fixed;
    });
  } else {
    const request: ChatMessage = { role: "user", content: fullPrompt(topic, range) };
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
    quality: split(raw).scenes.flatMap((sc) => qualityIssues(header, sc.text).map((q) => `${sc.id}: ${q.message}`)),
    trace: ctx.trace,
    ms: Math.round(performance.now() - ctx.started),
  };
}

/**
 * Validates one scene in isolation and asks the LLM to fix errors, up to
 * maxRepairs times. A scene without errors but with quality problems gets
 * one improvement pass, kept only if it stays error-free and gets better.
 */
async function repairLoop(ctx: Ctx, header: string, text: string, history: ChatMessage[], scene?: string, written?: CallTrace, system = ctx.system): Promise<string> {
  const ask = async (current: string, report: string, kind: "errors" | "quality", attempt?: number) => {
    ctx.repairs++;
    const meta: CallMeta = { kind: kind === "errors" ? "repair" : "quality", reason: report, ...(scene && { scene }), ...(attempt && { attempt }) };
    const reply = await chat(ctx, [...history, { role: "assistant", content: current }, { role: "user", content: repairPrompt(current, report, kind) }], meta, undefined, system);
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
  const issues = qualityIssues(header, current);
  if (!qualityOn || !issues.length) {
    judge(last, errors, issues.length, "valid");
    return current;
  }
  judge(last, errors, issues.length, "valid but weak → improve");
  const report = qualityReport(issues);
  ctx.opts.onLog?.(`improving scene:\n${report}`);
  const better = await ask(current, report, "quality");
  const after = checkScene(header, better.text);
  const left = qualityIssues(header, better.text).length;
  if (after.errors || left >= issues.length) {
    judge(better.trace, after, left, after.errors ? "rejected: introduced errors" : "rejected: no better");
    ctx.opts.onLog?.("the improvement didn't help; keeping the previous version");
    return current;
  }
  judge(better.trace, after, left, "kept");
  return better.text;
}

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
  const errorCodes = relevant.filter((d) => d.severity === "error").map((d) => d.code);
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
    system: system === ctx.system ? "full" : meta.kind === "outline" ? "outline" : "scene",
    systemChars: system.length,
    history: messages.length - 1,
    prompt: messages[messages.length - 1]!.content,
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
