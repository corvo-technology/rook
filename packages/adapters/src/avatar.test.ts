import { AVATAR_IMAGE_MAX_LENGTH, AVATAR_IMAGE_SIZE } from "@corvo/contracts";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { encodeAvatarImage, resolveAvatarValue } from "./avatar.js";

async function photo(width: number, height: number, format: "png" | "jpeg" = "png") {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 37) % 251;
  return sharp(raw, { raw: { width, height, channels: 3 } })
    [format]()
    .toBuffer();
}

async function sizeOf(dataUrl: string) {
  const meta = await sharp(Buffer.from(dataUrl.split(",")[1] ?? "", "base64")).metadata();
  return { width: meta.width, height: meta.height, format: meta.format };
}

describe("encodeAvatarImage", () => {
  it("crops any photo to a small square webp within the size cap", async () => {
    const dataUrl = await encodeAvatarImage(await photo(600, 300));
    expect(dataUrl.startsWith("data:image/webp;base64,")).toBe(true);
    expect(dataUrl.length).toBeLessThanOrEqual(AVATAR_IMAGE_MAX_LENGTH);
    expect(await sizeOf(dataUrl)).toEqual({
      width: AVATAR_IMAGE_SIZE,
      height: AVATAR_IMAGE_SIZE,
      format: "webp",
    });
  });

  it("refuses bytes that are not an image", async () => {
    await expect(encodeAvatarImage(Buffer.from("<svg onload=alert(1)/>"))).rejects.toThrow();
  });
});

describe("resolveAvatarValue", () => {
  it("keeps colors and clears on null", async () => {
    await expect(resolveAvatarValue("#15803D")).resolves.toEqual({ avatar: "#15803D" });
    await expect(resolveAvatarValue(null)).resolves.toEqual({ avatar: null });
  });

  it("re-encodes a data image instead of storing what was sent", async () => {
    const sent = `data:image/jpeg;base64,${(await photo(90, 90, "jpeg")).toString("base64")}`;
    const result = await resolveAvatarValue(sent);
    if (!("avatar" in result) || !result.avatar) throw new Error("expected an avatar");
    expect(result.avatar).not.toBe(sent);
    expect(result.avatar.startsWith("data:image/webp;base64,")).toBe(true);
  });

  it.each([
    "http://tracker.example/pixel.gif",
    "https://example.com/me.png",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "red",
  ])("refuses %s", async (value) => {
    await expect(resolveAvatarValue(value)).resolves.toHaveProperty("error");
  });

  it("refuses a data image that does not decode", async () => {
    await expect(resolveAvatarValue("data:image/png;base64,AAAA")).resolves.toHaveProperty("error");
  });
});
