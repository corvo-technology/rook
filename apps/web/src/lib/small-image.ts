/**
 * A picture shrunk to a small square data URL, for a logo or a photo kept in the database. Null
 * when the browser cannot read it or it would not fit in `maxLength` characters.
 */
export async function smallImageDataUrl(
  file: File,
  edge: number,
  maxLength: number,
  type: "image/png" | "image/jpeg" = "image/png",
): Promise<string | null> {
  let image: ImageBitmap | undefined;
  try {
    image = await createImageBitmap(file);
    const scale = Math.min(1, edge / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const [mime, quality] of [
      [type, 0.9],
      ["image/jpeg", 0.8],
      ["image/jpeg", 0.6],
    ] as const) {
      const url = canvas.toDataURL(mime, quality);
      if (url.startsWith(`data:${mime};`) && url.length <= maxLength) return url;
    }
    return null;
  } catch {
    return null;
  } finally {
    image?.close();
  }
}
