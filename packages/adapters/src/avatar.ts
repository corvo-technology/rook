import {
  AVATAR_IMAGE_MAX_LENGTH,
  AVATAR_IMAGE_SIZE,
  isAvatarColor,
  isAvatarImage,
} from "@corvo/contracts";

/**
 * Re-encodes a picture as a small square webp data URL, the one form a person's or a space's
 * avatar is stored in. Decoding and encoding again drops metadata and anything that is not pixels.
 */
export async function encodeAvatarImage(bytes: Uint8Array): Promise<string> {
  // sharp is a native addon; load it only when an image is processed.
  const { default: sharp } = await import("sharp");
  for (const quality of [85, 70, 50]) {
    const webp = await sharp(bytes, { limitInputPixels: 16_000_000 })
      .rotate()
      .resize(AVATAR_IMAGE_SIZE, AVATAR_IMAGE_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality })
      .toBuffer();
    const dataUrl = `data:image/webp;base64,${webp.toString("base64")}`;
    if (dataUrl.length <= AVATAR_IMAGE_MAX_LENGTH) return dataUrl;
  }
  throw new Error("Avatar image is too large");
}

/**
 * What to store for a value a client sent: a color as it is, a picture re-encoded here rather than
 * trusted, and null for the default look. Anything else, such as a remote address, is refused.
 */
export async function resolveAvatarValue(
  value: string | null,
): Promise<{ avatar: string | null } | { error: string }> {
  if (value === null) return { avatar: null };
  if (isAvatarColor(value)) return { avatar: value };
  if (!isAvatarImage(value)) return { error: "Invalid avatar" };
  try {
    const bytes = Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
    return { avatar: await encodeAvatarImage(bytes) };
  } catch {
    return { error: "Could not use that image as an avatar." };
  }
}
