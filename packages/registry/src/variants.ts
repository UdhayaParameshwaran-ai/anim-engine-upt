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
}

export const EXTRA_VARIANTS: ExtraVariant[] = [
  // variant entries (kept in this format; `pnpm variant` edits it)
  { template: "steps", name: "arch", summary: "steps rising along an arch that peaks in the middle", status: "approved" },
];
