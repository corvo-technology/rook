// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray) => parts.join(""),
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray) => parts.join("");
  return {
    useLingui: () => ({ t }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@corvo/ui-web", () => ({
  Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
  Spinner: (props: ComponentProps<"svg">) => <svg role="status" {...props} />,
  AgentLoader: ({ label }: { label?: string }) => (
    <span role="status" aria-label={label ?? "Loading…"} />
  ),
}));
const refetch = vi.hoisted(() => vi.fn());
vi.mock("../lib/use-pending-approvals", () => ({
  usePendingApprovals: () => ({
    isPending: false,
    isError: true,
    error: new Error("Offline"),
    data: undefined,
    refetch,
  }),
}));
vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    approvals: { list: { queryOptions: () => ({ queryKey: ["approvals"] }) } },
  }),
}));
vi.mock("../lib/rpc", () => ({ rpc: {} }));
vi.mock("./ApprovalsInbox", () => ({
  ApprovalsInbox: () => <p data-testid="approvals-empty" />,
}));

import { ApprovalsPage } from "./ApprovalsPage";

it("offers a retry instead of an empty inbox when the read fails", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ApprovalsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  expect(container.querySelector('[data-testid="approvals-empty"]')).toBeNull();
  const retry = container.querySelector('[role="alert"] button') as HTMLButtonElement;
  await act(async () => retry.click());
  expect(refetch).toHaveBeenCalled();
  await act(async () => root.unmount());
});
