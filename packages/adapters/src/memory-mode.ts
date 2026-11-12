import { memoryModeOf } from "@corvo/db";

/** The tools a bot does not get: the ones its owner switched off, and adding to the person's memory when it only reads. */
export function botDisabledTools(bot: {
  disabledBuiltinTools?: readonly string[] | null;
  memoryMode?: string | null;
}): string[] {
  return [
    ...(bot.disabledBuiltinTools ?? []),
    ...(memoryModeOf(bot) === "read" ? ["remember_about_user"] : []),
  ];
}
