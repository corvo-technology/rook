import { AVATAR_IMAGE_MAX_LENGTH } from "@corvo/contracts";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

const PHOTO_EDGE = 256;

/** A JPEG as the data URL an avatar is sent in; the server re-encodes it. */
export function avatarDataUrl(base64: string): string {
  return `data:image/jpeg;base64,${base64}`;
}

/** True when a data URL is small enough to send as an avatar. */
export function avatarFits(dataUrl: string): boolean {
  return dataUrl.length <= AVATAR_IMAGE_MAX_LENGTH;
}

/**
 * Lets the person choose and crop a square photo from the library, then shrinks it. Null when they
 * cancel; throws when the photo cannot be used.
 */
export async function pickAvatarPhoto(): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (!asset) return null;
  const context = ImageManipulator.ImageManipulator.manipulate(asset.uri);
  context.resize({ width: PHOTO_EDGE });
  const image = await context.renderAsync();
  for (const compress of [0.8, 0.6, 0.4]) {
    const saved = await image.saveAsync({
      compress,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    const dataUrl = avatarDataUrl(saved.base64 ?? "");
    if (saved.base64 && avatarFits(dataUrl)) return dataUrl;
  }
  throw new Error("Avatar photo is too large");
}
