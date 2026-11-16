import { $ } from "./util.js";

/** What the server says each setting is when left alone (GET /api/prompt-defaults). */
interface Defaults {
  maxWords: number;
  lengths: Record<string, { scenes: Range; sentences: Range; chapters: Range; advice: string; summary: string }>;
  motionHints: Record<string, string>;
  templates: string[];
  prompts: Record<string, { text: string; slots: string[] }>;
  promptInfo: Record<string, { title: string; stage: string; about: string }>;
  slotInfo: Record<string, { about: string; required?: boolean }>;
}
interface Range {
  min: number;
  max: number;
}

/** What the panel keeps and sends: the PromptSettings of @anim/llm. Missing = default. */
type Values = Record<string, unknown>;

const KEY = "studio.prompts";

const load = (): Values => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};
const save = (v: Values) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private window: the settings still work for this page */
  }
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
};

/**
 * The prompt settings panel: audience, tone, language and notes; length and planning advice; narration rules and
 * motion hints. Every field shows its default, can be reset on its own, and the whole panel resets at once.
 * Only what is edited is sent.
 */
export function promptSettings(): { value(): Values } {
  const shell = $<HTMLElement>("settings-panel");
  const backdrop = $<HTMLElement>("sheet-backdrop");
  const panes = {
    wording: $<HTMLElement>("pane-wording"),
    planning: $<HTMLElement>("pane-planning"),
    writing: $<HTMLElement>("pane-writing"),
    prompts: $<HTMLElement>("pane-prompts"),
  };
  const btn = $<HTMLButtonElement>("prompts-btn");
  const dot = $<HTMLElement>("prompts-dot");
  let values = load();
  let defaults: Defaults | undefined;

  const tabs = [...shell.querySelectorAll<HTMLButtonElement>(".sheet-tabs button")];
  const show = (name: string) => {
    for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.sheetTab === name));
    for (const s of shell.querySelectorAll<HTMLElement>(".sheet-pane")) s.hidden = s.dataset.pane !== name;
    shell.querySelector<HTMLElement>(".sheet-body")!.scrollTop = 0;
  };
  for (const t of tabs) t.addEventListener("click", () => show(t.dataset.sheetTab!));

  let opener: HTMLElement | null = null;
  const close = () => {
    shell.hidden = backdrop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    opener?.focus();
  };
  const open = async () => {
    opener = document.activeElement as HTMLElement | null;
    shell.hidden = backdrop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    shell.querySelector<HTMLElement>(".sheet-tabs button[aria-selected=true]")?.focus();
    if (!defaults) {
      try {
        defaults = (await (await fetch("/api/prompt-defaults")).json()) as Defaults;
      } catch {
        for (const pane of Object.values(panes)) pane.textContent = "Could not load the defaults. Is the Studio server running?";
        return;
      }
      render();
    }
  };
  btn.addEventListener("click", () => (shell.hidden ? void open() : close()));
  $("sheet-close").addEventListener("click", close);
  $("sheet-done").addEventListener("click", close);
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !shell.hidden) close();
  });
  $("sheet-reset").addEventListener("click", () => {
    values = {};
    changed();
    if (defaults) render();
  });

  /** A dot on each tab that holds something the person changed. */
  const TAB_KEYS: Record<string, string[]> = {
    wording: ["audience", "tone", "language", "notes"],
    planning: ["scenes", "planningAdvice"],
    writing: ["maxWords", "sentences", "motionHints", "templateNotes"],
    prompts: ["prompts"],
  };
  const badges = () => {
    for (const t of tabs) {
      const keys = TAB_KEYS[t.dataset.sheetTab!];
      const n = keys ? keys.filter((k) => values[k] !== undefined).length : 0;
      const i = t.querySelector("i")!;
      i.hidden = n === 0;
      i.textContent = String(n);
    }
  };

  const changed = () => {
    for (const k of Object.keys(values)) {
      const v = values[k];
      if (v === undefined || v === "" || (typeof v === "object" && v !== null && !Object.keys(v).length)) delete values[k];
    }
    save(values);
    dot.hidden = !Object.keys(values).length;
  badges();
    badges();
  };
  dot.hidden = !Object.keys(values).length;

  /** A text field (single line or area) with its default shown as placeholder and its own reset. */
  function text(label: string, key: string, hint: string, opts: { area?: boolean; placeholder?: string; type?: string } = {}) {
    const input = opts.area ? el("textarea", { rows: "3" }) : el("input", { type: opts.type ?? "text" });
    input.placeholder = opts.placeholder ?? "";
    input.value = values[key] === undefined ? "" : String(values[key]);
    const reset = el("button", { type: "button", class: "reset", title: "Back to the default" }, "↺");
    const sync = () => (reset.hidden = input.value === "");
    sync();
    input.addEventListener("input", () => {
      const v = input.value;
      values[key] = opts.type === "number" ? (v === "" ? undefined : Number(v)) : v;
      sync();
      changed();
    });
    reset.addEventListener("click", () => {
      input.value = "";
      values[key] = undefined;
      sync();
      changed();
    });
    return el("label", { class: "pfield" }, el("span", { class: "plabel" }, label, reset), input, el("small", {}, hint));
  }

  /** Two numbers (min and max) kept as one range setting. */
  function pair(label: string, key: string, hint: string, ph: Range) {
    const lo = el("input", { type: "number", min: "1", placeholder: String(ph.min) });
    const hi = el("input", { type: "number", min: "1", placeholder: String(ph.max) });
    const cur = values[key] as Range | undefined;
    if (cur) [lo.value, hi.value] = [String(cur.min), String(cur.max)];
    const reset = el("button", { type: "button", class: "reset", title: "Back to the default" }, "↺");
    const sync = () => (reset.hidden = lo.value === "" && hi.value === "");
    sync();
    const upd = () => {
      values[key] = lo.value === "" ? undefined : { min: Number(lo.value), max: Number(hi.value || lo.value) };
      sync();
      changed();
    };
    lo.addEventListener("input", upd);
    hi.addEventListener("input", upd);
    reset.addEventListener("click", () => {
      lo.value = hi.value = "";
      upd();
    });
    return el("label", { class: "pfield" }, el("span", { class: "plabel" }, label, reset), el("span", { class: "pair" }, lo, "to", hi), el("small", {}, hint));
  }

  /** A per-template text: pick the template, edit its text; empty means the default. */
  function perTemplate(label: string, key: string, hint: string, names: string[], fallback: (n: string) => string) {
    const map = (values[key] ??= {}) as Record<string, string>;
    const pick = el("select");
    for (const n of names) pick.append(el("option", { value: n }, (n === "grid" ? "grid pages" : n) + (map[n] !== undefined ? " •" : "")));
    const area = el("textarea", { rows: "3" });
    const reset = el("button", { type: "button", class: "reset", title: "Back to the default" }, "↺");
    const show = () => {
      const n = pick.value;
      area.value = map[n] ?? "";
      area.placeholder = fallback(n);
      reset.hidden = map[n] === undefined;
    };
    const mark = () => {
      const o = pick.selectedOptions[0]!;
      o.textContent = (pick.value === "grid" ? "grid pages" : pick.value) + (map[pick.value] !== undefined ? " •" : "");
    };
    pick.addEventListener("change", show);
    area.addEventListener("input", () => {
      // Empty is the default; a single space turns the built-in text off.
      map[pick.value] = area.value;
      if (area.value === "") delete map[pick.value];
      if (!Object.keys(map).length) values[key] = undefined;
      mark();
      reset.hidden = map[pick.value] === undefined;
      changed();
    });
    reset.addEventListener("click", () => {
      delete map[pick.value];
      if (!Object.keys(map).length) values[key] = undefined;
      show();
      mark();
      changed();
    });
    show();
    return el("label", { class: "pfield" }, el("span", { class: "plabel" }, label, reset), pick, area, el("small", {}, hint));
  }

  /**
   * One whole prompt: its default text is the starting point of the editor. Edit it in place; the arrows put the
   * default back. Clearing the box is the default too. {{slots}} are the parts the program fills in.
   */
  function promptEditor(id: string): HTMLElement {
    const d = defaults!;
    const info = d.promptInfo[id]!;
    const def = d.prompts[id]!;
    const mine = (): Record<string, string> => ((values.prompts ??= {}) as Record<string, string>);
    const area = el("textarea", { rows: "14", spellcheck: "false", class: "prompt-text" });
    area.placeholder = def.text;
    area.value = mine()[id] ?? def.text;
    const state = el("span", { class: "pstate" });
    const warn = el("small", { class: "pwarn" });
    const chips = el("div", { class: "slots" });
    const reset = el("button", { type: "button", class: "reset", title: "Back to the default text" }, "↺ default");
    const summary = el("summary", {}, el("strong", {}, info.title), " ", state);

    const check = () => {
      const text = area.value;
      const used = new Set([...text.matchAll(/{{([a-z0-9_]+)}}/g)].map((m) => m[1]!));
      const unknown = [...used].filter((n) => !def.slots.includes(n));
      const missing = def.slots.filter((n) => d.slotInfo[n]?.required && !used.has(n));
      warn.textContent = [unknown.length && `Unknown slot: ${unknown.map((n) => "{{" + n + "}}").join(", ")} (it will stay as written).`, missing.length && `Removed: ${missing.map((n) => "{{" + n + "}}").join(", ")}. The model will not get that part.`].filter(Boolean).join(" ");
      const edited = text !== def.text && text.trim() !== "";
      state.textContent = edited ? "edited" : "default";
      state.className = "pstate " + (edited ? "on" : "");
      reset.hidden = !edited;
      summary.dataset.edited = String(edited);
    };
    area.addEventListener("input", () => {
      const t = area.value;
      if (t.trim() === "" || t === def.text) delete mine()[id];
      else mine()[id] = t;
      if (!Object.keys(mine()).length) values.prompts = undefined;
      check();
      changed();
    });
    reset.addEventListener("click", () => {
      area.value = def.text;
      delete mine()[id];
      if (!Object.keys(mine()).length) values.prompts = undefined;
      check();
      changed();
    });
    for (const n of def.slots) {
      const chip = el("button", { type: "button", class: "slot", title: d.slotInfo[n]?.about ?? "" }, "{{" + n + "}}");
      chip.addEventListener("click", () => {
        const at = area.selectionStart ?? area.value.length;
        area.setRangeText("{{" + n + "}}", at, area.selectionEnd ?? at, "end");
        area.dispatchEvent(new Event("input"));
        area.focus();
      });
      chips.append(chip);
    }
    check();
    return el("details", { class: "prompt-block" }, summary, el("p", { class: "pabout" }, info.about), area, warn, el("div", { class: "slots-row" }, el("span", {}, "Slots (click to insert):"), chips), reset);
  }

  function render() {
    const d = defaults!;
    const length = ($("length") as HTMLSelectElement).value || "standard";
    const spec = d.lengths[length] ?? d.lengths.standard!;
    panes.wording.replaceChildren(
      el("p", { class: "sheet-intro" }, "Who the video is for and how it sounds. Added to every call, so the plan and every scene follow it."),
      text("Audience", "audience", "Who watches. It sets the depth.", { placeholder: "chosen from the topic" }),
      text("Tone", "tone", "How the narration sounds.", { placeholder: "neutral" }),
      text("Language", "language", "Narration language. Script syntax and ids stay as they are.", { placeholder: "English" }),
      text("Notes", "notes", "Anything else: product names, words to use or avoid.", { area: true }),
    );
    panes.planning.replaceChildren(
      el("p", { class: "sheet-intro" }, `How many scenes the plan has. The Length choice on the Video tab sets the starting point (now: ${length}, ${spec.scenes.min}–${spec.scenes.max} scenes).`),
      pair("Scenes", "scenes", `Overrides the Length menu. Now: ${spec.scenes.min}–${spec.scenes.max} for ${length}.`, spec.scenes),
      text("Planning advice", "planningAdvice", "Added to the plan. Type a space to turn the default off.", { area: true, placeholder: spec.advice || "(no advice at this length)" }),
    );
    panes.writing.replaceChildren(
      el("p", { class: "sheet-intro" }, "How each scene is written: sentence size, and extra advice for a template."),
      text("Most words per sentence", "maxWords", "One idea per sentence.", { type: "number", placeholder: String(d.maxWords) }),
      pair("Sentences per scene", "sentences", "Per chapter in a growing diagram.", spec.sentences),
      perTemplate("Motion hint", "motionHints", "What tells the model to show motion in this template. Empty is the built-in hint; a space turns it off.", Object.keys(d.motionHints), (n) => d.motionHints[n] ?? ""),
      perTemplate("Template note", "templateNotes", "Extra advice for one template.", d.templates, () => "(none)"),
    );
    panes.prompts.replaceChildren(
      el("p", { class: "sheet-intro" }, "The text each call is sent, as it is now. Edit it in place; {{slots}} are filled in by the program (the verbs, the templates, the pictures), so your text keeps up with them. Clear a box or press the default arrow to go back."),
      ...["Planning", "Writing scenes", "Checking"].flatMap((stage) => [
        el("h4", {}, stage),
        ...Object.keys(d.prompts).filter((id) => d.promptInfo[id]?.stage === stage).map(promptEditor),
      ]),
    );
  }

  // The Length menu changes what the defaults say.
  $("length").addEventListener("change", () => defaults && !shell.hidden && render());

  return {
    value: () => {
      const out: Values = {};
      for (const [k, v] of Object.entries(values)) {
        if (v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length) continue;
        out[k] = v;
      }
      return out;
    },
  };
}
