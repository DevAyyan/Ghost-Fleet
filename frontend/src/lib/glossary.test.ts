import { describe, expect, it } from "vitest";
import { splitTerms } from "./glossary";

const terms = (text: string) => splitTerms(text).flatMap((s) => (typeof s === "string" ? [] : [s.text]));

describe("splitTerms", () => {
  it("marks the first use of each term and keeps the text whole", () => {
    const text = "Vessels whose AIS stopped inside a no-take area. AIS again.";
    const segs = splitTerms(text);
    expect(segs.map((s) => (typeof s === "string" ? s : s.text)).join("")).toBe(text);
    expect(terms(text)).toEqual(["AIS", "no-take"]);
  });
  it("matches acronyms only as whole words", () => {
    expect(terms("A FRAIS of SAIS")).toEqual([]);
    expect(terms("public RFMOs list it")).toEqual(["RFMOs"]);
  });
  it("matches words in any case", () => expect(terms("No-take zone, Transshipment")).toEqual(["No-take", "Transshipment"]));
  it("leaves text without terms alone", () => expect(splitTerms("calm sea")).toEqual(["calm sea"]));
});
