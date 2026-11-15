import type { Actor, ImportFromAppInput, ImportFromAppPreview } from "@corvo/contracts";
import {
  AppExportSchema,
  BOT_INSTRUCTIONS_MAX_LENGTH,
  MEMORY_INDEX_PATH,
  SpaceExportSchema,
} from "@corvo/contracts";
import { looksLikeCredential, parseSkillMd } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { ORPCError } from "@orpc/server";
import { requireSpacePermission } from "./space-owner.js";

/** The input cannot be read as an agent; the message is for the person. */
export class AppImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppImportError";
  }
}

const REMOVED_LINE = "[removed]";
const CRON = /^\S+(?:\s+\S+){4}$/;

type Agent = {
  name: string;
  title: string;
  description: string;
  instructions: string;
  starters: string[];
  memory: string;
  facts: string[];
  routines: { name: string; prompt: string; schedule: string | null }[];
};

/** The first JSON object in an assistant's answer, which may be wrapped in a code fence. */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AppImportError("No agent found in this text.");
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    throw new AppImportError("No agent found in this text.");
  }
}

/** Lines that look like a key are replaced, so pasted text never carries one in. */
function scrub(text: string, counter: { leftOut: number }): string {
  if (!looksLikeCredential(text)) return text;
  return text
    .split("\n")
    .map((line) => {
      if (!looksLikeCredential(line)) return line;
      counter.leftOut += 1;
      return REMOVED_LINE;
    })
    .join("\n");
}

function keep(text: string, counter: { leftOut: number }): boolean {
  if (!looksLikeCredential(text)) return true;
  counter.leftOut += 1;
  return false;
}

function rawCount(json: unknown, key: string): number {
  const value = (json as Record<string, unknown> | null)?.[key];
  return Array.isArray(value) ? value.length : 0;
}

function agentFromPrompt(
  text: string,
  counter: { leftOut: number },
): { agent: Agent; files: string[]; connections: string[] } {
  const json = extractJson(text);
  const parsed = AppExportSchema.safeParse(json);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((issue) => issue.path[0] === "instructions");
    throw new AppImportError(tooLong ? "The instructions are too long." : "No agent found.");
  }
  const app = parsed.data;
  for (const key of [
    "conversation_starters",
    "knowledge_files",
    "memory",
    "connections",
    "routines",
  ] as const) {
    counter.leftOut += Math.max(0, rawCount(json, key) - app[key].length);
  }
  const facts = app.memory.filter((fact) => keep(fact, counter));
  const routines = app.routines.flatMap((routine) => {
    const schedule = routine.schedule ?? "";
    // A routine needs a schedule to exist; one without is not worth carrying.
    if (!CRON.test(schedule)) {
      counter.leftOut += 1;
      return [];
    }
    if (!keep(routine.prompt, counter)) return [];
    return [{ name: routine.name, prompt: routine.prompt, schedule }];
  });
  const memory =
    app.knowledge_files.length > 0
      ? `# ${app.name}\n\nKnowledge files to add again:\n${app.knowledge_files.map((name) => `- ${name}`).join("\n")}\n`
      : "";
  return {
    agent: {
      name: app.name,
      title: app.role,
      description: scrub(app.description, counter),
      instructions: scrub(app.instructions, counter),
      starters: app.conversation_starters,
      memory,
      facts,
      routines,
    },
    files: app.knowledge_files,
    connections: app.connections,
  };
}

/** Skill folders as the Anthropic skills format lays them out: one `SKILL.md` per skill. */
function skillsFromFiles(files: { path: string; content: string }[], counter: { leftOut: number }) {
  const seen = new Set<string>();
  const skills: { name: string; content: string }[] = [];
  for (const file of files) {
    if (file.path.split("/").at(-1) !== "SKILL.md") continue;
    const parsed = parseSkillMd(file.content);
    if ("error" in parsed || seen.has(parsed.name.toLowerCase()) || !keep(file.content, counter)) {
      counter.leftOut += 1;
      continue;
    }
    seen.add(parsed.name.toLowerCase());
    skills.push({ name: parsed.name, content: file.content });
  }
  if (skills.length === 0) throw new AppImportError("No skills found.");
  return skills;
}

/**
 * Translates what another app produced into Rook's space file, for the same import that moves a
 * space between servers. Everything read is data: it becomes instructions, memory and skills,
 * never anything that runs, and the input has no place for a key or a connection.
 */
export function translateAppImport(
  input: ImportFromAppInput,
  existingNames: Iterable<string> = [],
): ImportFromAppPreview {
  const counter = { leftOut: 0 };
  let agent: Agent | null = null;
  let skills: { name: string; content: string }[] = [];
  let files: string[] = [];
  let connections: string[] = [];
  if (input.source === "prompt") {
    ({ agent, files, connections } = agentFromPrompt(input.text, counter));
  } else if (input.source === "skills") {
    skills = skillsFromFiles(input.files, counter);
  } else {
    if (input.content.length > BOT_INSTRUCTIONS_MAX_LENGTH) {
      throw new AppImportError("The instructions are too long.");
    }
    agent = {
      name: input.name || "Imported agent",
      title: "",
      description: "",
      instructions: scrub(input.content, counter),
      starters: [],
      memory: "",
      facts: [],
      routines: [],
    };
  }
  const taken = new Set([...existingNames].map((name) => name.toLowerCase()));
  const space = SpaceExportSchema.parse({
    version: 1,
    kind: "space",
    exportedAt: new Date().toISOString(),
    bots: agent
      ? [
          {
            bot: {
              name: agent.name,
              title: agent.title,
              description: agent.description,
              instructions: agent.instructions,
              starters: agent.starters,
            },
            memory: agent.memory ? [{ path: MEMORY_INDEX_PATH, content: agent.memory }] : [],
            routines: agent.routines.map((routine) => ({
              name: routine.name,
              prompt: routine.prompt,
              crons: routine.schedule ? [routine.schedule] : [],
              timezone: "UTC",
            })),
            files: [],
          },
        ]
      : [],
    memory: [],
    skills: skills.map((skill) => ({ content: skill.content })),
    // They wait for the person's review, as anything an agent learns does.
    facts: (agent?.facts ?? []).map((text) => ({ text, state: "pending", source: "agent" })),
  });
  return {
    agents: agent
      ? [
          {
            name: agent.name,
            title: agent.title,
            instructions: agent.instructions,
            exists: taken.has(agent.name.toLowerCase()),
          },
        ]
      : [],
    skills: skills.map((skill) => skill.name),
    routines: agent?.routines.map(({ name, schedule }) => ({ name, schedule })) ?? [],
    facts: agent?.facts.length ?? 0,
    files,
    connections,
    leftOut: counter.leftOut,
    space,
  };
}

/** The same permission as the import itself, so a preview never reads what the person may not add. */
export async function previewAppImport(
  prisma: PrismaClient,
  listAgentNames: () => Promise<string[]>,
  actor: Actor,
  input: ImportFromAppInput,
): Promise<ImportFromAppPreview> {
  await requireSpacePermission(prisma, actor, "create_agents");
  try {
    return translateAppImport(input, await listAgentNames());
  } catch (error) {
    if (error instanceof AppImportError) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
    throw error;
  }
}
