import * as z from "zod";

/** The first steps a new account is guided through, in the order they are listed. */
export const MISSION_IDS = ["talk", "decide", "connect", "second", "routine", "memory"] as const;
export const MissionId = z.enum(MISSION_IDS);
export type MissionId = z.infer<typeof MissionId>;

/** The parts of the navigation that stay out of sight until a mission brings them. */
export const NAV_PARTS = [
  "board",
  "team",
  "routines",
  "workflows",
  "usage",
  "artifacts",
  "wiki",
  "approvals",
  "memory",
] as const;
export const NavPart = z.enum(NAV_PARTS);
export type NavPart = z.infer<typeof NavPart>;

export const MissionsViewSchema = z.object({
  /** True while this member's navigation is still growing. */
  short: z.boolean(),
  /** Missions already completed; a mission never leaves this list. */
  completed: z.array(MissionId),
  /** Parts that already have content, so they show without a mission. */
  has: z.array(NavPart),
  /** Parts a mission brought that the person has opened. */
  seen: z.array(NavPart),
});
export type MissionsView = z.infer<typeof MissionsViewSchema>;
