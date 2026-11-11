// @vitest-environment jsdom

import { i18n } from "@lingui/core";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
}));
vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
}));

import { ComposerError } from "./composer-error";

let container: HTMLDivElement;
let root: Root;

const unauthorized =
  '401: {"error":{"type":"authentication_error","message":"Bearer sk-test-0000000000 invalid"}}';
const tooLong =
  '400: {"error":{"message":"maximum context length","code":"context_length_exceeded"}}';

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.load("en", {});
  i18n.activate("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(props: Partial<Parameters<typeof ComposerError>[0]> = {}) {
  const all = {
    sendError: null,
    runError: unauthorized,
    runErrorId: "run-1",
    onRunErrorPresented: vi.fn(),
    onOpenModels: vi.fn(),
    onOpenConnections: vi.fn(),
    onDismissError: vi.fn(),
    textareaRef: { current: null },
    ...props,
  };
  await act(async () => root.render(<ComposerError {...all} />));
  return all;
}

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent === label);

describe("ComposerError", () => {
  it("offers Sign in again on an OAuth connection", async () => {
    const props = await render({ runAuthKind: "oauth" });
    expect(button("Replace key")).toBeUndefined();
    await act(async () => button("Sign in again")?.click());
    expect(props.onOpenConnections).toHaveBeenCalledWith("sign-in");
  });

  it("offers Replace key on an API key connection", async () => {
    await render({ runAuthKind: "api_key" });
    expect(button("Replace key")).toBeDefined();
    expect(button("Sign in again")).toBeUndefined();
  });

  it("retries once and disables Try again while retrying", async () => {
    const onRetryRun = vi.fn();
    await render({ onRetryRun });
    await act(async () => button("Try again")?.click());
    expect(onRetryRun).toHaveBeenCalledTimes(1);
    await render({ onRetryRun, retryingRun: true });
    expect(button("Try again")?.disabled).toBe(true);
  });

  it("does not offer Try again when retrying cannot help", async () => {
    await render({ runError: tooLong, onRetryRun: vi.fn() });
    expect(button("Try again")).toBeUndefined();
  });

  it("collapses Details and never shows the key", async () => {
    await render();
    const details = container.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain("[redacted]");
    expect(container.textContent).not.toContain("sk-test");
  });

  it("still renders a send error as before", async () => {
    await render({ sendError: "Failed to send message", runError: null, runErrorId: null });
    expect(container.textContent).toContain("Failed to send message");
    expect(container.querySelector("details")).toBeNull();
  });
});
