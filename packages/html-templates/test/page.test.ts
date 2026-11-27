import { describe, expect, it } from "vitest";
import { motionSet, motionVariant, pageData, keepUnitSpace, parseValue, STEPS, timing, templateUrl, warpTime, quietLeads } from "../src/index.js";

describe("warpTime: scene time to the page's own time", () => {
  // Three items cued at 2s, 5s and 6s of the scene; the page shows them at its own 1s, 3s and 4s.
  const cues = [2, 5, 6];
  const starts = [1, 3, 4];

  it("is the identity when the page has no start times", () => {
    for (const t of [0, 0.5, 3.3, 100]) expect(warpTime(t, cues, null)).toBe(t);
  });

  it("before the first cue the page opens at its own speed and waits just before its first item, which lands on its cue", () => {
    expect(warpTime(0, cues, starts)).toBe(0);
    expect(warpTime(0.3, cues, starts)).toBeCloseTo(0.3, 10); // the heading and the frame play from the scene's start
    expect(warpTime(1.2, cues, starts)).toBeCloseTo(0.7, 10); // held at the end of the page's opening, shortly before the first item (it starts at 1s)
    expect(warpTime(1.4, cues, starts)).toBeCloseTo(0.7, 10);
    expect(warpTime(1.8, cues, starts)).toBeCloseTo(0.8, 10); // the last 0.3s run into the first item
    expect(warpTime(2, cues, starts)).toBe(1); // the cue lands on the item's start
    // Never before the page's beginning.
    expect(warpTime(-3, cues, starts)).toBe(0);
  });

  it("a cue earlier than the page's own item start shifts the page forward, so the item still lands on its cue", () => {
    expect(warpTime(1, [1], [3])).toBe(3);
    expect(warpTime(0.5, [1], [3])).toBeCloseTo(2.5, 10);
    expect(warpTime(0, [1], [3])).toBeCloseTo(2, 10);
  });

  it("is never blank for a long first sentence: the page is past its opening well before the first cue", () => {
    // The first item is spoken at 6s, the page shows it at 1.1s: at 2s the page waits at the end of its opening (0.8s: heading and frame
    // up), not still at 0.
    expect(warpTime(2, [6], [1.1])).toBeCloseTo(0.8, 10);
    expect(warpTime(0.3, [6], [1.1])).toBeCloseTo(0.3, 10);
    expect(warpTime(6, [6], [1.1])).toBeCloseTo(1.1, 10);
  });

  it("a page whose first item starts within its opening (every chart) waits with its heading and frame up, never at a blank frame 0", () => {
    // A bar chart starts its first bar at 0.25s; the narration names it at 5s. The page must wait with its heading up (a first item is
    // taken to start no earlier than 0.3s, the heading's time), at 0.28s, not at 0.
    expect(warpTime(1, [5], [0.25])).toBeCloseTo(0.28, 10);
    expect(warpTime(4, [5], [0.25])).toBeCloseTo(0.28, 10);
    expect(warpTime(5, [5], [0.25])).toBeCloseTo(0.3, 10);
    expect(warpTime(2, [5], [0.05])).toBeCloseTo(0.28, 10);
    // A page that starts later keeps its run-in: item at 2.65s, waits 0.6s before it.
    expect(warpTime(1, [6], [2.65])).toBeCloseTo(1, 10);
    expect(warpTime(4, [6], [2.65])).toBeCloseTo(2.05, 10);
    expect(warpTime(6, [6], [2.65])).toBeCloseTo(2.65, 10);
  });

  it("between cues the page plays at its own speed, waits, then runs into the next item so that it lands on its cue", () => {
    // Item 1 is cued at 2s (page 1s), item 2 at 5s (page 3s): the page's 2s of motion is not stretched over 3s.
    expect(warpTime(2.5, cues, starts)).toBeCloseTo(1.5, 10); // plays right after the cue, at its own speed
    expect(warpTime(3.4, cues, starts)).toBeCloseTo(2.4, 10); // reaches the moment 0.6s before the next item
    expect(warpTime(3.9, cues, starts)).toBeCloseTo(2.4, 10); // waits there
    expect(warpTime(4.4, cues, starts)).toBeCloseTo(2.4, 10);
    expect(warpTime(4.7, cues, starts)).toBeCloseTo(2.7, 10); // then runs into the item
    expect(warpTime(5, cues, starts)).toBeCloseTo(3, 10); // the next item lands on its cue
    // 5s..6s is as long as the page's gap (3s..4s): played as is.
    expect(warpTime(5.5, cues, starts)).toBeCloseTo(3.5, 10);
    expect(warpTime(6, cues, starts)).toBeCloseTo(4, 10);
  });

  it("is never slow motion: however long the narration waits between items, the page never runs slower than its own speed by playing, only by waiting", () => {
    // 15s between two items that are 2.5s apart on the page (the dolly pan): 2.5s of motion and 12.5s of waiting.
    const gapCues = [3.5, 18.5], gapStarts = [0.7, 3.2];
    let moving = 0;
    for (let t = 3.5; t < 18.5; t += 0.01) {
      const d = warpTime(t + 0.01, gapCues, gapStarts) - warpTime(t, gapCues, gapStarts);
      expect(d).toBeLessThanOrEqual(0.01 + 1e-9); // never faster than its own speed here
      if (d > 0.005) moving += 0.01;
    }
    expect(moving).toBeCloseTo(2.5, 1);
    // The motion plays at 1x, not 1/6x: one second after the cue the page is one second further on.
    expect(warpTime(4.5, gapCues, gapStarts) - warpTime(3.5, gapCues, gapStarts)).toBeCloseTo(1, 10);
  });

  it("squeezes the page only when the narration is quicker than it (slope > 1)", () => {
    expect(warpTime(2.5, [2, 3], [1, 5])).toBeCloseTo(3, 10);
  });

  it("after the last cue has slope 1", () => {
    expect(warpTime(7, cues, starts)).toBeCloseTo(5, 10);
    expect(warpTime(106, cues, starts)).toBeCloseTo(104, 10);
  });

  it("is continuous and never decreases", () => {
    let prev = -Infinity;
    for (let t = 0; t <= 9; t += 0.05) {
      const w = warpTime(t, cues, starts);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = w;
    }
  });

  it("skips items whose cue is undefined (the script never shows them)", () => {
    // The second item is never shown: only the first and third make the curve.
    expect(warpTime(2, [2, undefined, 6], starts)).toBe(1);
    expect(warpTime(4, [2, undefined, 6], starts)).toBeCloseTo(3, 10); // 2s of play after the cue, then waiting for 6s/4s
    expect(warpTime(6, [2, undefined, 6], starts)).toBeCloseTo(4, 10);
    // Nothing shown at all: the page runs at its own speed.
    expect(warpTime(3, [undefined, undefined, undefined], starts)).toBe(3);
    expect(warpTime(3, [], starts)).toBe(3);
  });

  it("ignores cues that would make the page stand still or go back", () => {
    // Two items cued together (a single sentence showing both): the second adds nothing to the curve.
    expect(warpTime(4, [2, 2, 6], [1, 3, 4])).toBeCloseTo(3, 10);
    // An item the page shows no later than the one before it is dropped too.
    expect(warpTime(6, [2, 4, 6], [1, 1, 4])).toBeCloseTo(4, 10);
  });
});

describe("pageData: what the designer's page reads", () => {
  const set = STEPS;

  it("gives the steps page its fixed settings, the heading and the items", () => {
    const data = pageData(set, {
      heading: "From seed to tree",
      items: [
        { title: "Water", detail: "Moisture wakes the seed", icon: "droplet", kind: "icon" },
        { title: "Sprout", detail: "A root goes down", icon: "sprout" },
      ],
    });
    expect(data).toEqual({
      pace: "normal",
      motion: "default",
      order: "forward",
      kicker: "",
      heading: "From seed to tree",
      items: [
        { title: "Water", detail: "Moisture wakes the seed", icon: "droplet" },
        { title: "Sprout", detail: "A root goes down", icon: "sprout" },
      ],
    });
  });

  it("falls back to a star for an item with no icon (a card, a placeholder) and drops the kind", () => {
    const data = pageData(set, { heading: "", items: [{ title: "Wall", detail: "", icon: "", kind: "card" }] }) as { items: Record<string, unknown>[] };
    expect(data.items).toEqual([{ title: "Wall", detail: "", icon: "star" }]);
  });

  it("reads the set by its kind, not its name: the heading and the steps items for a steps-kind set", () => {
    const other = { ...set, template: "other" };
    expect(pageData(other, { heading: "H", items: [{ texts: ["A", "B"], icon: "sun" }] })).toMatchObject({ heading: "H", items: [{ title: "A", detail: "B", icon: "sun" }] });
  });
});

describe("the steps set", () => {
  it("names its variants, and falls back to the default for an unknown one", () => {
    expect(motionSet("steps")).toBe(STEPS);
    expect(motionSet("nothing")).toBeUndefined();
    expect(STEPS.variants.map((v) => v.id)).toEqual(["rail", "deck", "accordion", "path", "stack", "domino", "orbit", "dolly", "morph"]);
    expect(motionVariant(STEPS, "deck").id).toBe("deck");
    expect(motionVariant(STEPS, "zigzag").id).toBe("rail");
    expect(motionVariant(STEPS, undefined).id).toBe("rail");
  });

  it("builds the page url under a base, with the theme", () => {
    const rail = motionVariant(STEPS, "rail");
    expect(templateUrl("https://tpl.anim.local/", STEPS, rail, "daylight-clean")).toBe("https://tpl.anim.local/phase1/process-steps-motion/v3-number-rail.html?embed&paused&theme=daylight-clean");
  });

  it("has measured limits for every variant, and item ranges inside 2 to 6", () => {
    for (const v of STEPS.variants) {
      expect(v.titleChars, v.id).toBeGreaterThan(0);
      expect(v.detailChars, v.id).toBeGreaterThan(0);
      expect(v.items[0], v.id).toBeGreaterThanOrEqual(2);
      expect(v.items[1], v.id).toBeLessThanOrEqual(6);
    }
  });
});

describe("parseValue keeps the space before a word unit", () => {
  it("'6 requests' stays two words; symbols and short units join the number as before", () => {
    expect(parseValue("6 requests")).toEqual({ prefix: "", value: "6", suffix: " requests" });
    expect(parseValue("12 ms")).toEqual({ prefix: "", value: "12", suffix: " ms" });
    expect(parseValue("$12.5k")).toEqual({ prefix: "$", value: "12.5", suffix: "k" });
    expect(parseValue("45%")).toEqual({ prefix: "", value: "45", suffix: "%" });
    expect(parseValue("21k")).toEqual({ prefix: "", value: "21", suffix: "k" });
    expect(parseValue("1,200 users")).toEqual({ prefix: "", value: "1200", suffix: " users" });
    expect(parseValue("3")).toEqual({ prefix: "", value: "3", suffix: "" });
  });
});

describe("keepUnitSpace: a chart value's word unit keeps its space through the designer's parser", () => {
  // The chart kit's own parse, copied from designer/phase1/charts/chart-kit.js.
  const kit = (s: string) => {
    const m = /^\s*([^\d\-.]*)(-?[\d.,]+)\s*(.*)$/.exec(s)!;
    return `${m[1]}${m[2]}${m[3]}`;
  };

  it("a space before a word is kept, and nothing else changes", () => {
    expect(kit("6 requests")).toBe("6requests");
    expect(kit(keepUnitSpace("6 requests"))).toBe("6​ requests");
    expect(keepUnitSpace("$42k")).toBe("$42k");
    expect(keepUnitSpace("45%")).toBe("45%");
    expect(keepUnitSpace("12.5 ms")).toBe("12.5​ ms");
    expect(keepUnitSpace("1,200 users")).toBe("1,200​ users");
    expect(keepUnitSpace("7")).toBe("7");
  });

  it("is what a chart item's value goes through", () => {
    expect(pageData(motionSet("chart")!, { heading: "", items: [{ texts: ["t = 0", "6 requests"], icon: "" }] })).toMatchObject({ items: [{ title: "t = 0", detail: "6​ requests" }] });
  });
});

describe("timing: when each item really arrives, from what the page was measured to do", () => {
  const m = (appear: number, landed = appear + 0.1) => ({ first: { appear, landed }, last: { appear, landed } });

  it("starts an item a little before it is half visible, and keeps how long it takes", () => {
    const t = timing([m(1.1, 1.4), m(3.6, 3.7)], [0.7, 3.2]);
    expect(t.starts![0]).toBeCloseTo(0.85, 10);
    expect(t.starts![1]).toBeCloseTo(3.35, 10);
    expect(t.spans![0]).toBeCloseTo(0.55, 10);
  });

  it("falls back to the designer's formula when nothing could be followed", () => {
    expect(timing(null, [0.7, 3.2])).toEqual({ starts: [0.7, 3.2], spans: null, leads: null });
    expect(timing([null, null], [0.7, 3.2])).toEqual({ starts: [0.7, 3.2], spans: null, leads: null });
    expect(timing(null, null)).toEqual({ starts: null, spans: null, leads: null });
  });

  it("uses the later string when the earlier ones are there at once (a flip card: front shown for every item, the answer on its back later)", () => {
    const flip = [
      { first: { appear: 0.3, landed: 0.4 }, last: { appear: 1.8, landed: 2.0 } },
      { first: { appear: 0.3, landed: 0.4 }, last: { appear: 4.3, landed: 4.5 } },
      { first: { appear: 0.4, landed: 0.5 }, last: { appear: 6.8, landed: 7.0 } },
    ];
    const t = timing(flip, null);
    expect(t.starts!.map((x) => Math.round(x * 10) / 10)).toEqual([1.6, 4.1, 6.6]);
  });

  it("drops an item found out of order (a number on a ruler) and fills it in evenly from its neighbours", () => {
    const t = timing([m(1.4), m(4.1), m(3.8), m(9.4)], null);
    // 3.8 comes before 4.1: dropped; items 0, 1 and 3 are known: 1.4, 4.1, 9.4 -> item 2 sits half-way between 4.1 and 9.4.
    expect(t.starts![2]! + 0.25).toBeCloseTo(6.75, 10);
    expect(t.starts!.every((x, i, a) => i === 0 || x > a[i - 1]!)).toBe(true);
  });

  it("fills in items that could not be followed, after the last one measured and before the first", () => {
    const t = timing([null, m(3), m(5.5), null], null);
    expect(t.starts!.map((x) => x + 0.25)).toEqual([0.5, 3, 5.5, 8]);
  });
});

describe("warpTime for pages whose items overlap", () => {
  it("items that start less than a second apart (a bar chart) are not shown one by one: the page plays once from the first cue", () => {
    const cues = [6, 18, 30, 41];
    const starts = [0.3, 0.5, 0.7, 0.9]; // bars 0.2s apart
    const spans = [0.35, 0.35, 0.35, 0.35];
    expect(warpTime(6, cues, starts, spans)).toBeCloseTo(0.3, 10);
    // From the first cue it plays at its own speed and never waits for the later cues.
    expect(warpTime(7, cues, starts, spans)).toBeCloseTo(1.3, 10);
    expect(warpTime(20, cues, starts, spans)).toBeCloseTo(14.3, 10);
    // Before the first cue it only shows its opening.
    expect(warpTime(2, cues, starts, spans)).toBeLessThanOrEqual(0.3);
  });

  it("items 2.5 seconds apart are shown one by one", () => {
    const cues = [6, 18, 30];
    const starts = [0.9, 3.4, 5.9];
    const spans = [0.35, 0.35, 0.35];
    expect(warpTime(18, cues, starts, spans)).toBeCloseTo(3.4, 10);
    expect(warpTime(12, cues, starts, spans)).toBeLessThan(3);
  });
});

describe("the options a scene can ask of a page", () => {
  const items = [
    { id: "s1", texts: ["Q1", "12k", ""], icon: "user" },
    { id: "s2", texts: ["Q2", "21k", "+75% vs Q1"], icon: "user" },
  ];

  it("pace goes to every page that has one, and defaults to normal", () => {
    for (const name of ["steps", "compare", "timeline", "stats", "chart", "ui", "title"]) {
      const set = motionSet(name)!;
      const base = pageData(set, { heading: "H", items }) as { pace: string };
      const fast = pageData(set, { heading: "H", items, options: { pace: "snappy" } }) as { pace: string };
      expect([name, base.pace]).toEqual([name, "normal"]);
      expect([name, fast.pace]).toEqual([name, "snappy"]);
    }
  });

  it("a kicker slot becomes the page's kicker, in every set", () => {
    for (const name of ["steps", "compare", "timeline", "stats", "chart", "ui", "title"]) {
      const d = pageData(motionSet(name)!, { heading: "H", items, named: { kicker: ["How it works"] } }) as { kicker: string };
      expect([name, d.kicker]).toEqual([name, "How it works"]);
    }
    expect((pageData(motionSet("steps")!, { heading: "H", items }) as { kicker: string }).kicker).toBe("");
  });

  it("stats: the last stat glows unless highlight names another", () => {
    const glow = (options?: { highlight?: string }) => (pageData(motionSet("stats")!, { heading: "H", items, ...(options && { options }) }) as { items: { highlight: boolean }[] }).items.map((i) => i.highlight);
    expect(glow()).toEqual([false, true]);
    expect(glow({ highlight: "s1" })).toEqual([true, false]);
  });

  it("title: bg reaches the page, and the page never plays an exit of its own", () => {
    const d = pageData(motionSet("title")!, { heading: "H", items: [], options: { bg: "deep" } }) as { bg: string; playout: boolean };
    expect([d.bg, d.playout]).toEqual(["deep", false]);
    const plain = pageData(motionSet("title")!, { heading: "H", items: [] }) as { bg: string; playout: boolean };
    expect([plain.bg, plain.playout]).toEqual(["auto", false]);
  });

  it("stats: what the numbers measure (metric, yaxis, xaxis) reaches the page; empty when not written", () => {
    const items = [{ texts: ["Q1", "12k"], icon: "user" }, { texts: ["Q2", "21k", "+75% vs Q1"], icon: "user" }];
    const d = pageData(motionSet("stats")!, { heading: "H", items, named: { metric: ["Users per quarter"], yaxis: ["Users (thousands)"], xaxis: ["Quarter"] } }) as { metric: string; yAxis: string; xAxis: string };
    expect([d.metric, d.yAxis, d.xAxis]).toEqual(["Users per quarter", "Users (thousands)", "Quarter"]);
    const none = pageData(motionSet("stats")!, { heading: "H", items }) as { metric: string; yAxis: string; xAxis: string };
    expect([none.metric, none.yAxis, none.xAxis]).toEqual(["", "", ""]);
  });

  it("a timeline event's fourth string is a figure that counts up, or a line of text; the fifth is its caption", () => {
    const ev = (texts: string[]) => (pageData(motionSet("timeline")!, { heading: "H", items: [{ texts, icon: "" }] }) as { items: { media?: unknown }[] }).items[0]!.media;
    expect(ev(["2022", "Launch", "Doors open"])).toBeUndefined();
    expect(ev(["2022", "Launch", "Doors open", "10,000+ teams", "joined in a month"])).toEqual({ kind: "stat", value: 10000, prefix: "", suffix: "+ teams", label: "joined in a month" });
    expect(ev(["2022", "Launch", "Doors open", "$1.5M raised"])).toMatchObject({ kind: "stat", value: 1.5, prefix: "$", suffix: "M raised" });
    expect(ev(["2022", "Launch", "Doors open", "Cowpox, not smallpox", "the idea"])).toEqual({ kind: "text", text: "Cowpox, not smallpox", label: "the idea" });
  });
});

describe("warpTime: a page without items plays at its own speed", () => {
  it("a title has no cues: the page time is the scene time, and the page never leaves by itself", () => {
    for (const t of [0, 3, 9, 17]) expect(warpTime(t, [], null)).toBe(t);
  });
});

describe("held in a quiet moment, never half way through a motion", () => {
  // A page that walks a traveller to each item: still from 0.7s after an item until the walk, which takes about a second and arrives at the next one.
  const step = 0.1;
  const activity = (starts: number[], walk = 1.0) =>
    Array.from({ length: 140 }, (_, i) => {
      const t = i * step;
      const moving = t < 0.9 || starts.some((s, k) => (k > 0 && t > s - walk - 0.1 && t <= s + 0.5) || (k === 0 && t <= s + 0.5));
      return moving ? 600 : 14;
    });

  it("finds the quiet moment before each item: the lead covers the whole walk", () => {
    const starts = [1, 3.5, 6, 8.5];
    const leads = quietLeads(activity(starts), step, starts);
    for (const l of leads.slice(1)) expect(l!).toBeGreaterThan(1.0);
    for (const l of leads.slice(1)) expect(l!).toBeLessThan(2);
  });

  it("falls back to the default when the page is never quiet, or nothing was measured", () => {
    const starts = [1, 3.5, 6];
    expect(quietLeads(Array(140).fill(500), step, starts)).toEqual([undefined, undefined, undefined]);
    expect(quietLeads(undefined, step, starts)).toEqual([undefined, undefined, undefined]);
  });

  it("warpTime holds at the end of the quiet moment and runs the walk at its own speed into the cue", () => {
    const starts = [1, 3.5];
    const cues = [2, 8];
    const leads = [undefined, 1.25];
    // after the first cue the page plays on at its own speed until 1.25s before the second item (page time 2.25), then waits there
    expect(warpTime(2.5, cues, starts, null, leads)).toBeCloseTo(1.5, 10);
    expect(warpTime(3.25, cues, starts, null, leads)).toBeCloseTo(2.25, 10);
    expect(warpTime(5, cues, starts, null, leads)).toBeCloseTo(2.25, 10);
    expect(warpTime(6.7, cues, starts, null, leads)).toBeCloseTo(2.25, 10);
    // the walk then plays at its own speed and the item lands on its cue
    expect(warpTime(7.4, cues, starts, null, leads)).toBeCloseTo(2.9, 10);
    expect(warpTime(8, cues, starts, null, leads)).toBeCloseTo(3.5, 10);
    // without leads it is the default 0.6s
    expect(warpTime(5, cues, starts)).toBeCloseTo(2.9, 10);
  });
});
