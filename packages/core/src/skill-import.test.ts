import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseSkillMd } from "./agent-skill.js";
import {
  normalizeImportedSkill,
  SKILL_IMPORT_MAX_BYTES,
  SKILL_ZIP_MAX_ENTRIES,
  skillFromZip,
  skillRawUrl,
} from "./skill-import.js";

const skill = (name = "Weekly review", description = "Use when the week ends.") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nList wins and blockers.\n`;

describe("skillRawUrl", () => {
  it.each([
    [
      "https://github.com/acme/skills",
      "https://raw.githubusercontent.com/acme/skills/HEAD/SKILL.md",
    ],
    [
      "https://github.com/acme/skills/tree/main/weekly-review",
      "https://raw.githubusercontent.com/acme/skills/main/weekly-review/SKILL.md",
    ],
    [
      "https://github.com/acme/skills/blob/main/weekly-review/SKILL.md",
      "https://raw.githubusercontent.com/acme/skills/main/weekly-review/SKILL.md",
    ],
    [
      "https://raw.githubusercontent.com/acme/skills/main/a/SKILL.md",
      "https://raw.githubusercontent.com/acme/skills/main/a/SKILL.md",
    ],
    [
      "https://www.github.com/acme/skills.git",
      "https://raw.githubusercontent.com/acme/skills/HEAD/SKILL.md",
    ],
  ])("turns %s into the raw file", (input, expected) => {
    expect(skillRawUrl(input)).toEqual({ ok: true, url: expected });
  });

  it.each([
    "",
    "not a url",
    "http://github.com/acme/skills",
    "https://gitlab.com/acme/skills",
    "https://github.com.evil.test/acme/skills",
    "https://evil.test/github.com/acme/skills",
    "https://user:pass@github.com/acme/skills",
    "https://github.com:8443/acme/skills",
    "https://127.0.0.1/acme/skills",
    "https://github.com/acme",
    "https://github.com/acme/skills/issues/3",
    "https://github.com/acme/skills/tree/main/../../x",
    "https://github.com/acme/skills/blob/main/README.md",
    "https://raw.githubusercontent.com/acme/skills",
    "javascript:alert(1)",
  ])("refuses %j", (input) => {
    expect(skillRawUrl(input)).toMatchObject({ ok: false });
  });
});

it("never lets an encoded dot segment leave the repository", () => {
  const result = skillRawUrl("https://github.com/acme/skills/tree/main/%2e%2e/%2e%2e/x");
  if (result.ok)
    expect(result.url).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/acme\/skills\/[\w.-]+\/x\/SKILL\.md$/,
    );
});

describe("normalizeImportedSkill", () => {
  it("reads the name and description from the frontmatter", () => {
    const result = normalizeImportedSkill(skill());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseSkillMd(result.content);
    expect(parsed).toMatchObject({ name: "Weekly review", description: "Use when the week ends." });
  });

  it("keeps the name and description on one line without control characters", () => {
    const result = normalizeImportedSkill(
      '---\nname: "Weekly\\nreview\\u0007"\ndescription: "Use when\\r\\nthe week ends."\n---\nBody\n',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseSkillMd(result.content);
    expect(parsed).toMatchObject({ name: "Weekly review", description: "Use when the week ends." });
  });

  it("refuses text with no frontmatter, no description or too much content", () => {
    expect(normalizeImportedSkill("Just steps.")).toMatchObject({ ok: false });
    expect(normalizeImportedSkill("---\nname: A\n---\nBody")).toMatchObject({ ok: false });
    expect(normalizeImportedSkill(skill() + "x".repeat(SKILL_IMPORT_MAX_BYTES))).toMatchObject({
      ok: false,
    });
  });
});

describe("skillFromZip", () => {
  const zip = (files: Record<string, string>) =>
    zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

  it("reads the SKILL.md of a zipped folder and ignores everything else", () => {
    const result = skillFromZip(
      zip({
        "weekly/SKILL.md": skill(),
        "weekly/scripts/run.sh": "rm -rf /",
        "weekly/notes.md": "Not read.",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).not.toContain("rm -rf");
  });

  it("prefers the SKILL.md nearest to the top", () => {
    const result = skillFromZip(
      zip({ "a/b/SKILL.md": skill("Deep", "Deep one"), "SKILL.md": skill("Top", "Top one") }),
    );
    expect(result.ok && parseSkillMd(result.content)).toMatchObject({ name: "Top" });
  });

  it("refuses a path that escapes the folder", () => {
    for (const name of ["../SKILL.md", "a/../../SKILL.md", "/etc/SKILL.md", "a\\..\\SKILL.md"]) {
      expect(skillFromZip(zip({ [name]: skill(), "ok/SKILL.md": skill() }))).toMatchObject({
        ok: false,
      });
    }
  });

  it("refuses an archive with too many entries", () => {
    const files: Record<string, string> = { "SKILL.md": skill() };
    for (let i = 0; i < SKILL_ZIP_MAX_ENTRIES; i += 1) files[`f/${i}.txt`] = "x";
    expect(skillFromZip(zip(files))).toMatchObject({ ok: false });
  });

  it("refuses an archive without a SKILL.md, an oversized one and a non-zip", () => {
    expect(skillFromZip(zip({ "README.md": "hi" }))).toMatchObject({ ok: false });
    expect(
      skillFromZip(zip({ "SKILL.md": skill() + "x".repeat(SKILL_IMPORT_MAX_BYTES) })),
    ).toMatchObject({ ok: false });
    expect(skillFromZip(strToU8("not a zip"))).toMatchObject({ ok: false });
  });
});
