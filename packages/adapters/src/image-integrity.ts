import { getLogger } from "@corvo/logging";
import type { ImageContent, TextContent, TranscriptContext } from "@earendil-works/pi-ai";

/**
 * A model provider decodes every image it is sent and rejects the whole request when one is cut
 * short ("could not parse image: unexpected end of file"). A screenshot or file written while a
 * computer's disk was full is exactly that, so each image is checked here before it is sent:
 * the format's signature, plausible dimensions, and that the data reaches the format's end.
 * Only headers and trailers are read, so a check is cheap and needs no image library.
 */

export type ImageProblem = "empty" | "unrecognized" | "bad dimensions" | "truncated";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_EDGE = 65_535;

function plausible(width: number, height: number): boolean {
  return width >= 1 && height >= 1 && width <= MAX_EDGE && height <= MAX_EDGE;
}

function endsWith(bytes: Buffer, tail: number[]): boolean {
  let end = bytes.length;
  // Writers sometimes pad a file with zeros.
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  if (end < tail.length) return false;
  return tail.every((value, index) => bytes[end - tail.length + index] === value);
}

function inspectPng(bytes: Buffer): ImageProblem | undefined {
  if (bytes.length < 33) return "truncated";
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR")
    return "unrecognized";
  if (!plausible(bytes.readUInt32BE(16), bytes.readUInt32BE(20))) return "bad dimensions";
  // Chunks are length, type, data, CRC. The image is whole only when the walk reaches IEND.
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const next = offset + 12 + bytes.readUInt32BE(offset);
    if (next > bytes.length) return "truncated";
    if (bytes.toString("ascii", offset + 4, offset + 8) === "IEND") return undefined;
    offset = next;
  }
  return "truncated";
}

function inspectJpeg(bytes: Buffer): ImageProblem | undefined {
  let offset = 2;
  let dimensions: [number, number] | undefined;
  let scanStart = -1;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return dimensions ? "truncated" : "unrecognized";
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) return "truncated";
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return "truncated";
    if (
      length >= 7 &&
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      dimensions = [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
    }
    offset += 2 + length;
    if (marker === 0xda) {
      scanStart = offset;
      break;
    }
  }
  if (!dimensions) return scanStart < 0 ? "truncated" : "unrecognized";
  if (!plausible(...dimensions)) return "bad dimensions";
  // Entropy-coded data stuffs every 0xFF, so an end marker after the scan is a real one.
  if (scanStart < 0 || bytes.lastIndexOf(Buffer.from([0xff, 0xd9])) < scanStart) return "truncated";
  return undefined;
}

function inspectGif(bytes: Buffer): ImageProblem | undefined {
  if (bytes.length < 14) return "truncated";
  if (!plausible(bytes.readUInt16LE(6), bytes.readUInt16LE(8))) return "bad dimensions";
  return endsWith(bytes, [0x3b]) ? undefined : "truncated";
}

function inspectWebp(bytes: Buffer): ImageProblem | undefined {
  if (bytes.length < 30) return "truncated";
  if (bytes.readUInt32LE(4) + 8 > bytes.length) return "truncated";
  const format = bytes.toString("ascii", 12, 16);
  let size: [number, number] | undefined;
  if (format === "VP8X") size = [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  else if (format === "VP8L") {
    const packed = bytes.readUInt32LE(21);
    size = [1 + (packed & 0x3fff), 1 + ((packed >>> 14) & 0x3fff)];
  } else if (format === "VP8 ")
    size = [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  else return "unrecognized";
  return plausible(...size) ? undefined : "bad dimensions";
}

/** What is wrong with these image bytes, or undefined when they look like a whole image. */
export function imageProblem(bytes: Uint8Array): ImageProblem | undefined {
  if (bytes.byteLength === 0) return "empty";
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length >= 8 && PNG_SIGNATURE.every((value, index) => data[index] === value))
    return inspectPng(data);
  if (data[0] === 0xff && data[1] === 0xd8) return inspectJpeg(data);
  const head = data.toString("ascii", 0, 6);
  if (head === "GIF87a" || head === "GIF89a") return inspectGif(data);
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP")
    return inspectWebp(data);
  return "unrecognized";
}

/** The text a model reads in place of an image that could not be sent. */
export function unreadableImageNote(problem: string): string {
  return `[image could not be read: ${problem}]`;
}

type Part = ImageContent | TextContent;

const verdicts = new WeakMap<object, string | null>();

function verdictFor(part: Part, source: string): string | null {
  const cached = verdicts.get(part);
  if (cached !== undefined) return cached;
  const image = part as ImageContent;
  const problem = imageProblem(Buffer.from(image.data, "base64"));
  if (problem) {
    getLogger().warn("image removed before it reached the model", {
      problem,
      source,
      mimeType: image.mimeType,
    });
  }
  verdicts.set(part, problem ?? null);
  return problem ?? null;
}

function mapImages(
  context: TranscriptContext,
  replace: (part: Part, source: string) => string | null,
): TranscriptContext {
  let changed = false;
  const messages = context.messages.map((message) => {
    if (
      message.role === "assistant" ||
      message.role === "system" ||
      typeof message.content === "string"
    )
      return message;
    const source = message.role === "toolResult" ? `tool:${message.toolName}` : "user attachment";
    let touched = false;
    const content = message.content.map((part): Part => {
      if (part.type !== "image") return part;
      const note = replace(part, source);
      if (note === null) return part;
      touched = true;
      return { type: "text", text: note } satisfies TextContent;
    });
    if (!touched) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? { ...context, messages } : context;
}

/** The context with each image that is cut short or not an image replaced by a text note. */
export function withoutUnreadableImages(context: TranscriptContext): TranscriptContext {
  return mapImages(context, (part, source) => {
    const problem = verdictFor(part, source);
    return problem ? unreadableImageNote(problem) : null;
  });
}

/** The context with every image replaced by a text note, for a provider that rejected one. */
export function withoutImages(context: TranscriptContext): TranscriptContext {
  return mapImages(context, () => "[image removed: the model provider could not read it]");
}

export function hasImages(context: TranscriptContext): boolean {
  return context.messages.some(
    (message) =>
      message.role !== "assistant" &&
      message.role !== "system" &&
      typeof message.content !== "string" &&
      message.content.some((part) => part.type === "image"),
  );
}

// OpenAI: "could not parse image", "invalid image"; Anthropic: "Could not process image".
const IMAGE_REJECTED =
  /could not (?:parse|process|decode) image|invalid[ _]image|image.{0,40}(?:corrupt|truncated|unexpected end of file)|unsupported image/i;

/** True when a provider refused the request because of an image in it. */
export function isImageRejection(errorMessage: string | undefined): boolean {
  return !!errorMessage && IMAGE_REJECTED.test(errorMessage);
}
