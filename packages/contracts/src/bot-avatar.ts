import * as z from "zod";

/** Matches the eight shipped mascot shapes in `@corvo/core`. */
export const BOT_AVATAR_SHAPE_COUNT = 8;

/**
 * The chess pieces an agent can be, besides the rook every bot wears by default. They come first
 * when choosing a look, and an agent's role picks one of them.
 */
export const CHESS_PIECE_IDS = ["king", "queen", "bishop", "knight", "pawn"] as const;
export type ChessPieceId = (typeof CHESS_PIECE_IDS)[number];

/**
 * The characters a bot can wear in its own color, from Open Bot Avatar (MIT), by the id of their
 * definition. Their geometry lives where they are drawn; this is what a stored value may name.
 */
export const BOT_AVATAR_CHARACTER_IDS = [
  ...CHESS_PIECE_IDS,
  "controller",
  "barbell",
  "mug",
  "lightbulb",
  "chat",
  "sprout",
  "watering-can",
  "book",
  "brain",
  "bull",
  "bunny",
  "camera",
  "cat",
  "cloud",
  "ghost",
  "magnifier",
  "paint-brush",
  "palette",
  "rocket",
  "shield",
  "star",
  "witch-hat",
] as const;
export type BotAvatarCharacterId = (typeof BOT_AVATAR_CHARACTER_IDS)[number];

const CHARACTER_IDS: ReadonlySet<string> = new Set(BOT_AVATAR_CHARACTER_IDS);

/**
 * 256x256 webp data URLs from Avatar Studio stay well under this. Cap writes so
 * a pasted raw photo cannot bloat every bot list payload.
 */
export const BOT_AVATAR_VALUE_MAX_LENGTH = 200_000;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SHAPE_SUFFIX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})::shape_\d+$/;
const CHARACTER_SUFFIX = /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))::char_([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export type ParsedBotAvatar =
  | { kind: "image"; imageUrl: string }
  | { kind: "shape"; color: string; shapeIndex: number }
  | { kind: "character"; color: string; characterId: BotAvatarCharacterId }
  | { kind: "color"; color: string }
  | { kind: "other"; raw: string };

export function parseBotAvatarValue(raw: string): ParsedBotAvatar {
  if (raw.startsWith("data:image/")) {
    return { kind: "image", imageUrl: raw };
  }
  if (raw.includes("::char_")) {
    const found = CHARACTER_SUFFIX.exec(raw);
    if (found && CHARACTER_IDS.has(found[2] ?? "")) {
      return {
        kind: "character",
        color: found[1] ?? "#F97316",
        characterId: found[2] as BotAvatarCharacterId,
      };
    }
    // A character that is gone or never was still has its color to show.
    const color = raw.split("::char_")[0] ?? "";
    if (HEX_COLOR.test(color)) return { kind: "color", color };
    return { kind: "other", raw };
  }
  if (raw.includes("::shape_")) {
    const parts = raw.split("::shape_");
    const color = parts[0] || "#F97316";
    const rawShape = parts[1] ?? "0";
    const parsedShape = /^\d+$/.test(rawShape) ? Number(rawShape) : 0;
    const shapeIndex = Number.isSafeInteger(parsedShape) ? parsedShape % BOT_AVATAR_SHAPE_COUNT : 0;
    return { kind: "shape", color, shapeIndex };
  }
  if (HEX_COLOR.test(raw)) return { kind: "color", color: raw };
  return { kind: "other", raw };
}

/** True for values we persist on `bots.color` (hex, encoded shape or character, or data image). */
export function isBotAvatarValue(raw: string): boolean {
  if (!raw || raw.length > BOT_AVATAR_VALUE_MAX_LENGTH) return false;
  if (HEX_COLOR.test(raw) || SHAPE_SUFFIX.test(raw) || DATA_IMAGE.test(raw)) return true;
  const character = CHARACTER_SUFFIX.exec(raw);
  return Boolean(character && CHARACTER_IDS.has(character[2] ?? ""));
}

/** A color wearing a character, or the color alone when there is none. */
export function composeBotAvatarValue(
  color: string,
  characterId?: BotAvatarCharacterId | null,
): string {
  return characterId ? `${color}::char_${characterId}` : color;
}

/** The character a stored value wears, if it wears one. */
export function botAvatarCharacter(raw: string): BotAvatarCharacterId | null {
  const parsed = parseBotAvatarValue(raw);
  return parsed.kind === "character" ? parsed.characterId : null;
}

export const BotAvatarValueSchema = z
  .string()
  .min(1)
  .max(BOT_AVATAR_VALUE_MAX_LENGTH)
  .refine(isBotAvatarValue, { message: "Invalid bot avatar" });
