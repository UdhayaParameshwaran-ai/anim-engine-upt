import { respond, TEMPLATE_ORIGIN } from "@anim/html-templates/files";
import { motionSet, motionVariant, pageData, timing, type Measured } from "@anim/html-templates";
import { afterAll, describe, expect, it } from "vitest";
import { launch } from "../src/index.js";

/**
 * The designer's pages are measured in a real browser (window.__tpl.measure, src/prelude.js): when does each item's text arrive? The
 * formulas copied from the designer's code are wrong for some pages, so the engine times the narration against these measurements.
 */

const browser = await launch().catch(() => undefined);
afterAll(async () => {
  await browser?.close();
}, 60000);

const ITEMS = [
  { texts: ["Water the seed", "Moisture wakes the embryo inside"], icon: "droplet" },
  { texts: ["It sprouts", "A root goes down and a shoot goes up"], icon: "sprout" },
  { texts: ["It grows", "Leaves feed the plant and the trunk thickens"], icon: "sun" },
  { texts: ["It flowers", "Colour and scent bring the bees"], icon: "star" },
];
const BARS = ["January", "February", "March", "April"].map((m, i) => ({ texts: [m, `$${40 + i * 5}k`], icon: "" }));
const ROWS = [
  { texts: ["State lives on the server", "State travels with the user"], icon: "database" },
  { texts: ["Every request looks it up", "Every request checks a signature"], icon: "server" },
  { texts: ["Logging out is instant", "A token lives until it expires"], icon: "lock" },
];

async function measureVariant(template: string, variant: string, items: { texts: string[]; icon: string }[]) {
  const set = motionSet(template)!;
  const v = motionVariant(set, variant);
  const ctx = await browser!.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("about:") || url.startsWith("data:")) return route.continue();
    const r = respond(url);
    return r ? route.fulfill({ status: r.status, contentType: r.type, body: r.body }) : route.abort();
  });
  try {
    const page = await ctx.newPage();
    await page.setContent('<body style="margin:0"><iframe id="f" width="1920" height="1080" style="border:0"></iframe></body>');
    const hash = encodeURIComponent(JSON.stringify({ key: v.key, data: pageData(set, { heading: "Heading", items }), icons: {} }));
    await page.evaluate((src) => { (document.getElementById("f") as HTMLIFrameElement).src = src; }, `${TEMPLATE_ORIGIN}/${set.phase}/${v.dir}/${v.file}.html?embed&paused&theme=daylight-clean#${hash}`);
    const frame = await (await page.waitForSelector("#f")).contentFrame();
    await frame!.waitForFunction(() => (window as unknown as { __tpl?: unknown }).__tpl, null, { timeout: 15000 });
    await frame!.evaluate(() => (window as unknown as { __tpl: { ready: Promise<boolean> } }).__tpl.ready);
    return await frame!.evaluate(
      ({ texts, n }) => {
        const t = (window as unknown as { __tpl: { starts(n: number, p: string): number[] | null; measure(i: string[][]): unknown } }).__tpl;
        return { formula: t.starts(n, "normal"), measured: t.measure(texts) as (Measured | null)[] };
      },
      { texts: items.map((i) => i.texts), n: items.length },
    );
  } finally {
    await ctx.close();
  }
}

describe.skipIf(!browser)("measuring the designer's pages", () => {
  it(
    "steps (rail): each step arrives about 2.5s after the one before, and the page lands it within a moment",
    async () => {
      const { measured } = await measureVariant("steps", "rail", ITEMS);
      const t = timing(measured, null);
      expect(measured.every(Boolean)).toBe(true);
      for (let i = 1; i < 4; i++) expect(t.starts![i]! - t.starts![i - 1]!, `gap ${i}`).toBeGreaterThan(2);
      expect(t.spans!.every((s) => s < 1.2)).toBe(true);
    },
    60000,
  );

  it(
    "a bar chart starts its bars a fraction of a second apart: its items cannot be shown one by one",
    async () => {
      const { measured } = await measureVariant("chart", "bar-rise", BARS);
      const t = timing(measured, null);
      const gaps = t.starts!.slice(1).map((s, i) => s - t.starts![i]!);
      expect(Math.max(...gaps)).toBeLessThan(1);
    },
    60000,
  );

  it(
    "a compare page counts its header as the first thing: the rows come later than the designer's formula says, and a flip card is timed by its back",
    async () => {
      const verdict = await measureVariant("compare", "verdict", ROWS);
      const tv = timing(verdict.measured, verdict.formula);
      // The formula puts row 1 at 0.7s; the page shows it at about 1.3s and then one row every 2.5s.
      expect(tv.starts![0]).toBeGreaterThan(verdict.formula![0]!);
      expect(tv.starts![1]! - tv.starts![0]!).toBeGreaterThan(2);

      const flip = await measureVariant("compare", "flip", ROWS);
      const tf = timing(flip.measured, flip.formula);
      for (let i = 1; i < 3; i++) expect(tf.starts![i]! - tf.starts![i - 1]!, `flip gap ${i}`).toBeGreaterThan(2);
    },
    60000,
  );

  it(
    "a timeline's camera takes longer per event than the designer's formula assumes",
    async () => {
      const events = [
        { texts: ["1796", "First vaccine", "Jenner tests cowpox"], icon: "" },
        { texts: ["1885", "Rabies", "Pasteur protects a boy"], icon: "" },
        { texts: ["1955", "Polio vaccine", "Salk's shot ends epidemics"], icon: "" },
        { texts: ["2020", "mRNA vaccines", "Instructions train the body"], icon: "" },
      ];
      const { measured, formula } = await measureVariant("timeline", "camera", events);
      const t = timing(measured, formula);
      const gap = (t.starts![3]! - t.starts![0]!) / 3;
      expect(gap).toBeGreaterThan(2.3); // the formula says 1.5
    },
    60000,
  );
});
