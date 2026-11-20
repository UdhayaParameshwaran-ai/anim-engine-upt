/**
 * The person's picks in the Studio's menus (provider, subject area, length, video shape, voice, speed…), kept in
 * this browser so a reload doesn't reset them. The prompt settings have their own store (prompts.ts); these are the
 * plain menus around them.
 */
export interface Choices {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  /** Puts the saved value back into `control` when it is still one of its choices; true when it did. */
  restore(control: HTMLSelectElement | HTMLInputElement, name: string): boolean;
  /** Saves `control`'s value whenever the person changes it. */
  keep(control: HTMLSelectElement | HTMLInputElement, name: string): void;
}

export function choices(key = "studio.choices"): Choices {
  const read = (): Record<string, string> => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? "{}");
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  };
  const write = (v: Record<string, string>) => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* private window or storage blocked: the picks just last for this page */
    }
  };
  const store: Choices = {
    get: (name) => read()[name],
    set: (name, value) => write({ ...read(), [name]: value }),
    restore(control, name) {
      const v = read()[name];
      if (typeof v !== "string") return false;
      // A menu only takes a value it still offers (a provider whose key was removed is disabled).
      if (control instanceof HTMLSelectElement) {
        const option = [...control.options].find((o) => o.value === v);
        if (!option || option.disabled) return false;
      } else if (control.type === "number" && !Number.isFinite(Number(v))) {
        return false;
      }
      control.value = v;
      return true;
    },
    keep(control, name) {
      control.addEventListener("change", () => store.set(name, control.value));
    },
  };
  return store;
}
