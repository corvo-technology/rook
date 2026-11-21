// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InvitePage } from "./InvitePage";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray | { message: string }) =>
      "message" in strings ? strings.message : strings.join(""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@corvo/ui-web", () => ({
  Button: (props: React.ComponentProps<"button">) => <button {...props} />,
  Spinner: () => <span role="status" />,
  AgentLoader: ({ label }: { label?: string }) => (
    <span role="status" aria-label={label ?? "Loading…"} />
  ),
}));
vi.mock("../components/AuthFrame", () => ({
  AuthFrame: ({ title, children }: { title: ReactNode; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("../lib/brand", () => ({ useBrand: () => null }));
vi.mock("../lib/rpc", () => ({ selectSpace: vi.fn() }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const pending = {
  state: "pending",
  spaceName: "Acme",
  inviterName: "Ana",
  email: "a@example.com",
  role: "member",
  roleNames: [],
  hasAccount: true,
};

async function render() {
  await act(async () => root.render(<InvitePage kind="invite" token="tok" />));
}

it("shows a spinner while the invitation loads", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  await render();
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  expect(host.textContent).not.toContain("no longer works");
});

it("says the link no longer works only for a refused invitation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
  await render();
  expect(host.textContent).toContain("This link no longer works");
});

it("offers a retry when the request fails, and loads the invitation on retry", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(new Response(JSON.stringify(pending), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await render();
  expect(host.textContent).toContain("Could not load");
  expect(host.textContent).not.toContain("no longer works");
  const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again")!;
  await act(async () => retry.click());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Ana invited you to Acme");
});

it("treats a server error as a failed load, not a dead link", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 503 })),
  );
  await render();
  expect(host.textContent).toContain("Could not load");
});
