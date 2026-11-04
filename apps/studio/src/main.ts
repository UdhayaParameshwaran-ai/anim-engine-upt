import { exposeForRender, Player, Stage } from "@anim/engine";
import type { ResolvedTimeline, VideoIR } from "@anim/ir";
import { Editor } from "./editor.js";
import { createEvaluator, inspect, lineAt, type Evaluator } from "./inspect.js";
import { renderInspector } from "./inspector.js";
import { Overlay } from "./overlay.js";
import { TimelinePanel } from "./timeline-panel.js";
import { CallsPanel, type CallTrace } from "./calls.js";
import { $, escape } from "./util.js";

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
const overlayToggle = $<HTMLInputElement>("overlay-toggle");
const genLog = $<HTMLOListElement>("gen-log");
const genBtn = $<HTMLButtonElement>("generate");
const stopBtn = $<HTMLButtonElement>("stop");
const provider = $<HTMLSelectElement>("provider");
const modelSel = $<HTMLSelectElement>("model");
/** Model menus per provider (gemini, azure, claude), from /api/providers. */
let modelMenus: Record<string, { default: string; models: string[] }> = {};
const replayExample = $<HTMLSelectElement>("replay-example");

const editor = new Editor($<HTMLTextAreaElement>("source"), $<HTMLPreElement>("gutter"));
const panel = new TimelinePanel($<HTMLDivElement>("timeline"), {
  seek: (t) => session?.player.seek(t),
  select: (line) => selectLine(line),
});

let session: Session | undefined;
let lastInspect = 0;

// ------------------------------------------------------------- sessions ---

/** Builds a fresh stage + player for a timeline (replacing any previous one). */
function mount(ir: VideoIR, tl: ResolvedTimeline, live = false): Session {
  teardown();
  const stage = new Stage(stageBox, ir, tl, { autoFit: !renderMode });
  const player = new Player(stage, tl, {
    live,
    onTime: update,
    onEnd: () => setPlaying(false),
    onWait: (w) => {
      waitingText.textContent = "Writing the next scene";
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
async function extend(ir: VideoIR, tl: ResolvedTimeline, final: boolean): Promise<void> {
  if (!session) {
    const s = mount(ir, tl, !final);
    await loadAudio(s.player);
    s.player.play();
    setPlaying(true);
    return;
  }
  const old = session;
  const stage = new Stage(stageBox, ir, tl, { autoFit: true });
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
  session?.player.pause();
  session?.stage.destroy();
  session = undefined;
  waiting.hidden = true;
  setPlaying(false);
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

  // Inspector, overlay and editor line follow at ~15 fps while playing.
  const now = performance.now();
  if (s.player.isPlaying && now - lastInspect < 66) return;
  lastInspect = now;
  const m = inspect(s.ir, tl, s.ev, t);
  renderInspector(inspectorBox, m);
  s.overlay.enabled = overlayToggle.checked;
  s.overlay.update(m);
  editor.setNow(lineAt(m));
}

function setPlaying(playing: boolean): void {
  playBtn.dataset.state = playing ? "playing" : "paused";
  playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
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

let building = false;

async function build(): Promise<void> {
  if (building) return;
  stopGeneration();
  const buildBtn = $<HTMLButtonElement>("build");
  // Compiling takes a moment; speaking the narration is what takes time (Kokoro runs locally; beeps are instant).
  const what = tts.value === "kokoro" ? "speaking the narration with Kokoro" : tts.value === "piper" ? "speaking the narration with Piper" : "building";
  const started = performance.now();
  const tick = () => {
    const s = Math.round((performance.now() - started) / 1000);
    waitingText.textContent = `Building · ${what}${s >= 2 ? ` · ${s}s` : ""}${tts.value === "kokoro" && s >= 8 ? " (Piper is ~4x faster; Beeps is instant)" : ""}`;
  };
  building = true;
  buildBtn.disabled = true;
  buildBtn.textContent = "Building…";
  tick();
  waiting.hidden = false;
  const timer = setInterval(tick, 1000);
  let result: BuildResult;
  try {
    const res = await fetch(`/api/build?${style()}`, { method: "POST", body: editor.value });
    result = await res.json();
  } catch (e) {
    result = { ok: false, diagnostics: [], error: `build failed: ${e instanceof Error ? e.message : String(e)} (is the Studio server running?)` } as BuildResult;
  } finally {
    clearInterval(timer);
    waiting.hidden = true;
    building = false;
    buildBtn.disabled = false;
    buildBtn.textContent = "Build";
  }
  showDiagnostics(result.error ? [result.error] : result.diagnostics);
  if (!result.ok || !result.ir || !result.timeline) return;
  const s = mount(result.ir, result.timeline);
  if (renderMode) {
    exposeForRender(s.stage);
    return;
  }
  await loadAudio(s.player);
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
  await build();
}

// ------------------------------------------------------------- generate ---

let events: EventSource | undefined;
let queue = Promise.resolve();
const callsPanel = new CallsPanel($<HTMLElement>("calls-card"), $<HTMLElement>("calls"), $<HTMLElement>("calls-summary"));

function log(text: string, cls = ""): void {
  genLog.insertAdjacentHTML("beforeend", `<li class="${cls}">${escape(text).replace(/\n/g, "<br>")}</li>`);
  genLog.scrollTop = genLog.scrollHeight;
}

function startGeneration(): void {
  stopGeneration();
  teardown();
  panel.clear();
  genLog.innerHTML = "";
  if (provider.value !== "replay") callsPanel.start();
  const q = new URLSearchParams({
    topic: $<HTMLTextAreaElement>("topic").value,
    provider: provider.value,
    ...(!$<HTMLLabelElement>("model-row").hidden && modelSel.value && { model: modelSel.value }),
    mode: $<HTMLSelectElement>("mode").value,
    style: $<HTMLSelectElement>("style").value,
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

async function loadProviders(): Promise<void> {
  const p: { llm: Record<string, boolean>; models?: Record<string, { default: string; models: string[] }>; tts: string; examples: string[]; themes: Choice[]; motions: Choice[] } = await (await fetch("/api/providers")).json();
  tts.value = p.tts;
  const options = (list: Choice[]) => list.map((c) => `<option value="${c.name}" title="${c.summary}">${c.name}</option>`).join("");
  look.insertAdjacentHTML("beforeend", options(p.themes));
  motion.insertAdjacentHTML("beforeend", options(p.motions));
  replayExample.innerHTML = p.examples.map((f) => `<option>${f}</option>`).join("");
  const labels: Record<string, string> = { openrouter: "OpenRouter", azure: "Azure", gemini: "Gemini", groq: "Groq", claude: "Claude subscription" };
  const any = Object.values(p.llm).some(Boolean);
  $<HTMLParagraphElement>("keys").innerHTML =
    Object.entries(p.llm)
      .map(([name, ok]) => `${labels[name] ?? name} ${ok ? "connected" : "not set"}`)
      .join(" · ") + (any ? "" : ` — add keys to <code>.env</code>, or replay an example offline.`);
  for (const option of provider.options) if (option.value in p.llm) option.disabled = !p.llm[option.value];
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
  session.player.toggle();
  update(session.player.time);
});
scrub.addEventListener("input", () => session?.player.seek(Number(scrub.value)));
$<HTMLButtonElement>("prev").addEventListener("click", () => jumpCue(-1));
$<HTMLButtonElement>("next").addEventListener("click", () => jumpCue(1));
overlayToggle.addEventListener("change", () => {
  if (!session) return;
  lastInspect = 0;
  update(session.player.time);
});
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
  if (e.key === "ArrowRight") jumpCue(1);
  if (e.key === "ArrowLeft") jumpCue(-1);
  if (e.key === "o" || e.key === "O") overlayToggle.click();
});

void init();
