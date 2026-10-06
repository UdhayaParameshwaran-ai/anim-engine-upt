/**
 * Built-in artwork for the seed semantic library. Plain SVG markup:
 * strokes use currentColor, `data-fill="<token>"` marks theme-colored fills,
 * `data-part="<name>"` marks parts addressable from the DSL (`left.wall`).
 * Icons use a 24×24 grid, illustrations 200×200.
 */

export const ICONS: Record<string, string> = {
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>`,
  droplet: `<path d="M12 2.7C12 2.7 5.5 9.6 5.5 14.2a6.5 6.5 0 0 0 13 0C18.5 9.6 12 2.7 12 2.7z" data-fill="accent"/>`,
  wind: `<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7"/>`,
  cube: `<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>`,
  bolt: `<path d="M13 2L4 14h7l-1 8 10-13h-7z" data-fill="accent"/>`,
  server: `<rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/><path d="M7 6.5h.01M7 17.5h.01"/>`,
  user: `<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`,
  database: `<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14a8 3 0 0 0 16 0V5M4 12a8 3 0 0 0 16 0"/>`,
  cloud: `<path d="M7 18h10a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6 9.5 4.25 4.25 0 0 0 7 18z"/>`,
  flame: `<path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 0 2 1 3 2.5 3.5C11 9 11 5 12 2z" data-fill="warn"/>`,
  heart: `<path d="M12 20.5S3 15 3 8.8a4.8 4.8 0 0 1 9-2.6 4.8 4.8 0 0 1 9 2.6c0 6.2-9 11.7-9 11.7z" data-fill="warn"/>`,
  check: `<path d="M4 12.5l5 5L20 6.5"/>`,
  cross: `<path d="M6 6l12 12M18 6L6 18"/>`,
  lightbulb: `<path d="M9 18h6M10 21.5h4M12 2.5a6.5 6.5 0 0 0-4 11.6c.7.6 1 1.4 1 2.4V18h6v-1.5c0-1 .3-1.8 1-2.4A6.5 6.5 0 0 0 12 2.5z"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  gear: `<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>`,
};

export const ILLUSTRATIONS: Record<string, string> = {
  leaf: `
    <path data-part="blade" data-fill="good" d="M100 20C150 40 175 90 160 140c-10 30-40 45-60 45s-50-15-60-45C25 90 50 40 100 20z"/>
    <path data-part="vein" d="M100 40v135M100 80l30-20M100 80L70 60M100 115l40-20M100 115L60 95M100 150l30-15M100 150l-30-15"/>
    <path data-part="stem" d="M100 185v13"/>`,
  tree: `
    <path data-part="trunk" d="M90 195v-75h20v75"/>
    <path data-part="crown" data-fill="good" d="M100 20c35 0 60 25 60 55 0 28-25 50-60 50s-60-22-60-50c0-30 25-55 60-55z"/>
    <path data-part="roots" d="M90 195l-15 5M110 195l15 5"/>`,
  "cell.plant": `
    <rect data-part="wall" x="15" y="30" width="170" height="140" rx="18" stroke-width="2.2"/>
    <rect data-part="membrane" x="25" y="40" width="150" height="120" rx="12"/>
    <rect data-part="vacuole" data-fill="accent" x="105" y="58" width="60" height="74" rx="26"/>
    <circle data-part="nucleus" data-fill="muted" cx="68" cy="100" r="22"/>
    <g data-part="chloroplast">
      <ellipse data-fill="good" cx="55" cy="58" rx="14" ry="7"/>
      <ellipse data-fill="good" cx="62" cy="142" rx="14" ry="7"/>
      <ellipse data-fill="good" cx="140" cy="148" rx="14" ry="7"/>
    </g>`,
  "cell.animal": `
    <path data-part="membrane" d="M100 25c45 0 80 25 80 70s-30 80-80 80-80-30-78-78C24 50 55 25 100 25z"/>
    <circle data-part="nucleus" data-fill="muted" cx="95" cy="100" r="24"/>
    <g data-part="mitochondria">
      <ellipse data-fill="warn" cx="145" cy="80" rx="18" ry="9"/>
      <ellipse data-fill="warn" cx="60" cy="145" rx="18" ry="9"/>
      <path d="M131 80l5-4 5 8 5-8 5 8 5-4M46 145l5-4 5 8 5-8 5 8 5-4"/>
    </g>`,
  "heart.anatomy": `
    <path data-part="right-atrium" data-fill="accent" d="M100 60C90 35 55 30 45 55c-5 15 0 30 10 40h45z"/>
    <path data-part="left-atrium" data-fill="warn" d="M100 60c10-25 45-30 55-5 5 15 0 30-10 40h-45z"/>
    <path data-part="right-ventricle" data-fill="accent" d="M55 95h45v90C80 165 60 135 55 95z"/>
    <path data-part="left-ventricle" data-fill="warn" d="M145 95h-45v90c20-20 40-50 45-90z"/>
    <path data-part="valve" d="M70 95h20M110 95h20"/>`,
  earth: `
    <circle data-part="ocean" data-fill="accent" cx="100" cy="100" r="80"/>
    <path data-part="land" data-fill="good" d="M60 50c20-10 40 0 35 20s-25 15-30 35-20 10-25-5 5-40 20-50zM120 110c15-5 35 5 30 25s-25 30-40 20 0-40 10-45z"/>`,
};
