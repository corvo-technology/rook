// @vitest-environment jsdom
import type { RoutingReason, RoutingReport } from "@corvo/contracts";
import { ROUTING_REASONS } from "@corvo/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
}));

import { RoutingLine, showsRouting } from "./routing-line";

const agents: Record<string, { name: string; color: string }> = {
  cto: { name: "CTO", color: "#3B82F6" },
  fin: { name: "Financeiro", color: "#10B981" },
  chief: { name: "Chefe", color: "#F59E0B" },
};
const report = (
  by: RoutingReport["by"],
  entries: Array<[string, RoutingReason]>,
  note?: string,
): RoutingReport => ({
  by,
  note,
  agents: entries.map(([botId, reason]) => ({ botId, reason })),
});

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render(value: RoutingReport) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<RoutingLine report={value} agent={(id) => agents[id]} />));
  return host;
}

const open = async (host: HTMLElement) => {
  await act(async () => host.querySelector<HTMLElement>('[data-testid="routing-line"]')!.click());
  return document.body.querySelector('[data-testid="routing-popover"]');
};

it("shows who the router picked, with their faces", async () => {
  const host = await render(
    report("router", [
      ["cto", "router_picked"],
      ["fin", "router_picked"],
      ["chief", "not_picked"],
    ]),
  );
  const line = host.querySelector('[data-testid="routing-line"]')!;
  expect(line.textContent).toContain("CTO, Financeiro");
  expect(line.textContent).not.toContain("Chefe");
  expect(host.querySelectorAll(".corvo-mascot-avatar")).toHaveLength(2);
});

it("opens each agent's reason, and the router's note as the router's", async () => {
  const host = await render(
    report(
      "router",
      [
        ["cto", "router_picked"],
        ["chief", "not_in_audience"],
      ],
      "a question about the build",
    ),
  );
  const popover = await open(host);
  expect(popover?.textContent).toContain("CTOPicked for this");
  expect(popover?.textContent).toContain("ChefeNot available to you");
  expect(popover?.textContent).toContain("Router's note: a question about the build");
});

it("says no one answered, and why", async () => {
  const host = await render(
    report("router", [
      ["cto", "none_needed"],
      ["chief", "none_needed"],
    ]),
  );
  expect(host.querySelector('[data-testid="routing-line"]')?.textContent).toBe("No one answered");
  expect(host.querySelectorAll(".corvo-mascot-avatar")).toHaveLength(0);
  expect((await open(host))?.textContent).toContain("CTONo answer needed");
});

it("explains a mentioned agent that could not answer", async () => {
  const host = await render(report("rules", [["cto", "paused"]]));
  expect(host.querySelector('[data-testid="routing-line"]')?.textContent).toBe("No one answered");
  expect((await open(host))?.textContent).toContain("CTOPaused");
});

it("skips an agent that has left the space", async () => {
  const host = await render(
    report("router", [
      ["gone", "router_picked"],
      ["cto", "router_picked"],
    ]),
  );
  expect(host.querySelector('[data-testid="routing-line"]')?.textContent).toContain("CTO");
});

it("labels every reason", async () => {
  const host = await render(
    report(
      "router",
      ROUTING_REASONS.map((reason) => [reason === "paused" ? "cto" : "fin", reason]),
    ),
  );
  const text = (await open(host))?.textContent ?? "";
  expect(text).not.toContain("undefined");
});

it("draws the line only when it says something the message does not", () => {
  expect(showsRouting(report("router", [["cto", "router_picked"]]))).toBe(true);
  expect(showsRouting(report("rules", [["cto", "mentioned"]]))).toBe(false);
  expect(showsRouting(report("rules", [["cto", "thread_owner"]]))).toBe(false);
  expect(
    showsRouting(
      report("rules", [
        ["cto", "mentioned"],
        ["fin", "over_budget"],
      ]),
    ),
  ).toBe(true);
  expect(showsRouting(report("rules", [["cto", "paused"]]))).toBe(true);
});
