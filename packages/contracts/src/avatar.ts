import * as z from "zod";

/**
 * What a person or a space wears: a picture or a color behind their initial. Agents have their own
 * richer avatars (`bot-avatar.ts`); people and spaces never wear characters or shapes.
 */

/** The largest picture kept, as a data URL. Avatars travel with every message and member list. */
export const AVATAR_IMAGE_MAX_LENGTH = 60_000;

/** The side, in pixels, a stored picture is re-encoded to on the server. */
export const AVATAR_IMAGE_SIZE = 128;

/** The colors offered behind an initial, as stored. Muted on purpose: the app is monochrome. */
export const AVATAR_COLORS = [
  "#64748B",
  "#B45309",
  "#B91C1C",
  "#BE185D",
  "#7E22CE",
  "#4338CA",
  "#0F766E",
  "#15803D",
] as const;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isAvatarColor(raw: string): boolean {
  return HEX_COLOR.test(raw);
}

/** A small data image: never a remote URL, so showing it cannot reach out to another server. */
export function isAvatarImage(raw: string): boolean {
  return raw.length <= AVATAR_IMAGE_MAX_LENGTH && DATA_IMAGE.test(raw);
}

/** True for what a client may store as its own avatar. */
export function isAvatarValue(raw: string): boolean {
  return isAvatarColor(raw) || isAvatarImage(raw);
}

export type ParsedAvatar =
  | { kind: "none" }
  | { kind: "color"; color: string }
  /** A stored picture, or the address a sign-in provider supplied. */
  | { kind: "image"; src: string };

export function parseAvatar(raw: string | null | undefined): ParsedAvatar {
  if (!raw) return { kind: "none" };
  return isAvatarColor(raw) ? { kind: "color", color: raw } : { kind: "image", src: raw };
}

/** The ink that stays readable on a color: black on light colors, white on dark ones. */
export function avatarInk(color: string): "#000000" | "#FFFFFF" {
  const hex = color.slice(1);
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#000000" : "#FFFFFF";
}

export const AvatarValueSchema = z
  .string()
  .min(1)
  .max(AVATAR_IMAGE_MAX_LENGTH)
  .refine(isAvatarValue, { message: "Invalid avatar" });

/** What a client sends to change an avatar: a value, or null to go back to the default look. */
export const SetAvatarInputSchema = z.object({ avatar: AvatarValueSchema.nullable() });
export type SetAvatarInput = z.infer<typeof SetAvatarInputSchema>;
