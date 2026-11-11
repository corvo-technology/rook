import { beforeEach, describe, expect, it, vi } from "vitest";

const alert = vi.hoisted(() => vi.fn());
vi.mock("react-native", () => ({ Alert: { alert } }));

import { autonomyLine, autonomyOptions, confirmNeverAsk } from "./autonomy";

const t = (text: string, values?: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, key) => String(values?.[key] ?? ""));

const EVERY_CHANGE =
  "Still asks before anything that changes something, and before opening a site you didn't mention.";
const REVIEWED =
  "Still asks when a second model finds it outside your request, and before security changes.";
const STEERED_ONLY =
  "Still asks before a security change after it read outside content. Blocked actions stay blocked.";

beforeEach(() => alert.mockReset());

describe("autonomyOptions", () => {
  it("lists ask, auto and never with an approval model, marking the current one", () => {
    expect(autonomyOptions(t, { value: "auto", checkerAvailable: true })).toEqual([
      { id: "ask", title: "Asks before any change", state: "off" },
      { id: "auto", title: "Does what fits your request", state: "on" },
      { id: "never", title: "Does everything without asking", state: "off" },
    ]);
  });

  it("leaves out auto without a model, unless it is already chosen", () => {
    expect(
      autonomyOptions(t, { value: "ask", checkerAvailable: false }).map((option) => option.id),
    ).toEqual(["ask", "never"]);
    expect(
      autonomyOptions(t, { value: "auto", checkerAvailable: false }).map((option) => option.id),
    ).toEqual(["ask", "auto", "never"]);
  });
});

describe("autonomyLine", () => {
  it("says what still asks, as the gate computes it", () => {
    expect(autonomyLine(t, { mode: "ask", checkerAvailable: true })).toBe(EVERY_CHANGE);
    expect(autonomyLine(t, { mode: "auto", checkerAvailable: true })).toBe(REVIEWED);
    expect(autonomyLine(t, { mode: "auto", checkerAvailable: false })).toBe(EVERY_CHANGE);
    expect(autonomyLine(t, { mode: "never", checkerAvailable: true })).toBe(STEERED_ONLY);
  });
});

describe("confirmNeverAsk", () => {
  const buttons = () =>
    alert.mock.calls[0]?.[2] as { text: string; style: string; onPress: () => void }[];

  it("names the bot and explains with the free line", () => {
    void confirmNeverAsk(t, "Ada");
    expect(alert.mock.calls[0]?.[0]).toBe("Let Ada act without asking?");
    expect(alert.mock.calls[0]?.[1]).toBe(STEERED_ONLY);
    void confirmNeverAsk(t, undefined);
    expect(alert.mock.calls[1]?.[0]).toBe("Let bots act without asking?");
  });

  it("resolves false on Cancel and on dismiss, true on Stop asking", async () => {
    const cancelled = confirmNeverAsk(t, "Ada");
    expect(buttons().map((button) => [button.text, button.style])).toEqual([
      ["Cancel", "cancel"],
      ["Stop asking", "destructive"],
    ]);
    buttons()[0]?.onPress();
    await expect(cancelled).resolves.toBe(false);

    alert.mockClear();
    const dismissed = confirmNeverAsk(t, "Ada");
    const options = alert.mock.calls[0]?.[3] as { onDismiss: () => void };
    options.onDismiss();
    await expect(dismissed).resolves.toBe(false);

    alert.mockClear();
    const confirmed = confirmNeverAsk(t, "Ada");
    buttons()[1]?.onPress();
    await expect(confirmed).resolves.toBe(true);
  });
});
