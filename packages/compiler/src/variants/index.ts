import type { VariantLayout } from "./api.js";
import { cardsArch } from "./cards-arch.js";

export type { VariantContext, VariantLayout } from "./api.js";

/**
 * Layout variants from the authoring pipeline, keyed `<template>:<name>`.
 * `pnpm variant new` adds an import and an entry; the registry's
 * EXTRA_VARIANTS says whether each is a draft or approved.
 */
export const VARIANT_PLUGINS: Record<string, VariantLayout> = {
  // plugin entries
  "cards:arch": cardsArch,
};
