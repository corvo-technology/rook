import type { TranscriptContext } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  hasImages,
  imageProblem,
  isImageRejection,
  withoutImages,
  withoutUnreadableImages,
} from "./image-integrity.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function jpeg(withEnd = true): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0, 11, 8, 0, 2, 0, 3, 1, 1, 0x11, 0]);
  const sos = Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    sof,
    sos,
    Buffer.from([1, 2, 3, 4]),
    withEnd ? Buffer.from([0xff, 0xd9]) : Buffer.alloc(0),
  ]);
}

function gif(withTrailer = true): Buffer {
  const header = Buffer.from("GIF89a");
  const screen = Buffer.from([2, 0, 2, 0, 0, 0, 0]);
  const body = Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0, 2, 2, 0x44, 0x01, 0]);
  return Buffer.concat([header, screen, body, withTrailer ? Buffer.from([0x3b]) : Buffer.alloc(0)]);
}

function webp(declared = 22): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(declared, 4);
  bytes.write("WEBP", 8);
  bytes.write("VP8L", 12);
  bytes.writeUInt32LE(10, 16);
  bytes[20] = 0x2f;
  bytes.writeUInt32LE(3 | (4 << 14), 21);
  return bytes;
}

describe("imageProblem", () => {
  it("accepts whole images of each format", () => {
    expect(imageProblem(png)).toBeUndefined();
    expect(imageProblem(jpeg())).toBeUndefined();
    expect(imageProblem(gif())).toBeUndefined();
    expect(imageProblem(webp())).toBeUndefined();
  });

  it("flags images cut short", () => {
    expect(imageProblem(png.subarray(0, png.length - 12))).toBe("truncated");
    expect(imageProblem(png.subarray(0, 20))).toBe("truncated");
    expect(imageProblem(jpeg(false))).toBe("truncated");
    expect(imageProblem(gif(false))).toBe("truncated");
    expect(imageProblem(webp(500))).toBe("truncated");
  });

  it("flags empty and unrecognized data", () => {
    expect(imageProblem(new Uint8Array())).toBe("empty");
    expect(imageProblem(Buffer.from("<html>not an image</html>"))).toBe("unrecognized");
  });

  it("flags impossible dimensions", () => {
    const zero = Buffer.from(png);
    zero.writeUInt32BE(0, 16);
    expect(imageProblem(zero)).toBe("bad dimensions");
  });
});

const context = (...images: Buffer[]) =>
  ({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          ...images.map((image) => ({
            type: "image" as const,
            data: image.toString("base64"),
            mimeType: "image/png",
          })),
        ],
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "1",
        toolName: "computer_observe",
        content: images.map((image) => ({
          type: "image" as const,
          data: image.toString("base64"),
          mimeType: "image/png",
        })),
        isError: false,
        timestamp: 2,
      },
    ],
  }) as unknown as TranscriptContext;

describe("withoutUnreadableImages", () => {
  it("returns the same context when every image is whole", () => {
    const input = context(png);
    expect(withoutUnreadableImages(input)).toBe(input);
  });

  it("replaces a cut image in a message and in a tool result with a note", () => {
    const output = withoutUnreadableImages(context(png.subarray(0, 40)));
    expect(hasImages(output)).toBe(false);
    expect(JSON.stringify(output)).toContain("[image could not be read: truncated]");
  });

  it("keeps the whole images beside a cut one", () => {
    const output = withoutUnreadableImages(context(png, png.subarray(0, 40)));
    const first = output.messages[0];
    expect(first?.role === "user" && typeof first.content !== "string" && first.content).toEqual([
      expect.objectContaining({ type: "text", text: "look" }),
      expect.objectContaining({ type: "image" }),
      expect.objectContaining({ type: "text", text: "[image could not be read: truncated]" }),
    ]);
  });
});

describe("withoutImages", () => {
  it("removes every image", () => {
    expect(hasImages(withoutImages(context(png)))).toBe(false);
  });
});

describe("isImageRejection", () => {
  it("recognizes provider wording for an unreadable image", () => {
    expect(
      isImageRejection(
        "Codex error: input_image image_url could not parse image: unexpected end of file",
      ),
    ).toBe(true);
    expect(isImageRejection("Could not process image")).toBe(true);
    expect(isImageRejection("429 rate limit")).toBe(false);
    expect(isImageRejection(undefined)).toBe(false);
  });
});
