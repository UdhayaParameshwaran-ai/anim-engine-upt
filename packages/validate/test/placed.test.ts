import { parse } from "@anim/dsl";
import { describe, expect, it } from "vitest";
import { validate, ValidateCodes as C } from "../src/index.js";

const outside = (extra: string) => {
  const src = `video 1\nscene a "A" template=anatomy\np1 = box "https://"\np2 = box "a.com"\nn1 = label "scheme" @below:p1\n${extra}> {1}A {2}b.\n1 fade p1\n2 fade p2\n`;
  return validate(parse(src).script, { autofix: true }).diagnostics.filter((d) => d.code === C.OutsideTemplate);
};

describe("placed elements the template does not show", () => {
  it("warns about an icon placed beside the parts of an anatomy", () => {
    const d = outside('i1 = icon:lock "Secure" @above:p1\n');
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("`i1` is an icon");
  });

  it("accepts a label placed under a part, which is what an anatomy shows", () => {
    expect(outside("")).toHaveLength(0);
  });
});
