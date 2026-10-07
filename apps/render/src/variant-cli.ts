#!/usr/bin/env node
/**
 * Authoring pipeline for layout variants:
 *
 *   variant new <template> <name> ["summary"]   scaffold a draft plugin and register it
 *   variant check <template>:<name>             stress-test it, render a contact sheet, write a report
 *   variant approve <template>:<name> [--force] mark it approved (after a passing check)
 *   variant list                                show added variants and their status
 *
 * New variants never reach the LLM or the style director until approved.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, report } from "@anim/compiler";
import type { Box } from "@anim/ir";
import { EXTRA_VARIANTS, findTemplate } from "@anim/registry";
import { resolve } from "@anim/timeline";
import { MockTtsProvider, speakVideo } from "@anim/tts";
import { ffmpeg } from "./ffmpeg.js";
import { renderFrames, type Prepared } from "./render.js";

const repo = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../..");
const pluginsDir = join(repo, "packages/compiler/src/variants");
const registryFile = join(repo, "packages/registry/src/variants.ts");
const [cmd, ...rest] = process.argv.slice(2);

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(2);
};
const camel = (s: string) => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

async function scaffold(template: string, name: string, summary: string): Promise<void> {
  const tpl = findTemplate(template) ?? fail(`unknown template \`${template}\``);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) fail("variant names are lowercase words joined by '-'");
  if (tpl.variants.includes(name) || EXTRA_VARIANTS.some((v) => v.template === template && v.name === name)) fail(`\`${template}:${name}\` already exists`);
  const file = join(pluginsDir, `${template}-${name}.ts`);
  const fn = camel(`${template}-${name}`);
  await writeFile(
    file,
    `import type { VariantLayout } from "./api.js";

/**
 * ${template}:${name} — ${summary}
 * Draft. Decide a cell for every item and let put() fit it; never write
 * fixed pixel positions — derive everything from c.area and c.gap.
 * Check it with: pnpm variant check ${template}:${name}
 */
export const ${fn}: VariantLayout = (c) => {
  const cells = c.rowCells(c.area, c.items.length);
  c.items.forEach((e, i) => c.put(e, cells[i]!));
};
`,
  );
  const index = join(pluginsDir, "index.ts");
  let src = await readFile(index, "utf8");
  src = src.replace('import type { VariantLayout } from "./api.js";', `import type { VariantLayout } from "./api.js";\nimport { ${fn} } from "./${template}-${name}.js";`);
  src = src.replace("  // plugin entries", `  // plugin entries\n  "${template}:${name}": ${fn},`);
  await writeFile(index, src);
  let reg = await readFile(registryFile, "utf8");
  reg = reg.replace("  // variant entries (kept in this format; `pnpm variant` edits it)", `  // variant entries (kept in this format; \`pnpm variant` + "`" + ` edits it)\n  { template: ${JSON.stringify(template)}, name: ${JSON.stringify(name)}, summary: ${JSON.stringify(summary)}, status: "draft" },`);
  await writeFile(registryFile, reg);
  console.log(`created ${file.replace(repo, ".")} (draft)\nnext: implement it, then pnpm variant check ${template}:${name}`);
}

// ------------------------------------------------------------------ check ---

interface Case {
  label: string;
  script: string;
}

const ICONS = ["sun", "droplet", "wind", "cube", "cloud", "bolt", "heart", "star"];
const LONG = "A much longer label that has to wrap";

/** Stress scripts: fewest, middle and most items; short and long labels; pictures and boxes; with and without a title. */
function cases(template: string, variant: string): Case[] {
  const tpl = findTemplate(template)!;
  const counts = tpl.items ? [...new Set([Math.max(tpl.items.min, 2), Math.round((Math.max(tpl.items.min, 2) + tpl.items.max) / 2), tpl.items.max])] : [0];
  const out: Case[] = [];
  for (const n of counts) {
    for (const style of ["icons", "boxes", "long"] as const) {
      const els: string[] = [];
      const ids: string[] = [];
      for (const slot of tpl.slots) {
        if (slot.name === "title") continue;
        if (!slot.required && style !== "long") continue;
        const kind = slot.accepts.includes("asset") ? 'asset:leaf "Leaf"' : `text "${style === "long" ? LONG : "Subtitle"}"`;
        els.push(`${slot.name} = ${kind}`);
        ids.push(slot.name);
      }
      for (let i = 0; i < n; i++) {
        const id = `i${i + 1}`;
        els.push(style === "icons" ? `${id} = icon:${ICONS[i % ICONS.length]} "Item ${i + 1}"` : `${id} = box "${style === "long" ? `${LONG} ${i + 1}` : `Item ${i + 1}`}"`);
        ids.push(id);
      }
      const withTitle = style !== "boxes" && tpl.slots.some((s) => s.name === "title");
      if (withTitle) {
        els.unshift(`title = title "${style === "long" ? "A title that is quite long for a slide" : "Title"}"`);
        ids.unshift("title");
      }
      const narration = `> ${ids.map((id, i) => `{${i + 1}}${id}`).join(" and ")}.`;
      const actions = ids.map((id, i) => `${i + 1} fade ${id}`);
      out.push({
        label: `${n || "slots"} · ${style}${withTitle ? " · title" : ""}`,
        script: `video 1 "Check"\nscene s "S" template=${template} variant=${variant}\n${els.join("\n")}\n${narration}\n${actions.join("\n")}\n`,
      });
    }
  }
  return out;
}

interface Result {
  label: string;
  errors: string[];
  /** Problems the template's default arrangement doesn't have: these fail the check. */
  issues: string[];
  /** Problems the default arrangement has too (the content is hard for this template): reported, not blamed. */
  inherited: string[];
  frames: string[];
}

/** Layout problems of a compiled stress case (diagnostics plus geometry). */
function problems(src: string): { errors: string[]; issues: string[]; compiled: ReturnType<typeof compile> } {
  const compiled = compile(src, { drafts: true });
  const errors = compiled.diagnostics.filter((d) => d.severity === "error").map((d) => report([d]));
  const issues = compiled.diagnostics.filter((d) => ["NAR413", "NAR414", "NAR415", "NAR218"].includes(d.code)).map((d) => `${d.code}: ${d.message}`);
  if (compiled.ir) issues.push(...geometry(compiled.ir.scenes[0]!.elements.map((e) => ({ id: e.id, box: e.box })), compiled.ir.canvas.width, compiled.ir.canvas.height));
  return { errors, issues, compiled };
}

function geometry(boxes: { id: string; box: Box }[], width: number, height: number): string[] {
  const issues: string[] = [];
  const mx = width * 0.04;
  const my = height * 0.05;
  for (const { id, box } of boxes) {
    if (box.x < mx || box.y < my || box.x + box.w > width - mx || box.y + box.h > height - my) issues.push(`\`${id}\` leaves the safe area`);
    if (box.w < 40 || box.h < 24) issues.push(`\`${id}\` is tiny (${box.w}×${box.h})`);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!.box;
      const b = boxes[j]!.box;
      if (a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2) issues.push(`\`${boxes[i]!.id}\` overlaps \`${boxes[j]!.id}\``);
    }
  return issues;
}

async function check(key: string, looks: string[]): Promise<boolean> {
  const [template, variant] = key.split(":");
  if (!template || !variant || !findTemplate(template)) fail("usage: variant check <template>:<name>");
  const outDir = join(repo, "out/variants", `${template}-${variant}`);
  await mkdir(outDir, { recursive: true });
  const results: Result[] = [];
  const baselineVariant = findTemplate(template!)!.variants[0]!;
  for (const [k, c] of cases(template!, variant!).entries()) {
    const mine = problems(c.script);
    const base = new Set(problems(c.script.replace(`variant=${variant}`, `variant=${baselineVariant}`)).issues);
    const { compiled } = mine;
    const result: Result = { label: c.label, errors: mine.errors, issues: mine.issues.filter((x) => !base.has(x)), inherited: mine.issues.filter((x) => base.has(x)), frames: [] };
    if (compiled.ir) {
      const ir = compiled.ir;
      const speech = await speakVideo(ir, { provider: new MockTtsProvider({ audio: false }) });
      for (const look of looks) {
        const data: Prepared = { ir: { ...ir, theme: look }, timeline: resolve({ ...ir, theme: look }, speech) };
        const last = Math.max(0, Math.round(data.timeline.duration * data.timeline.fps) - 1);
        const [file] = await renderFrames(data, [last], join(outDir, `case-${k}-${look}`));
        result.frames.push(file!);
      }
    }
    results.push(result);
    const lines = [...result.errors, ...result.issues].map((x) => `\n    ${x}`).join("") + (result.inherited.length ? `\n    (${result.inherited.length} problem(s) shared with the default \`${baselineVariant}\`)` : "");
    console.log(`${result.errors.length ? "✗" : result.issues.length ? "!" : "✓"} ${c.label}${lines}`);
  }

  // Contact sheet: one row per case, one column per look.
  const frames = results.flatMap((r) => r.frames);
  if (frames.length) {
    const list = join(outDir, "frames.txt");
    await writeFile(list, frames.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
    await ffmpeg(["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=480:-1,tile=${looks.length}x${Math.ceil(frames.length / looks.length)}:padding=6:color=gray`, "-frames:v", "1", join(outDir, "sheet.png")]);
  }
  const pass = results.every((r) => !r.errors.length && !r.issues.length);
  await writeFile(join(outDir, "report.json"), JSON.stringify({ variant: key, pass, checkedAt: new Date().toISOString(), results }, null, 2));
  const rows = results
    .map((r) => `<tr><td>${r.errors.length ? "✗" : r.issues.length ? "!" : "✓"}</td><td>${r.label}</td><td>${[...r.errors, ...r.issues].map((x) => x.replace(/</g, "&lt;")).join("<br>") || "—"}${r.inherited.length ? `<br><small>shared with the default arrangement: ${r.inherited.map((x) => x.replace(/</g, "&lt;")).join("; ")}</small>` : ""}</td></tr>`)
    .join("");
  await writeFile(
    join(outDir, "report.html"),
    `<!doctype html><meta charset="utf-8"><title>${key}</title><style>body{font:14px system-ui;margin:24px}td{padding:4px 10px;border-bottom:1px solid #ddd;vertical-align:top}img{max-width:100%;margin-top:16px}</style><h1>${key} — ${pass ? "pass" : "needs work"}</h1><table>${rows}</table><img src="sheet.png" alt="contact sheet">`,
  );
  console.log(`\n${pass ? "PASS" : "NEEDS WORK"}: ${results.length} cases × ${looks.length} looks → ${join(outDir, "report.html").replace(repo, ".")}`);
  return pass;
}

async function approve(key: string, force: boolean): Promise<void> {
  const [template, variant] = key.split(":");
  const entry = EXTRA_VARIANTS.find((v) => v.template === template && v.name === variant) ?? fail(`\`${key}\` is not an added variant`);
  if (entry.status === "approved") return void console.log(`${key} is already approved`);
  const reportFile = join(repo, "out/variants", `${template}-${variant}`, "report.json");
  const last = existsSync(reportFile) ? (JSON.parse(await readFile(reportFile, "utf8")) as { pass: boolean }) : undefined;
  if (!last?.pass && !force) fail(`${key} has no passing check; run pnpm variant check ${key} (or approve with --force after reviewing it)`);
  const reg = await readFile(registryFile, "utf8");
  const needle = `{ template: ${JSON.stringify(template)}, name: ${JSON.stringify(variant)},`;
  const at = reg.indexOf(needle);
  const end = reg.indexOf("},", at);
  if (at < 0 || end < 0) fail("could not find the registry entry");
  await writeFile(registryFile, reg.slice(0, at) + reg.slice(at, end).replace('status: "draft"', 'status: "approved"') + reg.slice(end));
  console.log(`approved ${key}: templates now offer it (rebuild to pick it up)`);
}

switch (cmd) {
  case "new":
    await scaffold(rest[0] ?? fail("usage: variant new <template> <name> [summary]"), rest[1] ?? fail("usage: variant new <template> <name> [summary]"), rest[2] ?? "a new arrangement");
    break;
  case "check": {
    const looks = (rest.find((a) => a.startsWith("--looks="))?.slice(8) ?? "paper,tech-neon,crayon").split(",");
    process.exitCode = (await check(rest[0] ?? fail("usage: variant check <template>:<name>"), looks)) ? 0 : 1;
    break;
  }
  case "approve":
    await approve(rest[0] ?? fail("usage: variant approve <template>:<name>"), rest.includes("--force"));
    break;
  case "list":
    for (const v of EXTRA_VARIANTS) console.log(`${v.status.padEnd(9)} ${v.template}:${v.name} — ${v.summary}`);
    if (!EXTRA_VARIANTS.length) console.log("no added variants yet (pnpm variant new <template> <name>)");
    break;
  default:
    fail("usage: variant new|check|approve|list …");
}
