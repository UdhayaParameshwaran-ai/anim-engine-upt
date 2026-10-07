import type { ElementDecl } from "@anim/dsl";
import type { Box } from "@anim/ir";

/**
 * What a layout variant plugin gets: the template's content area and items,
 * and the same safe placement helpers the built-in variants use. A plugin
 * only decides cells; put() fits each element into its cell, and the
 * engine's overlap/overflow checks still apply.
 */
export interface VariantContext {
  /** Content area (below the title band when the template has one). */
  area: Box;
  /** Spacing between cells, already adjusted for `density=`. */
  gap: number;
  /** Elements that fill the template's items, in order. */
  items: ElementDecl[];
  /** The element filling a named slot, if any. */
  slot(name: string): ElementDecl | undefined;
  /** Places an element centered in a cell, scaled/wrapped to fit. */
  put(e: ElementDecl, cell: Box, fill?: number): void;
  rowCells(area: Box, n: number, weights?: number[]): Box[];
  colCells(area: Box, n: number, weights?: number[]): Box[];
  gridCells(area: Box, n: number): Box[];
  /** Index (in `items`) of the element named by `emphasis=`, or -1. */
  emphasis: number;
}

export type VariantLayout = (c: VariantContext) => void;
