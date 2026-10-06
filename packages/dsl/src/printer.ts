import type { Action, Args, Beat, ElementDecl, Place, Scene, Script, Setting, Step } from "./ast.js";

/**
 * Prints an AST back to canonical source. parse(print(ast)) yields the same
 * AST (ignoring spans); used for formatting, migrations and repair prompts.
 */
export function print(script: Script): string {
  const out: string[] = [];
  out.push(`video ${script.version}${script.title !== undefined ? " " + quote(script.title) : ""}`);
  for (const s of script.settings) out.push(setting(s));
  for (const scene of script.scenes) {
    out.push("");
    printScene(scene, out);
  }
  return out.join("\n") + "\n";
}

export function printScene(scene: Scene, out: string[] = []): string[] {
  let head = `scene ${scene.id}`;
  if (scene.title !== undefined) head += " " + quote(scene.title);
  for (const [k, v] of Object.entries(scene.attrs)) head += ` ${k}=${bare(v)}`;
  out.push(head);
  for (const s of scene.settings) out.push(setting(s));
  for (const step of scene.steps) printStep(step, out);
  return out;
}

function printStep(step: Step, out: string[]): void {
  if (!step.implicit) {
    let head = "step";
    if (step.id !== undefined) head += " " + step.id;
    if (step.title !== undefined) head += " " + quote(step.title);
    out.push("", head);
  }
  if (step.layout) out.push(`layout ${step.layout.name}`);
  if (step.focus) out.push(`focus ${step.focus.name}`);
  for (const el of step.elements) out.push(element(el));
  for (const beat of step.beats) printBeat(beat, out);
}

function printBeat(beat: Beat, out: string[]): void {
  out.push(beat.type === "wait" ? `wait ${num(beat.seconds)}` : `> ${narration(beat.text, beat.cues)}`);
  for (const a of beat.actions) out.push(action(a));
}

export function narration(text: string, cues: { id: string; start: number; end?: number }[]): string {
  // Insert markers back-to-front so offsets stay valid. Spans wrap text;
  // points sit before the next word.
  const marks = [...cues].sort((a, b) => b.start - a.start || (a.end === undefined ? 1 : -1));
  let s = escapeNarration(text);
  // Offsets refer to unescaped text; map them through the escaping.
  const map = offsetMap(text);
  for (const c of marks) {
    const a = map[c.start]!;
    if (c.end === undefined) {
      s = s.slice(0, a) + `{${c.id}}` + s.slice(a);
    } else {
      const b = map[c.end]!;
      s = s.slice(0, a) + `{${c.id} ${s.slice(a, b)}}` + s.slice(b);
    }
  }
  return s;
}

function escapeNarration(text: string): string {
  return text.replace(/[\\{}]/g, (c) => "\\" + c);
}

function offsetMap(text: string): number[] {
  const map: number[] = [];
  let j = 0;
  for (let i = 0; i < text.length; i++) {
    map.push(j);
    j += /[\\{}]/.test(text[i]!) ? 2 : 1;
  }
  map.push(j);
  return map;
}

function element(el: ElementDecl): string {
  let s = `${el.id} = `;
  if (el.kind === "edge" && el.link) {
    s += `${el.link.from} -> ${el.link.to}`;
  } else {
    s += el.kind + (el.name !== undefined ? `:${el.name}` : "") + (el.version !== undefined ? `@${el.version}` : "");
    if (el.link) s += ` ${el.link.from}->${el.link.to}`;
  }
  for (const t of el.texts) s += " " + quote(t);
  for (const [k, v] of Object.entries(el.attrs)) s += ` ${k}=${bare(v)}`;
  if (el.place) s += " " + place(el.place);
  return s;
}

function action(a: Action): string {
  const calls = a.calls.map((c) => {
    let s = c.verb;
    if (c.targets.length) s += " " + c.targets.join(",");
    s += args(c.args);
    return s;
  });
  return `${a.anchor} ${calls.join(" then ")}`;
}

function args(a: Args): string {
  let s = "";
  if (a.duration !== undefined) s += " " + num(a.duration);
  if (a.fit) s += " fit";
  if (a.delay !== undefined) s += " +" + num(a.delay);
  if (a.stagger !== undefined) s += " /" + num(a.stagger);
  if (a.to !== undefined) s += " ->" + a.to;
  if (a.place) s += " " + place(a.place);
  for (const [k, v] of Object.entries(a.params)) s += ` ${k}=${bare(v)}`;
  return s;
}

function place(p: Place): string {
  return p.kind === "slot" ? `@${p.slot}` : `@${p.relation}:${p.ref}`;
}

function setting(s: Setting): string {
  return [s.key, ...s.args.map(bare)].join(" ");
}

function num(n: number): string {
  return String(n);
}

function quote(s: string): string {
  return `"${s.replace(/[\\"]/g, (c) => "\\" + c)}"`;
}

/** Bare value if it has no whitespace or quotes, otherwise quoted. */
function bare(v: string): string {
  return /^[^\s"]+$/.test(v) ? v : quote(v);
}
