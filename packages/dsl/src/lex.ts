import type { Cue, Span } from "./ast.js";
import { Codes, type Diagnostic } from "./diagnostics.js";

export interface Token {
  /** Unquoted text (quotes and escapes removed). */
  text: string;
  /** True when the whole token was a quoted string. */
  quoted: boolean;
  /** 1-based start column, exclusive end column. */
  col: number;
  endCol: number;
}

export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const CUE_ID = /^[A-Za-z0-9_]+$/;

/**
 * Splits a statement line into whitespace-separated tokens. `"..."` is one
 * token; a quote inside a bare token (`label="a b"`) is read as part of it.
 */
export function tokenize(line: string, lineNo: number, diags: Diagnostic[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    const start = i;
    let text = "";
    let quotedWhole = ch === '"';
    while (i < line.length && line[i] !== " " && line[i] !== "\t") {
      if (line[i] === '"') {
        const r = readQuoted(line, i);
        text += r.value;
        if (!r.closed) {
          diags.push({
            code: Codes.UnterminatedString,
            severity: "error",
            message: "unterminated string",
            span: { line: lineNo, col: start + 1, endCol: line.length + 1 },
          });
        }
        if (i !== start) quotedWhole = false;
        i = r.next;
        if (quotedWhole) break;
      } else {
        text += line[i];
        quotedWhole = false;
        i++;
      }
    }
    tokens.push({ text, quoted: quotedWhole, col: start + 1, endCol: i + 1 });
  }
  return tokens;
}

function readQuoted(line: string, open: number): { value: string; next: number; closed: boolean } {
  let value = "";
  let i = open + 1;
  while (i < line.length) {
    const c = line[i]!;
    if (c === "\\" && i + 1 < line.length) {
      value += line[i + 1];
      i += 2;
    } else if (c === '"') {
      return { value, next: i + 1, closed: true };
    } else {
      value += c;
      i++;
    }
  }
  return { value, next: i, closed: false };
}

export interface Narration {
  text: string;
  cues: Cue[];
}

/**
 * Parses narration after `>`. `{id}` is a point cue at the start of the next
 * word; `{id words}` is a span cue over those words. Braces are stripped,
 * so `text` is exactly what TTS speaks. `\{`, `\}` and `\\` escape.
 *
 * @param col1 1-based column of src[0] in the source line.
 */
export function parseNarration(src: string, lineNo: number, col1: number, diags: Diagnostic[]): Narration {
  let text = "";
  const cues: Cue[] = [];
  const pendingPoints: Cue[] = [];
  const seen = new Set<string>();
  const span = (a: number, b: number): Span => ({ line: lineNo, col: col1 + a, endCol: col1 + b });

  const appendText = (s: string) => {
    for (const c of s) {
      if (pendingPoints.length && c !== " " && c !== "\t") {
        for (const p of pendingPoints) p.start = text.length;
        pendingPoints.length = 0;
      }
      text += c;
    }
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\" && i + 1 < src.length) {
      appendText(src[i + 1]!);
      i += 2;
      continue;
    }
    if (c !== "{") {
      appendText(c);
      i++;
      continue;
    }

    const close = src.indexOf("}", i + 1);
    const reopen = src.indexOf("{", i + 1);
    if (close === -1 || (reopen !== -1 && reopen < close)) {
      diags.push({ code: Codes.UnclosedCue, severity: "error", message: "cue `{` is never closed", span: span(i, i + 1) });
      appendText(c);
      i++;
      continue;
    }

    const inner = src.slice(i + 1, close);
    const sp = inner.indexOf(" ");
    const id = sp === -1 ? inner : inner.slice(0, sp);
    const content = sp === -1 ? "" : unescape(inner.slice(sp + 1).trim());
    const cueSpan = span(i, close + 1);
    i = close + 1;

    if (!CUE_ID.test(id)) {
      diags.push({ code: Codes.BadIdentifier, severity: "error", message: `invalid cue id \`${id}\``, span: cueSpan });
      appendText(content);
      continue;
    }
    if (seen.has(id)) {
      diags.push({ code: Codes.DuplicateCue, severity: "error", message: `cue \`${id}\` is defined twice in this beat`, span: cueSpan });
      appendText(content);
      continue;
    }
    seen.add(id);

    if (content === "") {
      const cue: Cue = { id, start: -1, span: cueSpan };
      cues.push(cue);
      pendingPoints.push(cue);
    } else {
      const start = text.length;
      appendText(content);
      cues.push({ id, start, end: text.length, span: cueSpan });
    }
  }

  const trimmed = text.trimEnd();
  for (const p of pendingPoints) {
    p.start = trimmed.length;
    diags.push({
      code: Codes.TrailingPointCue,
      severity: "warning",
      message: `point cue \`${p.id}\` has no following word; it anchors to the end of speech`,
      span: p.span,
    });
  }
  return { text: trimmed, cues };
}

function unescape(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}
