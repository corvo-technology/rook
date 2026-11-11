import { describe, expect, it } from "vitest";
import { parseActivityLabel, reviewBeforeSummary } from "./activity-label.js";

describe("parseActivityLabel", () => {
  it.each([
    ["Running: npm test", { id: "running", value: "npm test" }],
    ["Reading make_carousel.py", { id: "reading", value: "make_carousel.py" }],
    ["Writing out/a.txt", { id: "writing", value: "out/a.txt" }],
    ["Listing .", { id: "listing", value: "." }],
    ["Attaching a.png", { id: "attaching", value: "a.png" }],
    ["Opening report.pdf", { id: "opening", value: "report.pdf" }],
    ["Opening page: example.com/a", { id: "openingPage", value: "example.com/a" }],
    ["Reading page: example.com/a", { id: "readingPage", value: "example.com/a" }],
    ["Searching the web: node version", { id: "searching", value: "node version" }],
    ["Reading skill: carrossel", { id: "readingSkill", value: "carrossel" }],
    ["Delegating to helper: Researcher", { id: "delegating", value: "Researcher" }],
    [
      "Waiting for db: execute_sql_read_only",
      { id: "waitingFor", value: "db: execute_sql_read_only" },
    ],
    ["Using github: create_issue", { id: "using", value: "github: create_issue" }],
    ["Using CANVA_CREATE_DESIGN", { id: "using", value: "CANVA_CREATE_DESIGN" }],
    ["Finding a tool", { id: "findingTool" }],
    ["Looking at the screen", { id: "lookingAtScreen" }],
    ["Reading the page", { id: "readingThePage" }],
    ["Using the page", { id: "usingThePage" }],
    ["Operating the computer", { id: "operatingComputer" }],
    ["Saving a note to memory", { id: "savingNote" }],
    ["Rendering a chart", { id: "renderingChart" }],
  ])("reads %j", (label, expected) => {
    expect(parseActivityLabel(label)).toEqual(expected);
  });

  it("keeps the fixed phrases apart from the ones that carry a name", () => {
    expect(parseActivityLabel("Reading the page")).toEqual({ id: "readingThePage" });
    expect(parseActivityLabel("Reading thepage.txt")).toEqual({
      id: "reading",
      value: "thepage.txt",
    });
  });

  it("leaves a label it does not know alone", () => {
    expect(parseActivityLabel("Something else")).toBeUndefined();
    expect(parseActivityLabel("Já em português")).toBeUndefined();
  });
});

describe("reviewBeforeSummary", () => {
  it("reads a raw tool name as words", () => {
    expect(reviewBeforeSummary("Review before CANVA_CREATE_DESIGN_IMPORT_JOB")).toBe(
      "Canva create design import job",
    );
    expect(reviewBeforeSummary("Review before write_file")).toBe("Write file");
  });

  it("keeps a summary that already reads as words, and unescapes Markdown", () => {
    expect(reviewBeforeSummary("Review before web_fetch → example.com")).toBe(
      "web_fetch → example.com",
    );
    expect(reviewBeforeSummary("Review before CANVA\\_CREATE\\_DESIGN")).toBe(
      "Canva create design",
    );
  });

  it("answers nothing for any other title", () => {
    expect(reviewBeforeSummary("Update instructions?")).toBeUndefined();
    expect(reviewBeforeSummary("Create space “Docs”?")).toBeUndefined();
  });
});
