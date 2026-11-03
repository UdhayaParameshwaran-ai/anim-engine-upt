import { Stage } from "@anim/engine";
import type { ResolvedTimeline, VideoIR } from "@anim/ir";
import { COMPOSE_PATTERNS, GRID_ELEMENTS, GRID_LAYOUTS, TEMPLATES, THEMES } from "@anim/registry";
import { composeGroup, elementGroup, gridGroup, templateGroup, type Case, type Density, type Group } from "./gallery-cases.js";
import { $, escape } from "./util.js";

/**
 * Layout gallery (/gallery): every template in every variant, every grid
 * layout, every grid element and every compose pattern, each rendered from
 * a real example script by the same compiler and engine as the Studio.
 * Tiles build lazily as they scroll into view and show their final frame;
 * Play replays the entrances.
 */

type Built = { ok: boolean; diagnostics: string[]; ir?: VideoIR; timeline?: ResolvedTimeline };

const lookSel = $<HTMLSelectElement>("g-look");
const densitySel = $<HTMLSelectElement>("g-density");
const filter = $<HTMLInputElement>("g-filter");
const groupsEl = $<HTMLDivElement>("g-groups");
const toc = $<HTMLElement>("g-toc");

lookSel.innerHTML = THEMES.map((t) => `<option value="${t}">${t}</option>`).join("");
lookSel.value = "paper";
$<HTMLParagraphElement>("g-summary").textContent =
  `${TEMPLATES.length} templates · ${TEMPLATES.reduce((n, t) => n + t.variants.length, 0)} variants · ` +
  `${GRID_LAYOUTS.length} grid layouts · ${GRID_ELEMENTS.length} grid elements · ${COMPOSE_PATTERNS.length} compose patterns. ` +
  `Each tile is a real script; click Script to see it.`;

const cache = new Map<string, Promise<Built>>();
const stages = new Map<HTMLElement, Stage>();
let observer: IntersectionObserver | undefined;

// Builds go through the Studio's compiler (instant mock voice), a few at a time.
let running = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 4) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function build(c: Case): Promise<Built> {
  const key = `${lookSel.value}\n${c.script}`;
  let p = cache.get(key);
  if (!p) {
    p = limited(async () => (await fetch(`/api/build?tts=beeps&variants=exact&theme=${lookSel.value}`, { method: "POST", body: c.script })).json() as Promise<Built>);
    cache.set(key, p);
  }
  return p;
}

function groups(): Group[] {
  return [templateGroup(densitySel.value as Density), gridGroup(), elementGroup(), composeGroup()];
}

function render(): void {
  observer?.disconnect();
  for (const s of stages.values()) s.destroy();
  stages.clear();
  const q = filter.value.trim().toLowerCase();
  const match = (g: Group, title: string, c: Case) => !q || `${g.title} ${title} ${c.title} ${c.note}`.toLowerCase().includes(q);
  const all = groups();
  const byId = new Map<string, Case>();

  groupsEl.innerHTML = all
    .map((g) => {
      const sections = g.sections
        .map((s) => ({ ...s, cases: s.cases.filter((c) => match(g, s.title, c)) }))
        .filter((s) => s.cases.length);
      if (!sections.length) return "";
      return (
        `<section class="g-group" id="${g.id}"><h2>${escape(g.title)}</h2><p class="g-intro">${escape(g.intro)}</p>` +
        sections
          .map(
            (s) =>
              `<div class="g-section" id="${g.id}-${slug(s.title)}"><h3>${escape(s.title)}</h3><p class="hint">${escape(s.note)}</p><div class="g-tiles">` +
              s.cases
                .map((c) => {
                  byId.set(c.id, c);
                  return (
                    `<article class="g-tile" data-id="${c.id}">` +
                    `<div class="g-stage"><span class="g-status">Building…</span></div>` +
                    `<div class="g-meta"><div class="g-title"><b>${escape(c.title)}</b>` +
                    `<span class="g-actions"><button class="g-btn" data-act="play" title="Replay the entrances">Play</button>` +
                    `<button class="g-btn" data-act="script" title="Show the DSL">Script</button></span></div>` +
                    `<p class="g-note">${escape(c.note)}</p><pre class="g-script" hidden>${escape(c.script)}</pre><ul class="g-diag" hidden></ul></div>` +
                    `</article>`
                  );
                })
                .join("") +
              `</div></div>`,
          )
          .join("") +
        `</section>`
      );
    })
    .join("");

  toc.innerHTML = all
    .map(
      (g) =>
        `<a class="g-toc-group" href="#${g.id}">${escape(g.title)} <span>${g.sections.reduce((n, s) => n + s.cases.length, 0)}</span></a>` +
        g.sections.map((s) => `<a href="#${g.id}-${slug(s.title)}">${escape(s.title)} <span>${s.cases.length}</span></a>`).join(""),
    )
    .join("");
  if (!groupsEl.innerHTML) groupsEl.innerHTML = `<p class="hint">Nothing matches “${escape(q)}”.</p>`;

  // Build a tile when it comes near the viewport.
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer!.unobserve(e.target);
        const tile = e.target as HTMLElement;
        void show(tile, byId.get(tile.dataset.id!)!);
      }
    },
    { rootMargin: "400px 0px" },
  );
  groupsEl.querySelectorAll<HTMLElement>(".g-tile").forEach((t) => observer!.observe(t));
}

async function show(tile: HTMLElement, c: Case): Promise<void> {
  const box = tile.querySelector<HTMLElement>(".g-stage")!;
  const status = box.querySelector<HTMLElement>(".g-status")!;
  const diag = tile.querySelector<HTMLUListElement>(".g-diag")!;
  try {
    const r = await build(c);
    const notes = r.diagnostics.filter(Boolean);
    diag.innerHTML = notes.map((d) => `<li>${escape(d)}</li>`).join("");
    diag.hidden = !notes.length;
    tile.classList.toggle("has-diag", notes.length > 0);
    if (!r.ok || !r.ir || !r.timeline) {
      status.textContent = "Didn't compile";
      tile.classList.add("bad");
      return;
    }
    status.remove();
    const stage = new Stage(box, r.ir, r.timeline);
    stage.render(stage.duration);
    stages.set(tile, stage);
  } catch (e) {
    status.textContent = `Build failed: ${e instanceof Error ? e.message : String(e)}`;
    tile.classList.add("bad");
  }
}

/** Replays a tile from the start at real speed (no audio), ending on the final frame. */
function play(tile: HTMLElement): void {
  const stage = stages.get(tile);
  if (!stage) return;
  const t0 = performance.now();
  const tick = () => {
    if (stages.get(tile) !== stage) return;
    const t = (performance.now() - t0) / 1000;
    stage.render(Math.min(t, stage.duration));
    if (t < stage.duration) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

groupsEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
  if (!btn) return;
  const tile = btn.closest<HTMLElement>(".g-tile")!;
  if (btn.dataset.act === "play") play(tile);
  if (btn.dataset.act === "script") {
    const pre = tile.querySelector<HTMLElement>(".g-script")!;
    pre.hidden = !pre.hidden;
    btn.classList.toggle("on", !pre.hidden);
  }
});

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

let typing: number | undefined;
filter.addEventListener("input", () => {
  window.clearTimeout(typing);
  typing = window.setTimeout(render, 150);
});
lookSel.addEventListener("change", render);
densitySel.addEventListener("change", render);

// Theme toggle, shared with the Studio.
const themeKey = "anim-studio-theme";
try {
  const saved = localStorage.getItem(themeKey);
  document.documentElement.dataset.theme = saved === "dark" || saved === "light" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}
$<HTMLButtonElement>("theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(themeKey, next);
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
});

render();
