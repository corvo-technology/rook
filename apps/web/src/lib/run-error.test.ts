import { TURN_GUARD_KINDS } from "@corvo/contracts";
import {
  CLI_ENGINE_RUN_ERRORS,
  MODEL_OUTPUT_CUT_ERROR,
  normalizeRunError,
  TURN_GUARD_RUN_ERRORS,
} from "@corvo/core";
import { i18n } from "@lingui/core";
import { afterEach, expect, it } from "vitest";
import { translateRunError } from "./run-error";

afterEach(() => {
  i18n.activate("en");
});

it("uses the active Lingui catalog for shared run errors", () => {
  i18n.load("de", {
    "Your model provider": "Dein Modellanbieter",
    "{provider} is rate limiting requests. Try again shortly.":
      "{provider} drosselt Anfragen. Versuche es gleich noch einmal.",
  });
  i18n.activate("de");
  expect(
    normalizeRunError(
      '429: {"message":"API key rate limit exceeded"}',
      translateRunError,
      i18n.locale,
    ).summary,
  ).toBe("Dein Modellanbieter drosselt Anfragen. Versuche es gleich noch einmal.");
});

it("translates the summary of a reply cut off at the output limit", () => {
  i18n.load("de", {
    [MODEL_OUTPUT_CUT_ERROR]:
      "Das Modell hat sein Ausgabelimit erreicht, bevor es die Antwort fertig geschrieben hat.",
  });
  i18n.activate("de");
  expect(normalizeRunError(MODEL_OUTPUT_CUT_ERROR, translateRunError, i18n.locale)).toMatchObject({
    summary:
      "Das Modell hat sein Ausgabelimit erreicht, bevor es die Antwort fertig geschrieben hat.",
    recovery: "model",
  });
});

it.each(TURN_GUARD_KINDS)("translates the %s stop sentence without a recovery action", (kind) => {
  const sentence = TURN_GUARD_RUN_ERRORS[kind];
  i18n.load("de", { [sentence]: `marker:${kind}` });
  i18n.activate("de");
  const result = normalizeRunError(sentence, translateRunError, i18n.locale);
  expect(result.summary).toBe(`marker:${kind}`);
  expect(result.recovery).toBeUndefined();
});

it.each(Object.values(CLI_ENGINE_RUN_ERRORS.claude))(
  "translates the CLI engine error %s",
  (sentence) => {
    i18n.load("de", { [sentence]: `translated: ${sentence}` });
    i18n.activate("de");
    expect(normalizeRunError(sentence, translateRunError, "en").summary).toBe(
      `translated: ${sentence}`,
    );
  },
);
