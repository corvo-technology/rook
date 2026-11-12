import { CHESS_PIECE_IDS } from "@corvo/contracts";
import { avatarFrame, validateAvatar } from "open-bot-avatar";
import { describe, expect, it } from "vitest";
import { CHESS_PIECES } from "./chess-pieces.js";
import { ROOK_AVATAR } from "./rook-avatar.js";

// Geometry only: the engine's strict check (face room, no seams) was run on each drawing when it
// was made; here we keep every piece valid, inside the safe area and a sibling of the rook.
describe("the chess pieces", () => {
  it("has a definition for each id, named after it", () => {
    expect(Object.keys(CHESS_PIECES).sort()).toEqual([...CHESS_PIECE_IDS].sort());
    for (const id of CHESS_PIECE_IDS) expect(CHESS_PIECES[id].id).toBe(id);
  });

  it.each(CHESS_PIECE_IDS)("%s is a valid Open Bot Avatar", (id) => {
    const result = validateAvatar(CHESS_PIECES[id]);
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
  });

  it.each(CHESS_PIECE_IDS)("%s stands on the rook's base and keeps its eyes' size", (id) => {
    const { eyes } = CHESS_PIECES[id];
    expect(eyes.scale).toBe(ROOK_AVATAR.eyes.scale);
    expect(CHESS_PIECES[id].body.path).toContain("H32A18 18 0 0 1 14 70");
  });

  it.each(CHESS_PIECE_IDS)("%s draws two eyes at rest and at every gaze", (id) => {
    for (const gaze of [
      undefined,
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
    ]) {
      const frame = avatarFrame(CHESS_PIECES[id], { gaze, reducedMotion: true });
      expect(frame.shapes.filter((shape) => shape.kind === "eye")).toHaveLength(2);
    }
  });
});
