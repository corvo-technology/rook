import * as z from "zod";
import { BotStartersSchema } from "./bot-starters.js";
import {
  BOT_DESCRIPTION_MAX_LENGTH,
  BOT_INSTRUCTIONS_MAX_LENGTH,
  BOT_NAME_MAX_LENGTH,
  BOT_TITLE_MAX_LENGTH,
  SpaceExportSchema,
} from "./domain.js";
import { UserMemoryTextSchema } from "./user-memory.js";

/** The most text one import carries, whatever its source. */
export const APP_IMPORT_TEXT_MAX = 400_000;
const SKILL_CONTENT_MAX = 100_000;
const SKILL_FILES_MAX = 500;

/**
 * Model-facing text pasted into another product, so it stays in English. Its keys are the ones
 * `AppExportSchema` reads.
 */
export const APP_IMPORT_PROMPT = `I am moving you to another assistant app. Describe your own setup as one JSON object in exactly this shape:

{
  "name": "your name",
  "role": "one line: what you are for",
  "description": "a short paragraph about what you do",
  "instructions": "your full system instructions, verbatim, as plain text",
  "conversation_starters": ["up to 4 short example prompts"],
  "knowledge_files": ["names of the files you were given, names only"],
  "memory": ["one short fact about me per item, 200 characters at most"],
  "connections": ["names of the apps or tools you are connected to"],
  "routines": [{ "name": "a scheduled task", "prompt": "what it does", "schedule": "5-field cron, if you know it" }]
}

Rules:
- Leave out any key you have nothing for, or use an empty list.
- Copy your instructions word for word; do not summarise them.
- Never include passwords, API keys, tokens or other secrets.
- Reply with the JSON object only, in one code block.
`;

/** Each list item that does not fit is left out, so one bad entry does not lose the rest. */
const lenientList = <T extends z.ZodType>(item: T, cap: number) =>
  z
    .array(z.unknown())
    .max(10_000)
    .default([])
    .transform((raw) =>
      raw.slice(0, cap).flatMap((entry) => {
        const parsed = item.safeParse(entry);
        return parsed.success ? [parsed.data as z.output<T>] : [];
      }),
    );

/** What an assistant answers to `APP_IMPORT_PROMPT`. Keys it does not know are ignored. */
export const AppExportSchema = z.object({
  name: z.string().trim().min(1).max(BOT_NAME_MAX_LENGTH),
  role: z.string().trim().max(BOT_TITLE_MAX_LENGTH).default(""),
  description: z.string().trim().max(BOT_DESCRIPTION_MAX_LENGTH).default(""),
  instructions: z.string().max(BOT_INSTRUCTIONS_MAX_LENGTH).default(""),
  conversation_starters: lenientList(BotStartersSchema.element, 4),
  knowledge_files: lenientList(z.string().trim().min(1).max(200), 100),
  memory: lenientList(UserMemoryTextSchema, 200),
  connections: lenientList(z.string().trim().min(1).max(100), 50),
  routines: lenientList(
    z.object({
      name: z.string().trim().min(1).max(80),
      prompt: z.string().trim().min(1).max(10_000),
      schedule: z.string().trim().min(1).max(100).optional(),
    }),
    20,
  ),
});
export type AppExport = z.infer<typeof AppExportSchema>;

const AppImportFileSchema = z.object({
  path: z.string().min(1).max(1000),
  content: z.string().max(SKILL_CONTENT_MAX),
});

/** One of three things the person brings: an assistant's answer, skill files, or a text file. */
export const ImportFromAppInput = z.discriminatedUnion("source", [
  z.object({ source: z.literal("prompt"), text: z.string().min(1).max(APP_IMPORT_TEXT_MAX) }),
  z.object({
    source: z.literal("skills"),
    files: z.array(AppImportFileSchema).min(1).max(SKILL_FILES_MAX),
  }),
  z.object({
    source: z.literal("text"),
    name: z.string().trim().max(BOT_NAME_MAX_LENGTH).default(""),
    content: z.string().min(1).max(APP_IMPORT_TEXT_MAX),
  }),
]);
export type ImportFromAppInput = z.infer<typeof ImportFromAppInput>;

/**
 * What an import will bring, before anything is written. `space` is the translation into the
 * space file, to be sent to `bots.importSpace`; keys and credentials are never in it.
 */
export const ImportFromAppPreviewSchema = z.object({
  agents: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      instructions: z.string(),
      /** An agent of this name is already in the space, so it is left as it is. */
      exists: z.boolean(),
    }),
  ),
  skills: z.array(z.string()),
  routines: z.array(z.object({ name: z.string(), schedule: z.string().nullable() })),
  facts: z.number().int(),
  /** Knowledge files to add again by hand. */
  files: z.array(z.string()),
  /** Apps to connect again. */
  connections: z.array(z.string()),
  /** Items that did not fit or looked like a key. */
  leftOut: z.number().int(),
  space: SpaceExportSchema,
});
export type ImportFromAppPreview = z.infer<typeof ImportFromAppPreviewSchema>;
