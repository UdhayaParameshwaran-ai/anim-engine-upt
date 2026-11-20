// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { choices } from "../src/choices.js";

describe("remembered menu choices", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <select id="length"><option value="">Auto</option><option value="short">Short</option><option value="long">Long</option></select>
      <select id="provider"><option value="auto">Auto</option><option value="gemini">Gemini</option><option value="claude" disabled>Claude</option></select>
      <input id="speed" type="number" value="1" />`;
  });
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const change = (el: HTMLElement) => el.dispatchEvent(new Event("change"));

  it("keeps a pick across a reload", () => {
    const length = $<HTMLSelectElement>("length");
    choices().keep(length, "length");
    length.value = "long";
    change(length);

    // A reload: fresh menus at their defaults, then restored.
    document.body.innerHTML = `<select id="length"><option value="">Auto</option><option value="long">Long</option></select>`;
    const again = $<HTMLSelectElement>("length");
    expect(again.value).toBe("");
    expect(choices().restore(again, "length")).toBe(true);
    expect(again.value).toBe("long");
  });

  it("only restores a value the menu still offers and allows", () => {
    const store = choices();
    const provider = $<HTMLSelectElement>("provider");
    store.set("provider", "claude"); // its key was removed: the option is disabled
    expect(store.restore(provider, "provider")).toBe(false);
    expect(provider.value).toBe("auto");
    store.set("provider", "gone");
    expect(store.restore(provider, "provider")).toBe(false);
    store.set("provider", "gemini");
    expect(store.restore(provider, "provider")).toBe(true);
    expect(provider.value).toBe("gemini");
  });

  it("remembers numbers, ignores what is not one, and starts empty", () => {
    const store = choices();
    const speed = $<HTMLInputElement>("speed");
    expect(store.restore(speed, "speed")).toBe(false);
    store.keep(speed, "speed");
    speed.value = "1.2";
    change(speed);
    speed.value = "1";
    expect(store.restore(speed, "speed")).toBe(true);
    expect(speed.value).toBe("1.2");
    store.set("speed", "fast");
    expect(store.restore(speed, "speed")).toBe(false);
  });

  it("survives a broken store", () => {
    localStorage.setItem("studio.choices", "{not json");
    const length = $<HTMLSelectElement>("length");
    expect(choices().restore(length, "length")).toBe(false);
    choices().set("length", "short");
    expect(choices().get("length")).toBe("short");
  });
});
