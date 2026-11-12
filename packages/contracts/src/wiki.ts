import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

/** The longest page body that can be written, in characters. */
export const WIKI_BODY_MAX = 200_000;

/** A page's title: something a person can read, with a letter or a digit in it. */
export const WikiTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/[\p{L}\p{N}]/u, "A title needs a letter or a digit");

export const WikiPageInfoSchema = z.object({
  title: z.string(),
  path: z.string(),
  kind: z.string(),
  summary: z.string(),
  revision: z.number().int(),
  updatedAt: IsoDate,
});
export type WikiPageInfo = z.infer<typeof WikiPageInfoSchema>;

export const WikiPageSchema = WikiPageInfoSchema.extend({
  body: z.string(),
  /** Pages this one links to. */
  links: z.array(z.string()),
  /** The links that name no page yet. */
  missing: z.array(z.string()),
  /** Pages that link to this one. */
  backlinks: z.array(z.string()),
});
export type WikiPage = z.infer<typeof WikiPageSchema>;

export const WikiHitSchema = z.object({
  title: z.string(),
  kind: z.string(),
  snippet: z.string(),
});
export type WikiHit = z.infer<typeof WikiHitSchema>;

export const WikiRevisionSchema = z.object({
  revision: z.number().int(),
  at: IsoDate,
  bytes: z.number().int(),
});
export type WikiRevision = z.infer<typeof WikiRevisionSchema>;

export const WikiWriteInputSchema = z.object({
  title: WikiTitleSchema,
  body: z.string().max(WIKI_BODY_MAX),
  /**
   * The revision the writer saw; the write is refused when the page has moved on. 0 says the
   * page must not exist yet, which is how a new page is written without replacing one.
   */
  expectedRevision: z.number().int().min(0).optional(),
});
export type WikiWriteInput = z.infer<typeof WikiWriteInputSchema>;

export const WikiChangeStateSchema = z.enum([
  "pending",
  "applied",
  "refused",
  "conflict",
  "undone",
]);
export type WikiChangeState = z.infer<typeof WikiChangeStateSchema>;

/** What a change does to a page: write a new one, add to one, or swap a passage in one. */
export const WikiChangeOpKindSchema = z.enum(["create", "append", "replace"]);

export const WikiChangePageSchema = z.object({ title: z.string(), op: WikiChangeOpKindSchema });
export type WikiChangePage = z.infer<typeof WikiChangePageSchema>;

/** What one operation would write, so a person can read it before approving it. */
export const WikiChangeEditSchema = z.object({
  title: z.string(),
  op: WikiChangeOpKindSchema,
  section: z.string().optional(),
  removed: z.string().optional(),
  added: z.string(),
});
export type WikiChangeEdit = z.infer<typeof WikiChangeEditSchema>;

/**
 * A package of page operations the curator proposed. The quoted source is filled only for the
 * person who can read the conversation it came from.
 */
export const WikiChangeSchema = z.object({
  id: Id,
  state: WikiChangeStateSchema,
  /** The model's summary of the conversation; empty for anyone who may not read that conversation. */
  reason: z.string(),
  sourceTitle: z.string(),
  pages: z.array(WikiChangePageSchema),
  edits: z.array(WikiChangeEditSchema),
  createdAt: IsoDate,
  canSeeSource: z.boolean(),
  sourceText: z.string().optional(),
  /** Found by the review of the pages, not drawn from a conversation: a problem to look at. */
  review: z.boolean().optional(),
});
export type WikiChange = z.infer<typeof WikiChangeSchema>;

export const WikiChangeDecideInputSchema = z.object({
  changeId: Id,
  decision: z.enum(["apply", "refuse", "undo"]),
});

export const WikiSettingsSchema = z.object({
  /** Whether the curator reads conversations at all. */
  capture: z.boolean(),
  /** Whether edits to existing pages wait for approval or go in at once. */
  edits: z.enum(["approve", "auto"]),
});
export type WikiSettings = z.infer<typeof WikiSettingsSchema>;
export const WikiSettingsPatchSchema = WikiSettingsSchema.partial();

/** One conversation's switch: on, off, or null to follow its kind (channels on, chats with one agent off). */
export const WikiCaptureValueSchema = z.boolean().nullable();

/** One conversation's switch as the curator reads it: what is stored and what it comes to. */
export const WikiCaptureStateSchema = z.object({
  /** False when the curator cannot read this conversation (off for the Space, or held by outsiders). */
  available: z.boolean(),
  /** The conversation's own value; null follows the default for its kind and Space. */
  capture: WikiCaptureValueSchema,
  /** Whether the curator reads the conversation now. */
  on: z.boolean(),
  /** Only the conversation's owner changes the switch. */
  canChange: z.boolean(),
});
export type WikiCaptureState = z.infer<typeof WikiCaptureStateSchema>;

export const WikiApplyAllResultSchema = z.object({
  applied: z.number().int(),
  conflicts: z.number().int(),
});
export type WikiApplyAllResult = z.infer<typeof WikiApplyAllResultSchema>;

/** A file being read into the wiki, or one that could not be read. */
export const WikiImportSchema = z.object({
  id: Id,
  name: z.string(),
  state: z.enum(["reading", "failed"]),
  /** How many parts the file was cut into (0 until it has been opened) and how many are read. */
  parts: z.number().int(),
  readParts: z.number().int(),
  error: z.string().optional(),
});
export type WikiImport = z.infer<typeof WikiImportSchema>;

export const WikiImportStartInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mimeType: z.string().max(200),
  contentBase64: z.string().min(1),
});
