import { describe, expect, it } from "vitest";
import { AssetLibrary, SEED_ASSETS, iconSet, stem, tokens } from "../src/index.js";
import { TECH_SYNONYMS } from "../src/tech-synonyms.js";
// @ts-expect-error plain data module shared with scripts/eval-icons.mjs
import { FRESH, GOLDEN, HELD_OUT } from "../../../scripts/icon-eval-sets.mjs";

const lib = new AssetLibrary();
type Case = [string, string[]];

/** Share of concepts with a right icon among the first `k` hits. */
function recall(cases: Case[], k: number): number {
  const ok = cases.filter(([q, wanted]) => lib.search(q, { kind: "icon", limit: k }).some((h) => wanted.includes(h.asset.name)));
  return ok.length / cases.length;
}

describe("the library", () => {
  it("holds the Lucide and Tabler icons, with the hand-made ones on top", () => {
    const sets = new Set(SEED_ASSETS.map((a) => iconSet(a) ?? "hand-made"));
    expect([...sets].sort()).toEqual(["hand-made", "lucide", "tabler"]);
    expect(SEED_ASSETS.filter((a) => a.kind === "icon").length).toBeGreaterThan(1000);
    // Lucide's picture stays where both sets draw the same name; Tabler's tags are added to it.
    const server = lib.all().find((a) => a.name === "server")!;
    expect(iconSet(server)).toBeUndefined();
    expect(server.tags).toContain("hosting");
  });

  it("has no two entries with one name, and every entry says what it shows", () => {
    const names = SEED_ASSETS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const a of SEED_ASSETS) expect(a.description.length, a.name).toBeGreaterThan(0);
  });

  it("only gives synonyms to icons that exist", () => {
    const names = new Set(SEED_ASSETS.map((a) => a.name));
    expect(Object.keys(TECH_SYNONYMS).filter((k) => !names.has(k))).toEqual([]);
  });

  it("finds a brand by its bare name", () => {
    expect(lib.resolve("icon", "docker")?.manifest.name).toBe("brand-docker");
    expect(lib.resolve("icon", "github")?.manifest.name).toBe("brand-github");
    expect(lib.resolve("icon", "brand-python")?.via).toBe("exact");
  });
});

describe("search", () => {
  it("stems plurals and splits compound words", () => {
    expect(stem("databases")).toBe("database");
    expect(stem("proxies")).toBe("proxy");
    expect(stem("class")).toBe("class");
    expect(tokens("Load-balancer for the web servers")).toEqual(["load", "balancer", "web", "server"]);
  });

  it("puts the whole-name match first and the specific logo above a generic icon", () => {
    expect(lib.search("a load balancer spreading traffic", { kind: "icon", limit: 1 })[0]!.asset.name).toBe("load-balancer");
    expect(lib.search("the Docker container", { kind: "icon", limit: 2 }).map((h) => h.asset.name)).toContain("brand-docker");
  });

  it("finds a picture by a phrase people say for it", () => {
    expect(lib.search("a GET request", { limit: 1 })[0]!.asset.name).toBe("http-get");
    expect(lib.search("a code review before merging", { kind: "icon", limit: 3 }).map((h) => h.asset.name)).toContain("git-pull-request");
    // The words of a phrase must come together: "request" and "get" apart are not "get request".
    const apart = lib.search("they request it and then you get a reply", { kind: "icon", limit: 3 }).map((h) => h.asset.name);
    expect(apart).not.toContain("http-get");
  });

  it("ranks one word of a longer name below the picture that is about the word", () => {
    const names = lib.search("a push notification to the phone", { kind: "icon", limit: 5 }).map((h) => h.asset.name);
    expect(names).toContain("bell");
    expect(names.indexOf("bell")).toBeLessThan(names.indexOf("stack-push") === -1 ? 99 : names.indexOf("stack-push"));
  });

  it("returns nothing for words that mean nothing and respects minScore and limit", () => {
    expect(lib.search("the and a of")).toEqual([]);
    expect(lib.search("database", { kind: "icon", limit: 3 })).toHaveLength(3);
    expect(lib.search("database", { minScore: 1e9 })).toEqual([]);
    expect(lib.search("database", { kind: "asset" }).every((h) => h.asset.kind === "asset")).toBe(true);
  });
});

// The sets live in scripts/icon-eval-sets.mjs. The floors are a little under what they scored when written,
// so a change that makes finding pictures worse fails here; raise a floor when the search gets better.
describe("finding pictures for technology topics", () => {
  it("golden concepts (tuned against): a right icon in the top 5 for nearly all", () => {
    expect(recall(GOLDEN as Case[], 5)).toBeGreaterThanOrEqual(0.95);
  });

  it("held-out concepts: a right icon in the top 5 for nearly all", () => {
    expect(recall(HELD_OUT as Case[], 5)).toBeGreaterThanOrEqual(0.95);
  });

  it("fresh concepts (never tuned against): the right icon is among the 30 shown to the model for most", () => {
    expect(recall(FRESH as Case[], 30)).toBeGreaterThanOrEqual(0.88);
    expect(recall(FRESH as Case[], 5)).toBeGreaterThanOrEqual(0.78);
  });
});
