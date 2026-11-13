import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

/** What a person can do in a workspace. Custom roles that add up come later. */
export const SPACE_ROLES = ["owner", "admin", "member"] as const;
export const SpaceRoleSchema = z.enum(SPACE_ROLES);
export type SpaceRole = z.infer<typeof SpaceRoleSchema>;

export const MAX_INVITE_ADDRESSES = 50;

export const SpaceMemberSchema = z.object({
  userId: Id,
  name: z.string(),
  email: z.string(),
  role: SpaceRoleSchema,
  joinedAt: IsoDate,
});
export type SpaceMember = z.infer<typeof SpaceMemberSchema>;

export const SpaceInvitationSchema = z.object({
  id: Id,
  email: z.string(),
  role: SpaceRoleSchema,
  status: z.enum(["pending", "accepted"]),
  expiresAt: IsoDate,
  createdAt: IsoDate,
  /** Who joined, once an invitation is accepted; shown for a week. */
  acceptedByName: z.string().nullable(),
  /** The invitation link, for sharing by hand where no email is sent. Pending only. */
  link: z.string().nullable(),
});
export type SpaceInvitation = z.infer<typeof SpaceInvitationSchema>;

export const SpaceInviteResultSchema = z.object({
  /** Whether the server sent the email; false means the inviter shares the link. */
  emailed: z.boolean(),
  invitations: z.array(SpaceInvitationSchema),
  /** Addresses that already belong to the workspace. */
  alreadyMembers: z.array(z.string()),
});

export const SpaceJoinRequestSchema = z.object({
  id: Id,
  name: z.string(),
  email: z.string(),
  createdAt: IsoDate,
});

export type SpaceJoinRequest = z.infer<typeof SpaceJoinRequestSchema>;

export const SpaceInviteLinkSchema = z.object({ link: z.string().nullable() });

/** What the invited person sees before signing in; reachable only with the link's token. */
export const InvitationPreviewSchema = z.object({
  spaceName: z.string(),
  inviterName: z.string(),
  email: z.string(),
});
