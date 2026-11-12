import { CHESS_PIECES, ROOK_AVATAR, ROOK_EYE_COLOR } from "@corvo/core";
import { renderAvatarSvg } from "open-bot-avatar";
import { MASCOT_COLOR } from "./mascot";

export type TeamPiece = "rook" | keyof typeof CHESS_PIECES;

/** The set standing on the hairline, left to right: each with its color, width and the way it looks. */
export const TEAM: { piece: TeamPiece; color: string; width: number }[] = [
  { piece: "pawn", color: MASCOT_COLOR.laranja, width: 0.8 },
  { piece: "rook", color: MASCOT_COLOR.menta, width: 1.1 },
  { piece: "bishop", color: MASCOT_COLOR.violeta, width: 0.95 },
  { piece: "queen", color: MASCOT_COLOR.rosa, width: 1.05 },
  { piece: "king", color: MASCOT_COLOR.amarelo, width: 1.2 },
  { piece: "knight", color: MASCOT_COLOR.azul, width: 1 },
];

/** One piece as the app's engine draws it: still, eyes open, looking where `gaze` says. */
export function pieceSvg(
  piece: TeamPiece,
  color: string,
  gaze?: { x: number; y: number },
  eyeColor: string = ROOK_EYE_COLOR,
): string {
  const definition = piece === "rook" ? ROOK_AVATAR : CHESS_PIECES[piece];
  return renderAvatarSvg(definition, { color, eyeColor, reducedMotion: gaze === undefined, gaze })
    .replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true"')
    .replace(/<title>[^<]*<\/title>/, "");
}

/** Markup for the team: every piece looks up and toward the middle, so they seem to talk to each other. */
export function teamMarkup(unit: number): string {
  const mid = (TEAM.length - 1) / 2;
  return TEAM.map(({ piece, color, width }, i) => {
    const toward = Math.max(-1, Math.min(1, (mid - i) / 2));
    const gaze = { x: piece === "knight" ? -0.9 : toward, y: -0.35 };
    return `<span class="piece" style="width:${Math.round(unit * width)}px">${pieceSvg(piece, color, gaze)}</span>`;
  }).join("");
}
