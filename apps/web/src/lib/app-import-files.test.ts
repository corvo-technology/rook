import { describe, expect, it, vi } from "vitest";

// Reading zips is tested with the reader itself, in @corvo/core.
const readSkillArchive = vi.hoisted(() => vi.fn());
vi.mock("@corvo/core", () => ({ readSkillArchive }));

import { readAppImportFiles } from "./app-import-files";

const skill = (name: string) => `---\nname: ${name}\ndescription: Does a thing\n---\n\nSteps.\n`;
function inFolder(path: string, content: string): File {
  const file = new File([content], path.split("/").at(-1) ?? path);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("readAppImportFiles", () => {
  it("reads the SKILL.md files of a chosen folder and nothing else in it", async () => {
    const input = await readAppImportFiles([
      inFolder("pack/pdf/SKILL.md", skill("pdf")),
      inFolder("pack/pdf/helper.py", "print()"),
      inFolder("pack/node_modules/x/readme.txt", "hi"),
    ]);
    expect(input).toEqual({
      source: "skills",
      files: [{ path: "pack/pdf/SKILL.md", content: skill("pdf") }],
    });
  });

  it("reads the skills inside a zip", async () => {
    readSkillArchive.mockReturnValueOnce([{ path: "a/SKILL.md", content: skill("a") }]);
    const input = await readAppImportFiles([new File(["zip bytes"], "skills.zip")]);
    expect(input).toEqual({
      source: "skills",
      files: [{ path: "a/SKILL.md", content: skill("a") }],
    });
  });

  it("takes one text file as instructions, unnamed when its name says nothing", async () => {
    expect(await readAppImportFiles([new File(["Be kind."], "AGENTS.md")])).toEqual({
      source: "text",
      name: "",
      content: "Be kind.",
    });
    expect(await readAppImportFiles([new File(["Be kind."], "Helper.txt")])).toMatchObject({
      name: "Helper",
    });
  });

  it("refuses what it cannot read as an agent", async () => {
    expect(await readAppImportFiles([new File(["x"], "photo.png")])).toBeNull();
    expect(await readAppImportFiles([new File(["a"], "a.md"), new File(["b"], "b.md")])).toBeNull();
    readSkillArchive.mockReturnValueOnce(null);
    expect(await readAppImportFiles([new File(["nope"], "broken.zip")])).toBeNull();
  });
});
