import { describe, expect, it } from "vitest";
import { encodeWav, ScriptedSynthesizer } from "./speech-synthesizer.js";

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM WAV that every browser plays", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1, 2]), 22050);
    const view = new DataView(wav.buffer);
    const ascii = (from: number, to: number) => new TextDecoder().decode(wav.slice(from, to));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 12)).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);
    expect(wav.byteLength).toBe(44 + 12);
    expect([0, 1, 2, 3, 4, 5].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
      0, 16384, -16383, 32767, -32767, 32767,
    ]);
  });
});

describe("ScriptedSynthesizer", () => {
  it("records what it was asked and answers from its script", async () => {
    const engine = new ScriptedSynthesizer();
    const speech = await engine.synthesize({
      text: "Hi",
      modelDir: "/m",
      voice: { type: "vits", model: "m.onnx", tokens: "t.txt" },
    });
    expect(engine.calls).toHaveLength(1);
    expect(speech.samples.length).toBeGreaterThan(0);
  });
});
