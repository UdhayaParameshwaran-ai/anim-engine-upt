/**
 * A tiny, safe evaluator for the curve of a plot: numbers, `x`, + - * / ^, parentheses, and a few functions.
 * Nothing is executed: the text is parsed into a closure, or rejected.
 */

type Fn = (x: number) => number;

const FUNCS: Record<string, (v: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  exp: Math.exp,
  ln: Math.log,
  log2: Math.log2,
};

/** The function a text describes (`(x-3)^2`, `2*x+1`, `sqrt(x)`), or undefined when it is not one. */
export function parseCurve(text: string): Fn | undefined {
  const src = text.replace(/\s+/g, "");
  if (!src || src.length > 80) return undefined;
  let i = 0;
  const peek = () => src[i];
  const number = (): Fn | undefined => {
    const m = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (!m) return undefined;
    i += m[0].length;
    const v = Number(m[0]);
    return () => v;
  };
  const atom = (): Fn | undefined => {
    const c = peek();
    if (c === "(") {
      i++;
      const e = expr();
      if (!e || peek() !== ")") return undefined;
      i++;
      return e;
    }
    if (c === "x") {
      i++;
      return (x) => x;
    }
    const f = /^[a-z0-9]+/.exec(src.slice(i))?.[0];
    if (f && f in FUNCS && src[i + f.length] === "(") {
      i += f.length + 1;
      const e = expr();
      if (!e || peek() !== ")") return undefined;
      i++;
      const fn = FUNCS[f]!;
      return (x) => fn(e(x));
    }
    return number();
  };
  const power = (): Fn | undefined => {
    const a = atom();
    if (!a) return undefined;
    if (peek() === "^") {
      i++;
      const b = unary();
      if (!b) return undefined;
      return (x) => a(x) ** b(x);
    }
    return a;
  };
  const unary = (): Fn | undefined => {
    if (peek() === "-") {
      i++;
      const a = unary();
      return a && ((x) => -a(x));
    }
    return power();
  };
  const term = (): Fn | undefined => {
    let a = unary();
    while (a && (peek() === "*" || peek() === "/")) {
      const op = src[i++]!;
      const b = unary();
      if (!b) return undefined;
      const l = a;
      a = op === "*" ? (x) => l(x) * b(x) : (x) => l(x) / b(x);
    }
    return a;
  };
  const expr = (): Fn | undefined => {
    let a = term();
    while (a && (peek() === "+" || peek() === "-")) {
      const op = src[i++]!;
      const b = term();
      if (!b) return undefined;
      const l = a;
      a = op === "+" ? (x) => l(x) + b(x) : (x) => l(x) - b(x);
    }
    return a;
  };
  const f = expr();
  if (!f || i !== src.length) return undefined;
  // It has to produce a number somewhere.
  return [0, 1, 2, 5].some((x) => Number.isFinite(f(x))) ? f : undefined;
}
