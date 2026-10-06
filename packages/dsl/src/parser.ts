import type { Action, Args, Beat, ElementDecl, Place, Scene, Script, Setting, Span, Step, VerbCall } from "./ast.js";
import { Codes, type Diagnostic } from "./diagnostics.js";
import { CUE_ID, IDENT, parseNarration, tokenize, type Token } from "./lex.js";

export const SUPPORTED_VERSIONS = [1] as const;
export const SETTING_KEYS = new Set(["theme", "voice", "size", "lang", "fps"]);

const DURATION = /^\d+(\.\d+)?s?$/;
const TARGET = /^(\*|[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)?)$/;
const KIND = /^([a-z][a-z0-9-]*)(?::([A-Za-z0-9_.-]+))?(?:@(\d+))?$/;
const LINK = /^([A-Za-z_][A-Za-z0-9_]*)->([A-Za-z_][A-Za-z0-9_]*)$/;
const PLACE = /^@([A-Za-z][A-Za-z0-9-]*)(?::([A-Za-z_][A-Za-z0-9_]*))?$/;

export interface ParseResult {
  script: Script;
  diagnostics: Diagnostic[];
}

export interface ParserOptions {
  /** Called as soon as a scene is complete (next `scene` line or end of input). Enables live pipelines. */
  onScene?: (scene: Scene, diagnostics: readonly Diagnostic[]) => void;
}

/** Parses a whole script. */
export function parse(source: string, options?: ParserOptions): ParseResult {
  return new Parser(options).feed(source).end();
}

/**
 * Incremental, error-tolerant parser. Feed it LLM output chunk by chunk;
 * each complete line is parsed immediately. A bad line yields a diagnostic
 * and parsing continues with the next line.
 */
export class Parser {
  private buffer = "";
  private lineNo = 0;
  private sawHeader = false;
  private sawContent = false;
  private scene: Scene | undefined;
  private step: Step | undefined;
  private beat: Beat | undefined;
  private readonly diags: Diagnostic[] = [];
  private readonly script: Script = {
    version: 1,
    settings: [],
    scenes: [],
    span: { line: 1, col: 1, endCol: 1 },
  };

  constructor(private readonly options: ParserOptions = {}) {}

  feed(chunk: string): this {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      this.line(this.buffer.slice(0, nl));
      this.buffer = this.buffer.slice(nl + 1);
    }
    return this;
  }

  end(): ParseResult {
    if (this.buffer.length) this.line(this.buffer);
    this.buffer = "";
    if (!this.sawHeader && !this.sawContent) {
      this.err(Codes.MissingHeader, "script must start with `video <version> \"title\"`", { line: 1, col: 1, endCol: 1 });
    }
    this.closeScene();
    return { script: this.script, diagnostics: this.diags };
  }

  // ---------------------------------------------------------------------------

  private line(raw: string): void {
    this.lineNo++;
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trimStart();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const indent = line.length - trimmed.length;

    if (trimmed.startsWith(">")) {
      this.contentSeen();
      this.beatLine(trimmed, indent);
      return;
    }

    const toks = tokenize(line, this.lineNo, this.diags);
    const head = toks[0]!;
    const span = this.span(head.col, line.length + 1);

    if (head.text === "video" && !head.quoted) return this.header(toks, span);
    this.contentSeen();

    if (toks[1]?.text === "=" && !toks[1].quoted) return this.decl(toks, span);
    switch (head.text) {
      case "scene":
        return this.sceneLine(toks, span);
      case "step":
        return this.stepLine(toks, span);
      case "layout":
        return this.layoutLine(toks, span);
      case "wait":
        return this.waitLine(toks, span);
      case "focus":
        return this.focusLine(toks, span);
      case "start":
      case "end":
        return this.actionLine(toks, span);
    }
    if (SETTING_KEYS.has(head.text)) return this.settingLine(toks, span);
    if (this.beat && CUE_ID.test(head.text)) return this.actionLine(toks, span);
    if (/^\d+$/.test(head.text)) {
      this.err(Codes.ActionWithoutBeat, "action line must follow a `>` narration line", span);
      return;
    }
    this.err(Codes.UnknownStatement, `unknown statement \`${head.text}\``, span);
  }

  private contentSeen(): void {
    if (!this.sawHeader && !this.sawContent) {
      this.err(Codes.MissingHeader, "script must start with `video <version> \"title\"`", this.span(1, 1));
    }
    this.sawContent = true;
  }

  private header(toks: Token[], span: Span): void {
    if (this.sawHeader || this.sawContent) {
      this.err(Codes.DuplicateHeader, "`video` header must be the first line and appear once", span);
      return;
    }
    this.sawHeader = true;
    this.script.span = span;
    const ver = toks[1];
    if (!ver || !/^\d+$/.test(ver.text)) {
      this.err(Codes.MissingHeader, "header needs a version: `video 1 \"title\"`", span);
    } else {
      const v = Number(ver.text);
      if (!(SUPPORTED_VERSIONS as readonly number[]).includes(v)) {
        this.err(Codes.UnsupportedVersion, `DSL version ${v} is not supported (supported: ${SUPPORTED_VERSIONS.join(", ")})`, this.tokSpan(ver));
      }
      this.script.version = v;
    }
    const title = toks[2];
    if (title?.quoted) this.script.title = title.text;
    for (const t of toks.slice(title?.quoted ? 3 : 2)) this.badArg(t);
  }

  private settingLine(toks: Token[], span: Span): void {
    const setting: Setting = { key: toks[0]!.text, args: toks.slice(1).map((t) => t.text), span };
    (this.scene ? this.scene.settings : this.script.settings).push(setting);
  }

  private sceneLine(toks: Token[], span: Span): void {
    this.closeScene();
    const id = toks[1];
    if (!id || !IDENT.test(id.text) || id.quoted) {
      this.err(Codes.BadIdentifier, "scene needs an id: `scene <id> \"title\"`", span);
    }
    const scene: Scene = {
      id: id && !id.quoted ? id.text : `scene${this.script.scenes.length + 1}`,
      attrs: {},
      settings: [],
      steps: [],
      span,
    };
    let i = id && !id.quoted ? 2 : 1;
    if (toks[i]?.quoted) scene.title = toks[i++]!.text;
    for (const t of toks.slice(i)) {
      const kv = splitKv(t);
      if (kv) scene.attrs[kv[0]] = kv[1];
      else this.badArg(t);
    }
    this.scene = scene;
    this.step = { implicit: true, elements: [], beats: [], span };
    scene.steps.push(this.step);
    this.beat = undefined;
  }

  private stepLine(toks: Token[], span: Span): void {
    if (!this.requireScene(span)) return;
    const step: Step = { implicit: false, elements: [], beats: [], span };
    let i = 1;
    if (toks[i] && !toks[i]!.quoted) {
      if (IDENT.test(toks[i]!.text)) step.id = toks[i]!.text;
      else this.err(Codes.BadIdentifier, `invalid step id \`${toks[i]!.text}\``, this.tokSpan(toks[i]!));
      i++;
    }
    if (toks[i]?.quoted) step.title = toks[i++]!.text;
    for (const t of toks.slice(i)) this.badArg(t);
    // Drop an empty implicit step so steps reflect what the author wrote.
    const first = this.scene!.steps[0]!;
    if (this.scene!.steps.length === 1 && first.implicit && !first.elements.length && !first.beats.length && !first.layout && !first.focus) {
      this.scene!.steps.pop();
    }
    this.scene!.steps.push(step);
    this.step = step;
    this.beat = undefined;
  }

  private layoutLine(toks: Token[], span: Span): void {
    if (!this.requireScene(span)) return;
    const name = toks[1];
    if (!name || !IDENT.test(name.text)) {
      this.err(Codes.BadArgument, "layout needs a name: `layout row`", span);
      return;
    }
    this.step!.layout = { name: name.text, span };
    for (const t of toks.slice(2)) this.badArg(t);
  }

  private focusLine(toks: Token[], span: Span): void {
    if (!this.requireScene(span)) return;
    if (this.step!.beats.length) {
      this.err(Codes.MisplacedFocus, "`focus` line must come before the step's first beat; use `<cue> focus <id>` inside a beat", span);
      return;
    }
    const target = toks[1];
    if (!target || !(IDENT.test(target.text) || target.text === "reset")) {
      this.err(Codes.BadArgument, "focus needs an element id or `reset`", span);
      return;
    }
    this.step!.focus = { name: target.text, span };
    for (const t of toks.slice(2)) this.badArg(t);
  }

  private decl(toks: Token[], span: Span): void {
    if (!this.requireScene(span)) return;
    const idTok = toks[0]!;
    if (!IDENT.test(idTok.text)) {
      this.err(Codes.BadIdentifier, `invalid element id \`${idTok.text}\``, this.tokSpan(idTok));
      return;
    }
    const rest = mergeLinks(toks.slice(2));
    const first = rest[0];
    if (!first) {
      this.err(Codes.BadArgument, `element \`${idTok.text}\` needs a kind: \`${idTok.text} = icon:sun\``, span);
      return;
    }
    const decl: ElementDecl = { id: idTok.text, kind: "", texts: [], attrs: {}, span };
    const link = !first.quoted && LINK.exec(first.text);
    const kind = !first.quoted && KIND.exec(first.text);
    if (link) {
      decl.kind = "edge";
      decl.link = { from: link[1]!, to: link[2]! };
    } else if (kind) {
      decl.kind = kind[1]!;
      if (kind[2]) decl.name = kind[2];
      if (kind[3]) decl.version = kind[3];
    } else {
      this.err(Codes.BadArgument, `invalid element kind \`${first.text}\``, this.tokSpan(first));
      return;
    }
    for (const t of rest.slice(1)) {
      if (t.quoted) {
        decl.texts.push(t.text);
        continue;
      }
      const l = LINK.exec(t.text);
      if (l && !decl.link) {
        decl.link = { from: l[1]!, to: l[2]! };
        continue;
      }
      if (t.text.startsWith("@")) {
        const place = parsePlace(t.text);
        if (place) decl.place = place;
        else this.err(Codes.BadArgument, `invalid placement \`${t.text}\``, this.tokSpan(t));
        continue;
      }
      const kv = splitKv(t);
      if (kv) decl.attrs[kv[0]] = kv[1];
      else this.badArg(t);
    }
    this.step!.elements.push(decl);
  }

  private beatLine(trimmed: string, indent: number): void {
    const span = this.span(indent + 1, indent + trimmed.length + 1);
    if (!this.requireScene(span)) return;
    let body = trimmed.slice(1);
    const lead = body.length - body.trimStart().length;
    body = body.trimStart();
    const { text, cues } = parseNarration(body, this.lineNo, indent + 2 + lead, this.diags);
    const beat: Beat = { type: "speech", text, cues, actions: [], span };
    this.step!.beats.push(beat);
    this.beat = beat;
  }

  private waitLine(toks: Token[], span: Span): void {
    if (!this.requireScene(span)) return;
    const d = toks[1];
    if (!d || !DURATION.test(d.text)) {
      this.err(Codes.BadArgument, "wait needs a duration in seconds: `wait 0.5`", span);
      return;
    }
    for (const t of toks.slice(2)) this.badArg(t);
    const beat: Beat = { type: "wait", seconds: parseFloat(d.text), actions: [], span };
    this.step!.beats.push(beat);
    this.beat = beat;
  }

  private actionLine(toks: Token[], span: Span): void {
    if (!this.requireScene(span)) return;
    if (!this.beat) {
      this.err(Codes.ActionWithoutBeat, "action line must follow a `>` narration line or `wait`", span);
      return;
    }
    const action: Action = { anchor: toks[0]!.text, calls: [], span };
    let i = 1;
    while (i < toks.length) {
      const verbTok = toks[i]!;
      if (verbTok.quoted || !IDENT.test(verbTok.text)) {
        this.err(Codes.BadArgument, `expected a verb, got \`${verbTok.text}\``, this.tokSpan(verbTok));
        return;
      }
      i++;
      const call: VerbCall = { verb: verbTok.text, targets: [], args: { params: {} }, span: this.tokSpan(verbTok) };
      const next = toks[i];
      if (next && !next.quoted && next.text !== "then" && !isArgLike(next.text)) {
        if (call.verb === "focus" && next.text === "reset") {
          call.targets.push("reset");
        } else {
          for (const t of next.text.split(",")) {
            if (TARGET.test(t)) call.targets.push(t);
            else this.err(Codes.BadIdentifier, `invalid target \`${t}\``, this.tokSpan(next));
          }
        }
        i++;
      }
      while (i < toks.length && toks[i]!.text !== "then") {
        this.arg(toks[i]!, call.args);
        i++;
      }
      call.span = { ...call.span, endCol: toks[i - 1]!.endCol };
      action.calls.push(call);
      if (toks[i]?.text === "then") {
        i++;
        if (i >= toks.length) this.err(Codes.BadArgument, "`then` must be followed by a verb", this.tokSpan(toks[i - 1]!));
      }
    }
    if (!action.calls.length) {
      this.err(Codes.BadArgument, `action at \`${action.anchor}\` has no verb`, span);
      return;
    }
    this.beat.actions.push(action);
  }

  private arg(t: Token, args: Args): void {
    const s = t.text;
    if (!t.quoted) {
      if (DURATION.test(s)) return void (args.duration = parseFloat(s));
      if (s === "fit") return void (args.fit = true);
      if (s.startsWith("+") && DURATION.test(s.slice(1))) return void (args.delay = parseFloat(s.slice(1)));
      if (s.startsWith("/") && DURATION.test(s.slice(1))) return void (args.stagger = parseFloat(s.slice(1)));
      if (s.startsWith("->") && IDENT.test(s.slice(2))) return void (args.to = s.slice(2));
      if (s.startsWith("@")) {
        const place = parsePlace(s);
        if (place) return void (args.place = place);
      }
      const kv = splitKv(t);
      if (kv) return void (args.params[kv[0]] = kv[1]);
    }
    this.badArg(t);
  }

  // ---------------------------------------------------------------------------

  private closeScene(): void {
    if (!this.scene) return;
    this.script.scenes.push(this.scene);
    this.options.onScene?.(this.scene, this.diags);
    this.scene = undefined;
    this.step = undefined;
    this.beat = undefined;
  }

  private requireScene(span: Span): boolean {
    if (this.scene) return true;
    this.err(Codes.OutsideScene, "statement must be inside a `scene`", span);
    return false;
  }

  private badArg(t: Token): void {
    this.err(Codes.BadArgument, `unexpected \`${t.text}\``, this.tokSpan(t));
  }

  private err(code: Diagnostic["code"], message: string, span: Span): void {
    this.diags.push({ code, severity: "error", message, span });
  }

  private span(col: number, endCol: number): Span {
    return { line: this.lineNo, col, endCol };
  }

  private tokSpan(t: Token): Span {
    return this.span(t.col, t.endCol);
  }
}

function isArgLike(s: string): boolean {
  return DURATION.test(s) || s === "fit" || /^[+/@]/.test(s) || s.startsWith("->") || s.includes("=");
}

function splitKv(t: Token): [string, string] | undefined {
  if (t.quoted) return undefined;
  const eq = t.text.indexOf("=");
  if (eq <= 0) return undefined;
  const key = t.text.slice(0, eq);
  return IDENT.test(key) ? [key, t.text.slice(eq + 1)] : undefined;
}

export function parsePlace(s: string): Place | undefined {
  const m = PLACE.exec(s);
  if (!m) return undefined;
  return m[2] ? { kind: "relative", relation: m[1]!, ref: m[2] } : { kind: "slot", slot: m[1]! };
}

/** Joins `a -> b` written with spaces into a single `a->b` token. */
function mergeLinks(toks: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const arrow = toks[i + 1];
    const to = toks[i + 2];
    if (!t.quoted && arrow?.text === "->" && !arrow.quoted && to && !to.quoted) {
      out.push({ text: `${t.text}->${to.text}`, quoted: false, col: t.col, endCol: to.endCol });
      i += 2;
    } else {
      out.push(t);
    }
  }
  return out;
}
