import { describe, expect, it } from "vitest";
import { AssetLibrary } from "@anim/registry";
import { outlineSystemPrompt, pictureList, pictureQuery, retrieveAssets, sceneKindOf, sceneSystemPrompt, systemPrompt } from "../src/index.js";

const lib = new AssetLibrary();

describe("the pictures a scene is offered", () => {
  it("shortlists the best matches first, then the hand-made art and everyday icons", () => {
    const list = retrieveAssets("how a Docker container is built and run on a server", lib, 12);
    const names = list.map((a) => a.name);
    expect(list.best).toBeGreaterThan(3);
    expect(list.best).toBeLessThanOrEqual(12);
    expect(names.slice(0, list.best)).toContain("brand-docker");
    // Always there: hand-made pictures (with their parts) and everyday icons.
    expect(names).toContain("cell.plant");
    expect(names).toContain("users");
    // Nothing twice.
    expect(new Set(names).size).toBe(names.length);
  });

  it("adds the core technology icons for the tech domain only", () => {
    const tech = retrieveAssets("what a toaster does", lib, 5, "tech").map((a) => a.name);
    const general = retrieveAssets("what a toaster does", lib, 5).map((a) => a.name);
    expect(tech).toContain("load-balancer");
    expect(general).not.toContain("load-balancer");
  });

  it("keeps one family from filling the list", () => {
    const names = retrieveAssets("http get post put delete patch head options requests", lib, 30).slice(0, 30).map((a) => a.name);
    expect(names.filter((n) => n.startsWith("http-")).length).toBeLessThanOrEqual(4);
  });

  it("searches by the scene's own words, not only the topic", () => {
    const q = pictureQuery("how the web works", 'scene dns "Finding the server" template=steps\n# shape: sequence · goal: a DNS lookup turns a domain name into an address');
    const names = retrieveAssets(q, lib, 10).slice(0, 10).map((a) => a.name);
    expect(names).toContain("world-www");
  });
});

describe("the prompt tells the model how to choose", () => {
  const kind = sceneKindOf('scene run "Running it" template=steps');
  const scene = sceneSystemPrompt(kind, retrieveAssets("a Docker container on a server", lib, 20, "tech"), false);

  it("explains how to choose, and lists the best matches with what each shows", () => {
    expect(scene).toContain("Choose each picture by what it means");
    expect(scene).toContain("never an invented name");
    expect(scene).toContain("Best matches for this scene, most relevant first");
    expect(scene).toMatch(/\n {2}brand-docker — Docker logo, [^\n]+\n/);
    // What people call a picture comes before its stock tags: a container is a Docker container here, not a shipping one.
    expect(scene).toMatch(/\n {2}container — docker container, /);
  });

  it("still lists the illustrations with their parts and the other icons by name", () => {
    expect(scene).toContain("Illustrations, written asset:<name> (parts in brackets): ");
    expect(scene).toContain("leaf(blade,vein,stem)");
    expect(scene).toMatch(/More icons, written icon:<name>: .*\busers\b/);
  });

  it("is shorter than offering the whole library", () => {
    const all = pictureList(lib.all());
    expect(scene.length).toBeLessThan(all.length);
    expect(all).toContain("Icons, written icon:<name>: ");
  });

  it("gives the one-call prompt a list that matches the topic", () => {
    const single = systemPrompt(retrieveAssets("how Kubernetes schedules pods onto servers", lib, 40, "tech"));
    expect(single).toContain("Best matches for this scene");
    expect(single).toContain("container");
  });

  it("tells the planner that technology can be pictured", () => {
    const outline = outlineSystemPrompt(lib.all(), "tech");
    expect(outline).toContain("servers, databases, networks, security");
    expect(outline).toContain("the logos of common products");
  });
});
