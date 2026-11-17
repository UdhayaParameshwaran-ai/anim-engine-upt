import { $, escape } from "./util.js";

interface Entry {
  id: string;
  at: string;
  topic: string;
  provider: string;
  length?: string;
  ok: boolean;
  seconds: number;
  scenes: number;
}

interface Hooks {
  /** Puts a script in the Script tab's editor and shows that tab. */
  open: (script: string) => void;
}

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Plain-http pages have no clipboard API: fall back to a hidden textarea.
    const t = document.createElement("textarea");
    t.value = text;
    t.style.cssText = "position:fixed;opacity:0";
    document.body.append(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  }
}

/**
 * Every generated script is kept on the server. This panel lists them (newest first) so a person can copy one,
 * open it in the Script tab to build it, or delete it. It replaces the generation log while it is open.
 */
export function history(hooks: Hooks): { refresh: () => Promise<void>; show: (on?: boolean) => void } {
  const panel = $<HTMLElement>("history");
  const list = $<HTMLUListElement>("history-list");
  const count = $<HTMLElement>("history-count");
  const toggle = $<HTMLButtonElement>("history-btn");
  const log = $<HTMLElement>("gen-log");

  async function refresh(): Promise<void> {
    let items: Entry[] = [];
    try {
      items = await (await fetch("/api/history")).json();
    } catch {
      count.textContent = "could not load";
      return;
    }
    count.textContent = items.length ? `${items.length} saved` : "";
    list.innerHTML = items.length
      ? items
          .map(
            (e) =>
              `<li data-id="${escape(e.id)}"${e.ok ? "" : ' class="bad"'}>` +
              `<div class="h-topic" title="${escape(e.topic)}">${escape(e.topic || "(no topic)")}</div>` +
              `<div class="h-meta">${escape(when(e.at))} · ${e.scenes} scene${e.scenes === 1 ? "" : "s"}${e.length ? ` · ${escape(e.length)}` : ""} · ${escape(e.provider)}${e.ok ? "" : " · had errors"}</div>` +
              `<div class="h-actions"><button type="button" class="btn" data-act="copy">Copy script</button>` +
              `<button type="button" class="btn" data-act="open">Open in Script</button>` +
              `<button type="button" class="btn" data-act="delete" title="Delete this entry" aria-label="Delete">Delete</button></div></li>`,
          )
          .join("")
      : '<li class="empty">Nothing yet. Every script you generate is saved here.</li>';
  }

  function show(on = panel.hidden): void {
    panel.hidden = !on;
    log.hidden = on;
    toggle.setAttribute("aria-pressed", String(on));
    if (on) void refresh();
  }

  async function script(id: string): Promise<string> {
    return ((await (await fetch(`/api/history?id=${encodeURIComponent(id)}`)).json()) as { script: string }).script;
  }

  list.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    const li = btn?.closest<HTMLElement>("li[data-id]");
    if (!btn || !li) return;
    const id = li.dataset.id!;
    try {
      if (btn.dataset.act === "copy") {
        const label = btn.textContent;
        btn.textContent = (await copy(await script(id))) ? "Copied" : "Copy failed";
        setTimeout(() => (btn.textContent = label), 1500);
      } else if (btn.dataset.act === "open") {
        hooks.open(await script(id));
      } else if (btn.dataset.act === "delete") {
        await fetch(`/api/history?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        await refresh();
      }
    } catch {
      btn.textContent = "Failed";
    }
  });
  toggle.addEventListener("click", () => show());
  void refresh();
  return { refresh, show };
}
