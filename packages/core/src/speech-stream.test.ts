import { describe, expect, it } from "vitest";
import { createSpeechChunker } from "./speech-stream.js";

/** Feeds a reply a few characters at a time, as a model writes it. */
function stream(reply: string, step = 7) {
  const chunker = createSpeechChunker();
  const out: Array<{ at: number; chunk: string }> = [];
  for (let end = step; end < reply.length + step; end += step) {
    const written = reply.slice(0, Math.min(end, reply.length));
    for (const chunk of chunker.push(written)) out.push({ at: written.length, chunk });
  }
  for (const chunk of chunker.flush(reply)) out.push({ at: reply.length, chunk });
  return out;
}

const chunks = (reply: string) => stream(reply).map((item) => item.chunk);

describe("speech chunker", () => {
  it("releases a sentence only once its end is certain", () => {
    const chunker = createSpeechChunker();
    expect(chunker.push("Hello there.")).toEqual([]);
    expect(chunker.push("Hello there. How")).toEqual(["Hello there."]);
    expect(chunker.push("Hello there. How are you?")).toEqual([]);
    expect(chunker.flush("Hello there. How are you?")).toEqual(["How are you?"]);
  });

  it("starts speaking before the reply is complete", () => {
    const reply = "I checked the build. It passes now. Nothing else needs your attention";
    const out = stream(reply);
    expect(out[0]?.chunk).toBe("I checked the build.");
    expect(out[0]?.at).toBeLessThan(reply.length);
    expect(out.map((item) => item.chunk).join(" ")).toBe(
      "I checked the build. It passes now. Nothing else needs your attention",
    );
  });

  it("keeps abbreviations and numbers inside their sentence", () => {
    expect(chunks("Ask Dr. Silva about it. The fee is US$ 2.50 per seat. Done.")).toEqual([
      "Ask Dr. Silva about it.",
      "The fee is US$ 2.50 per seat.",
      "Done.",
    ]);
    expect(chunks("Fale com a Sra. Lima e o Prof. Costa. Custa R$ 3,50 hoje. Combinado?")).toEqual([
      "Fale com a Sra. Lima e o Prof. Costa.",
      "Custa R$ 3,50 hoje.",
      "Combinado?",
    ]);
  });

  it("splits Portuguese and English alike", () => {
    expect(chunks("Tudo certo por aqui. Posso ajudar com mais alguma coisa? Claro!")).toEqual([
      "Tudo certo por aqui.",
      "Posso ajudar com mais alguma coisa?",
      "Claro!",
    ]);
  });

  it("opens with a short clause when the first sentence runs long", () => {
    const chunker = createSpeechChunker();
    const written = "Looking at the repository, I found three failing tests, and they";
    expect(chunker.push(written)).toEqual([
      "Looking at the repository, I found three failing tests,",
    ]);
  });

  it("never cuts at a comma before the first clause is long enough", () => {
    const chunker = createSpeechChunker();
    expect(chunker.push("Yes, I can do that for you, then add the rest of it. Ok")).toEqual([
      "Yes, I can do that for you, then add the rest of it.",
    ]);
    const long = createSpeechChunker();
    expect(long.push("Yes, I can do that for you, then add the rest of it, and so")).toEqual([
      "Yes, I can do that for you, then add the rest of it,",
    ]);
  });

  it("turns markdown into speech and skips code blocks", () => {
    const reply = [
      "## Plan",
      "",
      "- **Fix** the [login](https://example.test/x) bug",
      "- Ship it",
      "",
      "```ts",
      "const secret = 1;",
      "```",
      "",
      "All done.",
    ].join("\n");
    const spoken = chunks(reply).join(" ");
    expect(spoken).toContain("Plan.");
    expect(spoken).toContain("Fix the login bug");
    expect(spoken).toContain("a TypeScript code block");
    expect(spoken).not.toContain("const secret");
    expect(spoken).not.toContain("**");
    expect(spoken).not.toContain("https");
    expect(spoken).toContain("All done.");
  });

  it("holds an unclosed code block until it closes", () => {
    const chunker = createSpeechChunker();
    expect(chunker.push("Here it is:\n```ts\nconst a = 1.")).toEqual(["Here it is:"]);
    expect(chunker.push("Here it is:\n```ts\nconst a = 1;\nconst b = 2;")).toEqual([]);
    const closed = "Here it is:\n```ts\nconst a = 1;\n```\nThat is it. Bye";
    const spoken = chunker.push(closed).join(" ");
    expect(spoken).toContain("code block");
    expect(spoken).not.toContain("const");
  });

  it("never repeats a chunk or loses text across pushes", () => {
    const reply = "One fish. Two fish, red fish. Blue fish!\nThe end";
    expect(chunks(reply).join(" ")).toBe("One fish. Two fish, red fish. Blue fish! The end");
  });

  it("ignores text that stops continuing what was released, and skips what was cut off", () => {
    const chunker = createSpeechChunker();
    expect(chunker.push("First one. Second")).toEqual(["First one."]);
    expect(chunker.push("Different start. More")).toEqual([]);
    expect(chunker.flush("Different start. More")).toEqual([]);

    const cut = createSpeechChunker();
    cut.skipTo("An answer nobody heard. Still going");
    expect(cut.push("An answer nobody heard. Still going. And a new answer. Next")).toEqual([
      "And a new answer.",
    ]);
  });

  it("also skips the rest of a sentence that was cut off in the middle", () => {
    const chunker = createSpeechChunker();
    chunker.skipTo("An answer nobody he");
    expect(chunker.push("An answer nobody heard. And a new answer. Next")).toEqual([
      "And a new answer.",
    ]);
    const unfinished = createSpeechChunker();
    unfinished.skipTo("An answer nobody he");
    expect(unfinished.flush("An answer nobody heard")).toEqual([]);
  });

  it("drops text with nothing to say", () => {
    expect(chunks("---\n\n")).toEqual([]);
  });
});
