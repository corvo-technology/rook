import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { i18n } from "@lingui/core";
import { beforeEach, expect, it } from "vitest";
import { activityLabelText, approvalTextLabel } from "./activity-label";
import { UI_LOCALES } from "./ui-locale";

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

const MESSAGES = [
  "Finding a tool",
  "Looking at the screen",
  "Reading the page",
  "Using the page",
  "Operating the computer",
  "Saving a note to memory",
  "Rendering a chart",
  "Running: {value}",
  "Reading {value}",
  "Writing {value}",
  "Listing {value}",
  "Attaching {value}",
  "Opening {value}",
  "Opening page: {value}",
  "Reading page: {value}",
  "Searching the web: {value}",
  "Reading skill: {value}",
  "Delegating to helper: {value}",
  "Waiting for {value}",
  "Using {value}",
  "Review before {reviewing}",
  "{name} is waiting for your approval.",
];

it("keeps the words of a known activity line and fills in its name", () => {
  expect(activityLabelText("Reading make_carousel.py")).toBe("Reading make_carousel.py");
  expect(activityLabelText("Searching the web: node version")).toBe(
    "Searching the web: node version",
  );
  expect(activityLabelText("Finding a tool")).toBe("Finding a tool");
});

it("names the tool a bot is waiting on", () => {
  expect(activityLabelText("Waiting for db: q")).toBe("Waiting for db: q");
});

it("leaves a line it does not know as it was written", () => {
  expect(activityLabelText("Anything else")).toBe("Anything else");
});

it("is translated in every other language", () => {
  for (const locale of UI_LOCALES.filter((item) => item !== "en")) {
    const catalog = readFileSync(
      fileURLToPath(new URL(`../locales/${locale}/messages.po`, import.meta.url)),
      "utf8",
    );
    for (const message of MESSAGES) {
      const entry = catalog
        .split("\n\n")
        .find((block) => block.includes(`msgid ${JSON.stringify(message)}\n`));
      const translated = entry?.split("msgstr ")[1]?.trim();
      expect(translated, `${locale}: ${message}`).toBeTruthy();
      expect(translated, `${locale}: ${message}`).not.toBe('""');
    }
  }
});

it("says an approval line in the language it is shown in, and leaves other text alone", () => {
  expect(approvalTextLabel("Ana is waiting for your approval.")).toBe(
    "Ana is waiting for your approval.",
  );
  expect(approvalTextLabel("Review before web_fetch → example.com")).toBe(
    "Review before web_fetch → example.com",
  );
  expect(approvalTextLabel("Hello")).toBe("Hello");
});
