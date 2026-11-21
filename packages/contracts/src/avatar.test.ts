import { describe, expect, it } from "vitest";
import {
  AVATAR_COLORS,
  AVATAR_IMAGE_MAX_LENGTH,
  avatarInk,
  isAvatarValue,
  parseAvatar,
  SetAvatarInputSchema,
} from "./avatar.js";

const png = "data:image/png;base64,iVBORw0KGgo=";

describe("isAvatarValue", () => {
  it.each([...AVATAR_COLORS, "#abcdef", png, "data:image/webp;base64,UklGRg=="])(
    "accepts %s",
    (value) => expect(isAvatarValue(value)).toBe(true),
  );

  it.each([
    "",
    "red",
    "#fff",
    "#12345",
    "http://tracker.example/pixel.gif",
    "https://example.com/me.png",
    "//example.com/me.png",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:text/html;base64,PGgxPg==",
    "javascript:alert(1)",
    "#8B5CF6::shape_3",
    "#8B5CF6::char_cat",
  ])("rejects %s", (value) => expect(isAvatarValue(value)).toBe(false));

  it("caps the size of a picture", () => {
    const big = `data:image/png;base64,${"A".repeat(AVATAR_IMAGE_MAX_LENGTH)}`;
    expect(isAvatarValue(big)).toBe(false);
    expect(SetAvatarInputSchema.safeParse({ avatar: big }).success).toBe(false);
  });
});

describe("SetAvatarInputSchema", () => {
  it("takes a value or null to clear", () => {
    expect(SetAvatarInputSchema.safeParse({ avatar: "#15803D" }).success).toBe(true);
    expect(SetAvatarInputSchema.safeParse({ avatar: null }).success).toBe(true);
    expect(SetAvatarInputSchema.safeParse({ avatar: "http://x.test/a.png" }).success).toBe(false);
    expect(SetAvatarInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("parseAvatar", () => {
  it("tells a color, a picture and nothing apart", () => {
    expect(parseAvatar(null)).toEqual({ kind: "none" });
    expect(parseAvatar("#15803D")).toEqual({ kind: "color", color: "#15803D" });
    expect(parseAvatar(png)).toEqual({ kind: "image", src: png });
    expect(parseAvatar("https://lh3.example/photo")).toEqual({
      kind: "image",
      src: "https://lh3.example/photo",
    });
  });
});

describe("avatarInk", () => {
  it("is white on dark colors and black on light ones", () => {
    expect(avatarInk("#15803D")).toBe("#FFFFFF");
    expect(avatarInk("#FDE68A")).toBe("#000000");
  });
  it("keeps every offered color readable", () => {
    for (const color of AVATAR_COLORS) expect(avatarInk(color)).toBe("#FFFFFF");
  });
});
