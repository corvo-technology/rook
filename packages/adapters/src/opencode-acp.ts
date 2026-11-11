import os from "node:os";
import path from "node:path";
import type { AcpCommand } from "./acp-client.js";
import { findAgentBinary } from "./agent-process.js";

/** Tells a person why `opencode acp` stopped, from what it printed. */
export function explainOpenCodeExit(output: string): string | undefined {
  // OpenCode 2 changes the shared database in a way OpenCode 1 cannot open (opencode issue 53221).
  if (output.includes("has no session table")) {
    return "OpenCode could not open its database because a newer OpenCode changed it. Update OpenCode to version 2 or later, then try again.";
  }
  return undefined;
}

/**
 * How to start OpenCode as an ACP agent. Rook gets a database of its own: its chats stay out of
 * the person's OpenCode history, and a database that another OpenCode version changed cannot
 * stop it. Sign-ins for paid providers still come from OpenCode's own auth file.
 */
export function openCodeCommand(options: {
  binary: string;
  /** A folder Rook owns, used for OpenCode's database and as its working directory. */
  dataDir: string;
}): AcpCommand {
  return {
    command: options.binary,
    args: ["acp"],
    cwd: options.dataDir,
    env: { OPENCODE_DB: path.join(options.dataDir, "opencode.db") },
    explainExit: explainOpenCodeExit,
  };
}

/** Where a person's OpenCode program usually is: their PATH, then OpenCode's own install folder. */
export async function findOpenCode(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): Promise<string | undefined> {
  return findAgentBinary("opencode", [path.join(home, ".opencode", "bin")], env);
}
