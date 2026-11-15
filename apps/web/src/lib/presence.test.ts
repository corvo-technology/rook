import { expect, it, vi } from "vitest";
import { createPresenceToucher, PRESENCE_TOUCH_INTERVAL_MS } from "./presence";

it("sends active at most once per interval and inactive once", () => {
  let now = 1_000;
  const send = vi.fn();
  const toucher = createPresenceToucher(send, () => now);
  toucher.active();
  now += 10_000;
  toucher.active();
  expect(send.mock.calls).toEqual([[true]]);
  now += PRESENCE_TOUCH_INTERVAL_MS;
  toucher.active();
  expect(send.mock.calls).toEqual([[true], [true]]);
  toucher.inactive();
  toucher.inactive();
  expect(send.mock.calls).toEqual([[true], [true], [false]]);
});

it("reports active again right away when the page comes back", () => {
  const send = vi.fn();
  const toucher = createPresenceToucher(send, () => 5);
  toucher.active();
  toucher.inactive();
  toucher.active();
  expect(send.mock.calls).toEqual([[true], [false], [true]]);
});
