import { describe, expect, it } from "vitest";
import {
  citedPositions,
  keepRealCitations,
  parseJsonObject,
  quoteAppearsIn,
  withSourceList,
} from "./research-report.js";

const sources = [
  { position: 1, title: "One", url: "https://a.test/" },
  { position: 2, title: "Two", url: "https://b.test/" },
];

describe("research report helpers", () => {
  it("finds the numbers a report cites, once each", () => {
    expect(citedPositions("A [2] and B [1][2].")).toEqual([2, 1]);
  });

  it("removes citations to sources that were never read", () => {
    const { text, cited } = keepRealCitations("Fact [1][5]. Other [9] .", sources);
    expect(text).toBe("Fact [1]. Other.");
    expect(cited).toEqual([1]);
  });

  it("lists only the cited sources, from the ledger", () => {
    expect(withSourceList("Fact [2].", sources)).toBe("Fact [2].\n\n[2] Two - https://b.test/");
    expect(withSourceList("No cites.", sources)).toBe("No cites.");
  });

  it("checks a quote against the page text", () => {
    const page = "The  team plan\nnow costs nine dollars.";
    expect(quoteAppearsIn("the team plan now costs nine", page)).toBe(true);
    expect(quoteAppearsIn("costs ten dollars", page)).toBe(false);
    expect(quoteAppearsIn("short", "short")).toBe(false);
  });

  it("reads a JSON object out of a fenced answer", () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject("no json")).toBeUndefined();
    expect(parseJsonObject("{broken")).toBeUndefined();
  });
});
