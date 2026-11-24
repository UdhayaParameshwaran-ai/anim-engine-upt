// Does the teaching decision (use case, intent → method, misconception, length) come out right?
// Runs only the decision call:
//   - every topic (topics.tsv, topics-general.tsv, gold.json) at level familiar, twice (the model's own variation);
//   - the gold topics also at new and practitioner, and with a "short" and a "long" wording (the length reading).
// Scores against scripts/eval/gold.json (accepted use cases and methods, written before the runs), and against the other
// model's run when it exists.
//   node scripts/eval/decision-check.mjs <haiku|sonnet> [parallel=3]        (run `pnpm build` first)
// Writes out/eval/decision2-<model>/<topic>.<variant>.txt and prints the report.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const llm = await import(pathToFileURL(join(root, "packages/llm/dist/index.js")).href);
const [model, par = "3"] = process.argv.slice(2);
if (!model) throw new Error("usage: decision-check.mjs <haiku|sonnet> [parallel]");
// TAG names the run (decision<TAG>-<model>); QUICK=1 asks each topic once and skips the length wordings.
const TAG = process.env.TAG ?? "2";
const QUICK = process.env.QUICK === "1";
const dirOf = (m) => join(root, "out/eval", `decision${TAG}-${m}`);
const out = dirOf(model);
mkdirSync(out, { recursive: true });

const GOLD = JSON.parse(readFileSync(join(root, "scripts/eval/gold.json"), "utf8")).topics;
const load = (f, group) => readFileSync(join(root, "scripts/eval", f), "utf8").split("\n").filter(Boolean).map((l) => { const [id, topic] = l.split("\t"); return { id, topic, group: id.startsWith("trap-") ? "trap" : group }; });
const seen = new Set();
const TOPICS = [...load("topics.tsv", "tech"), ...load("topics-general.tsv", "general"), ...Object.entries(GOLD).map(([id, g]) => ({ id, topic: g.topic, group: "gold-only" }))].filter((t) => !seen.has(t.id) && seen.add(t.id));

const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const SHORT = [(t) => `${t}. Keep it short, just a quick explanation.`, (t) => `Briefly explain: ${lower(t)}`, (t) => `${t}, in a nutshell`];
const LONG = [(t) => `${t}. Explain it in detail, I need a long narration.`, (t) => `Explain in detail: ${lower(t)}`, (t) => `${t}. Make it a 3 minute video.`];

const jobs = [];
TOPICS.forEach((t, i) => {
  for (const v of QUICK ? ["plain"] : ["plain", "plain2"]) jobs.push({ ...t, v, level: "familiar", request: t.topic, expect: "none" });
  if (!GOLD[t.id]) return;
  for (const level of ["new", "practitioner"]) jobs.push({ ...t, v: level, level, request: t.topic, expect: "none" });
  if (QUICK) return;
  jobs.push({ ...t, v: "short", level: "familiar", request: SHORT[i % SHORT.length](t.topic), expect: "short" });
  jobs.push({ ...t, v: "long", level: "familiar", request: LONG[i % LONG.length](t.topic), expect: "long" });
});

const client = llm.clientFromEnv({ providers: ["claude"], model });
async function pool(items, limit, fn) {
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (k < items.length) await fn(items[k++]); }));
}
await pool(jobs, Number(par), async (j) => {
  const f = join(out, `${j.id}.${j.v}.txt`);
  if (existsSync(f)) return;
  const settings = { level: j.level };
  try {
    const r = await client.chat({ messages: [{ role: "system", content: llm.decideSystemPrompt(settings) }, { role: "user", content: llm.decidePrompt(j.request, settings) }], temperature: 0.4 });
    writeFileSync(f, `${j.request}\n${JSON.stringify(r.usage ?? {})}\n---\n${r.text}`);
  } catch (e) {
    console.error(`FAILED ${j.id} ${j.v}: ${e?.message ?? e}`);
  }
});

/** One reply, read the way the pipeline reads it. */
const readOne = (dir, j) => {
  const f = join(dir, `${j.id}.${j.v}.txt`);
  if (!existsSync(f)) return undefined;
  const [head, text = ""] = readFileSync(f, "utf8").split("\n---\n");
  const usage = JSON.parse(head.split("\n")[1] || "{}");
  const d = llm.parseDecision(text, j.level, "standard", undefined, llm.USE_CASES, llm.guessUseCase(j.topic)?.name ?? "concept");
  const len = llm.readLengthLine(text);
  return { usecase: d?.usecase, intent: d?.intent, method: d?.method.name, misconception: d?.misconception, saidIntent: /^\s*#\s*intent:\s*([a-z]+)/im.test(text), length: len.said ? (len.length ?? "none") : "missing", usage };
};
const res = jobs.map((j) => ({ ...j, got: readOne(out, j) })).filter((j) => j.got);
const by = (id, v) => res.find((r) => r.id === id && r.v === v)?.got;
const pct = (a, b) => `${a}/${b} (${b ? Math.round((100 * a) / b) : 0}%)`;

console.log(`\n# Decision check v2 · ${model} · ${TOPICS.length} topics, ${Object.keys(GOLD).length} with expected answers · ${res.length}/${jobs.length} replies\n`);

console.log("## Against the expected answers (gold.json)\n\n| level | use case accepted | method accepted |\n|---|---|---|");
const misses = [];
for (const level of ["new", "familiar", "practitioner"]) {
  const rows = Object.keys(GOLD).map((id) => ({ id, g: by(id, level === "familiar" ? "plain" : level) })).filter((r) => r.g);
  const uc = rows.filter((r) => GOLD[r.id].usecases.includes(r.g.usecase)).length;
  const me = rows.filter((r) => GOLD[r.id].methods[level].includes(r.g.method)).length;
  console.log(`| ${level} | ${pct(uc, rows.length)} | ${pct(me, rows.length)} |`);
  for (const r of rows) if (!GOLD[r.id].methods[level].includes(r.g.method) || !GOLD[r.id].usecases.includes(r.g.usecase)) misses.push(`- ${r.id} · ${level}: ${r.g.usecase} · ${r.g.intent} → ${r.g.method} (accepted: ${GOLD[r.id].usecases.join("/")} · ${GOLD[r.id].methods[level].join(", ")})`);
}
console.log(`\nMisses:\n${misses.join("\n") || "- none"}`);

console.log("\n## Can every method be reached? (one topic per method, at each level)\n");
for (const id of Object.keys(GOLD).filter((k) => k.startsWith("m-"))) console.log(`- ${id}: ${["new", "plain", "practitioner"].map((v) => { const g = by(id, v); return g ? `${g.intent} → ${g.method}` : "?"; }).join(" · ")}`);

console.log("\n## Spread at familiar (all topics, first ask)\n");
const plain = TOPICS.map((t) => by(t.id, "plain")).filter(Boolean);
const count = (key) => Object.entries(plain.reduce((a, g) => ({ ...a, [g[key]]: (a[g[key]] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
console.log(`- methods: ${count("method")}\n- intents: ${count("intent")}\n- use cases: ${count("usecase")}`);
console.log(`- socratic share: ${pct(plain.filter((g) => g.method === "socratic").length, plain.length)} · a misconception named: ${pct(plain.filter((g) => g.misconception).length, plain.length)} · an intent line written: ${pct(plain.filter((g) => g.saidIntent).length, plain.length)}`);

console.log("\n## Consistency\n");
const pairs = TOPICS.map((t) => [by(t.id, "plain"), by(t.id, "plain2"), t]).filter(([a, b]) => a && b);
console.log(`- asked twice: same use case ${pct(pairs.filter(([a, b]) => a.usecase === b.usecase).length, pairs.length)} · same method ${pct(pairs.filter(([a, b]) => a.method === b.method).length, pairs.length)}`);
const other = model === "haiku" ? "sonnet" : "haiku";
if (existsSync(dirOf(other))) {
  const both = TOPICS.map((t) => [by(t.id, "plain"), readOne(dirOf(other), { ...t, v: "plain", level: "familiar" }), t]).filter(([a, b]) => a && b);
  console.log(`- against ${other}: same use case ${pct(both.filter(([a, b]) => a.usecase === b.usecase).length, both.length)} · same method ${pct(both.filter(([a, b]) => a.method === b.method).length, both.length)}`);
  for (const [a, b, t] of both) if (a.usecase !== b.usecase || a.method !== b.method) console.log(`  - ${t.id}: ${a.usecase} · ${a.intent} → ${a.method} | ${other}: ${b.usecase} · ${b.intent} → ${b.method}`);
}

console.log("\n## Length reading\n");
for (const want of ["none", "short", "long"]) {
  const rows = res.filter((r) => r.expect === want && (want !== "none" || r.v === "plain"));
  const ok = rows.filter((r) => r.got.length === want || (want === "none" && r.got.length === "standard") || (want === "long" && r.got.length === "deep")).length;
  console.log(`- asked ${want}: read right ${pct(ok, rows.length)}`);
}
const traps = res.filter((r) => r.group === "trap" && r.v === "plain");
console.log(`- trap topics (length words in the name), plain request read as no length: ${pct(traps.filter((r) => ["none", "standard"].includes(r.got.length)).length, traps.length)}`);

const tok = res.reduce((a, r) => ({ p: a.p + (r.got.usage.prompt ?? 0), c: a.c + (r.got.usage.completion ?? 0) }), { p: 0, c: 0 });
console.log(`\n## Tokens\n- ${res.length} calls · prompt ${tok.p} (${Math.round(tok.p / Math.max(1, res.length))} per call) · completion ${tok.c} (${Math.round(tok.c / Math.max(1, res.length))} per call)`);
