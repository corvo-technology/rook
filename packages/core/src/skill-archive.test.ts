import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readSkillArchive } from "./skill-archive.js";

describe("readSkillArchive", () => {
  it("returns only the SKILL.md files, in path order", () => {
    const zip = zipSync({
      "pack/b/SKILL.md": strToU8("---\nname: b\n---"),
      "pack/a/SKILL.md": strToU8("---\nname: a\n---"),
      "pack/a/script.py": strToU8("print('not run')"),
      "pack/a/SKILL.md.bak": strToU8("old"),
    });
    expect(readSkillArchive(zip)?.map((file) => file.path)).toEqual([
      "pack/a/SKILL.md",
      "pack/b/SKILL.md",
    ]);
  });

  it("skips a skill larger than a skill may be, and refuses bytes that are not a zip", () => {
    const zip = zipSync({ "big/SKILL.md": strToU8("x".repeat(100_001)) });
    expect(readSkillArchive(zip)).toEqual([]);
    expect(readSkillArchive(strToU8("not a zip"))).toBeNull();
  });
});
