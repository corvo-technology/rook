import type { ImportFromAppInput } from "@corvo/contracts";
import { readSkillArchive } from "@corvo/core";

const SKILL_FILE_MAX_BYTES = 100_000;
const TEXT_FILE_MAX_BYTES = 400_000;
const TEXT_FILE = /\.(?:md|markdown|txt)$/i;

function pathOf(file: File): string {
  return file.webkitRelativePath || file.name;
}

/** A file named for what it holds ("AGENTS.md") says nothing about the agent, so it goes unnamed. */
function agentName(file: File): string {
  const name = file.name.replace(/\.[^.]*$/, "").trim();
  return /^(?:agents?|system[-_ ]?prompt|prompt|instructions)$/i.test(name) ? "" : name;
}

/**
 * What the person chose, as an import: a zip or folder of skills, a lone SKILL.md, or one text
 * file of instructions. Null when none of it can be read as one.
 */
export async function readAppImportFiles(files: File[]): Promise<ImportFromAppInput | null> {
  const skills: { path: string; content: string }[] = [];
  const texts: File[] = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const found = readSkillArchive(new Uint8Array(await file.arrayBuffer()));
      if (found) skills.push(...found);
    } else if (pathOf(file).split("/").at(-1) === "SKILL.md") {
      if (file.size <= SKILL_FILE_MAX_BYTES) {
        skills.push({ path: pathOf(file), content: await file.text() });
      }
    } else if (TEXT_FILE.test(file.name) && file.size <= TEXT_FILE_MAX_BYTES) {
      texts.push(file);
    }
  }
  if (skills.length > 0) return { source: "skills", files: skills.slice(0, 500) };
  const [only] = texts;
  if (texts.length === 1 && only) {
    return { source: "text", name: agentName(only), content: await only.text() };
  }
  return null;
}
