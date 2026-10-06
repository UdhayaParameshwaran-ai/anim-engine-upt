import { exposeForRender, Player, Stage } from "@anim/engine";
import type { ResolvedTimeline, VideoIR } from "@anim/ir";

interface BuildResult {
  ok: boolean;
  diagnostics: string[];
  ir?: VideoIR;
  timeline?: ResolvedTimeline;
  error?: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const renderMode = params.has("render");

const examples = $<HTMLSelectElement>("examples");
const source = $<HTMLTextAreaElement>("source");
const speed = $<HTMLInputElement>("speed");
const diagnostics = $<HTMLUListElement>("diagnostics");
const stageBox = $<HTMLDivElement>("stage");
const playBtn = $<HTMLButtonElement>("play");
const scrub = $<HTMLInputElement>("scrub");
const clock = $<HTMLSpanElement>("clock");
const narration = $<HTMLParagraphElement>("narration");
const cuesList = $<HTMLOListElement>("cues");
const reportList = $<HTMLUListElement>("report");

let stage: Stage | undefined;
let player: Player | undefined;
let timeline: ResolvedTimeline | undefined;

async function init(): Promise<void> {
  if (renderMode) document.body.classList.add("render");
  const files: string[] = await (await fetch("/api/examples")).json();
  examples.innerHTML = files.map((f) => `<option>${f}</option>`).join("");
  const initial = params.get("file") ?? "photosynthesis.txt";
  if (files.includes(initial)) examples.value = initial;
  await loadExample();
}

async function loadExample(): Promise<void> {
  source.value = await (await fetch(`/api/source?file=${encodeURIComponent(examples.value)}`)).text();
  await build();
}

async function build(): Promise<void> {
  player?.pause();
  const res = await fetch(`/api/build?speed=${speed.value}`, { method: "POST", body: source.value });
  const result: BuildResult = await res.json();
  showDiagnostics(result);
  if (!result.ok || !result.ir || !result.timeline) return;

  stage?.destroy();
  timeline = result.timeline;
  stage = new Stage(stageBox, result.ir, timeline, { autoFit: !renderMode });
  player = new Player(stage, timeline, { onTime: update, onEnd: () => (playBtn.textContent = "▶") });
  if (renderMode) {
    exposeForRender(stage);
    return;
  }
  try {
    await player.load();
  } catch (e) {
    diagnostics.insertAdjacentHTML("beforeend", `<li class="warning">audio unavailable: ${escape(String(e))}</li>`);
  }
  scrub.max = String(timeline.duration);
  scrub.step = String(1 / timeline.fps);
  showCues();
  showReport();
  update(0);
}

function update(t: number): void {
  if (!timeline) return;
  scrub.value = String(t);
  clock.textContent = `${t.toFixed(2)} / ${timeline.duration.toFixed(2)}`;
  // Narration follow-along: the beat being spoken, current word highlighted.
  const words = timeline.words;
  const i = words.findIndex((w) => t >= w.t0 && t < w.t1 + 0.12);
  const scene = timeline.scenes.find((s) => t >= s.t0 && t < s.t1);
  const beat = scene?.beats.find((b) => t >= b.t0 && t < b.t1);
  const inBeat = beat ? words.filter((w) => w.scene === scene!.id && w.t0 >= beat.t0 && w.t1 <= beat.t1 + 1e-6) : [];
  narration.innerHTML = inBeat.map((w) => (w === words[i] ? `<span class="now">${escape(w.text)}</span>` : escape(w.text))).join(" ") || "&nbsp;";
  cuesList.querySelectorAll("li").forEach((li) => li.classList.toggle("passed", Number(li.dataset.t) <= t));
}

function showDiagnostics(r: BuildResult): void {
  const lines = r.error ? [r.error] : r.diagnostics;
  diagnostics.innerHTML =
    lines.map((d) => `<li class="${/\[fixed:/.test(d) ? "fixed" : / error: /.test(d) ? "error" : "warning"}">${escape(d)}</li>`).join("") ||
    `<li class="ok">✓ no diagnostics</li>`;
}

function showCues(): void {
  cuesList.innerHTML = timeline!.cues
    .map((c) => `<li data-t="${c.t}" title="line ${c.line}">${c.t.toFixed(2)}s · ${c.scene} · L${c.line} {${c.id}}${c.precision === "interpolated" ? " ≈" : ""}</li>`)
    .join("");
}

function showReport(): void {
  reportList.innerHTML = timeline!.report.map((r) => `<li>${r.line ? `L${r.line} ` : ""}${r.code} ${escape(r.message)}</li>`).join("") || "<li>clean</li>";
}

function jumpCue(dir: 1 | -1): void {
  if (!player || !timeline) return;
  const t = player.time;
  const times = [...new Set(timeline.cues.map((c) => c.t))].sort((a, b) => a - b);
  const target = dir > 0 ? times.find((c) => c > t + 1e-3) : [...times].reverse().find((c) => c < t - 1e-3);
  if (target !== undefined) player.seek(target);
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

examples.addEventListener("change", () => void loadExample());
$<HTMLButtonElement>("build").addEventListener("click", () => void build());
source.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void build();
  }
});
playBtn.addEventListener("click", () => {
  if (!player) return;
  player.toggle();
  playBtn.textContent = player.isPlaying ? "⏸" : "▶";
});
scrub.addEventListener("input", () => player?.seek(Number(scrub.value)));
$<HTMLButtonElement>("prev").addEventListener("click", () => jumpCue(-1));
$<HTMLButtonElement>("next").addEventListener("click", () => jumpCue(1));
cuesList.addEventListener("click", (e) => {
  const li = (e.target as HTMLElement).closest("li");
  if (li) player?.seek(Number(li.dataset.t));
});
document.addEventListener("keydown", (e) => {
  if (e.target === source || e.target instanceof HTMLInputElement) return;
  if (e.code === "Space") {
    e.preventDefault();
    playBtn.click();
  }
  if (e.key === "ArrowRight") jumpCue(1);
  if (e.key === "ArrowLeft") jumpCue(-1);
});

void init();
