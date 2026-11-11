import { TURN_GUARD_KINDS } from "@corvo/contracts";
import { describeModelProblem } from "@corvo/core";
import { describe, expect, it } from "vitest";
import {
  parseRunDiagnostic,
  runErrorActionLabel,
  runErrorWhatHappened,
} from "./run-error-presentation";

describe("readable provider diagnostics", () => {
  it.each(["", "403: "])("parses JSON with prefix %s", (prefix) => {
    const result = parseRunDiagnostic(
      `${prefix}{"status":403,"error":{"message":"Weekly key limit exceeded","metadata":{"reset_at":"2026-10-21T00:00:00Z"}}}`,
      "en",
      Date.parse("2026-10-20T00:00:00Z"),
    );
    expect(result).toMatchObject({
      status: "403",
      message: "Weekly key limit exceeded",
      limit: "weekly",
    });
    expect(result.resets).toContain("2026");
    expect(Object.values(result).join(" ")).not.toMatch(/[{}"]/);
  });
  it.each([
    '403: {"message": "Broken diagnostic',
    'Plain "quoted" message {without JSON}',
    '["invalid envelope"]',
  ])("strips JSON punctuation from malformed or unsupported input: %s", (raw) => {
    expect(parseRunDiagnostic(raw, "en").message).not.toMatch(/[{}[\]"]/);
  });
  it.each(["not-a-date", "2026-02-30", "2026-04-31T00:00:00Z"])(
    "omits invalid reset %s",
    (reset) => {
      expect(
        parseRunDiagnostic(
          JSON.stringify({ message: "weekly limit", metadata: { reset_at: reset } }),
          "en",
        ).resets,
      ).toBeUndefined();
    },
  );
  it("does not render JSON punctuation embedded in a provider message", () => {
    expect(
      parseRunDiagnostic(
        JSON.stringify({ message: 'The {weekly} limit for "key" was reached' }),
        "en",
      ).message,
    ).toBe("The weekly limit for key was reached");
  });
});

it.each(["2026-10-19T00:00:00Z", "2026-10-20T00:00:00Z"])(
  "omits past or current reset %s",
  (reset) => {
    expect(
      parseRunDiagnostic(
        JSON.stringify({ message: "weekly limit", metadata: { reset_at: reset } }),
        "en",
        Date.parse("2026-10-20T00:00:00Z"),
      ).resets,
    ).toBeUndefined();
  },
);

describe("the one recovery action", () => {
  const t = (message: string) => message;
  it.each([
    ['402: {"message":"You have no credits remaining."}', "Change model"],
    ['403: {"type":"FreeTierError","message":"Only usable inside its own app."}', "Change model"],
    ['404: {"message":"Model example-model does not exist"}', "Change model"],
    ['401: {"message":"Invalid API key"}', "Replace key"],
    [
      '403: {"message":"Key limit exceeded (weekly limit)","metadata":{"limit_source":"openrouter_key_limit"}}',
      "Add Model",
    ],
    ["Request timed out.", null],
    ['429: {"message":"Too many requests"}', null],
  ])("labels %s", (details, label) => {
    expect(runErrorActionLabel(t, describeModelProblem({ details }).action)).toBe(label);
  });

  it("names the sign-in action", () => {
    expect(runErrorActionLabel(t, "sign-in")).toBe("Sign in again");
  });
});

describe("runErrorWhatHappened for a stopped run", () => {
  const t = (message: string) => `t:${message}`;

  it.each(TURN_GUARD_KINDS)("points a %s stop at sending again", (kind) => {
    expect(runErrorWhatHappened(t, { kind })).toBe(t("Send your message again to try once more."));
  });

  it("leaves other kinds alone", () => {
    expect(runErrorWhatHappened(t, { kind: "rate" })).toBe(
      t("The provider received too many requests to answer this bot."),
    );
    expect(runErrorWhatHappened(t, {})).toBe(
      t("The bot couldn't finish its reply. Technical details includes the reported error."),
    );
  });
});
