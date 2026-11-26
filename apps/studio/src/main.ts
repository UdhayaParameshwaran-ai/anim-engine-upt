import { exposeForRender, Player, Stage } from "@anim/engine";
import type { ResolvedTimeline, VideoIR } from "@anim/ir";
import { Editor } from "./editor.js";
import { createEvaluator, inspect, lineAt, sceneAt, type Evaluator } from "./inspect.js";
import { choices } from "./choices.js";
import { SceneGrid } from "./scene-grid.js";
import { VideoControls } from "./video-controls.js";
import { renderInspector } from "./inspector.js";
import { Overlay } from "./overlay.js";
import { SceneBreak } from "./scene-break.js";
import { TimelinePanel } from "./timeline-panel.js";
import { CallsPanel, type CallTrace } from "./calls.js";
import { promptSettings as createPromptSettings } from "./prompts.js";
import { history as createHistory } from "./history.js";
import { $, escape } from "./util.js";

const promptSettings = createPromptSettings();
/** Saved scripts: "Open in Script" puts one in the editor, ready to build. */
const savedScripts = createHistory({
  open(script) {
    editor.value = script;
    showTab("script");
    void build();
  },
});
$<HTMLButtonElement>("script-history").addEventListener("click", () => {
  showTab("generate");
  savedScripts.show(true);
});

interface BuildResult {
  ok: boolean;
  diagnostics: string[];
  ir?: VideoIR;
  timeline?: ResolvedTimeline;
  error?: string;
}

interface Session {
  ir: VideoIR;
  tl: ResolvedTimeline;
  stage: Stage;
  player: Player;
  ev: Evaluator;
  overlay: Overlay;
}

const params = new URLSearchParams(location.search);
const renderMode = params.has("render");

const examples = $<HTMLSelectElement>("examples");
const speed = $<HTMLInputElement>("speed");
const tts = $<HTMLSelectElement>("tts");
const look = $<HTMLSelectElement>("look");
const motion = $<HTMLSelectElement>("motion");
/** Voice, look and motion as query parameters (empty look/motion = what the script says). */
const style = () => new URLSearchParams({ speed: speed.value, tts: tts.value, theme: look.value, motion: motion.value });
const diagnostics = $<HTMLUListElement>("diagnostics");
const stageBox = $<HTMLDivElement>("stage");
const waiting = $<HTMLDivElement>("waiting");
const waitingText = $<HTMLSpanElement>("waiting-text");
const playBtn = $<HTMLButtonElement>("play");
const scrub = $<HTMLInputElement>("scrub");
const clock = $<HTMLSpanElement>("clock");
const narration = $<HTMLParagraphElement>("narration");
const cuesList = $<HTMLOListElement>("cues");
const reportList = $<HTMLUListElement>("report");
const inspectorBox = $<HTMLDivElement>("inspector");
/** Element bounds drawn over the stage (a debugging aid, toggled with the O key). */
let showBounds = false;
const genLog = $<HTMLOListElement>("gen-log");
const genBtn = $<HTMLButtonElement>("generate");
const stopBtn = $<HTMLButtonElement>("stop");
const provider = $<HTMLSelectElement>("provider");
const modelSel = $<HTMLSelectElement>("model");
/** Model menus per provider (gemini, claude), from /api/providers. */
let modelMenus: Record<string, { default: string; models: string[] }> = {};
const replayExample = $<HTMLSelectElement>("replay-example");

// The menus remember the person's picks across reloads. Menus whose options arrive from the server (provider,
// replay example) and the voice (whose default comes from the server) are restored in loadProviders.
const remembered = choices();
const kept: [HTMLSelectElement | HTMLInputElement, string][] = [
  [$<HTMLSelectElement>("domain"), "domain"],
  [$<HTMLSelectElement>("length"), "length"],
  [$<HTMLSelectElement>("mode"), "mode"],
  [speed, "speed"],
  [tts, "voice"],
  [provider, "provider"],
  [replayExample, "replay"],
];
for (const [control, name] of kept) {
  remembered.restore(control, name);
  remembered.keep(control, name);
}

const editor = new Editor($<HTMLTextAreaElement>("source"), $<HTMLPreElement>("gutter"));
const panel = new TimelinePanel($<HTMLDivElement>("timeline"), {
  seek: (t) => session?.player.seek(t),
  select: (line) => selectLine(line),
});

/** Seconds the on-video buttons and the arrow keys skip. */
const SKIP = 10;
const controls = new VideoControls($<HTMLDivElement>("vc"), {
  toggle: () => playBtn.click(),
  skip: (s) => skip(s),
});
/** Every scene of the built video; a card jumps to its scene and pauses there, so the inspector shows it. */
const sceneGrid = new SceneGrid(
  $<HTMLDivElement>("scene-grid"),
  {
    seek: (t) => {
      if (!session) return;
      session.player.pause();
      session.player.seek(t);
    },
    select: (line) => selectLine(line),
  },
  $<HTMLSpanElement>("scenes-count"),
);

let session: Session | undefined;
let lastInspect = 0;
/** The clock at the previous update, to see playback run across a scene's end. */
let lastT = 0;

/** What playback does when a scene ends: play through, pause, or a short break (the "Between scenes" menu). */
const sceneBreak = new SceneBreak(
  $<HTMLButtonElement>("between"),
  $<HTMLElement>("between-menu"),
  $<HTMLElement>("scene-break"),
  {
    hold: (t) => {
      if (!session) return;
      session.player.pause();
      // The scene's last frame, not the next scene's first.
      session.player.seek(Math.max(0, t - 1 / session.tl.fps));
    },
    resume: (t) => {
      if (!session) return;
      session.player.seek(t);
      session.player.play();
      update(session.player.time);
    },
  },
  remembered,
);

/** Moves playback by `seconds` (the player clamps to the video), showing which way on the video. */
function skip(seconds: number): void {
  if (!session) return;
  session.player.seek(session.player.time + seconds);
  controls.flash(seconds);
}

// ------------------------------------------------------------- sessions ---

/** Builds a fresh stage + player for a timeline (replacing any previous one). */
function mount(ir: VideoIR, tl: ResolvedTimeline, live = false): Session {
  teardown();
  const stage = new Stage(stageBox, ir, tl, { autoFit: !renderMode, templateBase: "/tpl" });
  const player = new Player(stage, tl, {
    live,
    onTime: update,
    onEnd: () => setPlaying(false),
    onWait: (w) => {
      waitingText.textContent = waitLabel;
      waiting.hidden = !w;
    },
  });
  session = { ir, tl, stage, player, ev: createEvaluator(tl), overlay: new Overlay(stage) };
  showTimeline();
  return session;
}

/**
 * Progressive playback: swaps in the stage for a longer timeline while the
 * player keeps its clock. Earlier scenes resolve to the same times when
 * scenes are appended, so the picture doesn't jump.
 */
async function extend(ir: VideoIR, tl: ResolvedTimeline, final: boolean, autoplay = true): Promise<void> {
  if (!session) {
    const s = mount(ir, tl, !final);
    await loadAudio(s.player);
    if (autoplay) {
      s.player.play();
      setPlaying(true);
    }
    return;
  }
  const old = session;
  const stage = new Stage(stageBox, ir, tl, { autoFit: true, templateBase: "/tpl" });
  stage.render(old.player.time);
  old.stage.destroy();
  session = { ...old, ir, tl, stage, ev: createEvaluator(tl), overlay: new Overlay(stage) };
  showTimeline();
  try {
    await old.player.extend(stage, tl, final);
  } catch (e) {
    note(`audio unavailable: ${String(e)}`, "warning");
  }
  update(session.player.time);
}

function teardown(): void {
  sceneBreak.dismiss();
  lastT = 0;
  session?.player.pause();
  session?.stage.destroy();
  session = undefined;
  waiting.hidden = true;
  setPlaying(false);
  controls.setEnabled(false);
  sceneGrid.clear();
}

async function loadAudio(player: Player): Promise<void> {
  try {
    await player.load();
  } catch (e) {
    note(`audio unavailable: ${String(e)}`, "warning");
  }
}

function showTimeline(): void {
  const tl = session!.tl;
  scrub.max = String(tl.duration);
  scrub.step = String(1 / tl.fps);
  panel.set(tl);
  if (!renderMode) {
    controls.setEnabled(true);
    document.getElementById("app")!.classList.add("has-scenes");
    sceneGrid.set(session!.ir, tl);
  }
  cuesList.innerHTML = tl.cues
    .map((c) => `<li data-t="${c.t}" data-line="${c.line}">${c.t.toFixed(2)}s · ${c.scene} · L${c.line} {${c.id}}${c.precision === "interpolated" ? " ≈" : ""}</li>`)
    .join("");
  reportList.innerHTML =
    tl.report.map((r) => `<li data-line="${r.line ?? 0}" ${r.t !== undefined ? `data-t="${r.t}"` : ""}>${r.line ? `L${r.line} ` : ""}${r.code} ${escape(r.message)}</li>`).join("") ||
    "<li class=\"muted\">clean</li>";
  update(session!.player.time);
}

// --------------------------------------------------------------- update ---

function update(t: number): void {
  const s = session;
  if (!s) return;
  const { tl } = s;
  // Moving away from a held scene end (seek, skip, a scene card) drops the "scene done" card.
  if (sceneBreak.isHolding && Math.abs(t - (sceneBreak.heldAt! - 1 / tl.fps)) > 0.05) sceneBreak.dismiss();
  const from = lastT;
  lastT = t;
  const held = sceneBreak.isHolding;
  sceneBreak.check(tl, from, t, s.player.isPlaying, (id) => s.ir.scenes.find((x) => x.id === id)?.title);
  // Holding seeks back to the scene's last frame, which updated everything already.
  if (!held && sceneBreak.isHolding) return;
  scrub.value = String(t);
  scrub.style.setProperty("--p", `${tl.duration ? (t / tl.duration) * 100 : 0}%`);
  clock.innerHTML = `${fmtTime(t)} <span>/ ${fmtTime(tl.duration)}</span>`;
  setPlaying(s.player.isPlaying);

  // Narration follow-along: the beat being spoken, current word highlighted.
  const words = tl.words;
  const i = words.findIndex((w) => t >= w.t0 && t < w.t1 + 0.12);
  const scene = tl.scenes.find((sc) => t >= sc.t0 && t < sc.t1);
  const beat = scene?.beats.find((b) => t >= b.t0 && t < b.t1);
  const inBeat = beat ? words.filter((w) => w.scene === scene!.id && w.t0 >= beat.t0 && w.t1 <= beat.t1 + 1e-6) : [];
  narration.innerHTML = inBeat.map((w) => (w === words[i] ? `<span class="now">${escape(w.text)}</span>` : escape(w.text))).join(" ") || "&nbsp;";
  cuesList.querySelectorAll("li").forEach((li) => li.classList.toggle("passed", Number(li.dataset.t) <= t));
  panel.update(t, s.player.isPlaying);
  const playing = sceneAt(tl, t);
  sceneGrid.setActive(playing ? tl.scenes.indexOf(playing) : undefined);

  // Inspector, overlay and editor line follow at ~15 fps while playing.
  const now = performance.now();
  if (s.player.isPlaying && now - lastInspect < 66) return;
  lastInspect = now;
  const m = inspect(s.ir, tl, s.ev, t);
  renderInspector(inspectorBox, m);
  s.overlay.enabled = showBounds;
  s.overlay.update(m);
  editor.setNow(lineAt(m));
}

function setPlaying(playing: boolean): void {
  playBtn.dataset.state = playing ? "playing" : "paused";
  playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  controls.setPlaying(playing);
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
}

function selectLine(line: number): void {
  if (line <= 0) return;
  showTab("script");
  editor.select(line);
}

// ---------------------------------------------------------------- build ---

/** What the waiting badge says while a live video waits for its next scene. */
let waitLabel = "Writing the next scene";
/** The build being streamed; a new Build or a generation stops it. */
let buildAbort: AbortController | undefined;

/**
 * Builds the script in the editor progressively: the server compiles it all (mistakes show at once), then speaks it
 * scene by scene, and the first scene plays while the rest is spoken. `autoplay` is off for the example loaded with
 * the page (no click yet, so the browser would not let it play sound).
 */
async function build(autoplay = true): Promise<void> {
  if (renderMode) return buildWhole();
  stopGeneration();
  buildAbort?.abort();
  const abort = (buildAbort = new AbortController());
  // The old video stays on screen until the first new scene is ready, but silent.
  if (session?.player.isPlaying) {
    session.player.pause();
    update(session.player.time);
  }
  const buildBtn = $<HTMLButtonElement>("build");
  // Compiling takes a moment; speaking the narration is what takes time (Kokoro runs locally; beeps are instant).
  const what = tts.value === "kokoro" ? "speaking the narration with Kokoro" : tts.value === "piper" ? "speaking the narration with Piper" : "building";
  const started = performance.now();
  let total = 0;
  let shown = false;
  const tick = () => {
    if (shown) return;
    const s = Math.round((performance.now() - started) / 1000);
    waitingText.textContent = `Building · ${what}${total > 1 ? ` · scene 1 of ${total}` : ""}${s >= 2 ? ` · ${s}s` : ""}${tts.value === "kokoro" && s >= 8 ? " (Piper is ~4x faster; Beeps is instant)" : ""}`;
  };
  buildBtn.textContent = "Building…";
  tick();
  waiting.hidden = false;
  const timer = setInterval(tick, 1000);
  /** The first scene replaces whatever video was showing; until then the old one stays (a failed build keeps it). */
  const show = async (ir: VideoIR, tl: ResolvedTimeline, final: boolean) => {
    if (!shown) {
      shown = true;
      clearInterval(timer);
      waiting.hidden = true;
      teardown();
      waitLabel = "Speaking the next scene";
    }
    await extend(ir, tl, final, autoplay);
  };
  try {
    const res = await fetch(`/api/build-stream?${style()}`, { method: "POST", body: editor.value, signal: abort.signal });
    await readEvents(res, async (event, d) => {
      if (abort !== buildAbort) return;
      if (event === "start") {
        total = d.scenes;
        showDiagnostics(d.diagnostics);
        tick();
      } else if (event === "scene") {
        await show(d.ir, d.timeline, false);
      } else if (event === "done") {
        showDiagnostics(d.diagnostics);
        if (d.ok && d.ir && d.timeline) await show(d.ir, d.timeline, true);
        else session?.player.finish();
      } else if (event === "fail") {
        showDiagnostics([`build failed: ${d.error}`]);
        session?.player.finish();
      }
    });
  } catch (e) {
    if (abort.signal.aborted) return;
    showDiagnostics([`build failed: ${e instanceof Error ? e.message : String(e)} (is the Studio server running?)`]);
    session?.player.finish();
  } finally {
    clearInterval(timer);
    if (abort === buildAbort) {
      buildAbort = undefined;
      if (!shown) waiting.hidden = true;
      buildBtn.textContent = "Build";
    }
  }
}

/** The whole video in one request: the headless renderer needs every frame before it starts. */
async function buildWhole(): Promise<void> {
  let result: BuildResult;
  try {
    result = await (await fetch(`/api/build?${style()}`, { method: "POST", body: editor.value })).json();
  } catch (e) {
    result = { ok: false, diagnostics: [], error: `build failed: ${e instanceof Error ? e.message : String(e)}` } as BuildResult;
  }
  showDiagnostics(result.error ? [result.error] : result.diagnostics);
  if (!result.ok || !result.ir || !result.timeline) return;
  exposeForRender(mount(result.ir, result.timeline).stage);
}

/** Reads a server-sent event stream from a fetch response, handing each event over in order. */
async function readEvents(res: Response, on: (event: string, data: any) => Promise<void> | void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    for (let k = buffer.indexOf("\n\n"); k >= 0; k = buffer.indexOf("\n\n")) {
      const block = buffer.slice(0, k);
      buffer = buffer.slice(k + 2);
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (data !== undefined) await on(/^event: (.*)$/m.exec(block)?.[1] ?? "message", JSON.parse(data));
    }
  }
}

function showDiagnostics(lines: string[]): void {
  editor.setDiagnostics(lines);
  diagnostics.innerHTML =
    lines
      .map((d) => {
        const line = /^L(\d+):/.exec(d)?.[1] ?? "0";
        return `<li data-line="${line}" class="${/\[fixed:/.test(d) ? "fixed" : / error: /.test(d) ? "error" : "warning"}">${escape(d)}</li>`;
      })
      .join("") || `<li class="ok">✓ no diagnostics</li>`;
}

function note(text: string, cls: string): void {
  diagnostics.insertAdjacentHTML("beforeend", `<li class="${cls}">${escape(text)}</li>`);
}

async function loadExample(): Promise<void> {
  editor.value = await (await fetch(`/api/source?file=${encodeURIComponent(examples.value)}`)).text();
  // The example shows paused: there has been no click yet, and a page should not start talking by itself.
  await build(false);
}

// ------------------------------------------------------------- generate ---

let events: EventSource | undefined;
let queue = Promise.resolve();
const callsPanel = new CallsPanel($<HTMLElement>("calls-card"), $<HTMLElement>("calls"), $<HTMLElement>("calls-summary"));

function log(text: string, cls = ""): void {
  genLog.insertAdjacentHTML("beforeend", `<li class="${cls}">${escape(text).replace(/\n/g, "<br>")}</li>`);
  genLog.scrollTop = genLog.scrollHeight;
}

async function startGeneration(): Promise<void> {
  stopGeneration();
  buildAbort?.abort();
  buildAbort = undefined;
  $<HTMLButtonElement>("build").textContent = "Build";
  waitLabel = "Writing the next scene";
  teardown();
  panel.clear();
  genLog.innerHTML = "";
  savedScripts.show(false); // the log is what a new generation writes to
  if (provider.value !== "replay") callsPanel.start();
  // Prompt settings can be long, so they go ahead as a POST and the stream names them.
  const settingsId = await fetch("/api/settings", { method: "POST", body: JSON.stringify(promptSettings.value()) }).then((r) => r.json()).then((j: { id: string }) => j.id).catch(() => "");
  const q = new URLSearchParams({
    topic: $<HTMLTextAreaElement>("topic").value,
    provider: provider.value,
    ...(!$<HTMLLabelElement>("model-row").hidden && modelSel.value && { model: modelSel.value }),
    mode: $<HTMLSelectElement>("mode").value,
    domain: $<HTMLSelectElement>("domain").value,
    length: $<HTMLSelectElement>("length").value,
    settingsId,
    example: replayExample.value,
    ...Object.fromEntries(style()),
  });
  const started = performance.now();
  let firstFrame = 0;
  const es = (events = new EventSource(`/api/generate?${q}`));
  genBtn.disabled = true;
  stopBtn.hidden = false;
  const json = (e: Event) => JSON.parse((e as MessageEvent<string>).data);
  // Scene updates are applied strictly in order.
  const then = (fn: () => Promise<void> | void) => (queue = queue.then(fn).catch((e) => log(String(e), "error")));

  es.addEventListener("log", (e) => log(json(e)));
  es.addEventListener("call", (e) => callsPanel.upsert(json(e) as CallTrace));
  es.addEventListener("scene", (e) => {
    const d: BuildResult & { index: number; script: string } = json(e);
    then(async () => {
      if (events !== es) return;
      editor.value = d.script;
      showDiagnostics(d.diagnostics);
      if (!d.ok || !d.ir || !d.timeline) return log(`scene ${d.index + 1} didn't compile; waiting for the next one`, "warning");
      if (!firstFrame) firstFrame = performance.now();
      log(`scene ${d.index + 1} ready (${((performance.now() - started) / 1000).toFixed(1)}s) — ${d.timeline.duration.toFixed(1)}s of video`, "ok");
      await extend(d.ir, d.timeline, false);
    });
  });
  es.addEventListener("done", (e) => {
    const d: BuildResult & { script: string; generated: boolean; stats: { calls: number; repairs: number; usage: { prompt: number; completion: number }; seconds: number; traceFile?: string } } = json(e);
    finishStream(es);
    callsPanel.finish(d.stats.traceFile);
    void savedScripts.refresh();
    then(async () => {
      editor.value = d.script;
      showDiagnostics(d.diagnostics);
      const st = d.stats;
      log(
        `done: ${st.calls} LLM call(s), ${st.repairs} repair(s), ${st.usage.prompt}+${st.usage.completion} tokens, ${st.seconds.toFixed(1)}s` +
          (firstFrame ? ` · first scene playing after ${((firstFrame - started) / 1000).toFixed(1)}s` : ""),
        d.ok ? "ok" : "error",
      );
      if (d.ok && d.ir && d.timeline) await extend(d.ir, d.timeline, true);
      else session?.player.finish();
    });
  });
  es.addEventListener("fail", (e) => {
    finishStream(es);
    log(json(e).error, "error");
    then(() => session?.player.finish());
  });
  es.onerror = () => {
    if (events !== es) return;
    finishStream(es);
    log("connection lost", "error");
    then(() => session?.player.finish());
  };
}

function finishStream(es: EventSource): void {
  es.close();
  callsPanel.stop();
  if (events === es) events = undefined;
  genBtn.disabled = false;
  stopBtn.hidden = true;
}

function stopGeneration(): void {
  if (!events) return;
  finishStream(events);
  log("stopped", "warning");
  session?.player.finish();
}

type Choice = { name: string; summary: string };

let providersLoaded = false;

async function loadProviders(): Promise<void> {
  const p: { llm: Record<string, boolean>; models?: Record<string, { default: string; models: string[] }>; tts: string; examples: string[]; themes: Choice[]; motions: Choice[] } = await (await fetch("/api/providers")).json();
  // The server's default voice, unless the person picked one before.
  if (!remembered.restore(tts, "voice")) tts.value = p.tts;
  const options = (list: Choice[]) => list.map((c) => `<option value="${c.name}" title="${c.summary}">${c.name}</option>`).join("");
  if (!providersLoaded) {
    look.insertAdjacentHTML("beforeend", options(p.themes));
    motion.insertAdjacentHTML("beforeend", options(p.motions));
    replayExample.innerHTML = p.examples.map((f) => `<option>${f}</option>`).join("");
    remembered.restore(replayExample, "replay");
    providersLoaded = true;
  }
  const labels: Record<string, string> = { openrouter: "OpenRouter", gemini: "Gemini", anthropic: "Claude API", claude: "Claude subscription" };
  const any = Object.values(p.llm).some(Boolean);
  $<HTMLParagraphElement>("keys").innerHTML =
    Object.entries(p.llm)
      .map(([name, ok]) => `${labels[name] ?? name} ${ok ? "connected" : "not set"}`)
      .join(" · ") + (any ? "" : ` — add keys to <code>.env</code>, or replay an example offline.`);
  for (const option of provider.options) if (option.value in p.llm) option.disabled = !p.llm[option.value];
  // The provider picked last time, if it is still set up; else one that is.
  remembered.restore(provider, "provider");
  if (provider.selectedOptions[0]?.disabled) provider.value = "auto";
  if (!any) provider.value = "replay";
  $<HTMLLabelElement>("replay-row").hidden = provider.value !== "replay";
  modelMenus = p.models ?? {};
  showModels();
}

// ------------------------------------------------------------------- ui ---

function showTab(name: string): void {
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) => t.classList.toggle("on", t.id === `tab-${name}`));
}

function jumpCue(dir: 1 | -1): void {
  if (!session) return;
  const t = session.player.time;
  const times = [...new Set(session.tl.cues.map((c) => c.t))].sort((a, b) => a - b);
  const target = dir > 0 ? times.find((c) => c > t + 1e-3) : [...times].reverse().find((c) => c < t - 1e-3);
  if (target !== undefined) session.player.seek(target);
}

function onListClick(e: Event): void {
  const li = (e.target as HTMLElement).closest<HTMLElement>("[data-line], [data-t]");
  if (!li) return;
  if (li.dataset.t !== undefined) session?.player.seek(Number(li.dataset.t));
  if (Number(li.dataset.line) > 0) selectLine(Number(li.dataset.line));
}

async function init(): Promise<void> {
  if (renderMode) document.body.classList.add("render");
  const files: string[] = await (await fetch("/api/examples")).json();
  examples.innerHTML = files.map((f) => `<option>${f}</option>`).join("");
  const initial = params.get("file") ?? "photosynthesis.txt";
  if (files.includes(initial)) examples.value = initial;
  if (!renderMode) void loadProviders();
  await loadExample();
}

document.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab!)));
examples.addEventListener("change", () => void loadExample());
for (const pick of [look, motion]) pick.addEventListener("change", () => void build());
$<HTMLButtonElement>("build").addEventListener("click", () => void build());
editor.source.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void build();
  }
});
playBtn.addEventListener("click", () => {
  if (!session) return;
  // At a held scene end, play means "continue to the next scene".
  if (sceneBreak.isHolding) return sceneBreak.continue();
  session.player.toggle();
  update(session.player.time);
});
scrub.addEventListener("input", () => session?.player.seek(Number(scrub.value)));
$<HTMLButtonElement>("prev").addEventListener("click", () => jumpCue(-1));
$<HTMLButtonElement>("next").addEventListener("click", () => jumpCue(1));
for (const list of [cuesList, reportList, diagnostics, inspectorBox]) list.addEventListener("click", onListClick);
provider.addEventListener("change", () => {
  $<HTMLLabelElement>("replay-row").hidden = provider.value !== "replay";
  showModels();
});
modelSel.addEventListener("change", () => {
  try {
    localStorage.setItem(`studio.model.${provider.value}`, modelSel.value);
  } catch {
    /* storage unavailable: the choice just is not remembered */
  }
});

/** Shows the model menu for providers that offer one, remembering the last pick per provider. */
function showModels(): void {
  const menu = modelMenus[provider.value];
  $<HTMLLabelElement>("model-row").hidden = !menu;
  if (!menu) return;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(`studio.model.${provider.value}`);
  } catch {
    saved = null;
  }
  modelSel.innerHTML = menu.models.map((m) => `<option value="${escape(m)}">${escape(m)}${m === menu.default ? " (default)" : ""}</option>`).join("");
  modelSel.value = saved && menu.models.includes(saved) ? saved : menu.default;
}
$<HTMLFormElement>("gen-form").addEventListener("submit", (e) => {
  e.preventDefault();
  startGeneration();
});
stopBtn.addEventListener("click", () => stopGeneration());
$<HTMLTextAreaElement>("topic").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
    e.preventDefault();
    if (!genBtn.disabled) startGeneration();
  }
});

// Theme: light by default, else the system preference, remembered per browser.
const themeKey = "anim-studio-theme";
function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
}
try {
  const saved = localStorage.getItem(themeKey);
  applyTheme(saved === "dark" || saved === "light" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch {
  applyTheme("light");
}
$<HTMLButtonElement>("theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem(themeKey, next);
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
});
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === "Space") {
    e.preventDefault();
    playBtn.click();
  }
  // ← / → skip 10 s, like a video player; Shift + ← / → step from cue to cue.
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    if (e.shiftKey) jumpCue(dir);
    else skip(dir * SKIP);
  }
  if (e.key === "o" || e.key === "O") {
    showBounds = !showBounds;
    lastInspect = 0;
    if (session) update(session.player.time);
  }
});

void init();

// ------------------------------------------------------------- API keys ---
const keyInputs = [...document.querySelectorAll<HTMLInputElement>("input[data-key]")];
const showKeyHints = (hints: Record<string, string>) => {
  for (const el of document.querySelectorAll<HTMLElement>(".key-state[data-state]")) {
    const h = hints[el.dataset.state!];
    el.textContent = h ? `Saved (${h})` : "Not set";
    el.classList.toggle("on", Boolean(h));
  }
};
void fetch("/api/keys").then((r) => r.json()).then(showKeyHints).catch(() => undefined);
$<HTMLButtonElement>("keys-save").addEventListener("click", async () => {
  const msg = $<HTMLElement>("keys-msg");
  const body = Object.fromEntries(keyInputs.filter((i) => i.value.trim()).map((i) => [i.dataset.key!, i.value.trim()]));
  if (!Object.keys(body).length) {
    msg.textContent = "Nothing to save.";
    return;
  }
  try {
    const res = await fetch("/api/keys", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) throw new Error("could not save");
    showKeyHints(await res.json());
    for (const i of keyInputs) i.value = "";
    await loadProviders();
    msg.textContent = "Saved.";
  } catch {
    msg.textContent = "Could not save the keys.";
  }
});
