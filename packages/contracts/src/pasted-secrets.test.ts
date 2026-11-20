import { describe, expect, it } from "vitest";
import { BotSecretName, commandVariableName, commandVariableProblem } from "./bot-secrets.js";
import { findPastedSecrets, PASTED_SECRET_KINDS } from "./pasted-secrets.js";

// Fake, shape-only values. None of these is a real credential.
const alnum = (length: number, seed = "aB3dE5gH7jK9mN1pQ") =>
  seed.repeat(Math.ceil(length / seed.length)).slice(0, length);

const samples: Record<string, string> = {
  github: `ghp_${alnum(36)}`,
  "github-fine": `github_pat_${alnum(60)}`,
  slack: "xoxb-1234567890-abcdefghij",
  "slack-app": "xapp-1-A0123456789-abcdefghij",
  stripe: `sk_live_${alnum(24)}`,
  "stripe-restricted": `rk_test_${alnum(24)}`,
  "stripe-webhook": `whsec_${alnum(32)}`,
  aws: "AKIAIOSFODNN7EXAMPLE",
  anthropic: `sk-ant-api03-${alnum(40)}`,
  openrouter: `sk-or-v1-${"a1b2c3d4".repeat(8)}`,
  openai: `sk-proj-${alnum(48)}`,
  "openai-legacy": `sk-${alnum(48)}`,
  google: `AIza${alnum(35)}`,
  jwt: `eyJ${alnum(20)}.eyJ${alnum(30)}.${alnum(30)}`,
  bearer: `Bearer ${alnum(40)}`,
};

describe("findPastedSecrets", () => {
  it.each(Object.entries(samples))("detects a %s key", (_name, value) => {
    const [match, ...rest] = findPastedSecrets(`here you go ${value} thanks`);
    expect(rest).toEqual([]);
    expect(match).toBeDefined();
    const text = `here you go ${value} thanks`;
    expect(text.slice(match!.start, match!.end)).toBe(value.replace(/^Bearer /, ""));
  });

  it("names every kind with a valid, exportable credential name", () => {
    for (const kind of PASTED_SECRET_KINDS) {
      expect(BotSecretName.safeParse(kind.name).success).toBe(true);
      expect(commandVariableProblem(commandVariableName(kind.name))).toBeUndefined();
    }
  });

  it("maps keys to the right kind and does not double-count overlapping shapes", () => {
    expect(findPastedSecrets(samples.anthropic!)[0]?.kind).toBe("anthropic");
    expect(findPastedSecrets(samples.openrouter!)[0]?.kind).toBe("openrouter");
    expect(findPastedSecrets(samples.openai!)[0]?.kind).toBe("openai");
    expect(findPastedSecrets(samples["stripe-webhook"]!)[0]?.kind).toBe("stripe-webhook");
    expect(findPastedSecrets(samples.jwt!)).toHaveLength(1);
  });

  it("finds several keys in one text, in order", () => {
    const text = `${samples.github} and ${samples.aws}`;
    expect(findPastedSecrets(text).map((match) => match.kind)).toEqual(["github", "aws"]);
  });

  it.each([
    "pk_live_51Habcdefghijklmnopqrstuv",
    "pk_test_51Habcdefghijklmnopqrstuv",
    "hello, how are you doing today?",
    "ghp_short",
    "sk-learn is a library, sk-short",
    // Split so secret scanners do not mistake a fake for a real key.
    `${"sk"}_live_${"abcdefghijklmnopqrstuvwx"}`,
    "AKIA is a prefix",
    "Bearer token",
    `Bearer ${"a".repeat(40)}`,
    "https://example.com/some/very/long/path/with-dashes-and-words-that-go-on-and-on",
    "the quick brown fox jumps over the lazy dog 1234567890 again and again",
    `xoxb-${"a".repeat(12)}`,
    "eyJhbGciOiJIUzI1NiJ9 is a header",
    `token ${alnum(40)}`,
  ])("does not flag %s", (text) => {
    expect(findPastedSecrets(text)).toEqual([]);
  });

  it("is quick on long input", () => {
    const text = "sk-".repeat(50_000);
    const started = Date.now();
    findPastedSecrets(text);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
