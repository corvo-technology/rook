import { CONSULTATION_CHUNK_SECONDS } from "@corvo/contracts";

/** The most one transcription request carries; larger recordings are cut into segments. */
export const CONSULTATION_SEGMENT_BYTES = 8 * 1024 * 1024;

export interface AudioSegment {
  bytes: Uint8Array;
  /** Where the segment starts in the recording, estimated from its share of the bytes. */
  startMs: number;
  /** How long it lasts, estimated the same way. */
  durationMs: number;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function indexOfBytes(haystack: Uint8Array, needle: readonly number[], from: number): number {
  const first = needle[0] as number;
  const last = haystack.byteLength - needle.length;
  for (let i = Math.max(0, from); i <= last; i++) {
    if (haystack[i] !== first) continue;
    let match = true;
    for (let j = 1; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

/** A WebM cluster starts a run of audio that decodes by itself once the headers precede it. */
const WEBM_CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
/** An Ogg page: capture pattern and version 0. */
const OGG_PAGE = [0x4f, 0x67, 0x67, 0x53, 0x00];

interface Container {
  /** The bytes every segment must start with so a decoder can read it. */
  header(bytes: Uint8Array): Uint8Array;
  /** The next offset at or after `from` where a segment may begin, or -1. */
  boundary(bytes: Uint8Array, from: number): number;
}

const webm: Container = {
  header(bytes) {
    const cluster = indexOfBytes(bytes, WEBM_CLUSTER, 0);
    return bytes.subarray(0, cluster < 0 ? 0 : cluster);
  },
  boundary: (bytes, from) => indexOfBytes(bytes, WEBM_CLUSTER, from),
};

const ogg: Container = {
  header(bytes) {
    // The identification and comment headers are the first two pages.
    let offset = 0;
    for (let page = 0; page < 2; page++) {
      if (indexOfBytes(bytes.subarray(offset, offset + 4), OGG_PAGE.slice(0, 4), 0) !== 0) {
        return new Uint8Array();
      }
      const segments = bytes[offset + 26];
      if (segments === undefined) return new Uint8Array();
      let size = 27 + segments;
      for (let i = 0; i < segments; i++) size += bytes[offset + 27 + i] ?? 0;
      offset += size;
    }
    return bytes.subarray(0, Math.min(offset, bytes.byteLength));
  },
  boundary: (bytes, from) => indexOfBytes(bytes, OGG_PAGE, from),
};

/**
 * Cuts one recording into pieces a transcription request can carry. A recording that fits is
 * returned as it is. Otherwise each cut falls where the container allows a new segment to begin
 * (a WebM cluster or an Ogg page), so no audio is lost or repeated, and every segment after the
 * first is given the container's header so it decodes on its own. Times are estimated from the
 * bytes and the nominal length of an uploaded chunk.
 */
export function planAudioSegments(
  audio: Uint8Array,
  mimeType: string,
  chunkCount: number,
  maxBytes = CONSULTATION_SEGMENT_BYTES,
): AudioSegment[] {
  const totalMs = chunkCount * CONSULTATION_CHUNK_SECONDS * 1000;
  const whole = [{ bytes: audio, startMs: 0, durationMs: totalMs }];
  if (audio.byteLength <= maxBytes) return whole;
  const container = mimeType.includes("ogg") ? ogg : webm;
  const header = container.header(audio);
  const bounds = [0];
  for (let target = maxBytes; target < audio.byteLength; target += maxBytes) {
    const cut = container.boundary(audio, Math.max(target, (bounds.at(-1) ?? 0) + 1));
    if (cut < 0) break;
    bounds.push(cut);
  }
  if (bounds.length === 1) return whole;
  bounds.push(audio.byteLength);
  const segments: AudioSegment[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const from = bounds[i] as number;
    const to = bounds[i + 1] as number;
    const body = audio.subarray(from, to);
    segments.push({
      bytes: i === 0 ? body : concatBytes([header, body]),
      startMs: Math.round((from / audio.byteLength) * totalMs),
      durationMs: Math.round(((to - from) / audio.byteLength) * totalMs),
    });
  }
  return segments;
}
