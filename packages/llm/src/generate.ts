import { compile, report } from "@anim/compiler";
import { print, type Diagnostic } from "@anim/dsl";
import type { Director } from "@anim/director";
import { AssetLibrary } from "@anim/registry";
import type { ChatMessage, LlmClient, Usage } from "./client.js";
import { fullPrompt, narrationOf, outlinePrompt, outlineSystemPrompt, repairPrompt, retrieveAssets, scenePrompt, systemPrompt } from "./prompt.js";
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
  /** One extra LLM pass for a scene that is valid but weak (box-only, placeholders, vague quotes). Default true. */
  qualityRepairs?: boolean;
  /**
   * Styles the video (look, motion, background, scene arrangements) as it streams,
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
}

interface Ctx {
  opts: GenerateOptions;
  system: string;
  usage: Usage;
  calls: number;
  repairs: number;
}

/**
 * Prompt → validated Narrascript. The LLM decides narration, structure,
 * templates, assets and cues; the compiler checks everything, failing
 * scenes go back to the LLM with compact diagnostics, and deterministic
 * auto-fixes handle whatever is left.
 */
export async function generate(topic: string, opts: GenerateOptions): Promise<GenerateResult> {
  const assets = opts.assets ?? new AssetLibrary();
  const relevant = retrieveAssets(topic, assets);
  const ctx: Ctx = { opts, system: systemPrompt(relevant), usage: { prompt: 0, completion: 0 }, calls: 0, repairs: 0 };
  const range = opts.scenes ?? { min: 2, max: 4 };
  let header = "";
  // The look is set on the header, before the first scene plays; scenes are arranged as they arrive.
  const direct = (h: string) => (opts.director ? opts.director.header(h).trim() : h);
  const arrange = (scene: string) => (opts.director ? opts.director.scene(scene) : scene);
  const emit = orderedEmitter((text, i) => opts.onScene?.(text, i, header));

  let scenes: string[];
  if ((opts.mode ?? "outline") === "outline") {
    // Planning only needs scene types and asset names, not the whole language.
    const outline = clean(await chat(ctx, [{ role: "user", content: outlinePrompt(topic, range) }], undefined, outlineSystemPrompt(relevant)));
    const plan = split(outline);
    if (!plan.scenes.length) {
      opts.onLog?.("outline had no scenes; falling back to a single pass");
      return generate(topic, { ...opts, mode: "single" });
    }
    header = direct(ensureHeader(plan.header, topic));
    opts.onLog?.(`outline: ${plan.scenes.map((s) => s.id).join(", ")}`);
    const written: string[] = [];
    scenes = await pool(plan.scenes, opts.concurrency ?? opts.client.concurrency ?? 3, async (s, i) => {
      // Earlier scenes that are already written (all of them when scenes run one at a time).
      const earlier = narrationOf(written.slice(0, i).filter((x) => x !== undefined));
      const first: ChatMessage = { role: "user", content: scenePrompt(outline, s.id, earlier) };
      const text = sceneOnly(clean(await chat(ctx, [first])), s.id);
      const fixed = arrange(await repairLoop(ctx, header, text, [first]));
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
        repairLoop(ctx, headerText!, text, [request]).then(arrange).then((fixed) => {
          emit(fixed, i);
          return fixed;
        }),
      );
    };
    const splitter = streamSplitter((h) => (header = headerText = direct(ensureHeader(h, topic))), onSceneText);
    const full = await chat(ctx, [request], (delta) => splitter.push(delta));
    splitter.end();
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
  };
}

/**
 * Validates one scene in isolation and asks the LLM to fix errors, up to
 * maxRepairs times. A scene without errors but with quality problems gets
 * one improvement pass, kept only if it stays error-free and gets better.
 */
async function repairLoop(ctx: Ctx, header: string, text: string, history: ChatMessage[]): Promise<string> {
  const ask = async (current: string, report: string, kind: "errors" | "quality") => {
    ctx.repairs++;
    const reply = await chat(ctx, [...history, { role: "assistant", content: current }, { role: "user", content: repairPrompt(current, report, kind) }]);
    return sceneOnly(clean(reply));
  };
  let current = text;
  let errors = checkScene(header, current);
  for (let attempt = 0; errors.errors && attempt < (ctx.opts.maxRepairs ?? 2); attempt++) {
    ctx.opts.onLog?.(`repairing scene (attempt ${attempt + 1}):\n${errors.report}`);
    current = await ask(current, errors.report, "errors");
    errors = checkScene(header, current);
  }
  if (errors.errors || ctx.opts.qualityRepairs === false) return current;

  const issues = qualityIssues(header, current);
  if (!issues.length) return current;
  const report = qualityReport(issues);
  ctx.opts.onLog?.(`improving scene:\n${report}`);
  const better = await ask(current, report, "quality");
  if (checkScene(header, better).errors || qualityIssues(header, better).length >= issues.length) {
    ctx.opts.onLog?.("the improvement didn't help; keeping the previous version");
    return current;
  }
  return better;
}

/**
 * Compiles a scene with the video header and no auto-fix. Returns the
 * number of errors and a report (errors and warnings) with scene-relative
 * line numbers, ready for a repair prompt.
 */
export function checkScene(header: string, sceneText: string): { errors: number; report: string } {
  const offset = header.split("\n").length;
  const { diagnostics } = compile(`${header}\n${sceneText}\n`, { autofix: false });
  // keep= refers to other scenes, which aren't present when a scene is checked alone.
  const relevant = diagnostics.filter((d) => d.code !== "NAR309" && d.span.line > offset);
  const errors = relevant.filter((d) => d.severity === "error").length;
  const shifted = relevant.map((d) => ({ ...d, span: { ...d.span, line: d.span.line - offset } }));
  return { errors, report: report(shifted) };
}

// ------------------------------------------------------------- helpers ---

async function chat(ctx: Ctx, messages: ChatMessage[], onDelta?: (d: string) => void, system = ctx.system): Promise<string> {
  ctx.calls++;
  const req = { messages: [{ role: "system" as const, content: system }, ...messages], temperature: ctx.opts.temperature ?? 0.4 };
  const result = onDelta ? await ctx.opts.client.stream(req, onDelta) : await ctx.opts.client.chat(req);
  if (result.usage) {
    ctx.usage.prompt += result.usage.prompt;
    ctx.usage.completion += result.usage.completion;
  }
  return result.text;
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
