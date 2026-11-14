import { describe, expect, it } from "vitest";
import { LocalModelStore } from "./local-speech-models.js";
import {
  chooseLocalVoice,
  DEFAULT_LOCAL_MODEL,
  DEFAULT_LOCAL_VOICE,
  LOCAL_VOICES,
  primaryLanguage,
} from "./local-voices.js";

/** Licenses that allow using and redistributing the model in a product. */
const PERMISSIVE = new Set(["Apache-2.0", "BSD-3-Clause", "MIT", "CC0-1.0", "CC-BY-4.0"]);

describe("the shipped voice catalog", () => {
  it("uses one fixed https origin, pinned digests and the files the engine reads", () => {
    for (const voice of LOCAL_VOICES) {
      expect(voice.kind).toBe("speak");
      expect(voice.url).toMatch(
        /^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\/tts-models\/[\w.-]+\.tar\.bz2$/,
      );
      expect(voice.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(voice.sizeBytes).toBeGreaterThan(1_000_000);
      expect(voice.keep.length).toBeGreaterThan(0);
      expect(voice.sample?.length).toBeGreaterThan(5);
      const engine = voice.voice;
      expect(engine).toBeDefined();
      const files =
        engine?.type === "kokoro"
          ? [engine.model, engine.voices, engine.tokens, engine.lexicon]
          : engine?.type === "piper"
            ? [engine.model, engine.tokens, engine.dataDir]
            : [engine?.model, engine?.tokens, engine?.lexicon];
      for (const file of files.filter(Boolean)) expect(voice.keep).toContain(file);
    }
  });

  it("has unique ids that do not collide with the listening models", () => {
    const store = new LocalModelStore({ dir: "/unused" });
    const ids = [...store.specs("listen"), ...store.specs("speak")].map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(store.spec(DEFAULT_LOCAL_VOICE)?.kind).toBe("speak");
    expect(store.spec(DEFAULT_LOCAL_MODEL)?.kind).toBe("listen");
  });

  it("offers only voices whose license allows use in the product", () => {
    for (const voice of LOCAL_VOICES) expect(PERMISSIVE.has(voice.license)).toBe(true);
  });

  it("covers Brazilian Portuguese, Spanish and English", () => {
    const languages = LOCAL_VOICES.flatMap((voice) => voice.languages);
    for (const language of ["pt", "es", "en"]) expect(languages).toContain(language);
  });
});

describe("primaryLanguage", () => {
  it("reads the language of a regional tag", () => {
    expect(primaryLanguage("pt-BR")).toBe("pt");
    expect(primaryLanguage("PT_br")).toBe("pt");
    expect(primaryLanguage(" en ")).toBe("en");
    expect(primaryLanguage("")).toBeUndefined();
    expect(primaryLanguage(undefined)).toBeUndefined();
  });
});

describe("chooseLocalVoice", () => {
  const all = ["voice-pt", "voice-es", "voice-kokoro"];

  it("picks the voice of the reply's language when it is on this computer", () => {
    expect(chooseLocalVoice({ language: "pt-BR", ready: all })).toBe("voice-pt");
    expect(chooseLocalVoice({ language: "es", ready: all })).toBe("voice-es");
    expect(chooseLocalVoice({ language: "en", ready: all })).toBe("voice-kokoro");
  });

  it("offers the faster English voice first and keeps Kokoro as the more natural choice", () => {
    const both = ["voice-kokoro", "voice-ljs"];
    expect(DEFAULT_LOCAL_VOICE).toBe("voice-ljs");
    expect(chooseLocalVoice({ language: "en", ready: both })).toBe("voice-ljs");
    expect(chooseLocalVoice({ language: "en", selected: "voice-kokoro", ready: both })).toBe(
      "voice-kokoro",
    );
    expect(chooseLocalVoice({ language: "en", ready: [] })).toBe("voice-ljs");
  });

  it("keeps the owner's choice when it speaks the language", () => {
    expect(chooseLocalVoice({ language: "en", selected: "voice-kokoro", ready: all })).toBe(
      "voice-kokoro",
    );
    // A choice in another language gives way to a voice that fits the reply.
    expect(chooseLocalVoice({ language: "pt", selected: "voice-kokoro", ready: all })).toBe(
      "voice-pt",
    );
  });

  it("reads with what is on this computer when the language has no voice there", () => {
    expect(chooseLocalVoice({ language: "pt", ready: ["voice-kokoro"] })).toBe("voice-kokoro");
    expect(chooseLocalVoice({ language: "ja", selected: "voice-es", ready: all })).toBe("voice-es");
    expect(chooseLocalVoice({ language: "ja", ready: ["voice-es"] })).toBe("voice-es");
  });

  it("names the language's own voice when none is downloaded, and the default otherwise", () => {
    expect(chooseLocalVoice({ language: "es", ready: [] })).toBe("voice-es");
    expect(chooseLocalVoice({ language: "ja", ready: [] })).toBe(DEFAULT_LOCAL_VOICE);
    expect(chooseLocalVoice({ ready: [] })).toBe(DEFAULT_LOCAL_VOICE);
  });

  it("uses the owner's voice, then any voice, when the language is unknown", () => {
    expect(chooseLocalVoice({ selected: "voice-es", ready: all })).toBe("voice-es");
    expect(chooseLocalVoice({ ready: ["voice-pt"] })).toBe("voice-pt");
  });
});
