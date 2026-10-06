import { formatDiagnostic, parse, type Diagnostic, type Script } from "@anim/dsl";
import type { VideoIR } from "@anim/ir";
import { AssetLibrary } from "@anim/registry";
import { validate } from "@anim/validate";
import { lower } from "./lower.js";

export interface CompileOptions {
  assets?: AssetLibrary;
  /** Apply deterministic auto-fixes. Turn off to collect raw errors for an LLM repair prompt. */
  autofix?: boolean;
}

export interface CompileResult {
  /** Present when no unfixed errors remain. */
  ir?: VideoIR;
  /** The validated (and possibly auto-fixed) script. */
  script: Script;
  diagnostics: Diagnostic[];
  ok: boolean;
}

/**
 * DSL text → VideoIR: parse (L1) → validate + auto-fix (L2–L4) → layout +
 * lowering. A script with unfixed errors yields diagnostics and no IR.
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const assets = options.assets ?? new AssetLibrary();
  const parsed = parse(source);
  const validated = validate(parsed.script, { assets, autofix: options.autofix ?? true });
  const diagnostics = [...parsed.diagnostics, ...validated.diagnostics];
  const ok = !diagnostics.some((d) => d.severity === "error" && !d.fixed);
  if (!ok) return { script: validated.script, diagnostics: sortDiagnostics(diagnostics), ok };

  const lowered = lower(validated.script, assets);
  return { ir: lowered.ir, script: validated.script, diagnostics: sortDiagnostics([...diagnostics, ...lowered.diagnostics]), ok };
}

/** Compact report for logs and LLM repair prompts: one line per diagnostic. */
export function report(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map(formatDiagnostic).join("\n");
}

function sortDiagnostics(d: Diagnostic[]): Diagnostic[] {
  return [...d].sort((a, b) => a.span.line - b.span.line || a.span.col - b.span.col);
}
