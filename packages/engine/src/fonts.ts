/**
 * Bundled fonts (Fontsource, SIL Open Font License). A face id like
 * "inter-700" names the latin woff2 file of a Fontsource package; hosts
 * serve `<base><package>/<file>` from node_modules/@fontsource/<package>/files.
 * Bundling the files (instead of relying on system fonts) keeps the live
 * preview and the MP4 identical on every machine.
 */
const FAMILIES: Record<string, string> = {
  inter: "Inter",
  "space-grotesk": "Space Grotesk",
  "archivo-black": "Archivo Black",
  nunito: "Nunito",
  poppins: "Poppins",
  "playfair-display": "Playfair Display",
  "dm-serif-display": "DM Serif Display",
  "jetbrains-mono": "JetBrains Mono",
  "patrick-hand": "Patrick Hand",
  caveat: "Caveat",
  "space-mono": "Space Mono",
};

export interface FontFace {
  family: string;
  weight: number;
  /** `<package>/<file>` relative to the font base URL. */
  path: string;
}

export function fontFace(id: string): FontFace | undefined {
  const m = /^(.+)-(\d{3})$/.exec(id);
  const family = m && FAMILIES[m[1]!];
  if (!m || !family) return undefined;
  return { family, weight: Number(m[2]), path: `${m[1]}/${m[1]}-latin-${m[2]}-normal.woff2` };
}

/** `@font-face` rules for the given face ids. */
export function fontFaceCss(ids: string[], base: string): string {
  return ids
    .map(fontFace)
    .filter((f): f is FontFace => !!f)
    .map((f) => `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:block;src:url("${base}${f.path}") format("woff2");}`)
    .join("\n");
}

/** Every font package the looks use (hosts serve these). */
export const FONT_PACKAGES = Object.keys(FAMILIES);
