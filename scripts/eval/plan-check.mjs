// Does the planner use the teaching methods correctly? Runs only the decision and planning calls (no scenes):
//   - the 16 plan topics of gold.json at every audience level, at the default length;
//   - the 8 one-per-method topics (m-*) at short and long length.
// Checks each plan: its teaching lines follow the method's arc (core beats kept at every length), the method is one a
// teacher would accept (gold.json, written before the runs), and each beat's template fits what the beat must show.
//   node scripts/eval/plan-check.mjs <arm> <haiku|sonnet> [parallel=2]      (run `pnpm build` first)
// Writes out/eval/<arm>/<topic>.<level|length>.plan.txt and plan-check.json; prints the report.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const llm = await import(pathToFileURL(join(root, "packages/llm/dist/index.js")).href);

const [arm, model, par = "2"] = process.argv.slice(2);
if (!arm || !model) throw new Error("usage: plan-check.mjs <arm> <haiku|sonnet> [parallel]");
const dir = join(root, "out/eval", arm);
mkdirSync(dir, { recursive: true });
const GOLD = JSON.parse(readFileSync(join(root, "scripts/eval/gold.json"), "utf8")).topics;
const LEVELS = ["new", "familiar", "practitioner"];
const client = llm.clientFromEnv({ providers: ["claude"], model });

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (k < items.length) { const i = k++; out[i] = await fn(items[i], i); } }));
  return out;
}

const plain = Object.keys(GOLD).filter((t) => !t.startsWith("m-") && !t.startsWith("d-"));
const methodTopics = Object.keys(GOLD).filter((t) => t.startsWith("m-"));
const jobs = [
  ...plain.flatMap((t) => LEVELS.map((level) => ({ t, level, length: undefined, tag: level }))),
  ...methodTopics.flatMap((t) => ["short", "long"].map((length) => ({ t, level: "familiar", length, tag: length }))),
];

/** What a scene's template is, from its scene line: a template name, or "page" for a grid page. */
const templateOf = (line) => (/\bgrid=/.test(line) ? "page" : (/\btemplate=(\S+)/.exec(line)?.[1] ?? "?"));

const results = await pool(jobs, Number(par), async (j) => {
  const file = join(dir, `${j.t}.${j.tag}.plan.txt`);
  const meta = join(dir, `${j.t}.${j.tag}.json`);
  if (!existsSync(file)) {
    try {
      const r = await llm.plan(GOLD[j.t].topic, { client, domain: "tech", ...(j.length && { length: j.length }), settings: { level: j.level } });
      writeFileSync(file, r.outline);
      writeFileSync(meta, JSON.stringify({ ms: r.ms, usage: r.usage, length: r.length }));
      console.error(`planned ${j.t} (${j.tag})`);
    } catch (e) {
      console.error(`FAILED ${j.t} (${j.tag}): ${e?.message ?? e}`);
      return { ...j, failed: true };
    }
  }
  const outline = readFileSync(file, "utf8");
  const m = JSON.parse(readFileSync(meta, "utf8"));
  const teach = llm.teachingOf(outline, j.level);
  const method = teach.method?.name ?? teach.methodName ?? "";
  const sceneLines = outline.split("\n").filter((l) => /^\s*scene\s/.test(l));
  return {
    ...j,
    usecase: llm.useCaseOf(outline)?.name,
    intent: teach.intent,
    method,
    misconception: teach.misconception,
    accepted: GOLD[j.t].methods[j.level].includes(method),
    problems: teach.problems,
    coreLost: teach.problems.some((p) => /is not taught without/.test(p)),
    slots: teach.scenes.map((s) => `${s.beats.join("+")}${s.round ? `:${s.round}` : ""}`),
    templates: sceneLines.map(templateOf),
    devices: teach.scenes.flatMap((s) => s.devices),
    scenes: teach.scenes.length,
    length: m.length,
    usage: m.usage,
  };
});

const ok = results.filter((r) => !r.failed);
writeFileSync(join(dir, "plan-check.json"), JSON.stringify(results, null, 1));
const pct = (n, d) => `${n}/${d} (${d ? Math.round((100 * n) / d) : 0}%)`;

console.log(`\n# Planner check v2 · ${arm} · ${model} · ${ok.length} plans (${results.length - ok.length} failed)\n`);
console.log("## Does the plan follow the method's arc?");
console.log(`- plans with no teaching problem: ${pct(ok.filter((r) => !r.problems.length).length, ok.length)}`);
console.log(`- plans that keep every core beat: ${pct(ok.filter((r) => !r.coreLost).length, ok.length)}`);
const kinds = {};
for (const r of ok) for (const p of r.problems) {
  const k = p.replace(/`[^`]*`/g, "`…`").replace(/^scene \w+: /, "scene …: ").replace(/\(.*\)$/, "").replace(/under [\w, ]+$/, "under …");
  kinds[k] = (kinds[k] ?? 0) + 1;
}
for (const [k, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) console.log(`  - ${n}× ${k}`);
for (const length of ["standard", "short", "long"]) {
  const g = ok.filter((r) => r.length === length);
  if (g.length) console.log(`- ${length}: ${g.length} plans · scenes ${[...new Set(g.map((r) => r.scenes))].sort().join(", ")} · no problem ${pct(g.filter((r) => !r.problems.length).length, g.length)}`);
}

console.log("\n## Does it choose a sensible method? (gold.json)");
console.log(`- accepted: ${pct(ok.filter((r) => r.accepted).length, ok.length)}`);
for (const level of LEVELS) { const g = ok.filter((r) => r.level === level && r.tag === level); console.log(`  - ${level}: ${pct(g.filter((r) => r.accepted).length, g.length)}`); }
console.log("- not accepted:");
for (const r of ok.filter((r) => !r.accepted)) console.log(`  - ${r.t} (${r.tag}): ${r.usecase} · ${r.intent} → ${r.method || "none"} — accepted: ${GOLD[r.t].methods[r.level].join(", ")}`);
const misc = ok.filter((r) => r.misconception).length;
console.log(`- plans with a misconception to bring out: ${pct(misc, ok.length)}`);

console.log("\n## Does each beat get a picture that can show it?");
const flat = ok.flatMap((r) => r.slots.map((s, i) => ({ r, beats: llm.parseSlot(s).beats, tpl: r.templates[i], i, last: i === r.slots.length - 1 })));
const page = (want) => { const g = flat.filter((x) => x.beats.some((b) => want.includes(b))); return pct(g.filter((x) => x.tpl === "page").length, g.length); };
console.log(`- a text page on a beat that must show something (steps, evidence, experiment, mechanism, result, apply, conclusion): ${page(["steps", "evidence", "experiment", "mechanism", "result", "apply", "conclusion"])}`);
const applies = ok.filter((r) => r.method === "worked-example").map((r) => { const run = r.slots.findIndex((s) => llm.parseSlot(s).beats.includes("steps")); const ap = r.slots.findIndex((s) => llm.parseSlot(s).beats.includes("apply")); return run >= 0 && ap >= 0 ? r.templates[run] === r.templates[ap] : undefined; }).filter((x) => x !== undefined);
console.log(`- worked example: the new case uses the run's picture: ${pct(applies.filter(Boolean).length, applies.length)}`);
console.log(`- last scene a text page: ${pct(ok.filter((r) => r.templates.at(-1) === "page").length, ok.length)} · a card list: ${pct(ok.filter((r) => r.templates.at(-1) === "cards").length, ok.length)}`);
console.log(`- first scene a title card: ${pct(ok.filter((r) => r.templates[0] === "title").length, ok.length)}`);

const tok = ok.reduce((a, r) => ({ p: a.p + (r.usage?.prompt ?? 0), c: a.c + (r.usage?.completion ?? 0) }), { p: 0, c: 0 });
console.log(`\n## Tokens (decision + plan)\n- per plan: prompt ${Math.round(tok.p / Math.max(1, ok.length))} · completion ${Math.round(tok.c / Math.max(1, ok.length))}`);

console.log("\n## Every plan");
for (const r of ok) console.log(`- ${r.t} · ${r.tag}: ${r.intent ?? "?"} → ${r.method}${r.accepted ? "" : " ✗"} · ${r.slots.map((s, i) => `${s}[${r.templates[i]}]`).join(" → ")}${r.problems.length ? ` · ⚠ ${r.problems.join("; ")}` : ""}`);
