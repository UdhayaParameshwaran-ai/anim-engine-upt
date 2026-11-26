/**
 * Layout variants added through the authoring pipeline (`pnpm variant`).
 * Each one is a plugin in packages/compiler/src/variants/. A draft is only
 * usable when drafts are allowed explicitly (the stress checker does);
 * `pnpm variant approve` flips it to approved after a person reviewed its
 * report, and from then on templates offer it like a built-in variant.
 */
export interface ExtraVariant {
  template: string;
  name: string;
  summary: string;
  status: "draft" | "approved";
  /** Item counts it lays out cleanly (inclusive), like a built-in variant's card; unset means the template's own range. */
  items?: readonly [number, number];
}

export const EXTRA_VARIANTS: ExtraVariant[] = [
  // variant entries (kept in this format; `pnpm variant` edits it)
  { template: "cards", name: "arch", summary: "cards rising along an arch that peaks in the middle", status: "approved", items: [3, 6] },
];
