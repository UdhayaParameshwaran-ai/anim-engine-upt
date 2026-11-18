// Joins each scene's 9 frames into one contact sheet (3×3, time left to right, top to bottom).
//   node scripts/eval/sheets.cjs <arm>
// Writes out/eval/<arm>/review/<topic>/<scene>.png next to the frames render.mjs made.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "../..");
const pnpmDir = path.join(root, "node_modules/.pnpm");
const sharpDir = fs.readdirSync(pnpmDir).find((d) => d.startsWith("sharp@"));
const sharp = require(path.join(pnpmDir, sharpDir, "node_modules/sharp"));

(async () => {
  const arm = process.argv[2];
  if (!arm) throw new Error("usage: sheets.cjs <arm>");
  const review = path.join(root, "out/eval", arm, "review");
  const W = 560, H = 315, G = 6;
  let n = 0;
  for (const t of fs.readdirSync(review)) {
    const dir = path.join(review, t);
    const scenesFile = path.join(dir, "scenes.txt");
    if (!fs.existsSync(scenesFile)) continue;
    for (const id of fs.readFileSync(scenesFile, "utf8").trim().split(/\s+/)) {
      const out = path.join(dir, `${id}.png`);
      if (fs.existsSync(out)) continue;
      const { pngs } = JSON.parse(fs.readFileSync(path.join(dir, `${id}-f`, "list.json"), "utf8"));
      const comps = [];
      for (let i = 0; i < pngs.length; i++) comps.push({ input: await sharp(pngs[i]).resize(W, H).toBuffer(), left: (i % 3) * (W + G), top: Math.floor(i / 3) * (H + G) });
      await sharp({ create: { width: 3 * W + 2 * G, height: Math.ceil(pngs.length / 3) * (H + G), channels: 3, background: "#888" } }).composite(comps).png().toFile(out);
      n++;
    }
  }
  console.log("sheets", n);
})();
