// Checks the picture search against what scenes about technology ask for.
//   node scripts/eval-icons.mjs            every concept with the rank of its expected icon
//   node scripts/eval-icons.mjs --misses   only the concepts whose icon is not in the top 5
// Each line is a concept as a scene would word it, and the icons that would be right for it.
import { AssetLibrary } from "../packages/registry/dist/index.js";
import { FRESH, GOLDEN, HELD_OUT } from "./icon-eval-sets.mjs";

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const lib = new AssetLibrary();
  const missesOnly = process.argv.includes("--misses");
  const set = process.argv.includes("--fresh") ? FRESH : process.argv.includes("--held-out") ? HELD_OUT : GOLDEN;
  let hit = 0;
  let shortlist = 0;
  for (const [query, expected] of set) {
    if (lib.search(query, { kind: "icon", limit: 30 }).some((h) => expected.includes(h.asset.name))) shortlist++;
    const hits = lib.search(query, { kind: "icon", limit: 10 });
    const rank = hits.findIndex((h) => expected.includes(h.asset.name)) + 1;
    if (rank && rank <= 5) hit++;
    if (missesOnly && rank && rank <= 5) continue;
    const top = hits.slice(0, 5).map((h) => h.asset.name).join(" ");
    console.log(`${rank ? (rank <= 5 ? `#${rank}` : `#${rank} (low)`) : "MISS"}\t${query}\t→ ${top}${rank && rank <= 5 ? "" : `   [wanted ${expected.join("|")}]`}`);
  }
  const pct = (n) => `${Math.round((n / set.length) * 100)}%`;
  console.log(`\n[${set === FRESH ? "fresh" : set === HELD_OUT ? "held-out" : "golden"}] a right icon in the top 5: ${hit}/${set.length} (${pct(hit)}) · in the 30 the model is shown: ${shortlist}/${set.length} (${pct(shortlist)})`);
}
