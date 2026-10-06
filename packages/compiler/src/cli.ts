#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { compile, report } from "./compile.js";

/**
 *   check <file> [--ir] [--no-fix] [--fixed]
 *
 * Prints diagnostics; exits 1 on unfixed errors. --ir prints the VideoIR,
 * --fixed prints the auto-fixed script, --no-fix disables auto-fixes.
 */
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: check <file> [--ir] [--fixed] [--no-fix]");
  process.exit(2);
}

const result = compile(readFileSync(file, "utf8"), { autofix: !args.includes("--no-fix") });
if (result.diagnostics.length) console.error(report(result.diagnostics));
if (args.includes("--fixed")) {
  const { print } = await import("@anim/dsl");
  process.stdout.write(print(result.script));
}
if (args.includes("--ir") && result.ir) console.log(JSON.stringify(result.ir, null, 2));

const errors = result.diagnostics.filter((d) => d.severity === "error" && !d.fixed).length;
const warnings = result.diagnostics.length - errors;
console.error(`${file}: ${result.ok ? "ok" : "failed"} (${errors} error(s), ${warnings} warning(s)/fix(es))`);
process.exit(result.ok ? 0 : 1);
