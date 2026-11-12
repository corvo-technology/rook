import { describe, expect, it } from "vitest";
import {
  BOT_AVATAR_CHARACTER_IDS,
  BOT_AVATAR_VALUE_MAX_LENGTH,
  BotAvatarValueSchema,
  botAvatarCharacter,
  composeBotAvatarValue,
  isBotAvatarValue,
  parseBotAvatarValue,
  UpdateBotInput,
} from "./index.js";

describe("bot avatar values", () => {
  it("parses hex, encoded shapes, and data images", () => {
    expect(parseBotAvatarValue("#8B5CF6")).toEqual({ kind: "color", color: "#8B5CF6" });
    expect(parseBotAvatarValue("#8B5CF6::shape_3")).toEqual({
      kind: "shape",
      color: "#8B5CF6",
      shapeIndex: 3,
    });
    expect(parseBotAvatarValue("data:image/png;base64,abc")).toEqual({
      kind: "image",
      imageUrl: "data:image/png;base64,abc",
    });
  });

  it("does not treat remote URLs as images", () => {
    expect(parseBotAvatarValue("https://evil.example/track.png")).toEqual({
      kind: "other",
      raw: "https://evil.example/track.png",
    });
    expect(isBotAvatarValue("https://evil.example/track.png")).toBe(false);
  });

  it("accepts persisted writes and rejects oversized or remote values", () => {
    expect(isBotAvatarValue("#3EC5A8")).toBe(true);
    expect(isBotAvatarValue("#8B5CF6::shape_0")).toBe(true);
    expect(isBotAvatarValue("data:image/webp;base64,aGVsbG8=")).toBe(true);
    expect(isBotAvatarValue("#8B5CF6::shape_3junk")).toBe(false);
    expect(
      isBotAvatarValue(`data:image/png;base64,${"A".repeat(BOT_AVATAR_VALUE_MAX_LENGTH)}`),
    ).toBe(false);
    expect(BotAvatarValueSchema.safeParse("#fff").success).toBe(true);
    expect(BotAvatarValueSchema.safeParse("not-a-color").success).toBe(false);
    expect(UpdateBotInput.safeParse({ botId: "bot-1", color: "#8B5CF6::shape_2" }).success).toBe(
      true,
    );
    expect(
      UpdateBotInput.safeParse({ botId: "bot-1", color: "https://evil.example/x.png" }).success,
    ).toBe(false);
    expect(UpdateBotInput.safeParse({ botId: "bot-1", color: "gray" }).success).toBe(false);
    expect(UpdateBotInput.safeParse({ botId: "bot-1", name: "Atlas" }).success).toBe(true);
  });
});

describe("a character in a bot avatar value", () => {
  it("names the characters a bot can wear, each once", () => {
    expect(BOT_AVATAR_CHARACTER_IDS).toHaveLength(27);
    expect(new Set(BOT_AVATAR_CHARACTER_IDS).size).toBe(BOT_AVATAR_CHARACTER_IDS.length);
    for (const id of BOT_AVATAR_CHARACTER_IDS) expect(id, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("parses a character in its color", () => {
    expect(parseBotAvatarValue("#1FBF68::char_sprout")).toEqual({
      kind: "character",
      color: "#1FBF68",
      characterId: "sprout",
    });
    expect(parseBotAvatarValue("#fb3::char_paint-brush")).toMatchObject({
      kind: "character",
      characterId: "paint-brush",
    });
  });

  it("falls back to the color for a character that is not known, rather than to nothing", () => {
    expect(parseBotAvatarValue("#1FBF68::char_not-a-character")).toEqual({
      kind: "color",
      color: "#1FBF68",
    });
    expect(parseBotAvatarValue("#1FBF68::char_")).toEqual({ kind: "color", color: "#1FBF68" });
  });

  it("accepts a known character and nothing else after the color", () => {
    expect(isBotAvatarValue("#1FBF68::char_sprout")).toBe(true);
    expect(isBotAvatarValue("#fff::char_witch-hat")).toBe(true);
    expect(isBotAvatarValue("#1FBF68::char_unknown")).toBe(false);
    expect(isBotAvatarValue("#1FBF68::char_sprout::shape_1")).toBe(false);
    expect(isBotAvatarValue("#1FBF68::char_sprout ")).toBe(false);
    expect(isBotAvatarValue("::char_sprout")).toBe(false);
    expect(isBotAvatarValue("red::char_sprout")).toBe(false);
    expect(BotAvatarValueSchema.safeParse("#1FBF68::char_sprout").success).toBe(true);
    expect(UpdateBotInput.safeParse({ botId: "bot-1", color: "#1FBF68::char_cat" }).success).toBe(
      true,
    );
  });

  it("puts a character on a color, and takes it off again", () => {
    expect(composeBotAvatarValue("#1FBF68", "sprout")).toBe("#1FBF68::char_sprout");
    expect(composeBotAvatarValue("#1FBF68")).toBe("#1FBF68");
    expect(composeBotAvatarValue("#1FBF68", null)).toBe("#1FBF68");
    expect(botAvatarCharacter("#1FBF68::char_sprout")).toBe("sprout");
    expect(botAvatarCharacter("#1FBF68")).toBeNull();
    expect(botAvatarCharacter("#1FBF68::shape_2")).toBeNull();
    expect(botAvatarCharacter("data:image/webp;base64,aGVsbG8=")).toBeNull();
  });

  it("leaves what was stored before as it was", () => {
    expect(parseBotAvatarValue("#8B5CF6::shape_3")).toEqual({
      kind: "shape",
      color: "#8B5CF6",
      shapeIndex: 3,
    });
    expect(isBotAvatarValue("#8B5CF6::shape_3")).toBe(true);
  });
});
