import { BOT_AVATAR_CHARACTER_IDS, CHESS_PIECE_IDS } from "@corvo/contracts";
import { validateAvatar } from "open-bot-avatar";
import { describe, expect, it } from "vitest";
import { BOT_CHARACTERS, botCharacter } from "./bot-characters.js";

describe("the characters an agent can wear", () => {
  it("are exactly the ones a stored value may name, in the same order", () => {
    expect(BOT_CHARACTERS.map((character) => character.id)).toEqual([...BOT_AVATAR_CHARACTER_IDS]);
  });

  it("start with the chess pieces", () => {
    expect(
      BOT_CHARACTERS.slice(0, CHESS_PIECE_IDS.length).map((character) => character.id),
    ).toEqual([...CHESS_PIECE_IDS]);
  });

  it.each(BOT_CHARACTERS)(
    "$id is a valid definition under the project's own contract",
    ({ id, name, definition }) => {
      const result = validateAvatar(definition);
      expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
      expect(definition.id).toBe(id);
      expect(definition.name).toBe(name);
    },
  );

  it("are found by id, and not by anything else", () => {
    expect(botCharacter("ghost")?.name).toBe("Ghost");
    expect(botCharacter("nobody")).toBeUndefined();
    expect(botCharacter("")).toBeUndefined();
  });
});
