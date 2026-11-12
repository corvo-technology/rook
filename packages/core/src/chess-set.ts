import type { ChessPieceId } from "@corvo/contracts";
import type { AvatarDefinition } from "open-bot-avatar";

/**
 * The rook as an Open Bot Avatar: one block under three battlements, drawn as a single outline so
 * the engine turns it as one rounded slab. It is a little wider than the small glyph so the eyes
 * have the room the engine's strict check asks for (see rook-avatar.test.tsx).
 */
export const ROOK_AVATAR: AvatarDefinition = {
  version: 1,
  id: "rook",
  name: "Rook",
  body: {
    path: "M19 12H29A5 5 0 0 1 34 17V28H42V17A5 5 0 0 1 47 12H53A5 5 0 0 1 58 17V28H66V17A5 5 0 0 1 71 12H81A5 5 0 0 1 86 17V70A18 18 0 0 1 68 88H32A18 18 0 0 1 14 70V17A5 5 0 0 1 19 12Z",
  },
  eyes: { x: 50, y: 57, spacing: 26, scale: 1.2 },
};

/*
 * The rest of the chess set beside the rook (the rook above): our own drawings for the Open
 * Bot Avatar format. Like the rook each is one soft outline on a solid base 72 wide (x 14..86, ending
 * at y 88), so the set reads as one family, with its eyes on the part that carries the face. They
 * meet the engine's strict targets (face room, no silhouette seams).
 */
export const CHESS_PIECES: Record<ChessPieceId, AvatarDefinition> = {
  king: {
    version: 1,
    id: "king",
    name: "King",
    // A cross over a rounded crown.
    body: {
      path: "M46 8H54V15H61V23H54V33C72 35 86 43 86 58V70A18 18 0 0 1 68 88H32A18 18 0 0 1 14 70V58C14 43 28 35 46 33V23H39V15H46Z",
    },
    eyes: { x: 50, y: 62, spacing: 26, scale: 1.2 },
  },
  queen: {
    version: 1,
    id: "queen",
    name: "Queen",
    // Three points of a crown, the middle one the highest.
    body: {
      path: "M18 14A5 5 0 0 1 28 14L32 34L45 15A5 5 0 0 1 55 15L68 34L72 14A5 5 0 0 1 82 14L86 70A18 18 0 0 1 68 88H32A18 18 0 0 1 14 70Z",
    },
    eyes: { x: 50, y: 62, spacing: 26, scale: 1.2 },
  },
  bishop: {
    version: 1,
    id: "bishop",
    name: "Bishop",
    // A mitre with its slit as a hole, on a collar.
    body: {
      path: "M50 8C66 18 72 32 70 44H73A5 5 0 0 1 78 49A5 5 0 0 1 73 54C81 58 86 62 86 70A18 18 0 0 1 68 88H32A18 18 0 0 1 14 70C14 62 19 58 27 54A5 5 0 0 1 22 49A5 5 0 0 1 27 44H30C28 32 34 18 50 8ZM47 22L45 25L56 38L59 35Z",
    },
    eyes: { x: 50, y: 67, spacing: 26, scale: 1.2 },
  },
  knight: {
    version: 1,
    id: "knight",
    name: "Knight",
    // A horse's head in profile, looking left, with its eyes on the head.
    body: {
      path: "M14 66V60A8 8 0 0 1 17 54L30 42L32 22L37 8L46 18C58 14 70 20 76 32C84 44 86 56 86 70A18 18 0 0 1 68 88H32A18 18 0 0 1 14 70Z",
    },
    eyes: { x: 58, y: 55, spacing: 22, scale: 1.2 },
  },
  pawn: {
    version: 1,
    id: "pawn",
    name: "Pawn",
    // A ball on a collar over a wide body.
    body: {
      path: "M38.8 36A15 15 0 1 1 61.2 36H68A5 5 0 0 1 73 41A5 5 0 0 1 68 46C80 50 86 58 86 70A18 18 0 0 1 68 88H32A18 18 0 0 1 14 70C14 58 20 50 32 46A5 5 0 0 1 27 41A5 5 0 0 1 32 36Z",
    },
    eyes: { x: 50, y: 66, spacing: 26, scale: 1.2 },
  },
};
