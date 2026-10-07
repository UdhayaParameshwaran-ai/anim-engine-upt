import { formatDiagnostic, parse, type Diagnostic, type Script } from "@anim/dsl";
import type { VideoIR } from "@anim/ir";
import { AssetLibrary } from "@anim/registry";
import { validate } from "@anim/validate";
import { lower } from "./lower.js";

export interface CompileOptions {
  assets?: AssetLibrary;
  /** Apply deterministic auto-fixes. Turn off to collect raw errors for an LLM repair prompt. */
  autofix?: boolean;
  /**
   * Video-wide settings that win over the script's (`{ theme: "magazine", motion: "playful" }`):
   * restyle a script without editing it. Validated like settings written in the script.
   */
  settings?: Record<string, string>;
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
  for (const [key, value] of Object.entries(options.settings ?? {})) {
    const at = parsed.script.settings.findIndex((s) => s.key === key);
    const setting = { key, args: [value], span: at >= 0 ? parsed.script.settings[at]!.span : { line: 1, col: 1, endCol: 1 } };
    if (at >= 0) parsed.script.settings[at] = setting;
    else parsed.script.settings.push(setting);
  }
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
