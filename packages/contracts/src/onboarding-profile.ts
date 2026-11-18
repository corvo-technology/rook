import { z } from "zod";
import { Id } from "./ids.js";

/** What the workspace does, as the "what you do" step offers it. */
export const BUSINESS_KINDS = [
  "agency",
  "online-store",
  "clinic",
  "software",
  "customer-service",
  "services-office",
  "other",
] as const;
export const BusinessKind = z.enum(BUSINESS_KINDS);
export type BusinessKind = z.infer<typeof BusinessKind>;

/** What a person looks after, as the "about you" step offers it. */
export const WORK_AREAS = [
  "development",
  "marketing",
  "sales",
  "finance",
  "operations",
  "support",
  "other",
] as const;
export const WorkArea = z.enum(WORK_AREAS);
export type WorkArea = z.infer<typeof WorkArea>;

export const BUSINESS_SUMMARY_MAX_LENGTH = 300;

/** What the person said about the workspace's business. */
export const BusinessAnswerSchema = z.object({
  kind: BusinessKind,
  summary: z.string().trim().max(BUSINESS_SUMMARY_MAX_LENGTH).default(""),
});
export type BusinessAnswer = z.infer<typeof BusinessAnswerSchema>;

/** What first-run onboarding knows about a person, on any device. */
export const OnboardingAnswersSchema = z.object({
  business: BusinessAnswerSchema.nullable(),
  areas: z.array(WorkArea).max(WORK_AREAS.length),
  /** The picture chosen for the workspace, a small data URL. */
  logo: z.string().nullable(),
});
export type OnboardingAnswers = z.infer<typeof OnboardingAnswersSchema>;

/** The largest workspace logo the server keeps: a data URL of a small image. */
export const SPACE_LOGO_MAX_LENGTH = 60_000;
export const SpaceLogoSchema = z
  .string()
  .max(SPACE_LOGO_MAX_LENGTH)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);

/** A channel the suggested team starts with: its name and the catalog agents in it. */
export const TeamChannelPickSchema = z.object({
  name: z.string().trim().min(1).max(40),
  agentSlugs: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/))
    .min(1)
    .max(6),
});
export type TeamChannelPick = z.infer<typeof TeamChannelPickSchema>;

export const TeamAgentSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export const HomeChecklistItemId = z.enum(["invite", "connect", "routine", "talk"]);
export type HomeChecklistItemId = z.infer<typeof HomeChecklistItemId>;
export const HOME_CHECKLIST_ITEMS = ["talk", "connect", "routine", "invite"] as const;

/** The getting-started list on Home; absent once every item is done. */
export const HomeChecklistSchema = z.object({
  items: z.array(z.object({ id: HomeChecklistItemId, done: z.boolean() })),
  done: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  /** The Chief's id, so the list can open its chat. */
  chiefId: Id.nullable(),
});
export type HomeChecklist = z.infer<typeof HomeChecklistSchema>;

/** The business answer with the language its wiki page is written in. */
export const SaveBusinessInputSchema = BusinessAnswerSchema.extend({
  /** The app's language tag; the page is written in it, English when it is not shipped. */
  locale: z.string().max(20).default("en"),
});
