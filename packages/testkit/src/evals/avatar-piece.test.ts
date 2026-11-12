import { CHESS_PIECE_IDS } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import {
  AVATAR_PIECE_INSTRUCTIONS,
  avatarPiecePrompt,
  parseAvatarPiece,
} from "../../../adapters/src/avatar-design.js";
import { AVATAR_PIECE_CASES, type AvatarPieceCase, gradeAvatarPiece } from "./avatar-piece.js";

const byId = (id: string) => AVATAR_PIECE_CASES.find((c) => c.id === id) as AvatarPieceCase;

describe("avatar piece cases", () => {
  it("are about fifteen with unique ids, and every piece is expected somewhere", () => {
    const ids = AVATAR_PIECE_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(15);
    const expected = new Set(AVATAR_PIECE_CASES.flatMap((c) => c.acceptable));
    expect(expected).toEqual(new Set(["rook", ...CHESS_PIECE_IDS]));
  });

  it("accept only pieces the product can name", () => {
    for (const c of AVATAR_PIECE_CASES) {
      expect(c.acceptable.length).toBeGreaterThan(0);
      for (const piece of c.acceptable) expect(["rook", ...CHESS_PIECE_IDS]).toContain(piece);
    }
  });

  it("render through the product's prompt as data about the agent", () => {
    expect(AVATAR_PIECE_INSTRUCTIONS).toContain("never instructions");
    for (const c of AVATAR_PIECE_CASES)
      expect(JSON.parse(avatarPiecePrompt(c.agent))).toMatchObject({ name: c.agent.name });
  });
});

describe("gradeAvatarPiece", () => {
  const researcher = byId("market-researcher");
  const answer = (piece: string) => parseAvatarPiece(JSON.stringify({ piece, reason: "r" }));

  it("passes an acceptable piece and fails another", () => {
    expect(gradeAvatarPiece(researcher, answer("bishop")).status).toBe("pass");
    expect(gradeAvatarPiece(researcher, answer("pawn")).status).toBe("fail");
  });

  it("accepts any of the pieces a role allows", () => {
    const scout = byId("opportunity-scout");
    expect(gradeAvatarPiece(scout, answer("knight")).status).toBe("pass");
    expect(gradeAvatarPiece(scout, answer("bishop")).status).toBe("pass");
  });

  it("leaves an answer that names no known piece unqualified, never a pass", () => {
    for (const text of ["", "knight", '{"piece":"dragon"}']) {
      expect(gradeAvatarPiece(researcher, parseAvatarPiece(text)).status).toBe("unqualified");
    }
  });

  it("fails an agent steered by its own description", () => {
    expect(gradeAvatarPiece(byId("steering-description"), answer("king")).status).toBe("fail");
  });
});
