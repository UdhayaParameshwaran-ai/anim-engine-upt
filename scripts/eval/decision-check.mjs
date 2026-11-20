// Does the way a request asks for length change the teaching decision, and is the length read right?
// Runs only the decision call (use case, method, length) for every topic, four times: the plain topic, the plain topic
// again (how much the model varies by itself), a "short" wording and a "long" wording (each cycling through several
// phrasings). Topics: scripts/eval/topics.tsv and topics-general.tsv (with trap topics whose names hold length words).
//   node scripts/eval/decision-check.mjs <haiku|sonnet> [parallel=3]        (run `pnpm build` first)
// Writes out/eval/decision-<model>/<topic>.<variant>.txt and prints the report.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const llm = await import(pathToFileURL(join(root, "packages/llm/dist/index.js")).href);
const [model, par = "3"] = process.argv.slice(2);
if (!model) throw new Error("usage: decision-check.mjs <haiku|sonnet> [parallel]");
const out = join(root, "out/eval", `decision-${model}`);
mkdirSync(out, { recursive: true });
const load = (f, group) => readFileSync(join(root, "scripts/eval", f), "utf8").split("\n").filter(Boolean).map((l) => { const [id, topic] = l.split("\t"); return { id, topic, group: id.startsWith("trap-") ? "trap" : group }; });
const TOPICS = [...load("topics.tsv", "tech"), ...load("topics-general.tsv", "general")];

/** Wordings, each with the length it asks for. A topic gets one of each kind, in turn. */
const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const SHORT = [
  [(t) => `${t}. Keep it short, just a quick explanation.`, "short"],
  [(t) => `Briefly explain: ${lower(t)}`, "short"],
  [(t) => `${t}, in a nutshell`, "short"],
  [(t) => `Give me a 30-second explanation of this: ${lower(t)}`, "short"],
  [(t) => `${t}. Konjam short-ah explain pannunga.`, "short"],
];
const LONG = [
  [(t) => `${t}. Explain it in detail, I need a long narration.`, "long"],
  [(t) => `Explain in detail: ${lower(t)}`, "long"],
  [(t) => `I want a detailed explanation of this: ${lower(t)}`, "long"],
  [(t) => `${t}. Make it a 3 minute video.`, "long"],
  [(t) => `Deep dive: ${lower(t)}`, "deep"],
  [(t) => `${t}. Explain everything, in depth.`, "deep"],
];
const variantsOf = (i) => ({ plain: [(t) => t, "none"], plain2: [(t) => t, "none"], short: SHORT[i % SHORT.length], long: LONG[i % LONG.length] });

const client = llm.clientFromEnv({ providers: ["claude"], model });
const settings = { level: "familiar" };
async function pool(items, limit, fn) {
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (k < items.length) await fn(items[k++]); }));
}

const jobs = TOPICS.flatMap((t, i) => Object.entries(variantsOf(i)).map(([v, [wording, expect]]) => ({ ...t, v, request: wording(t.topic), expect })));
await pool(jobs, Number(par), async (j) => {
  const f = join(out, `${j.id}.${j.v}.txt`);
  if (existsSync(f)) return;
  try {
    const r = await client.chat({ messages: [{ role: "system", content: llm.decideSystemPrompt(settings) }, { role: "user", content: llm.decidePrompt(j.request, settings) }], temperature: 0.4 });
    writeFileSync(f, `${j.request}\n---\n${r.text}`);
  } catch (e) {
    console.error(`FAILED ${j.id} ${j.v}: ${e?.message ?? e}`);
  }
});

const read = (j) => {
  const f = join(out, `${j.id}.${j.v}.txt`);
  if (!existsSync(f)) return undefined;
  const text = readFileSync(f, "utf8").split("\n---\n")[1] ?? "";
  const len = llm.readLengthLine(text);
  return { usecase: /^\s*#\s*usecase:\s*([a-z-]+)/im.exec(text)?.[1], method: /^\s*#\s*method:\s*([a-z-]+)/im.exec(text)?.[1], why: /why:\s*(.+)$/im.exec(text)?.[1] ?? "", length: len.said ? (len.length ?? "none") : "missing" };
};
const res = jobs.map((j) => ({ ...j, got: read(j) })).filter((j) => j.got);
const by = (id, v) => res.find((r) => r.id === id && r.v === v)?.got;
const pct = (a, b) => `${a}/${b} (${b ? Math.round((100 * a) / b) : 0}%)`;

console.log(`\n# Decision check · ${model} · level familiar · ${TOPICS.length} topics (${TOPICS.filter((t) => t.group === "tech").length} tech, ${TOPICS.filter((t) => t.group === "general").length} general, ${TOPICS.filter((t) => t.group === "trap").length} with length words in their name)\n`);
console.log("## Does the wording move the decision? (compared with the plain request)\n\n| request | same method | same use case |\n|---|---|---|");
for (const [v, label] of [["plain2", "the same plain request again (the model's own variation)"], ["short", "a \"short\" wording"], ["long", "a \"long\" or \"in depth\" wording"]]) {
  const pairs = TOPICS.map((t) => [by(t.id, "plain"), by(t.id, v)]).filter(([a, b]) => a && b);
  console.log(`| ${label} | ${pct(pairs.filter(([a, b]) => a.method === b.method).length, pairs.length)} | ${pct(pairs.filter(([a, b]) => a.usecase === b.usecase).length, pairs.length)} |`);
}
for (const g of ["tech", "general", "trap"]) {
  const ts = TOPICS.filter((t) => t.group === g);
  const row = (v) => { const p = ts.map((t) => [by(t.id, "plain"), by(t.id, v)]).filter(([a, b]) => a && b); return pct(p.filter(([a, b]) => a.method === b.method).length, p.length); };
  console.log(`- ${g}: same method · again ${row("plain2")} · short ${row("short")} · long ${row("long")}`);
}
console.log("\nMethod changes (plain → other wording):");
for (const t of TOPICS) for (const v of ["plain2", "short", "long"]) {
  const a = by(t.id, "plain"), b = by(t.id, v);
  if (a && b && a.method !== b.method) console.log(`- ${t.id} · ${v}: ${a.method} (${a.usecase}) → ${b.method} (${b.usecase})${v === "plain2" ? "" : ` · "${res.find((r) => r.id === t.id && r.v === v).request.slice(0, 70)}"`}`);
}

console.log("\n## Is the length read right?\n\n| asked | read as none | short | standard | long | deep | missing | right |\n|---|---|---|---|---|---|---|---|");
for (const want of ["none", "short", "long", "deep"]) {
  const rows = res.filter((r) => r.expect === want && (want !== "none" || r.v === "plain"));
  const c = (x) => rows.filter((r) => r.got.length === x).length;
  // "standard" is as right as "none" for a request that asks for no length.
  const right = rows.filter((r) => r.got.length === want || (want === "none" && r.got.length === "standard")).length;
  console.log(`| ${want === "none" ? "nothing (plain topic)" : want} | ${c("none")} | ${c("short")} | ${c("standard")} | ${c("long")} | ${c("deep")} | ${c("missing")} | ${pct(right, rows.length)} |`);
}
const traps = res.filter((r) => r.group === "trap" && r.v === "plain");
console.log(`\nTrap topics (length words in the name), plain request: read as no length ${pct(traps.filter((r) => r.got.length === "none" || r.got.length === "standard").length, traps.length)}${traps.filter((r) => !["none", "standard"].includes(r.got.length)).map((r) => ` · ${r.id} → ${r.got.length}`).join("")}`);
console.log("Wrong readings:");
for (const r of res.filter((r) => r.v !== "plain2" && !(r.got.length === r.expect || (r.expect === "none" && r.got.length === "standard")))) console.log(`- ${r.id} · "${r.request.slice(0, 80)}" → ${r.got.length} (wanted ${r.expect})`);
