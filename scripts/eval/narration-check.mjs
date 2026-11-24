// Did the scenes tell the story the plan asked for? Compares the narration of eval arms on the same topics, and for
// arms whose plan has teaching lines (# method:, # beat:) checks that each scene's narration does what its line says.
// Also counts what the last audit found by hand (plan words spoken aloud, a question asked twice, a core scene written
// as a sentence or two) and what each video cost (tokens, seconds).
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
/** The same words quality.ts flags (Q15): plan words spoken aloud. */
const SCAFFOLD = /\b(next|last|previous|this|earlier|following) scene\b|\bthe (gap|follow-up|refine|beat|prediction|guess|steps|evidence|investigation|mapping) (showed|shows|ended|raised|set|gave|left)\b/i;
const tri = (t) => { const w = t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean); const s = new Set(); for (let i = 0; i + 2 < w.length; i++) s.add(w.slice(i, i + 3).join(" ")); return s; };

const STOP = new Set("the a an and or but so of to in on at for with by is are was were be it its this that these those then than as from into now each one two only not no can will would could should has have had do does did what which who how why when where you your we our they their there here just also more most very".split(" "));
const contentWords = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** One scene's source text from the final script (for wait lines and other non-spoken parts). */
function scriptBlock(arm, t, id) {
  const text = readFileSync(join(root, "out/eval", arm, `${t}.txt`), "utf8");
  return llm.split(text).scenes.find((x) => x.id === id)?.text ?? "";
}

/** Each scene's spoken sentences, in order, from the final script. */
function scenesOf(arm, t) {
  const f = join(root, "out/eval", arm, `${t}.txt`);
  if (!existsSync(f)) return undefined;
  const { script } = compile(readFileSync(f, "utf8"));
  return script.scenes.map((sc) => ({ id: sc.id, said: sc.steps.flatMap((st) => st.beats.filter((b) => b.type === "speech").map((b) => b.text.trim())) })).filter((s) => s.said.length);
}

const traceOf = (arm, t) => { const f = join(root, "out/eval", arm, `${t}.trace.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined; };

/** The plan as the scene writers saw it (the outline at the top of every scene request), with its teaching lines. */
function teachingFor(arm, t) {
  const trace = traceOf(arm, t);
  const ask = trace?.calls.find((c) => c.kind === "scene")?.prompt ?? "";
  const outline = (/^Video outline:\n([\s\S]*?)(?=\n\n(Already narrated|TEMPLATE |GRID|YOUR PART|Write scene))/.exec(ask)?.[1]) ?? "";
  if (!/^\s*#\s*method:/im.test(outline)) return undefined;
  return llm.teachingOf(outline, "familiar");
}

function stats(arm) {
  const S = { predictions: 0, paused: 0, links: 0, linkUsed: 0, n: 0, scenes: 0, sent: 0, words: 0, sd: [], q: 0, qPaused: 0, you: 0, link: 0, screen: 0, openers: 0, linked: 0, firstQ: 0, firstQAllowed: 0, endQ: 0, closeTri: [], devices: {}, firstQWrong: [], scaffold: [], askedTwice: [], thinCore: [], dupes: [], prompt: 0, completion: 0, ms: 0, calls: {}, methods: [] };
  for (const t of topics) {
    const sc = scenesOf(arm, t);
    if (!sc?.length) continue;
    S.n++;
    S.scenes += sc.length;
    const all = sc.flatMap((s) => s.said);
    const ws = all.map((s) => words(s).length);
    const mean = ws.reduce((a, b) => a + b, 0) / ws.length;
    S.sd.push(Math.sqrt(ws.reduce((a, b) => a + (b - mean) ** 2, 0) / ws.length));
    S.sent += all.length;
    S.words += ws.reduce((a, b) => a + b, 0);
    for (const s of all) { if (RE.question.test(s)) S.q++; if (RE.you.test(s)) S.you++; if (RE.link.test(s)) S.link++; if (RE.screen.test(s)) S.screen++; if (SCAFFOLD.test(s)) S.scaffold.push(`${t}: ${s.slice(0, 90)}`); }
    const seen = new Set();
    for (const s of all) { const k = s.toLowerCase().replace(/[^a-z0-9 ]/g, ""); if (seen.has(k)) S.dupes.push(`${t}: ${s.slice(0, 80)}`); seen.add(k); }
    sc.forEach((s, i) => {
      if (i > 0) { S.openers++; if (RE.backref.test(s.said[0])) S.linked++; }
      // Questions to the viewer followed by a pause before the next sentence.
      const block = scriptBlock(arm, t, s.id).split("\n");
      block.forEach((l, k) => { if (/^\s*>/.test(l) && /\?\s*$/.test(l.replace(/\{\d+\s?|\}/g, "").trim())) { const next = block.slice(k + 1).find((x) => /^\s*(>|wait\b)/.test(x)); if (next && /^\s*wait\b/.test(next)) S.qPaused++; } });
      // The same question to the viewer as the scene before asked.
      if (i > 0) {
        const before = sc[i - 1].said.filter((x) => RE.question.test(x)).map(contentWords);
        const again = s.said.filter((x) => RE.question.test(x)).find((q) => { const w = [...contentWords(q)]; return w.length >= 2 && before.some((b) => w.filter((x) => b.has(x)).length / w.length >= 0.6); });
        if (again) S.askedTwice.push(`${t}/${s.id}: ${again.slice(0, 80)}`);
      }
    });
    const teach = teachingFor(arm, t);
    if (teach?.method) S.methods.push(`${t}: ${teach.method.name} (${teach.scenes.map((p) => `${p.beats.join("+")}${p.round ? `:${p.round}` : ""}`).join(" → ")})`);
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
      const beats = p.beats?.length ? p.beats : p.beat ? [p.beat] : [];
      if (teach.method && beats.some((b) => (teach.method.core ?? []).includes(b)) && s.said.length < 3) S.thinCore.push(`${t}/${p.id} (${beats.join("+")}): ${s.said.length} sentence(s)`);
      for (const d of p.devices) {
        if (!(d in RE) || d === "repetition") continue;
        const ok = d === "prediction" || d === "question" ? s.said.some((x) => RE.question.test(x)) : s.said.some((x) => RE[d].test(x));
        const k = (S.devices[d] ??= { planned: 0, shown: 0 });
        k.planned++;
        if (ok) k.shown++;
      }
      // A planned prediction also needs its pause before the reveal.
      if (p.devices.includes("prediction") || beats.includes("prediction")) {
        S.predictions++;
        const block = scriptBlock(arm, t, p.id);
        if (/^\s*wait\s+\d/m.test(block) && s.said.some((x) => RE.question.test(x))) S.paused++;
      }
      // The scene's first sentence takes up its planned link (two content words in common).
      const i = sc.findIndex((x) => x.id === p.id);
      if (i > 0 && p.link) {
        S.links++;
        const lw = contentWords(p.link);
        if ([...contentWords(s.said[0])].filter((w) => lw.has(w)).length >= 2) S.linkUsed++;
      }
    }
    // What the video cost.
    const trace = traceOf(arm, t);
    if (trace) {
      S.prompt += trace.usage?.prompt ?? 0;
      S.completion += trace.usage?.completion ?? 0;
      S.ms += trace.ms ?? 0;
      for (const c of trace.calls) { const k = (S.calls[c.kind] ??= { n: 0, p: 0, c: 0 }); k.n++; k.p += c.usage?.prompt ?? 0; k.c += c.usage?.completion ?? 0; }
    }
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const pct = (n) => `${((100 * n) / Math.max(1, S.sent)).toFixed(1)}%`;
  const per = (x) => Math.round(x / Math.max(1, S.n));
  return {
    S,
    rows: {
      videos: S.n,
      "scenes / video": (S.scenes / Math.max(1, S.n)).toFixed(1),
      "sentences / scene": (S.sent / Math.max(1, S.scenes)).toFixed(1),
      "words / video": per(S.words),
      "sentence-length spread": `±${avg(S.sd).toFixed(1)}`,
      "later scenes that open with a link back": `${S.linked}/${S.openers}`,
      "first scene asks a question (of them, the method opens with one)": `${S.firstQ}/${S.n} (${S.firstQAllowed})`,
      "last scene asks a question": `${S.endQ}/${S.n}`,
      "questions to the viewer": S.q,
      "… followed by a pause": S.qPaused,
      "sentences with you/your": pct(S.you),
      "sentences with but/so/because…": pct(S.link),
      "screen/structure talk": pct(S.screen),
      "closing: 3-word phrases already said": avg(S.closeTri).toFixed(2),
      "openings that take up their planned link": S.links ? `${S.linkUsed}/${S.links}` : "—",
      "planned predictions asked, with a pause": S.predictions ? `${S.paused}/${S.predictions}` : "—",
      "planned devices the narration shows": Object.keys(S.devices).length ? Object.entries(S.devices).map(([d, k]) => `${d} ${k.shown}/${k.planned}`).join(", ") : "—",
      "plan words spoken aloud": S.scaffold.length,
      "a question asked twice in a row": S.askedTwice.length,
      "core scenes under 3 sentences": S.thinCore.length,
      "sentences repeated word for word": S.dupes.length,
      "prompt tokens / video": per(S.prompt),
      "completion tokens / video": per(S.completion),
      "seconds / video": Math.round(S.ms / 1000 / Math.max(1, S.n)),
    },
  };
}

const res = arms.map((a) => [a, stats(a)]);
console.log(`| metric | ${arms.join(" | ")} |\n|---|${arms.map(() => "---").join("|")}|`);
for (const k of Object.keys(res[0][1].rows)) console.log(`| ${k} | ${res.map(([, r]) => r.rows[k]).join(" | ")} |`);
for (const [a, r] of res) {
  const calls = Object.entries(r.S.calls).map(([k, v]) => `${k} ${(v.n / Math.max(1, r.S.n)).toFixed(1)} calls, ${Math.round(v.p / Math.max(1, r.S.n))}+${Math.round(v.c / Math.max(1, r.S.n))} tokens`).join(" · ");
  console.log(`\n### ${a}\n- per video: ${calls}`);
  if (r.S.methods.length) console.log(`- arcs: ${r.S.methods.join("; ")}`);
  for (const [label, list] of [["first scene asks a question although the method opens otherwise", r.S.firstQWrong], ["plan words spoken aloud", r.S.scaffold], ["a question asked twice", r.S.askedTwice], ["core scenes under 3 sentences", r.S.thinCore], ["repeated sentences", r.S.dupes]]) if (list.length) console.log(`- ${label}:\n${list.map((x) => `  - ${x}`).join("\n")}`);
}
