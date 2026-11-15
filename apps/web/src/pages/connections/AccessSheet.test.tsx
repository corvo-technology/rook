// @vitest-environment jsdom
import type { Bot } from "@corvo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import type { ConnectionItem } from "./connection-model";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, i) => text + (i ? String(values[i - 1]) : "") + part, "");
  return {
    useLingui: () => ({ t }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@corvo/ui-web", () => {
  const box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    Sheet: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SheetContent: box,
    SheetHeader: box,
    SheetTitle: box,
    DropdownMenu: box,
    DropdownMenuContent: box,
    DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => (
      <button type="button">{children}</button>
    ),
    DropdownMenuItem: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <button type="button" data-bulk onClick={onClick}>
        {children}
      </button>
    ),
    BotAvatar: () => null,
    OptionSelect: ({
      value,
      options,
      onValueChange,
      "aria-label": label,
    }: {
      value: string;
      options: Array<{ value: string; label: string; disabled?: boolean }>;
      onValueChange: (value: string) => void;
      "aria-label": string;
    }) => (
      <select aria-label={label} value={value} onChange={(e) => onValueChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
});

import { AccessSheet } from "./AccessSheet";

const bot = (id: string, name: string, title = ""): Bot => ({ id, name, title }) as Bot;
const item = (kind: ConnectionItem["kind"]): ConnectionItem => ({
  kind,
  id: "c1",
  name: "GitHub",
  detail: "",
  tone: "ok",
  status: "Connected",
  otherOwner: null,
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
});

async function render(ui: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => createRoot(host).render(ui));
  return host;
}

it("lists every agent with its level, and a per-tool list reads Custom", async () => {
  const host = await render(
    <AccessSheet
      item={item("mcp")}
      agents={[bot("a", "Engineer", "Writes code"), bot("b", "QA"), bot("c", "Chief")]}
      levels={
        new Map([
          ["a", "write"],
          ["b", "custom"],
        ])
      }
      onChange={async () => undefined}
      onClose={() => undefined}
    />,
  );
  expect(host.textContent).toContain("Who can use GitHub");
  const value = (name: string) =>
    (host.querySelector(`select[aria-label="Access for ${name}"]`) as HTMLSelectElement).value;
  expect(value("Engineer")).toBe("write");
  expect(value("QA")).toBe("custom");
  expect(value("Chief")).toBe("none");
  // A few agents need no search box.
  expect(host.querySelector('input[aria-label="Search agents"]')).toBeNull();
});

it("sets one agent's level, and everyone's at once", async () => {
  const onChange = vi.fn(async () => undefined);
  const host = await render(
    <AccessSheet
      item={item("mailbox")}
      agents={[bot("a", "Engineer"), bot("b", "QA")]}
      levels={new Map()}
      onChange={onChange}
      onClose={() => undefined}
    />,
  );
  const select = host.querySelector('select[aria-label="Access for QA"]') as HTMLSelectElement;
  await act(async () => {
    select.value = "read";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith(["b"], "read");
  const bulk = Array.from(host.querySelectorAll("button[data-bulk]")).find(
    (button) => button.textContent === "Read and write",
  ) as HTMLButtonElement;
  await act(async () => bulk.click());
  expect(onChange).toHaveBeenLastCalledWith(["a", "b"], "write");
});

it("offers a database only none and read, and searches when there are many agents", async () => {
  const agents = Array.from({ length: 7 }, (_, i) => bot(`b${i}`, `Agent ${i}`));
  const host = await render(
    <AccessSheet
      item={item("database")}
      agents={agents}
      levels={new Map()}
      onChange={async () => undefined}
      onClose={() => undefined}
    />,
  );
  const options = Array.from(
    host.querySelectorAll('select[aria-label="Access for Agent 0"] option'),
  ).map((option) => option.textContent);
  expect(options).toEqual(["No access", "Read"]);
  const search = host.querySelector('input[aria-label="Search agents"]') as HTMLInputElement;
  expect(search).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      search,
      "agent 3",
    );
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelectorAll('[data-testid="access-agent"]')).toHaveLength(1);
});
