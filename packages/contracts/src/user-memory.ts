import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

/** The longest a remembered fact about a person can be, in characters. */
export const USER_MEMORY_TEXT_MAX = 200;

/** What a bot does with a fact about the person: save it alone, ask first, or only read. */
export const MemoryModeSchema = z.enum(["auto", "ask", "read"]);
export type MemoryMode = z.infer<typeof MemoryModeSchema>;
/** The mode of a bot that has none of its own. */
export const DEFAULT_MEMORY_MODE: MemoryMode = "ask";

export const UserMemoryStateSchema = z.enum(["pending", "saved", "forgotten"]);
export type UserMemoryState = z.infer<typeof UserMemoryStateSchema>;

export const UserMemorySourceSchema = z.enum(["typed", "agent", "learned"]);
export type UserMemorySource = z.infer<typeof UserMemorySourceSchema>;

export const UserMemorySchema = z.object({
  id: Id,
  text: z.string(),
  state: UserMemoryStateSchema,
  source: UserMemorySourceSchema,
  createdAt: IsoDate,
  /** Saved a long time ago and not confirmed since: the person is asked whether it still holds. */
  stale: z.boolean(),
});
export type UserMemory = z.infer<typeof UserMemorySchema>;

export const UserMemoryTextSchema = z.string().trim().min(1).max(USER_MEMORY_TEXT_MAX);

/** What a person does with a fact: keep a suggestion, drop it, forget one, confirm one, or erase it for good. */
export const UserMemoryDecisionSchema = z.enum(["save", "discard", "forget", "keep", "erase"]);
export type UserMemoryDecision = z.infer<typeof UserMemoryDecisionSchema>;

export const UserMemorySettingsSchema = z.object({
  /** Whether the memory model suggests facts from what the person says. */
  learn: z.boolean(),
});
export type UserMemorySettings = z.infer<typeof UserMemorySettingsSchema>;
