import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

/** The only variables of the engine's own environment that a local agent program inherits. */
const AGENT_ENV = ["PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL", "SHELL"] as const;

/** Variables that would switch an agent program to API billing or another route. */
export const BLOCKED_AGENT_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
] as const;

/**
 * The environment of a local agent program: a small allow-list from the engine's own, plus what
 * the caller adds. Server secrets are never inherited, and no caller can add a billing route.
 */
export function agentChildEnv(
  extra: Record<string, string>,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of AGENT_ENV) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  for (const key of Object.keys(extra)) {
    if ((BLOCKED_AGENT_ENV as readonly string[]).includes(key)) {
      throw new Error(`The agent environment cannot set ${key}.`);
    }
  }
  return { ...env, ...extra };
}

/** The first executable `name` on PATH, then in `extraDirs`. */
export async function findAgentBinary(
  name: string,
  extraDirs: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const folders = [...(env.PATH ?? "").split(path.delimiter).filter(Boolean), ...extraDirs];
  for (const folder of folders) {
    const candidate = path.join(folder, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here; try the next folder.
    }
  }
  return undefined;
}
