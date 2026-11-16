import { describe, expect, it } from "vitest";
import { previewSpaceFile } from "./space-file-preview";

const file = JSON.stringify({
  version: 1,
  kind: "space",
  exportedAt: "2026-01-01T00:00:00.000Z",
  bots: [
    {
      bot: { name: "Ana", title: "Support", description: "", instructions: "Be kind." },
      memory: [],
      routines: [
        {
          name: "Brief",
          prompt: "Go",
          crons: ["0 9 * * *"],
          timezone: "UTC",
          modelProvider: "cli-engine",
          modelId: "claude/sonnet",
        },
      ],
      files: [],
    },
    {
      bot: { name: "Bia", title: "", description: "", instructions: "" },
      memory: [],
      routines: [],
      files: [],
    },
  ],
  memory: [],
  skills: [{ content: "---\nname: pdf\ndescription: Reads PDFs\n---\nSteps." }],
});

describe("previewSpaceFile", () => {
  it("lists what a Rook file brings and marks agents the space already has", () => {
    const preview = previewSpaceFile(file, ["ana"]);
    expect(preview?.agents.map((a) => [a.name, a.exists])).toEqual([
      ["Ana", true],
      ["Bia", false],
    ]);
    expect(preview?.skills).toEqual(["pdf"]);
    expect(preview?.routines).toEqual([{ name: "Brief", schedule: "0 9 * * *" }]);
  });

  it("is null for anything that is not a space file", () => {
    expect(previewSpaceFile("not json", [])).toBeNull();
    expect(previewSpaceFile('{"kind":"bot"}', [])).toBeNull();
  });
});
