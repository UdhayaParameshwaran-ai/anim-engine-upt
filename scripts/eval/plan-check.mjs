// Does the planner use the teaching methods correctly? Runs only the planning call (no scenes) for a set of topics at
// every audience level, then checks each plan: its teaching lines follow the method's rules, the method is one a
// teacher would accept for that topic and level, the use case's default is kept or a reason is given, and the level
// changes the plan where it should.
//   node scripts/eval/plan-check.mjs <arm> <haiku|sonnet> [parallel=2]      (run `pnpm build` first)
// Writes out/eval/<arm>/<topic>.<level>.plan.txt and out/eval/<arm>/plan-check.json; prints the report.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const llm = await import(pathToFileURL(join(root, "packages/llm/dist/index.js")).href);

const [arm, model, par = "2"] = process.argv.slice(2);
if (!arm || !model) throw new Error("usage: plan-check.mjs <arm> <haiku|sonnet> [parallel]");
const dir = join(root, "out/eval", arm);
mkdirSync(dir, { recursive: true });
const TOPICS = Object.fromEntries(readFileSync(join(root, "scripts/eval/topics.tsv"), "utf8").split("\n").filter(Boolean).map((l) => l.split("\t")));

/**
 * Methods a teacher would accept for each topic and level, decided before any plan was generated (a judgement, not a
 * ground truth): several are often right, and the check only asks that the planner's choice is one of them.
 */
const ACCEPT = {
  dijkstra: { new: ["worked-example", "discovery", "analogical"], familiar: ["worked-example", "discovery"], practitioner: ["worked-example", "problem-based"] },
  "bubble-sort": { new: ["worked-example", "discovery", "analogical"], familiar: ["worked-example", "discovery"], practitioner: ["worked-example"] },
  "gradient-descent": { new: ["analogical", "worked-example", "discovery"], familiar: ["worked-example", "discovery", "feynman"], practitioner: ["worked-example", "problem-based", "causal"] },
  cors: { new: ["causal", "socratic", "analogical", "problem-based"], familiar: ["socratic", "causal", "problem-based"], practitioner: ["problem-based", "socratic", "causal"] },
  "browser-render": { new: ["causal", "analogical"], familiar: ["causal"], practitioner: ["causal", "problem-based"] },
  kubernetes: { new: ["causal", "analogical", "problem-based"], familiar: ["causal", "problem-based"], practitioner: ["problem-based", "causal"] },
  "db-index": { new: ["analogical", "feynman", "problem-based", "contrastive"], familiar: ["feynman", "problem-based", "contrastive", "worked-example"], practitioner: ["problem-based", "worked-example", "contrastive"] },
  "floating-point": { new: ["discovery", "socratic", "feynman", "analogical"], familiar: ["socratic", "discovery", "feynman", "worked-example"], practitioner: ["socratic", "worked-example", "problem-based"] },
  "bloom-filter": { new: ["analogical", "feynman", "worked-example", "discovery"], familiar: ["worked-example", "feynman", "socratic", "discovery"], practitioner: ["worked-example", "problem-based"] },
  "public-key": { new: ["analogical", "feynman"], familiar: ["feynman", "analogical", "causal", "worked-example"], practitioner: ["feynman", "causal", "worked-example"] },
  "cap-theorem": { new: ["socratic", "analogical", "feynman", "discovery"], familiar: ["socratic", "contrastive", "feynman", "causal"], practitioner: ["contrastive", "socratic", "problem-based"] },
  "process-thread": { new: ["contrastive", "analogical"], familiar: ["contrastive"], practitioner: ["contrastive"] },
  "rest-graphql": { new: ["contrastive"], familiar: ["contrastive"], practitioner: ["contrastive", "problem-based"] },
  "git-branching": { new: ["worked-example", "analogical"], familiar: ["worked-example", "causal"], practitioner: ["worked-example", "problem-based"] },
  "sql-injection": { new: ["worked-example", "discovery", "causal"], familiar: ["worked-example", "problem-based", "causal", "socratic"], practitioner: ["problem-based", "worked-example"] },
  "tcp-states": { new: ["causal", "worked-example"], familiar: ["causal", "worked-example"], practitioner: ["causal", "worked-example", "problem-based"] },
};
const LEVELS = ["new", "familiar", "practitioner"];
const client = llm.clientFromEnv({ providers: ["claude"], model });

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (k < items.length) { const i = k++; out[i] = await fn(items[i], i); } }));
  return out;
}

const jobs = Object.keys(ACCEPT).flatMap((t) => LEVELS.map((level) => ({ t, level })));
const results = await pool(jobs, Number(par), async ({ t, level }) => {
  const file = join(dir, `${t}.${level}.plan.txt`);
  const meta = join(dir, `${t}.${level}.json`);
  if (!existsSync(file)) {
    try {
      const r = await llm.plan(TOPICS[t], { client, domain: "tech", scenes: { min: 4, max: 6 }, settings: { level } });
      writeFileSync(file, r.outline);
      writeFileSync(meta, JSON.stringify({ ms: r.ms, usage: r.usage }));
      console.error(`planned ${t} (${level})`);
    } catch (e) {
      console.error(`FAILED ${t} (${level}): ${e?.message ?? e}`);
      return { t, level, failed: true };
    }
  }
  const outline = readFileSync(file, "utf8");
  const usecase = llm.useCaseOf(outline) ?? llm.guessUseCase(TOPICS[t]);
  const teach = llm.teachingOf(outline, level, usecase?.method, { min: 4, max: 6 });
  const method = teach.method?.name ?? teach.methodName ?? "";
  return {
    t,
    level,
    usecase: usecase?.name,
    defaultMethod: usecase?.method,
    method,
    why: teach.why,
    accepted: ACCEPT[t][level].includes(method),
    problems: teach.problems,
    briefProblems: llm.briefOf(outline).problems,
    beats: teach.scenes.map((s) => `${s.beat ?? "?"}${s.via ? `/${s.via}` : ""}`),
    devices: teach.scenes.flatMap((s) => s.devices),
    firstDevices: teach.scenes[0]?.devices ?? [],
    links: teach.scenes.slice(1).map((s) => s.link ?? ""),
    wroteAudience: /^\s*#\s*(audience|level|voice)\s*:/im.test(outline),
    // The topic's own words name an audience ("for beginners"), which can contradict the level given.
    selfAudience: /\bfor (programming )?(beginners|developers|experts)\b/i.test(TOPICS[t]),
    scenes: teach.scenes.length,
  };
});

const ok = results.filter((r) => !r.failed);
writeFileSync(join(dir, "plan-check.json"), JSON.stringify(results, null, 1));
const pct = (n, d) => `${n}/${d} (${d ? Math.round((100 * n) / d) : 0}%)`;
const by = (f) => ok.reduce((m, r) => ((m[f(r)] ??= []).push(r), m), {});

console.log(`\n# Planner check · ${arm} · ${model} · ${ok.length} plans (${results.length - ok.length} failed)\n`);
console.log("## Does the plan follow the teaching rules?");
console.log(`- plans with no teaching problem: ${pct(ok.filter((r) => !r.problems.length).length, ok.length)}`);
const kinds = {};
for (const r of ok) for (const p of r.problems) {
  const k = p.replace(/`[^`]*`/g, "`…`").replace(/^scene \w+: /, "scene …: ").replace(/\(.*\)$/, "").replace(/under [\w, ]+$/, "under …").replace(/beats [\w, -]+ of/, "beats … of");
  kinds[k] = (kinds[k] ?? 0) + 1;
}
for (const [k, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) console.log(`  - ${n}× ${k}`);
console.log(`- plans that wrote an audience/level/voice line themselves: ${pct(ok.filter((r) => r.wroteAudience).length, ok.length)}`);
console.log(`- brief problems: ${pct(ok.filter((r) => r.briefProblems.length).length, ok.length)}`);

console.log("\n## Does it choose a sensible method?");
console.log(`- method a teacher would accept (fixed before the run): ${pct(ok.filter((r) => r.accepted).length, ok.length)}`);
for (const level of LEVELS) { const g = ok.filter((r) => r.level === level); console.log(`  - ${level}: ${pct(g.filter((r) => r.accepted).length, g.length)}`); }
const clean = ok.filter((r) => !r.selfAudience);
console.log(`  - without topics that name their own audience (${[...new Set(ok.filter((r) => r.selfAudience).map((r) => r.t))].join(", ")}): ${pct(clean.filter((r) => r.accepted).length, clean.length)}`);
console.log(`- kept the use case's default method: ${pct(ok.filter((r) => r.method === r.defaultMethod).length, ok.length)}; switched with a why: ${ok.filter((r) => r.method !== r.defaultMethod && r.why).length}, without: ${ok.filter((r) => r.method !== r.defaultMethod && !r.why).length}`);
console.log("- not accepted:");
for (const r of ok.filter((r) => !r.accepted)) console.log(`  - ${r.t} (${r.level}): ${r.method || "none"} [use case ${r.usecase}, default ${r.defaultMethod}] — accepted: ${ACCEPT[r.t][r.level].join(", ")}${r.why ? ` · why: ${r.why}` : ""}`);

console.log("\n## Does the audience level change the plan?");
const methodsBy = by((r) => r.level);
for (const level of LEVELS) {
  const counts = {};
  for (const r of methodsBy[level] ?? []) counts[r.method] = (counts[r.method] ?? 0) + 1;
  const dev = {};
  for (const r of methodsBy[level] ?? []) for (const d of r.devices) dev[d] = (dev[d] ?? 0) + 1;
  console.log(`- ${level.padEnd(12)} methods: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m}×${n}`).join(" ")} · devices: ${Object.entries(dev).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}×${n}`).join(" ")}`);
}
const topics = Object.keys(ACCEPT);
const levelTopics = topics.filter((t) => !ok.some((r) => r.t === t && r.selfAudience));
const varied = levelTopics.filter((t) => new Set(ok.filter((r) => r.t === t).map((r) => r.method)).size > 1);
console.log(`- topics whose method changes with the level (topics that name their own audience left out): ${varied.length}/${levelTopics.length} (${varied.join(", ")})`);

console.log("\n## Openings and arcs");
const opensQ = ok.filter((r) => r.firstDevices.some((d) => d === "prediction" || d === "question"));
console.log(`- first scene asks the viewer a question or for a prediction: ${pct(opensQ.length, ok.length)} — methods: ${[...new Set(opensQ.map((r) => r.method))].join(", ") || "-"}`);
console.log(`- scenes per plan: ${[...new Set(ok.map((r) => r.scenes))].sort().join(", ")}`);
console.log(`- links written for later scenes: ${pct(ok.flatMap((r) => r.links).filter(Boolean).length, ok.flatMap((r) => r.links).length)}`);
console.log("\n## Every plan");
for (const t of topics) for (const level of LEVELS) {
  const r = ok.find((x) => x.t === t && x.level === level);
  if (r) console.log(`- ${t} · ${level}: ${r.method}${r.accepted ? "" : " ✗"} · ${r.beats.join(" → ")}${r.problems.length ? ` · ⚠ ${r.problems.length}` : ""}`);
}
