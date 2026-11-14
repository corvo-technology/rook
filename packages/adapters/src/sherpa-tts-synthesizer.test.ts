import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { LocalVoiceEngine } from "./local-speech-models.js";
import { LOCAL_VOICES } from "./local-voices.js";
import { SherpaTtsSynthesizer } from "./sherpa-tts-synthesizer.js";
import type { SpeechChild } from "./speech-process.js";

/** An engine process that answers every job with a short sound, and remembers the jobs. */
function fakeEngine() {
  const jobs: Array<{ type: string; voice?: LocalVoiceEngine }> = [];
  const spawn = (): SpeechChild => {
    const child = new EventEmitter() as EventEmitter & SpeechChild;
    child.send = (message: unknown) => {
      const job = message as { id: number; type: string; voice?: LocalVoiceEngine };
      jobs.push(job);
      queueMicrotask(() =>
        child.emit("message", {
          id: job.id,
          result: { samples: new Float32Array(8), sampleRate: 22_050 },
        }),
      );
      return true;
    };
    child.kill = () => true;
    return child;
  };
  return { jobs, spawn };
}

describe("SherpaTtsSynthesizer", () => {
  const piper = LOCAL_VOICES.find((entry) => entry.id === "voice-pt")?.voice;
  const kokoro = LOCAL_VOICES.find((entry) => entry.id === "voice-kokoro")?.voice;

  it("speaks a Piper voice in the engine process that has espeak-ng, and no other voice there", async () => {
    if (!piper || !kokoro) throw new Error("voices missing");
    const main = fakeEngine();
    const espeak = fakeEngine();
    const engine = new SherpaTtsSynthesizer({ spawn: main.spawn, spawnEspeak: espeak.spawn });
    try {
      await engine.synthesize({ text: "Olá.", modelDir: "/models/voice-pt", voice: piper });
      await engine.warm({ modelDir: "/models/voice-pt", voice: piper });
      await engine.synthesize({ text: "Hi.", modelDir: "/models/voice-kokoro", voice: kokoro });
      expect(espeak.jobs.map((job) => [job.type, job.voice?.type])).toEqual([
        ["speak", "piper"],
        ["warm", "piper"],
      ]);
      expect(main.jobs.map((job) => [job.type, job.voice?.type])).toEqual([["speak", "kokoro"]]);
    } finally {
      await engine.close();
    }
  });
});

// Runs the real engine, so it is off by default: CI is offline and downloads no voice.
//   RUN_LOCAL_SPEECH_ENGINE=1
//   LOCAL_VOICE_DIR=<the folder LocalModelStore keeps the voice in>
//   LOCAL_VOICE_ID=<voice-pt, voice-es, voice-fr, voice-de, voice-ljs or voice-kokoro; default voice-pt>
const enabled = process.env.RUN_LOCAL_SPEECH_ENGINE === "1" && Boolean(process.env.LOCAL_VOICE_DIR);

describe.skipIf(!enabled)("SherpaTtsSynthesizer (real engine)", () => {
  it("speaks a sentence, then another with the voice already loaded", async () => {
    const id = process.env.LOCAL_VOICE_ID ?? "voice-pt";
    const voice = LOCAL_VOICES.find((entry) => entry.id === id)?.voice;
    if (!voice) throw new Error(`Unknown voice ${id}`);
    const modelDir = process.env.LOCAL_VOICE_DIR ?? "";
    const engine = new SherpaTtsSynthesizer();
    try {
      const first = await engine.synthesize({ text: "Hello there. How are you?", modelDir, voice });
      expect(first.sampleRate).toBeGreaterThan(8000);
      expect(first.samples.length).toBeGreaterThan(first.sampleRate / 2);
      const second = await engine.synthesize({ text: "Fine, thanks.", modelDir, voice });
      expect(second.samples.length).toBeGreaterThan(0);
    } finally {
      await engine.close();
    }
  }, 120_000);

  it("survives the engine crashing on text it cannot pronounce", async () => {
    const id = process.env.LOCAL_VOICE_ID ?? "voice-pt";
    const voice = LOCAL_VOICES.find((entry) => entry.id === id)?.voice;
    if (!voice) throw new Error(`Unknown voice ${id}`);
    const modelDir = process.env.LOCAL_VOICE_DIR ?? "";
    const engine = new SherpaTtsSynthesizer({ backoffMs: () => 0 });
    try {
      // The provider refuses this text; sent straight to the engine it stops the native code.
      await engine.synthesize({ text: "\u{1F600}", modelDir, voice }).catch(() => undefined);
      const after = await engine.synthesize({ text: "Still here.", modelDir, voice });
      expect(after.samples.length).toBeGreaterThan(0);
    } finally {
      await engine.close();
    }
  }, 120_000);
});
