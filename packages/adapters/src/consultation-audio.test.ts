import { describe, expect, it } from "vitest";
import { concatBytes, planAudioSegments } from "./consultation-audio.js";

const EBML = [0x1a, 0x45, 0xdf, 0xa3];
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75];

function webm(clusters: number, payload = 100) {
  const header = new Uint8Array([...EBML, ...Array.from({ length: 16 }, (_, i) => 0x10 + i)]);
  const parts = [header];
  for (let i = 0; i < clusters; i++) {
    parts.push(new Uint8Array([...CLUSTER, ...Array.from({ length: payload }, () => i + 1)]));
  }
  return { header, audio: concatBytes(parts) };
}

function oggPage(payloadSize: number, fill: number) {
  const head = [0x4f, 0x67, 0x67, 0x53, 0x00, 0x00, ...new Array(8).fill(0), 1, 0, 0, 0];
  const rest = [...new Array(8).fill(0), 1, payloadSize];
  return new Uint8Array([...head, ...rest, ...new Array(payloadSize).fill(fill)]);
}

describe("planAudioSegments", () => {
  it("returns a recording that fits as one segment", () => {
    const { audio } = webm(3);
    const [only, ...more] = planAudioSegments(audio, "audio/webm", 3, 10_000);
    expect(more).toEqual([]);
    expect(only?.bytes).toBe(audio);
    expect(only?.startMs).toBe(0);
    expect(only?.durationMs).toBe(30_000);
  });

  it("cuts a long WebM at cluster starts, losing and repeating nothing", () => {
    const { audio, header } = webm(12, 100);
    const segments = planAudioSegments(audio, "audio/webm", 12, 450);
    expect(segments.length).toBeGreaterThan(2);
    segments.forEach((segment, i) => {
      if (i > 0) expect([...segment.bytes.subarray(0, header.length)]).toEqual([...header]);
      const body = segment.bytes.subarray(i === 0 ? 0 : header.length);
      if (i > 0) expect([...body.subarray(0, 4)]).toEqual(CLUSTER);
    });
    const bodies = segments.map((segment, i) =>
      i === 0 ? segment.bytes : segment.bytes.subarray(header.length),
    );
    expect([...concatBytes(bodies)]).toEqual([...audio]);
    expect(segments.reduce((sum, s) => sum + s.durationMs, 0)).toBeGreaterThanOrEqual(119_998);
    expect(segments[1]?.startMs).toBeGreaterThan(0);
  });

  it("cuts a long Ogg stream at page starts and repeats its two header pages", () => {
    const pages = [oggPage(19, 0xaa), oggPage(11, 0xbb)];
    for (let i = 0; i < 10; i++) pages.push(oggPage(60, i + 1));
    const audio = concatBytes(pages);
    const headerLength = (pages[0]?.length ?? 0) + (pages[1]?.length ?? 0);
    const segments = planAudioSegments(audio, "audio/ogg", 10, 400);
    expect(segments.length).toBeGreaterThan(2);
    const header = audio.subarray(0, headerLength);
    segments.slice(1).forEach((segment) => {
      expect([...segment.bytes.subarray(0, headerLength)]).toEqual([...header]);
      expect([...segment.bytes.subarray(headerLength, headerLength + 4)]).toEqual([
        0x4f, 0x67, 0x67, 0x53,
      ]);
    });
  });

  it("keeps one segment when no cut point exists", () => {
    const audio = new Uint8Array(1000).fill(7);
    expect(planAudioSegments(audio, "audio/webm", 4, 100)).toHaveLength(1);
  });
});
