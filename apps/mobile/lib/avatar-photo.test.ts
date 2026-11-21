import { AVATAR_IMAGE_MAX_LENGTH } from "@corvo/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-image-manipulator", () => ({}));
vi.mock("expo-image-picker", () => ({}));

describe("avatar photo", () => {
  it("sends a JPEG data URL and checks it against the shared size cap", async () => {
    const { avatarDataUrl, avatarFits } = await import("./avatar-photo");
    const url = avatarDataUrl("AAAA");
    expect(url).toBe("data:image/jpeg;base64,AAAA");
    expect(avatarFits(url)).toBe(true);
    expect(avatarFits(avatarDataUrl("A".repeat(AVATAR_IMAGE_MAX_LENGTH)))).toBe(false);
  });
});
