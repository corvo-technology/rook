// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCountUp, useTypewriter } from "./hooks";

function Probe() {
  return (
    <p>
      {useCountUp(7)}|{useTypewriter("hello")}
    </p>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function media(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

async function show() {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));
  const text = container.textContent;
  await act(async () => root.unmount());
  return text;
}

it("shows the final number and text at once when motion is reduced", async () => {
  media(true);
  expect(await show()).toBe("7|hello");
});

it("starts from nothing when motion is allowed", async () => {
  media(false);
  expect(await show()).toBe("0|");
});
