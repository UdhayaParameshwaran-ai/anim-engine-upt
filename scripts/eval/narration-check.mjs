// Did the scenes tell the story the plan asked for? Compares the narration of eval arms on the same topics, and for
// arms whose plan has teaching lines (# method:, # beat:) checks that each scene's narration does what its line says.
//   node scripts/eval/narration-check.mjs <topics.tsv> <arm> [arm ...]          (run `pnpm build` first)
// Reads out/eval/<arm>/<topic>.txt (the final script) and <topic>.trace.json (the plan). Prints a markdown report.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { compile } = await imp("packages/compiler/dist/index.js");
const llm = await imp("packages/llm/dist/index.js");

const [topicsFile, ...arms] = process.argv.slice(2);
if (!topicsFile || !arms.length) throw new Error("usage: narration-check.mjs <topics.tsv> <arm> [arm ...]");
const topics = readFileSync(topicsFile, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t")[0]);

const words = (s) => s.split(/\s+/).filter(Boolean);
const RE = {
  question: /\?\s*$/,
  you: /\b(you|your|you're|you'd|you'll)\b/i,
  link: /\b(but|so|because|therefore|which means|that's why|that is why|instead|yet|unless|otherwise)\b/i,
  backref: /^(so|but|that|this|these|now|back|remember|that's|which|instead|and that|then|because|why|whether|yet|still|once|with that|here's)\b/i,
  screen: /\b(here we see|this diagram|as shown|on screen|let's look|in this video|we will|as we saw)\b/i,
  analogy: /\b(like a|like an|like the|imagine|think of|picture|as if|just as|similar to|the same way)\b/i,
  misconception: /\b(you might|you'd (think|expect|guess)|tempting|seems? (like|to)|looks like|feels like|natural guess|most people|common(ly)? (mistake|belief|assum)|assum|isn't|is not|not what|actually|but (that|it) (is|was)n't|wrong)\b/i,
  contrast: /\b(but|while|whereas|instead|unlike|on the other hand|versus|vs|compared|than)\b/i,
  signposting: /\b(next|first|now|then|let's|before we|here's (how|what|why)|so far)\b/i,
  repetition: /./,
  recap: /\b(so far|to sum up|in short|remember|recap)\b/i,
};
const tri = (t) => { const w = t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean); const s = new Set(); for (let i = 0; i + 2 < w.length; i++) s.add(w.slice(i, i + 3).join(" ")); return s; };

/** Each scene's spoken sentences, in order, from the final script. */
function scenesOf(arm, t) {
  const f = join(root, "out/eval", arm, `${t}.txt`);
  if (!existsSync(f)) return undefined;
  const { script } = compile(readFileSync(f, "utf8"));
  return script.scenes.map((sc) => ({ id: sc.id, said: sc.steps.flatMap((st) => st.beats.filter((b) => b.type === "speech").map((b) => b.text.trim())) })).filter((s) => s.said.length);
}

/** The plan's teaching lines, from the planning call in the trace (missing for arms planned before teaching lines). */
function teachingFor(arm, t) {
  const f = join(root, "out/eval", arm, `${t}.trace.json`);
  if (!existsSync(f)) return undefined;
  const reply = JSON.parse(readFileSync(f, "utf8")).calls.find((c) => c.kind === "outline")?.reply ?? "";
  if (!/^\s*#\s*method:/im.test(reply)) return undefined;
  const outline = llm.clean(reply);
  return llm.teachingOf(outline, "familiar", (llm.useCaseOf(outline) ?? llm.guessUseCase(t))?.method);
}

function stats(arm) {
  const S = { n: 0, sent: 0, words: 0, sd: [], q: 0, you: 0, link: 0, screen: 0, openers: 0, linked: 0, firstQ: 0, firstQAllowed: 0, endQ: 0, closeTri: [], devices: {}, firstQWrong: [] };
  for (const t of topics) {
    const sc = scenesOf(arm, t);
    if (!sc?.length) continue;
    S.n++;
    const all = sc.flatMap((s) => s.said);
    const ws = all.map((s) => words(s).length);
    const mean = ws.reduce((a, b) => a + b, 0) / ws.length;
    S.sd.push(Math.sqrt(ws.reduce((a, b) => a + (b - mean) ** 2, 0) / ws.length));
    S.sent += all.length;
    S.words += ws.reduce((a, b) => a + b, 0);
    for (const s of all) { if (RE.question.test(s)) S.q++; if (RE.you.test(s)) S.you++; if (RE.link.test(s)) S.link++; if (RE.screen.test(s)) S.screen++; }
    sc.forEach((s, i) => { if (i > 0) { S.openers++; if (RE.backref.test(s.said[0])) S.linked++; } });
    const teach = teachingFor(arm, t);
    const firstAsks = sc[0].said.some((s) => RE.question.test(s));
    if (firstAsks) {
      S.firstQ++;
      if (teach?.method && ["socratic", "discovery"].includes(teach.method.name)) S.firstQAllowed++;
      else if (teach?.method) S.firstQWrong.push(`${t} (${teach.method.name})`);
    }
    if (sc.at(-1).said.some((s) => RE.question.test(s))) S.endQ++;
    const earlier = tri(sc.slice(0, -1).flatMap((s) => s.said).join(" "));
    const last = [...tri(sc.at(-1).said.join(" "))];
    S.closeTri.push(last.filter((x) => earlier.has(x)).length / Math.max(1, last.length));
    // Devices the plan placed on a scene, and whether that scene's narration shows a sign of them.
    if (teach) for (const p of teach.scenes) {
      const s = sc.find((x) => x.id === p.id);
      if (!s) continue;
      for (const d of p.devices) {
        if (!(d in RE) || d === "repetition") continue;
        const ok = d === "prediction" || d === "question" ? s.said.some((x) => RE.question.test(x)) : s.said.some((x) => RE[d].test(x));
        const k = (S.devices[d] ??= { planned: 0, shown: 0 });
        k.planned++;
        if (ok) k.shown++;
      }
    }
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const pct = (n) => `${((100 * n) / Math.max(1, S.sent)).toFixed(1)}%`;
  return {
    S,
    rows: {
      videos: S.n,
      "words / video": Math.round(S.words / Math.max(1, S.n)),
      "sentence-length spread": `±${avg(S.sd).toFixed(1)}`,
      "later scenes that open with a link back": `${S.linked}/${S.openers}`,
      "first scene asks a question (of them, the method opens with one)": `${S.firstQ}/${S.n} (${S.firstQAllowed})`,
      "last scene asks a question": `${S.endQ}/${S.n}`,
      "sentences that are questions": pct(S.q),
      "sentences with you/your": pct(S.you),
      "sentences with but/so/because…": pct(S.link),
      "screen/structure talk": pct(S.screen),
      "closing: 3-word phrases already said": avg(S.closeTri).toFixed(2),
      "planned devices the narration shows": Object.keys(S.devices).length ? Object.entries(S.devices).map(([d, k]) => `${d} ${k.shown}/${k.planned}`).join(", ") : "—",
    },
  };
}

const res = arms.map((a) => [a, stats(a)]);
console.log(`| metric | ${arms.join(" | ")} |\n|---|${arms.map(() => "---").join("|")}|`);
for (const k of Object.keys(res[0][1].rows)) console.log(`| ${k} | ${res.map(([, r]) => r.rows[k]).join(" | ")} |`);
for (const [a, r] of res) if (r.S.firstQWrong.length) console.log(`\n${a}: first scene asks a question although the method opens otherwise: ${r.S.firstQWrong.join(", ")}`);
