// Summarises reviewer reports (the format rubric.md asks for) into one score card.
//   node scripts/eval/score.mjs <report.md> [<report.md> ...] [--json out.json]
// Prints the average score, the score spread, verdict counts and the misleading scenes.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const out = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
const files = args.filter((a, i) => a !== "--json" && i !== jsonAt + 1);

/** Videos and scenes from report text. */
export function parse(text) {
  const videos = [];
  let cur;
  for (const line of text.split("\n")) {
    const v = /^###\s+(\S+)\s+[—-]+\s+score\s+(\d)\s*\/\s*5/.exec(line);
    if (v) {
      cur = { topic: v[1], score: Number(v[2]), scenes: [] };
      videos.push(cur);
      continue;
    }
    if (/^###/.test(line)) cur = undefined;
    const s = cur && /^-\s+(\S+)\s+\(([^)]*)\):\s*(EXPLAINS|ILLUSTRATES|DECORATES|BROKEN)\b(.*)$/.exec(line.trim());
    if (s) {
      // Only the defects say what the picture got wrong; "missing:" is what a better picture would add.
      const defects = s[4].split(/\|\s*missing:/i)[0];
      cur.scenes.push({ id: s[1], template: s[2], verdict: s[3], misleading: /MISLEADING|mislead|contradicts?/i.test(defects), text: s[4].trim() });
    }
  }
  return videos;
}

const videos = files.flatMap((f) => parse(readFileSync(f, "utf8")));
const scenes = videos.flatMap((v) => v.scenes.map((s) => ({ ...s, topic: v.topic })));
const count = (k) => scenes.filter((s) => s.verdict === k).length;
const card = {
  videos: videos.length,
  average: videos.length ? Math.round((100 * videos.reduce((a, v) => a + v.score, 0)) / videos.length) / 100 : 0,
  scores: Object.fromEntries([5, 4, 3, 2, 1].map((n) => [n, videos.filter((v) => v.score === n).length])),
  scenes: scenes.length,
  verdicts: { EXPLAINS: count("EXPLAINS"), ILLUSTRATES: count("ILLUSTRATES"), DECORATES: count("DECORATES"), BROKEN: count("BROKEN") },
  misleading: scenes.filter((s) => s.misleading).map((s) => `${s.topic}/${s.id}`),
  perVideo: Object.fromEntries(videos.map((v) => [v.topic, v.score])),
};
console.log(`videos ${card.videos} · average ${card.average}/5 · scores ${JSON.stringify(card.scores)}`);
console.log(`scenes ${card.scenes} · ${Object.entries(card.verdicts).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
console.log(`misleading scenes (${card.misleading.length}): ${card.misleading.join(", ") || "none"}`);
if (out) writeFileSync(out, JSON.stringify(card, null, 2));
