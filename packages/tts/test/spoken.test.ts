import { describe, expect, it } from "vitest";
import { speakWord, toSpoken } from "../src/index.js";

/** The text spoken for a sentence written as it would be in a narration. */
const say = (written: string) => toSpoken(written).text;

describe("numbers are said the way a person says them", () => {
  it("years", () => {
    expect(say("It began in 1957.")).toBe("It began in nineteen fifty-seven.");
    expect(say("In 2007 it moved")).toBe("In two thousand seven it moved");
    expect(say("by 2030")).toBe("by twenty thirty");
    expect(say("in 2020,")).toBe("in twenty twenty,");
    expect(say("in 1905")).toBe("in nineteen oh five");
    expect(say("the 1990s")).toBe("the nineteen nineties");
    expect(say("the 80s")).toBe("the eighties");
  });

  it("counts stay counts: a number that is not a year is a cardinal", () => {
    expect(say("about 1500 requests")).toBe("about one thousand five hundred requests");
    expect(say("12,000 users")).toBe("twelve thousand users");
    expect(say("1,250,000 rows")).toBe("one million two hundred fifty thousand rows");
    expect(say("21 users")).toBe("twenty-one users");
  });

  it("money, percent, magnitudes and units", () => {
    expect(say("$18M a year")).toBe("eighteen million dollars a year");
    expect(say("$2.5B")).toBe("two point five billion dollars");
    expect(say("$1.50 each")).toBe("one dollar and fifty cents each");
    expect(say("$5")).toBe("five dollars");
    expect(say("60% of users")).toBe("sixty percent of users");
    expect(say("+75% vs Q1")).toBe("plus seventy-five percent versus Q one");
    expect(say("42k users")).toBe("forty-two thousand users");
    expect(say("a 5MB file")).toBe("a five megabytes file");
    expect(say("under 200ms")).toBe("under two hundred milliseconds");
    expect(say("3x faster")).toBe("three times faster");
    expect(say("3.14")).toBe("three point one four");
    expect(say("the 3rd step")).toBe("the third step");
  });

  it("ranges, times, ratios and dates", () => {
    expect(say("10-20 minutes")).toBe("ten to twenty minutes");
    expect(say("at 12:30")).toBe("at twelve thirty");
    expect(say("at 9:05pm")).toBe("at nine oh five P M");
    expect(say("a 3:1 ratio")).toBe("a three to one ratio");
    expect(say("on 2024-03-15")).toBe("on March fifteenth, twenty twenty-four");
    expect(say("1/2 a cup")).toBe("one half a cup");
  });

  it("status codes are said digit by digit", () => {
    expect(say("the status 404 appears")).toBe("the status four oh four appears");
    expect(say("error 500")).toBe("error five oh oh");
  });
});

describe("ids, addresses and code are not read as noise", () => {
  it("hashes and ids are spelled", () => {
    expect(say("commit a1f3c9e")).toBe("commit A one F three C nine E");
    expect(say("on S3 and EC2")).toBe("on S three and E C two");
    expect(say("p95 latency")).toBe("P ninety-five latency");
    expect(say("version v2.1 ships")).toBe("version version two point one ships");
  });

  it("web addresses and paths", () => {
    expect(say("visit https://www.example.com/docs now")).toBe("visit example dot com slash docs now");
    expect(say("at docs.example.io.")).toBe("at docs dot example dot io.");
    expect(say("mail me@site.com")).toBe("mail me at site dot com");
    expect(say("GET /api/users")).toBe("get slash api slash users");
    expect(say("on localhost:3000")).toBe("on localhost colon three thousand");
    expect(say("open main.py")).toBe("open main dot P Y");
    expect(say("192.168.1.1")).toBe("one hundred ninety-two dot one hundred sixty-eight dot one dot one");
  });

  it("acronyms are spelled, the ones that are words are not", () => {
    expect(say("an HTTP request")).toBe("an H T T P request");
    expect(say("the CI/CD pipeline")).toBe("the C I C D pipeline");
    expect(say("many APIs")).toBe("many A P I's");
    expect(say("SQL and JSON")).toBe("sequel and Jason");
    expect(say("NASA launched")).toBe("nasa launched");
    expect(say("This is NOT safe")).toBe("This is not safe");
    expect(say("COVID-19")).toBe("covid nineteen");
    expect(say("the snake_case name")).toBe("the snake case name");
  });

  it("plain words and punctuation are left as written", () => {
    const plain = "A developer writes code, then pushes it to the repository. Nothing moves until a change arrives!";
    expect(say(plain)).toBe(plain);
    expect(say("e.g. a cache, i.e. memory")).toBe("for example a cache, that is memory");
  });
});

describe("the written words keep their place", () => {
  it("each written word maps to the words it became, and a word that is not spoken is empty", () => {
    const written = "In 1957 — Sputnik flew.";
    const sp = toSpoken(written);
    expect(sp.text).toBe("In nineteen fifty-seven Sputnik flew.");
    const [inn, year, dash, sputnik] = sp.words;
    expect(sp.text.slice(year!.sStart, year!.sEnd)).toBe("nineteen fifty-seven");
    expect(dash!.sStart).toBe(dash!.sEnd);
    expect(sp.text.slice(sputnik!.sStart, sputnik!.sEnd)).toBe("Sputnik");
    expect(written.slice(inn!.start, inn!.end)).toBe("In");
  });

  it("another language is passed through", () => {
    expect(toSpoken("En 1957 llegó", "es").text).toBe("En 1957 llegó");
  });

  it("speakWord keeps the punctuation around a word", () => {
    expect(speakWord('"$18M,"')).toBe('"eighteen million dollars,"');
    expect(speakWord("(1961)")).toBe("(nineteen sixty-one)");
  });
});
