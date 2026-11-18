// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({
  partner: {
    status: vi.fn(),
    create: vi.fn(),
    rotateKey: vi.fn(),
    setTemplate: vi.fn(),
    setTenantState: vi.fn(),
    setLimits: vi.fn(),
  },
}));
vi.mock("../lib/rpc", () => ({ rpc: rpcMock }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return {
    useLingui: () => ({ t, i18n: { locale: "en" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});

import { PartnershipSettingsPanel } from "./PartnershipSettingsPanel";

const account = {
  name: "Acme SaaS",
  keyPrefix: "cpk_ABCDEFGH",
  template: null,
  wallet: { balanceUsd: 7.5, passedOnUsd: 2.5, perTenantLimitUsd: 6, monthlyLimitUsd: null },
  tenants: [
    {
      externalTenantId: "s1",
      name: "Shop One",
      state: "enabled" as const,
      usedUsd: 1.2,
      balanceUsd: 3.8,
    },
    {
      externalTenantId: "s2",
      name: "Shop Two",
      state: "suspended" as const,
      usedUsd: 0,
      balanceUsd: 0,
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? "";
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined;

async function render() {
  await act(async () => {
    root.render(<PartnershipSettingsPanel />);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const fn of Object.values(rpcMock.partner)) fn.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PartnershipSettingsPanel", () => {
  it("offers to become a partner, then shows the key once", async () => {
    rpcMock.partner.status.mockResolvedValue({ partner: null });
    rpcMock.partner.create.mockResolvedValue({ key: "cpk_NEWKEY.secret-value" });
    await render();
    const input = container.querySelector("input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Acme SaaS",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    rpcMock.partner.status.mockResolvedValue({ partner: { ...account, tenants: [] } });
    await act(async () => button("Become a partner")?.click());
    expect(rpcMock.partner.create).toHaveBeenCalledWith({ name: "Acme SaaS" });
    expect(text()).toContain("cpk_NEWKEY.secret-value");
    expect(text()).toContain("Acme SaaS");
  });

  it("lists customers and pauses or resumes one", async () => {
    rpcMock.partner.status.mockResolvedValue({ partner: account });
    rpcMock.partner.setTenantState.mockResolvedValue({ ok: true });
    await render();
    expect(text()).toContain("Shop One");
    expect(text()).toContain("Shop Two");
    await act(async () => button("Pause")?.click());
    expect(rpcMock.partner.setTenantState).toHaveBeenCalledWith({
      externalTenantId: "s1",
      state: "suspended",
    });
    await act(async () => button("Resume")?.click());
    expect(rpcMock.partner.setTenantState).toHaveBeenCalledWith({
      externalTenantId: "s2",
      state: "enabled",
    });
  });

  it("replaces the key on request and shows the new one", async () => {
    rpcMock.partner.status.mockResolvedValue({ partner: account });
    rpcMock.partner.rotateKey.mockResolvedValue({ key: "cpk_ROTATED.secret" });
    await render();
    expect(text()).not.toContain("cpk_ROTATED");
    await act(async () => button("New key")?.click());
    expect(text()).toContain("cpk_ROTATED.secret");
  });

  it("shows what each customer has spent and has left", async () => {
    rpcMock.partner.status.mockResolvedValue({ partner: account });
    await render();
    expect(text()).toContain("$1.20 used");
    expect(text()).toContain("$3.80 left");
  });

  it("shows the credit the partner can pass on and what it passed on this month", async () => {
    rpcMock.partner.status.mockResolvedValue({ partner: account });
    await render();
    expect(text()).toContain("$7.50 to pass on");
    expect(text()).toContain("$2.50 passed on this month");
  });

  it("saves the limits in dollars, and an empty field removes a limit", async () => {
    rpcMock.partner.status.mockResolvedValue({ partner: account });
    rpcMock.partner.setLimits.mockResolvedValue({ ok: true });
    await render();
    const perCustomer = container.querySelector(
      'input[aria-label="Limit per customer, per month"]',
    ) as HTMLInputElement;
    expect(perCustomer.value).toBe("6");
    const total = container.querySelector(
      'input[aria-label="Limit in total, per month"]',
    ) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(total, "50");
      total.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = total.closest("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(rpcMock.partner.setLimits).toHaveBeenCalledWith({
      perTenantLimitUsd: 6,
      monthlyLimitUsd: 50,
    });
  });

  it("offers to add credit only where billing exists", async () => {
    rpcMock.partner.status.mockResolvedValue({ partner: account });
    await render();
    expect(button("Add credit")).toBeUndefined();
    const onAddCredit = vi.fn();
    await act(async () => {
      root.render(<PartnershipSettingsPanel onAddCredit={onAddCredit} />);
    });
    await act(async () => button("Add credit")?.click());
    expect(onAddCredit).toHaveBeenCalled();
  });

  it("saves the agents every new customer gets, keeping a saved agent's key", async () => {
    const saved = {
      agents: [{ key: "manager", name: "Manager", instructions: "Run it.", usesConnector: false }],
    };
    rpcMock.partner.status.mockResolvedValue({ partner: { ...account, template: saved } });
    rpcMock.partner.setTemplate.mockResolvedValue({ ok: true });
    await render();
    await act(async () => button("Edit")?.click());
    const name = container.querySelector('input[aria-label="Name"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Boss");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Add agent")?.click());
    const names = container.querySelectorAll('input[aria-label="Name"]');
    await act(async () => {
      const second = names[1] as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        second,
        "Writer Two",
      );
      second.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // The editor's Save comes after the limits form's.
    const saves = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "Save",
    );
    await act(async () => saves.at(-1)?.click());
    expect(rpcMock.partner.setTemplate).toHaveBeenCalledWith({
      template: {
        agents: [
          { key: "manager", name: "Boss", instructions: "Run it.", usesConnector: false },
          { key: "writer-two", name: "Writer Two", instructions: "", usesConnector: false },
        ],
      },
    });
  });

  it("saves which areas to hide and whether customers may choose the model", async () => {
    rpcMock.partner.status.mockResolvedValue({ partner: account });
    rpcMock.partner.setTemplate.mockResolvedValue({ ok: true });
    await render();
    await act(async () => button("Edit")?.click());
    const tick = async (label: string) => {
      const box = container.querySelector<HTMLElement>(`[role="checkbox"][aria-label="${label}"]`);
      await act(async () => box?.click());
    };
    await tick("Store");
    await tick("Customers can choose the model");
    const saves = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "Save",
    );
    await act(async () => saves.at(-1)?.click());
    expect(rpcMock.partner.setTemplate).toHaveBeenCalledWith({
      template: { agents: [], hide: ["store"], models: "choose" },
    });
  });

  it("saves an agent's first messages, one per line, at most four", async () => {
    const saved = {
      agents: [{ key: "manager", name: "Manager", instructions: "Run it.", usesConnector: false }],
    };
    rpcMock.partner.status.mockResolvedValue({ partner: { ...account, template: saved } });
    rpcMock.partner.setTemplate.mockResolvedValue({ ok: true });
    await render();
    await act(async () => button("Edit")?.click());
    const box = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="First messages, one per line"]',
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        box,
        "Show today's bookings\n\n  Who has not paid?  \na\nb\nc",
      );
      box?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saves = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "Save",
    );
    await act(async () => saves.at(-1)?.click());
    expect(rpcMock.partner.setTemplate).toHaveBeenCalledWith({
      template: {
        agents: [
          {
            key: "manager",
            name: "Manager",
            instructions: "Run it.",
            usesConnector: false,
            starters: ["Show today's bookings", "Who has not paid?", "a", "b"],
          },
        ],
      },
    });
  });

  it("says so when it cannot load", async () => {
    rpcMock.partner.status.mockRejectedValue(new Error("boom"));
    await render();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  const typeInto = async (el: HTMLInputElement | null, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value);
      el?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const saveEditor = async () => {
    const saves = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "Save",
    );
    await act(async () => saves.at(-1)?.click());
  };

  it("saves the Chief's name and the brand colour, lowercased", async () => {
    rpcMock.partner.status.mockResolvedValue({ partner: account });
    rpcMock.partner.setTemplate.mockResolvedValue({ ok: true });
    await render();
    await act(async () => button("Edit")?.click());
    await typeInto(
      container.querySelector('input[aria-label="Chief name"]'),
      " Assistente GreenBarber ",
    );
    await typeInto(container.querySelector('input[aria-label="Brand colour"]'), "#16A34A");
    await saveEditor();
    expect(rpcMock.partner.setTemplate).toHaveBeenCalledWith({
      template: { agents: [], chiefName: "Assistente GreenBarber", accent: "#16a34a" },
    });
  });

  it("does not save a brand colour that is not #rrggbb", async () => {
    rpcMock.partner.status.mockResolvedValue({ partner: account });
    await render();
    await act(async () => button("Edit")?.click());
    await typeInto(container.querySelector('input[aria-label="Brand colour"]'), "green");
    await saveEditor();
    expect(rpcMock.partner.setTemplate).not.toHaveBeenCalled();
  });

  const chooseFile = async (contents: string) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([contents], "greenbarber.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  it("imports a template file into the editor, asks for the server address, then saves", async () => {
    rpcMock.partner.status.mockResolvedValue({ partner: account });
    rpcMock.partner.setTemplate.mockResolvedValue({ ok: true });
    await render();
    await chooseFile(
      JSON.stringify({
        connector: { slug: "greenflow", name: "Greenflow", endpoint: "{{MCP_PUBLIC_URL}}" },
        agents: [
          {
            key: "recepcao",
            name: "Recepção",
            instructions: "Cuide da agenda.",
            usesConnector: true,
            starters: ["Como está a agenda de hoje?"],
          },
        ],
        hide: ["store"],
        chiefName: "Assistente GreenBarber",
      }),
    );
    // Nothing is saved until the owner has checked it and filled in the address.
    expect(rpcMock.partner.setTemplate).not.toHaveBeenCalled();
    expect((container.querySelector('input[aria-label="Name"]') as HTMLInputElement).value).toBe(
      "Recepção",
    );
    await saveEditor();
    expect(rpcMock.partner.setTemplate).not.toHaveBeenCalled();
    await typeInto(
      container.querySelector('input[aria-label="Connector address"]'),
      "https://mcp.example.test",
    );
    await saveEditor();
    expect(rpcMock.partner.setTemplate).toHaveBeenCalledWith({
      template: {
        connector: { slug: "greenflow", name: "Greenflow", endpoint: "https://mcp.example.test" },
        agents: [
          {
            key: "recepcao",
            name: "Recepção",
            instructions: "Cuide da agenda.",
            usesConnector: true,
            starters: ["Como está a agenda de hoje?"],
          },
        ],
        hide: ["store"],
        chiefName: "Assistente GreenBarber",
      },
    });
  });

  it("says so, and changes nothing, when the imported file is not a template", async () => {
    rpcMock.partner.status.mockResolvedValue({ partner: account });
    await render();
    await chooseFile("not json");
    expect(text()).toContain("That file is not a valid template");
    await chooseFile(JSON.stringify({ agents: [], accent: "red" }));
    expect(text()).toContain("That file is not a valid template");
    expect(container.querySelector('input[aria-label="Name"]')).toBeNull();
    expect(rpcMock.partner.setTemplate).not.toHaveBeenCalled();
  });
});
