/**
 * Narration is written to be read on screen and then spoken. A voice reads what it is given letter by letter or number by number:
 * "1961" comes out as a cardinal, "a1f3c9e" and "https://x.io/a-b" as noise, "S3" and "CI/CD" wrongly. This turns the written text into
 * what a person would say, word by word, and keeps where every written word went, so the captions keep the writing and the cues keep
 * their words (speak.ts maps the voice's timings back onto the written words).
 *
 *   1961 -> nineteen sixty-one   $18M -> eighteen million dollars   60% -> sixty percent   2.5B -> two point five billion
 *   a1f3c9e -> A one F three C nine E   https://www.example.com/docs -> example dot com slash docs   S3 -> S three   CI/CD -> C I C D
 *
 * English only: another language is passed through unchanged.
 */

export interface SpokenText {
  /** What is sent to the voice. */
  text: string;
  /** For every word (run of non-space characters) of the written text, where it went in `text`. A word that is not spoken is empty. */
  words: { start: number; end: number; sStart: number; sEnd: number }[];
}

// ── numbers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", " thousand", " million", " billion", " trillion"];

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} hundred` : "", r ? below100(r) : ""].filter(Boolean).join(" ");
}

/** 1234 -> "one thousand two hundred thirty-four". Beyond a quadrillion the digits are read one by one. */
export function cardinal(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1e15) return digits(String(Math.max(0, Math.floor(n))));
  if (n === 0) return "zero";
  const parts: string[] = [];
  let rest = Math.floor(n);
  for (let i = 0; rest > 0; i++, rest = Math.floor(rest / 1000)) {
    const chunk = rest % 1000;
    if (chunk) parts.unshift(below1000(chunk) + SCALES[i]);
  }
  return parts.join(" ");
}

const ORD_IRREGULAR: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

/** 21 -> "twenty-first". */
export function ordinal(n: number): string {
  const words = cardinal(n);
  const m = /^(.*?)([a-z]+)$/.exec(words)!;
  const last = m[2]!;
  const head = m[1]!;
  const o = ORD_IRREGULAR[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return head + o;
}

/** "1957" -> "nineteen fifty-seven", "2007" -> "two thousand seven", "2020" -> "twenty twenty". */
export function yearWords(y: number): string {
  if (y >= 2000 && y <= 2009) return y === 2000 ? "two thousand" : `two thousand ${ONES[y - 2000]}`;
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  if (lo === 0) return `${cardinal(hi)} hundred`;
  if (lo < 10) return `${cardinal(hi)} oh ${ONES[lo]}`;
  return `${cardinal(hi)} ${below100(lo)}`;
}

/** Digit by digit: "404" -> "four zero four" (zero as "oh" for codes: "four oh four"). */
export function digits(s: string, zero = "zero"): string {
  return [...s].map((c) => (c === "0" ? zero : ONES[Number(c)] ?? c)).join(" ");
}

const pluralize = (word: string) => (word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`);
const spell = (s: string) => [...s].map((c) => (/[a-z]/i.test(c) ? c.toUpperCase() : /\d/.test(c) ? ONES[Number(c)]! : c)).join(" ");

// ── dictionaries ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Whole tokens (lower case, as written) with a fixed reading. */
const FIXED: Record<string, string> = {
  "e.g.": "for example", "e.g": "for example", "i.e.": "that is", "i.e": "that is", "etc.": "et cetera", "etc": "et cetera", "vs.": "versus", vs: "versus",
  "approx.": "approximately", "w/": "with", "w/o": "without", "&": "and", "+": "plus", "=": "equals", "->": "to", "=>": "to", "→": "to", "≈": "about", "~": "about",
  "×": "times", "<": "less than", ">": "more than", "≥": "at least", "≤": "at most", "#": "number", "@": "at",
  "24/7": "twenty-four seven", "and/or": "and or", "tcp/ip": "T C P I P", "ci/cd": "C I C D", "i/o": "I O", "—": "", "–": "", "-": "", "r&d": "R and D", "q&a": "Q and A", "a/b": "A B",
  json: "Jason", yaml: "yammel", yml: "Y M L", sql: "sequel", nosql: "no S Q L", mysql: "my S Q L", postgres: "post-gress", postgresql: "post-gress Q L", sqlite: "S Q lite",
  graphql: "graph Q L", grpc: "g R P C", oauth: "oh auth", nginx: "engine X", kubectl: "cube control", regex: "reg ex", ios: "i O S", macos: "mac O S", iot: "I o T",
  webrtc: "web R T C", devops: "dev ops", saas: "sass", paas: "pass", mrna: "m R N A", jpeg: "jay peg", jpg: "J P G", gif: "gif", wasm: "wazum", sudo: "sudo", k8s: "Kubernetes",
  i18n: "internationalization", a11y: "accessibility", wifi: "Wi-Fi", ok: "okay", "node.js": "Node J S", "vue.js": "view J S", "next.js": "next J S", "d3.js": "D three J S",
};

/** Capital-letter words that are read as words, not spelled. */
const CAPS_WORDS = new Set(["NASA", "NATO", "COVID", "UNIX", "LISP", "GNOME", "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "RAM", "ROM", "LAN", "WAN", "CRUD", "REST", "SOAP", "SCUBA", "LASER", "RADAR", "UNICEF", "OPEC", "PIN", "SIM", "ASCII", "AJAX", "BIOS", "NOT", "AND", "OR", "THE", "ALL", "NEW", "NOW", "YES", "NO", "OK", "STOP", "ON", "OFF", "IF", "IN", "IT", "IS", "AT", "TO", "BE", "BY", "SO", "UP", "DO", "NEVER", "ALWAYS", "WARNING", "NOTE", "TODO", "FAQ", "FREE", "BIG", "HOT", "COLD", "WIN", "GO"]);
// FAQ is a CAPS_WORDS entry only to stay "fack"; it is spelled by the line below.
CAPS_WORDS.delete("FAQ");

/** Lower-case acronyms that are spelled when written in lower case. */
const SPELLED_LOWER = new Set(["api", "apis", "url", "urls", "uri", "cpu", "gpu", "html", "css", "http", "https", "tcp", "udp", "dns", "ssh", "ssl", "tls", "cdn", "cli", "gui", "ui", "ux", "ai", "ml", "pdf", "csv", "xml", "jwt", "sdk", "ide", "vm", "vms", "vpn", "png", "gpt", "ip", "os", "ci", "cd", "id", "ids"]);

const MAGNITUDE: Record<string, [string, number]> = { k: ["thousand", 1e3], K: ["thousand", 1e3], M: ["million", 1e6], B: ["billion", 1e9], bn: ["billion", 1e9], T: ["trillion", 1e12] };

const UNITS: Record<string, string> = {
  kb: "kilobyte", mb: "megabyte", gb: "gigabyte", tb: "terabyte", pb: "petabyte", kbps: "kilobit per second", mbps: "megabit per second", gbps: "gigabit per second",
  ms: "millisecond", ns: "nanosecond", µs: "microsecond", km: "kilometer", kg: "kilogram", cm: "centimeter", mm: "millimeter", mph: "mile per hour", kph: "kilometer per hour",
  hz: "hertz", khz: "kilohertz", mhz: "megahertz", ghz: "gigahertz", px: "pixel", fps: "frame per second", rpm: "revolution per minute", mah: "milliamp hour", kwh: "kilowatt hour",
};
/** Units whose plural is not just "s". */
const UNIT_PLURAL: Record<string, string> = { "hertz": "hertz", "kilohertz": "kilohertz", "megahertz": "megahertz", "gigahertz": "gigahertz" };

const CURRENCY: Record<string, [string, string, string]> = { $: ["dollar", "dollars", "cents"], "€": ["euro", "euros", "cents"], "£": ["pound", "pounds", "pence"], "¥": ["yen", "yen", "sen"], "₹": ["rupee", "rupees", "paise"] };

const FILE_EXT: Record<string, string> = { js: "J S", ts: "T S", jsx: "J S X", tsx: "T S X", py: "P Y", rb: "R B", go: "go", rs: "R S", json: "Jason", yaml: "yammel", yml: "Y M L", html: "H T M L", css: "C S S", md: "M D", txt: "T X T", sh: "S H", sql: "sequel", csv: "C S V", xml: "X M L", pdf: "P D F", png: "P N G", jpg: "J P G", gif: "gif", env: "env", toml: "tommel", ini: "I N I" };

/** Words before a four-digit number that mark it as a year. */
const YEAR_CUES = new Set(["in", "by", "since", "until", "till", "from", "of", "around", "circa", "during", "before", "after", "between", "and", "to", "year", "late", "early", "mid", "through", "than", "that", "was", "were", "when"]);
/** Words before a three-digit number that mark it as a status or error code. */
const CODE_CUES = new Set(["status", "code", "error", "http", "response", "returns", "return", "gets", "get", "got", "codes"]);

// ── one word ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const NUM = /^([+\-−–]?)([$€£¥₹]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%|[A-Za-z°µ×]{1,5})?$/;

/** A number with its sign, currency, fraction and suffix, in words. */
function number(m: RegExpExecArray, prev: string): string {
  const sign = m[1]! === "+" ? "plus " : m[1]! ? "minus " : "";
  const cur = m[2]!;
  const raw = m[3]!.replace(/,/g, "");
  const frac = m[4];
  let suffix = m[5] ?? "";
  const n = Number(raw);
  const value = (): string => {
    if (frac !== undefined) return `${cardinal(n)} point ${digits(frac)}`;
    return cardinal(n);
  };
  const c = cur ? CURRENCY[cur]! : undefined;
  const money = (amount: string, scaled: boolean) => (c ? `${amount} ${scaled || n !== 1 || frac !== undefined ? c[1] : c[0]}` : amount);

  if (suffix === "%") return `${sign}${value()} percent`;
  if (suffix === "×" || suffix === "x" || suffix === "X") return `${sign}${value()} times`;
  const mag = MAGNITUDE[suffix];
  if (mag) return `${sign}${money(`${value()} ${mag[0]}`, true)}`;
  const unit = UNITS[suffix.toLowerCase()];
  if (unit && suffix.length >= 2) {
    const one = n === 1 && frac === undefined;
    const words = unit.split(" ");
    const head = one ? words[0]! : UNIT_PLURAL[words[0]!] ?? pluralize(words[0]!);
    return `${sign}${value()} ${[head, ...words.slice(1)].join(" ")}`;
  }
  if (/^(st|nd|rd|th)$/i.test(suffix) && frac === undefined) return `${sign}${ordinal(n)}`;
  if (suffix === "s" && frac === undefined && !cur) {
    // 1990s, 80s
    const words = n >= 1000 ? yearWords(n) : cardinal(n);
    const at = words.lastIndexOf(" ") + 1;
    return `${sign}${words.slice(0, at)}${pluralize(words.slice(at))}`;
  }
  if (suffix) {
    // 5G, 4K, 3D, 2FA: the number, then the letters spelled
    const letters = suffix === suffix.toUpperCase() || suffix.length <= 2 ? spell(suffix) : suffix;
    return `${sign}${value()} ${letters}`;
  }
  suffix = "";
  if (c) {
    if (frac !== undefined && frac.length === 2 && cur === "$") {
      const cents = Number(frac);
      return `${sign}${cardinal(n)} ${n === 1 ? c[0] : c[1]}${cents ? ` and ${cardinal(cents)} ${cents === 1 ? "cent" : c[2]}` : ""}`;
    }
    return `${sign}${money(value(), false)}`;
  }
  if (frac === undefined && !m[1] && /^\d{4}$/.test(raw) && ((n >= 1100 && n <= 2099 && YEAR_CUES.has(prev)) || (n >= 1900 && n <= 2099 && !CODE_CUES.has(prev)))) return yearWords(n);
  if (frac === undefined && /^\d{3}$/.test(raw) && n >= 100 && n <= 599 && CODE_CUES.has(prev)) return digits(raw, "oh");
  return `${sign}${value()}`;
}

/** letters and digits mixed in one token (S3, p95, h264, a1f3c9e, v2.1): read by runs. */
function mixed(core: string): string | null {
  const ver = /^v(\d+(?:\.\d+)*)$/i.exec(core);
  if (ver) return `version ${ver[1]!.split(".").map((p) => cardinal(Number(p))).join(" point ")}`;
  if (!/\d/.test(core) || !/[A-Za-z]/.test(core) || !/^[A-Za-z0-9]+$/.test(core)) return null;
  // a hash or an id: every character, one by one
  if (core.length >= 6 && /^[0-9a-f]+$/i.test(core)) return spell(core);
  const runs = core.match(/[A-Za-z]+|\d+/g)!;
  return runs
    .map((r) => {
      if (/^\d+$/.test(r)) return r.length <= 2 ? cardinal(Number(r)) : digits(r);
      const lower = FIXED[r.toLowerCase()];
      if (lower) return lower;
      return r.length <= 2 || r === r.toUpperCase() ? spell(r) : r;
    })
    .join(" ");
}

function speakCore(core: string, prev: string): string {
  const lower = core.toLowerCase();
  if (FIXED[lower] !== undefined) return FIXED[lower]!;

  // an address: user@host.tld
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(core)) return core.replace(/@/g, " at ").replace(/\./g, " dot ").replace(/_/g, " underscore ").replace(/-/g, " dash ").replace(/\s+/g, " ");
  // a web address, a host with a port, a path
  if (/^https?:\/\//i.test(core) || /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,8}(:\d+)?(\/\S*)?$/i.test(core)) {
    const file = /^([\w-]+)\.([a-z0-9]{1,5})$/i.exec(core);
    if (file && FILE_EXT[file[2]!.toLowerCase()] !== undefined) return `${file[1]!.replace(/[_-]/g, " ")} dot ${FILE_EXT[file[2]!.toLowerCase()]}`;
    const bare = core.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
    return bare.replace(/\./g, " dot ").replace(/:/g, " colon ").replace(/\//g, " slash ").replace(/-/g, " dash ").replace(/_/g, " underscore ").replace(/\s+/g, " ").trim();
  }
  if (/^\/[\w./-]+$/.test(core) && core.length > 1) return core.slice(1).replace(/\./g, " dot ").replace(/\//g, " slash ").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim().replace(/^/, "slash ");
  // 192.168.1.1
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(core)) return core.split(".").map((p) => cardinal(Number(p))).join(" dot ");
  // 1.2.3 (a version)
  if (/^\d+(\.\d+){2,}$/.test(core)) return core.split(".").map((p) => cardinal(Number(p))).join(" point ");
  // 2024-03-15
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(core);
  if (iso) {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const mo = months[Number(iso[2]) - 1];
    if (mo) return `${mo} ${ordinal(Number(iso[3]))}, ${yearWords(Number(iso[1]))}`;
  }
  // localhost:3000
  const port = /^([a-z][\w-]*):(\d{2,5})$/i.exec(core);
  if (port) return `${port[1]} colon ${cardinal(Number(port[2]))}`;
  // 12:30, 9:05, 3:1
  const time = /^(\d{1,2}):(\d{2})(am|pm)?$/i.exec(core);
  if (time) {
    const h = Number(time[1]);
    const mi = Number(time[2]);
    const ap = time[3] ? ` ${spell(time[3])}` : "";
    return `${cardinal(h)} ${mi === 0 ? (ap ? "" : "o'clock") : mi < 10 ? `oh ${ONES[mi]}` : below100(mi)}${ap}`.replace(/\s+/g, " ").trim();
  }
  const ratio = /^(\d+):(\d+)$/.exec(core);
  if (ratio) return `${cardinal(Number(ratio[1]))} to ${cardinal(Number(ratio[2]))}`;
  // 9pm, 10am
  const ap = /^(\d{1,2})(am|pm)$/i.exec(core);
  if (ap) return `${cardinal(Number(ap[1]))} ${spell(ap[2]!)}`;
  // 10-20, 3/4
  const range = /^(\d[\d,.]*)[-–](\d[\d,.]*)$/.exec(core);
  if (range) return `${speakCore(range[1]!, prev)} to ${speakCore(range[2]!, "")}`;
  const frac = /^(\d+)\/(\d+)$/.exec(core);
  if (frac) {
    const [a, b] = [Number(frac[1]), Number(frac[2])];
    if (b === 2) return a === 1 ? "one half" : `${cardinal(a)} halves`;
    if (b === 4) return a === 1 ? "one quarter" : `${cardinal(a)} quarters`;
    return `${cardinal(a)} over ${cardinal(b)}`;
  }

  const num = NUM.exec(core);
  if (num) return number(num, prev);

  // an acronym with a plural: APIs, URLs, CPUs
  const plural = /^([A-Z]{2,})s$/.exec(core);
  if (plural && !CAPS_WORDS.has(plural[1]!)) return `${spell(plural[1]!)}'s`;

  const m = mixed(core);
  if (m) return m;

  // code and file names: snake_case, name.ext
  const file = /^([\w-]+)\.([a-z0-9]{1,5})$/i.exec(core);
  if (file && FILE_EXT[file[2]!.toLowerCase()] !== undefined) return `${file[1]!.replace(/[_-]/g, " ")} dot ${FILE_EXT[file[2]!.toLowerCase()]}`;
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/i.test(core)) return core.replace(/_/g, " ");

  // COVID-19, X-2: a hyphenated word with a number in it, each part on its own
  if (core.includes("-") && /\d/.test(core) && /^[\w-]+$/.test(core)) return core.split("-").map((p) => speakCore(p, "")).join(" ");

  // CI/CD, client/server: each part, then the parts together
  if (/^[^/\s]+(\/[^/\s]+)+$/.test(core) && !/^https?:/i.test(core)) {
    const parts = core.split("/");
    const spoken = parts.map((p) => speakCore(p, ""));
    const allCaps = parts.every((p) => /^[A-Z]{2,}$/.test(p));
    return spoken.join(allCaps ? " " : " slash ");
  }

  // 2 to 5 capitals are an acronym (spelled) unless they are a known word; a longer run is a name (ARPANET)
  if (/^[A-Z]{2,}$/.test(core)) return CAPS_WORDS.has(core) || core.length >= 6 ? core.toLowerCase() : spell(core);
  if (SPELLED_LOWER.has(lower) && core === lower) return spell(core);
  return core;
}

/** One written word (with its punctuation) as it is spoken. */
export function speakWord(token: string, prev = ""): string {
  const m = /^([("'[{“‘]*)(.*?)([)"'\]}”’…]*[.,;:!?]*[)"'\]}”’…]*)$/s.exec(token)!;
  const lead = m[1]!;
  let core = m[2]!;
  let trail = m[3]!;
  // the dot of an abbreviation (e.g., etc.) belongs to the word; the dot that ends a sentence does not
  if (trail.startsWith(".") && FIXED[`${core}.`.toLowerCase()] !== undefined) {
    core += ".";
    trail = trail.slice(1);
  }
  if (!core) return token;
  const spoken = speakCore(core, prev.toLowerCase().replace(/[^a-z]/g, ""));
  return lead + spoken + trail;
}

/** The written narration as it is spoken, with where each written word went. */
export function toSpoken(text: string, lang = "en"): SpokenText {
  const tokens = [...text.matchAll(/\S+/g)];
  if (!/^en/i.test(lang)) return { text, words: tokens.map((t) => ({ start: t.index!, end: t.index! + t[0].length, sStart: t.index!, sEnd: t.index! + t[0].length })) };
  let out = "";
  const words: SpokenText["words"] = [];
  let prev = "";
  for (const t of tokens) {
    const spoken = speakWord(t[0], prev);
    prev = t[0];
    if (spoken && out) out += " ";
    const sStart = out.length;
    out += spoken;
    words.push({ start: t.index!, end: t.index! + t[0].length, sStart, sEnd: out.length });
  }
  return { text: out, words };
}
