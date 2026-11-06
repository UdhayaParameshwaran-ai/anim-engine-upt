import { escape } from "./util.js";

/** Mirrors @anim/llm's CallTrace (the Studio receives it as JSON). */
export interface CallTrace {
  id: number;
  kind: "outline" | "scene" | "repair" | "quality" | "single";
  scene?: string;
  attempt?: number;
  status: "running" | "done" | "failed";
  provider?: string;
  model?: string;
  start: number;
  ms?: number;
  firstTokenMs?: number;
  usage?: { prompt: number; completion: number; cached?: number };
  estimated?: boolean;
  system: "outline" | "full" | "scene";
  systemChars: number;
  history: number;
  prompt: string;
  reply?: string;
  request?: { system: string; messages: { role: string; content: string }[] };
  wire?: { request: string; response: string };
  reason?: string;
  check?: { errors: number; warnings: number; quality: number };
  verdict?: string;
  error?: string;
}

const KIND_LABEL: Record<CallTrace["kind"], string> = { outline: "Outline", scene: "Scene", repair: "Repair", quality: "Improve", single: "Script" };

/**
 * Live table of the LLM calls behind a generation: what each call was for,
 * when it ran (a waterfall against the whole run), tokens in/out, how its
 * reply validated, and, on click, the reason, prompt and reply.
 */
export class CallsPanel {
  private calls = new Map<number, CallTrace>();
  private open = new Set<number>();
  private t0 = 0;
  private timer: number | undefined;
  private file = "";

  constructor(
    private readonly card: HTMLElement,
    private readonly body: HTMLElement,
    private readonly summary: HTMLElement,
  ) {
    body.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("tr[data-id]");
      if (!row || (e.target as HTMLElement).closest("details")) return;
      const id = Number(row.dataset.id);
      this.open.has(id) ? this.open.delete(id) : this.open.add(id);
      this.render();
    });
  }

  start(): void {
    this.calls.clear();
    this.open.clear();
    this.file = "";
    this.t0 = performance.now();
    this.card.hidden = false;
    this.render();
  }

  upsert(call: CallTrace): void {
    this.calls.set(call.id, call);
    this.render();
    // Running bars grow until their call ends.
    const running = [...this.calls.values()].some((c) => c.status === "running");
    if (running && this.timer === undefined) this.timer = window.setInterval(() => this.render(), 250);
    if (!running) this.stop();
  }

  finish(traceFile?: string): void {
    this.file = traceFile ?? "";
    this.stop();
    this.render();
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
  }

  private render(): void {
    const calls = [...this.calls.values()].sort((a, b) => a.id - b.id);
    const now = performance.now() - this.t0;
    const end = (c: CallTrace) => c.start + (c.ms ?? Math.max(0, now - c.start));
    const span = Math.max(1, ...calls.map(end));

    const tin = sum(calls, (c) => c.usage?.prompt ?? 0);
    const tout = sum(calls, (c) => c.usage?.completion ?? 0);
    const cached = sum(calls, (c) => c.usage?.cached ?? 0);
    const est = calls.some((c) => c.estimated) ? "~" : "";
    const repairs = calls.filter((c) => c.kind === "repair" || c.kind === "quality").length;
    this.summary.innerHTML =
      `${calls.length} call${calls.length === 1 ? "" : "s"} · ${repairs} repair${repairs === 1 ? "" : "s"} · ` +
      `${est}${tokens(tin)} in${cached ? ` (${tokens(cached)} cached)` : ""} / ${est}${tokens(tout)} out · ${secs(span)}` +
      (this.file ? ` · saved <code>${escape(this.file)}</code>` : "");

    if (!calls.length) {
      this.body.innerHTML = `<p class="calls-empty">Waiting for the first call…</p>`;
      return;
    }

    // Per scene: how many calls and how much time/tokens it took to get it right.
    const scenes = new Map<string, CallTrace[]>();
    for (const c of calls) if (c.scene) scenes.set(c.scene, [...(scenes.get(c.scene) ?? []), c]);
    const chips = [...scenes]
      .map(([id, cs]) => {
        const last = [...cs].reverse().find((c) => c.check);
        const state = cs.some((c) => c.status === "running") ? "running" : last?.check?.errors ? "bad" : last ? "good" : "";
        return (
          `<span class="scene-chip ${state}" title="${cs.length} call(s)">` +
          `<b>${escape(id)}</b> ${cs.length}× · ${secs(sum(cs, (c) => c.ms ?? 0))} · ${tokens(sum(cs, (c) => (c.usage?.prompt ?? 0) + (c.usage?.completion ?? 0)))} tok</span>`
        );
      })
      .join("");

    const rows = calls
      .map((c) => {
        const left = (c.start / span) * 100;
        const width = Math.max(0.6, ((end(c) - c.start) / span) * 100);
        const ttft = c.firstTokenMs !== undefined ? `<i style="left:${(c.firstTokenMs / Math.max(1, end(c) - c.start)) * 100}%"></i>` : "";
        const result =
          c.status === "running"
            ? `<span class="muted">running…</span>`
            : c.status === "failed"
              ? `<span class="bad">failed</span>`
              : `${c.check ? checkBadge(c.check) : ""}<span class="muted">${escape(c.verdict ?? "")}</span>`;
        const row =
          `<tr data-id="${c.id}" class="${this.open.has(c.id) ? "open" : ""}">` +
          `<td class="num">${c.id}</td>` +
          `<td><span class="kind ${c.kind}">${KIND_LABEL[c.kind]}${c.attempt ? ` ${c.attempt}` : ""}</span></td>` +
          `<td class="mono">${escape(c.scene ?? "—")}</td>` +
          `<td class="num">${c.usage ? (c.estimated ? "~" : "") + tokens(c.usage.prompt) : ""}</td>` +
          `<td class="num">${c.usage ? (c.estimated ? "~" : "") + tokens(c.usage.completion) : ""}</td>` +
          `<td class="num">${c.ms !== undefined ? secs(c.ms) : secs(Math.max(0, now - c.start))}</td>` +
          `<td class="bar-cell"><div class="bar ${c.status} ${c.kind}" style="left:${left}%;width:${width}%">${ttft}</div></td>` +
          `<td class="result">${result}</td>` +
          `</tr>`;
        return row + (this.open.has(c.id) ? detail(c) : "");
      })
      .join("");

    this.body.innerHTML =
      (chips ? `<div class="scene-chips">${chips}</div>` : "") +
      `<table class="calls"><thead><tr><th>#</th><th>Step</th><th>Scene</th><th class="num">In</th><th class="num">Out</th><th class="num">Time</th><th>Timeline</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
}

function detail(c: CallTrace): string {
  const facts = [
    c.model && `${escape(c.provider ?? "")} · ${escape(c.model)}`,
    `${c.system} system prompt (${tokens(Math.ceil(c.systemChars / 4))} tok)`,
    c.history ? `${c.history} earlier message${c.history === 1 ? "" : "s"} resent` : "no history",
    c.firstTokenMs !== undefined && `first token after ${secs(c.firstTokenMs)}`,
    c.usage?.cached && `${tokens(c.usage.cached)} prompt tokens cached`,
    c.estimated && "tokens estimated (provider sent no usage)",
    `started at ${secs(c.start)}`,
  ].filter(Boolean);
  return (
    `<tr class="detail"><td></td><td colspan="7">` +
    `<p class="facts">${facts.join(" · ")}</p>` +
    (c.error ? `<pre class="bad">${escape(c.error)}</pre>` : "") +
    (c.reason ? `<details open><summary>Why this call (sent to the model)</summary><pre>${escape(c.reason)}</pre></details>` : "") +
    // The whole input, in the order the model reads it.
    (c.request
      ? `<details class="input"><summary>Full input: system prompt + ${c.request.messages.length} message${c.request.messages.length === 1 ? "" : "s"} (${tokens(Math.ceil((c.request.system.length + c.request.messages.reduce((n, m) => n + m.content.length, 0)) / 4))} tok)</summary>` +
        `<details><summary>system (${tokens(Math.ceil(c.request.system.length / 4))} tok)</summary><pre>${escape(c.request.system)}</pre></details>` +
        c.request.messages.map((m, i) => `<details${i === c.request!.messages.length - 1 ? " open" : ""}><summary>${escape(m.role)} ${i + 1} (${tokens(Math.ceil(m.content.length / 4))} tok)${i === c.request!.messages.length - 1 ? " · this call's new message" : " · resent"}</summary><pre>${escape(m.content)}</pre></details>`).join("") +
        `</details>`
      : `<details><summary>Prompt (${tokens(Math.ceil(c.prompt.length / 4))} tok)</summary><pre>${escape(c.prompt)}</pre></details>`) +
    (c.wire ? `<details><summary>Exactly what the provider received</summary><pre>${escape(c.wire.request)}</pre></details>` : "") +
    (c.reply !== undefined ? `<details open><summary>Reply (raw model output)</summary><pre>${escape(c.reply)}</pre></details>` : "") +
    (c.wire ? `<details><summary>Provider's raw response</summary><pre>${escape(c.wire.response)}</pre></details>` : "") +
    `</td></tr>`
  );
}

function checkBadge(k: { errors: number; warnings: number; quality: number }): string {
  if (k.errors) return `<span class="badge bad">${k.errors} error${k.errors === 1 ? "" : "s"}</span>`;
  const extra = [k.warnings && `${k.warnings} warn`, k.quality && `${k.quality} weak`].filter(Boolean).join(", ");
  return `<span class="badge good">valid${extra ? ` · ${extra}` : ""}</span>`;
}

function sum<T>(list: T[], f: (x: T) => number): number {
  return list.reduce((n, x) => n + f(x), 0);
}

function tokens(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function secs(ms: number): string {
  return ms >= 10_000 ? `${(ms / 1000).toFixed(0)}s` : `${(ms / 1000).toFixed(1)}s`;
}
