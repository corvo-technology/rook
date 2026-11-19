import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import type { ObjectStorage } from "@corvo/adapter-kit";
import { BRAND_ASSET_MAX_BYTES } from "@corvo/contracts";

export type BrandAssetKind = "logo" | "icon";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** The smallest square a home-screen icon may be: what installable web apps ask for. */
export const MIN_ICON_PIXELS = 512;

export class BrandAssetError extends Error {
  constructor(readonly reason: "too_large" | "not_an_image" | "icon_size" | "icon_type") {
    super(reason);
    this.name = "BrandAssetError";
  }
}

export interface DecodedAsset {
  bytes: Buffer;
  mimeType: string;
  extension: string;
  /** Pixels, read from the file; only PNG is measured. */
  size: { width: number; height: number } | null;
}

export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function matchesType(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === "image/png") return pngSize(bytes) !== null;
  if (mimeType === "image/jpeg") return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
  return (
    bytes.length > 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  );
}

/**
 * Checks what the partner sent is the image it says it is, within the size limit, and, for the
 * home-screen icon, a PNG that is square and large enough. Nothing is trusted from the label.
 */
export function decodeBrandAsset(
  kind: BrandAssetKind,
  input: { mimeType: string; dataBase64: string },
): DecodedAsset {
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (bytes.length === 0) throw new BrandAssetError("not_an_image");
  if (bytes.length > BRAND_ASSET_MAX_BYTES) throw new BrandAssetError("too_large");
  if (!matchesType(bytes, input.mimeType)) throw new BrandAssetError("not_an_image");
  const size = input.mimeType === "image/png" ? pngSize(bytes) : null;
  if (kind === "icon") {
    if (input.mimeType !== "image/png") throw new BrandAssetError("icon_type");
    if (!size || size.width !== size.height || size.width < MIN_ICON_PIXELS)
      throw new BrandAssetError("icon_size");
  }
  return { bytes, mimeType: input.mimeType, extension: EXTENSIONS[input.mimeType]!, size };
}

export function assetContentType(key: string): string | null {
  return TYPES[key.split(".").pop() ?? ""] ?? null;
}

/**
 * Where logos and icons live: the deployment's object storage, or a folder of its data directory
 * when it has none. Keys carry a hash of the bytes, so a changed image is a new address.
 */
export class BrandAssetStore {
  constructor(
    private readonly storage: ObjectStorage | undefined,
    private readonly dataDir: string,
  ) {}

  /** Keys are `brand/<partnerId>/<kind>-<hash>.<ext>`; the partner id is a cuid. */
  keyFor(partnerId: string, kind: BrandAssetKind, asset: DecodedAsset): string {
    const hash = createHash("sha256").update(asset.bytes).digest("hex").slice(0, 16);
    return `brand/${partnerId}/${kind}-${hash}.${asset.extension}`;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    if (this.storage) {
      await this.storage.put(
        key,
        (async function* () {
          yield bytes;
        })(),
      );
      return;
    }
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      if (this.storage) return await buffer(this.storage.get(key));
      return await readFile(this.file(key));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    if (this.storage) await this.storage.delete([key]);
    else await rm(this.file(key), { force: true });
  }

  private file(key: string): string {
    const resolved = path.resolve(this.dataDir, key);
    const root = path.resolve(this.dataDir, "brand");
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Invalid brand asset key");
    return resolved;
  }
}
