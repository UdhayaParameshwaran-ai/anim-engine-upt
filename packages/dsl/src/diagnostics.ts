import type { Span } from "./ast.js";

export type Severity = "error" | "warning";

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  span: Span;
}

/** L1 (syntax) codes. Higher layers (validator, resolver) own NAR2xx+. */
export const Codes = {
  UnknownStatement: "NAR101",
  UnterminatedString: "NAR102",
  UnclosedCue: "NAR103",
  MissingHeader: "NAR104",
  UnsupportedVersion: "NAR105",
  OutsideScene: "NAR106",
  ActionWithoutBeat: "NAR107",
  BadArgument: "NAR108",
  DuplicateCue: "NAR109",
  BadIdentifier: "NAR110",
  MisplacedFocus: "NAR111",
  TrailingPointCue: "NAR112",
  DuplicateHeader: "NAR113",
} as const;

export type DiagnosticCode = (typeof Codes)[keyof typeof Codes];

/** Compact one-line form, also used verbatim in LLM repair prompts. */
export function formatDiagnostic(d: Diagnostic): string {
  return `L${d.span.line}:${d.span.col} ${d.code} ${d.severity}: ${d.message}`;
}
