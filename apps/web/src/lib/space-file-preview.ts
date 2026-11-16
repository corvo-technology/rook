import type { ImportFromAppPreview } from "@corvo/contracts";
import { SpaceExportSchema } from "@corvo/contracts";
import { parseSkillMd } from "@corvo/core";

/**
 * A Rook space file read for the same preview other apps' imports show. Null when the text is
 * not a space file. `existing` are the names of the agents the space already has.
 */
export function previewSpaceFile(
  text: string,
  existing: readonly string[],
): ImportFromAppPreview | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = SpaceExportSchema.safeParse(json);
  if (!parsed.success) return null;
  const space = parsed.data;
  const taken = new Set(existing.map((name) => name.toLowerCase()));
  return {
    agents: space.bots.map(({ bot }) => ({
      name: bot.name,
      title: bot.title,
      instructions: bot.instructions,
      exists: taken.has(bot.name.toLowerCase()),
    })),
    skills: space.skills.flatMap(({ content }) => {
      const skill = parseSkillMd(content);
      return "error" in skill ? [] : [skill.name];
    }),
    routines: space.bots.flatMap(({ routines }) =>
      routines.map((routine) => ({ name: routine.name, schedule: routine.crons[0] ?? null })),
    ),
    facts: space.facts.length,
    files: [],
    connections: [],
    leftOut: 0,
    space,
  };
}
