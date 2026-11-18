import { describe, expect, it } from "vitest";
import {
  activeEmbedTab,
  balanceView,
  embedTabs,
  formatMinor,
  parsePartnerBalance,
  quickActions,
} from "./embedded-home";

describe("the frame's tabs", () => {
  it("are Home, Chats, Tasks, Routines and Agents", () => {
    expect(embedTabs({ hidden: [], ticketBoardEnabled: true })).toEqual([
      "home",
      "chats",
      "board",
      "routines",
      "team",
    ]);
  });

  it("leave out what the partner hides and the board when it is off", () => {
    expect(embedTabs({ hidden: ["routines", "store"], ticketBoardEnabled: false })).toEqual([
      "home",
      "chats",
      "team",
    ]);
    expect(embedTabs({ hidden: ["board"], ticketBoardEnabled: true })).not.toContain("board");
  });

  it("never offer billing, the workspace switcher, or the store", () => {
    const tabs: string[] = embedTabs({ hidden: [], ticketBoardEnabled: true });
    for (const name of ["billing", "settings", "store", "spaces", "usage", "approvals"]) {
      expect(tabs).not.toContain(name);
    }
  });

  it("mark the tab a path belongs to, every conversation being under Chats", () => {
    expect(activeEmbedTab("/app/home")).toBe("home");
    expect(activeEmbedTab("/app/board")).toBe("board");
    expect(activeEmbedTab("/app/routines")).toBe("routines");
    expect(activeEmbedTab("/app/team")).toBe("team");
    expect(activeEmbedTab("/app")).toBe("chats");
    expect(activeEmbedTab("/app/bot-1")).toBe("chats");
    expect(activeEmbedTab("/app/g/group-1")).toBe("chats");
  });
});

describe("the quick actions", () => {
  const prontu = [
    { label: "Resumo da agenda de hoje", prompt: "Faça o resumo da agenda de hoje" },
    { label: "Gravar consulta (abrir no Prontu)", open: "/consultas/gravar" },
  ];
  const bots = [
    { id: "chief", starters: ["Resumo do dia"] },
    { id: "a", starters: ["Como está a agenda de hoje?", "Outra"] },
    { id: "b", starters: [] },
    { id: "c", starters: ["Faça o resumo de hoje"] },
  ];

  it("are the template's own, in its order, whatever the agents' starters", () => {
    expect(quickActions({ quickActions: prontu }, bots, "chief")).toEqual(prontu);
  });

  it("fall back to the first starter of each agent but the Chief", () => {
    expect(quickActions({}, bots, "chief")).toEqual([
      { label: "Como está a agenda de hoje?", prompt: "Como está a agenda de hoje?" },
      { label: "Faça o resumo de hoje", prompt: "Faça o resumo de hoje" },
    ]);
    expect(quickActions(null, [], undefined)).toEqual([]);
  });
});

describe("the balance", () => {
  const base = {
    currency: "BRL",
    planCredit: 3000,
    used: 1200,
    remaining: 1800,
    periodEnd: "2026-12-01T00:00:00Z",
    state: "active",
    checkoutUrl: "https://pay.example.test/buy",
    lowThresholdReached: false,
  };

  it("is nothing when the server has none or sends something else", () => {
    expect(parsePartnerBalance(undefined)).toBeNull();
    expect(parsePartnerBalance({ currency: "BRL" })).toBeNull();
    expect(balanceView(null, "pt-BR")).toBeNull();
    expect(balanceView({ ...base, planCredit: 0 }, "pt-BR")).toBeNull();
  });

  it("reads the server's shape", () => {
    expect(parsePartnerBalance(base)).toEqual(base);
    expect(parsePartnerBalance({ ...base, state: undefined, checkoutUrl: 3 })).toMatchObject({
      state: "active",
      checkoutUrl: null,
    });
  });

  it("shows what is left of the month's credit in the partner's money", () => {
    const view = balanceView(base, "pt-BR");
    expect(view).toMatchObject({ kind: "normal", ratio: 0.6 });
    expect(view?.remaining.replace(/\s/g, " ")).toBe("R$ 18");
    expect(view?.total.replace(/\s/g, " ")).toBe("R$ 30");
  });

  it("warns at the threshold, when used up, and when the plan lapsed", () => {
    expect(balanceView({ ...base, remaining: 500, lowThresholdReached: true }, "pt-BR")?.kind).toBe(
      "low",
    );
    expect(balanceView({ ...base, remaining: 0, used: 3000 }, "pt-BR")?.kind).toBe("empty");
    expect(balanceView({ ...base, state: "lapsed" }, "pt-BR")?.kind).toBe("lapsed");
  });

  it("keeps cents only when there are some, and never shows a negative balance", () => {
    expect(formatMinor(1850, "BRL", "pt-BR").replace(/\s/g, " ")).toBe("R$ 18,50");
    expect(balanceView({ ...base, remaining: -40 }, "pt-BR")).toMatchObject({ ratio: 0 });
  });
});
