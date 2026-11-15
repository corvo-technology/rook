// @vitest-environment jsdom
import type { DatabaseConnection } from "@corvo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { DatabasesSettings } from "./DatabasesSettings";

const PASSWORD = "fake-db-password-SENTINEL";
const row: DatabaseConnection = {
  id: "db1",
  name: "Sales",
  host: "db.example.test",
  port: 5432,
  database: "sales",
  user: "reader",
  sslMode: "require",
  testedOk: true,
  botIds: ["b1"],
  createdAt: "2026-01-01T00:00:00.000Z",
};
const api = vi.hoisted(() => ({
  databases: { create: vi.fn(), test: vi.fn(), remove: vi.fn(), setGrants: vi.fn() },
}));
const data = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, i) => text + (i ? String(values[i - 1]) : "") + part, ""),
  }),
}));
vi.mock("../lib/rpc", () => ({ rpc: api }));
vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    databases: {
      list: { queryOptions: () => ({ queryKey: ["databases"], queryFn: async () => data.rows }) },
    },
    bots: {
      list: {
        queryOptions: () => ({
          queryKey: ["bots"],
          queryFn: async () => [
            { id: "b1", name: "Ana", archivedAt: null },
            { id: "b2", name: "Rui", archivedAt: null },
          ],
        }),
      },
    },
  }),
}));

let cleanup: (() => Promise<void>) | undefined;
beforeEach(() => {
  api.databases.create.mockReset();
  api.databases.setGrants.mockReset();
  data.rows = [];
});

async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DatabasesSettings />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return container;
}

const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);

it("keeps the connection string in a password field and saves it as typed", async () => {
  api.databases.create.mockResolvedValue(row);
  const container = await render();
  await act(async () => button(container, "Add database")?.click());
  const field = container.querySelector<HTMLInputElement>('[aria-label="Connection string"]')!;
  expect(field.type).toBe("password");
  expect(container.textContent).toContain("Use a read-only database role.");
  const name = container.querySelector<HTMLInputElement>('[aria-label="Name"]')!;
  const setValue = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await act(async () => setValue(name, "Sales"));
  await act(async () => setValue(field, `postgres://reader:${PASSWORD}@db.example.test/sales`));
  await act(async () => button(container, "Connect")?.click());
  expect(api.databases.create).toHaveBeenCalledWith({
    name: "Sales",
    connectionString: `postgres://reader:${PASSWORD}@db.example.test/sales`,
  });
  // Once saved, the list shows the connection and never the password.
  expect(container.textContent).toContain("reader@db.example.test/sales");
  expect(container.textContent).not.toContain(PASSWORD);
  await cleanup?.();
});

it("shows what an agent is granted and changes it one agent at a time", async () => {
  data.rows = [row];
  api.databases.setGrants.mockResolvedValue({ ...row, botIds: ["b1", "b2"] });
  const container = await render();
  expect(button(container, "Ana")?.getAttribute("aria-pressed")).toBe("true");
  expect(button(container, "Rui")?.getAttribute("aria-pressed")).toBe("false");
  await act(async () => button(container, "Rui")?.click());
  expect(api.databases.setGrants).toHaveBeenCalledWith({ id: "db1", botIds: ["b1", "b2"] });
  await cleanup?.();
});
