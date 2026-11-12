import type { Bot, Ticket, TicketStatus } from "@corvo/contracts";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import { BoardLanes } from "../../src/pages/board/BoardLanes";

// The Tasks columns over a few tickets, one with an agent working on it right now, so the live
// step can be checked without a backend. State lives in the URL (?theme=light|dark&locale=en|pt-BR).

const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "pt-BR" ? "pt-BR" : "en";
const now = new Date().toISOString();

const bots = [
  { id: "ana", name: "Ana", color: "green", status: "running" },
  { id: "leo", name: "Leo", color: "cyan", status: "idle" },
] as unknown as Bot[];

function ticket(
  n: number,
  title: string,
  status: TicketStatus,
  assigneeBotId: string | null,
): Ticket {
  return {
    id: `t${n}`,
    boardId: "board",
    spaceId: "space",
    number: n,
    ref: `RAK-${n}`,
    title,
    description: null,
    status,
    priority: "normal",
    assigneeBotId,
    createdByBotId: null,
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    fields: [],
  };
}

const tickets = [
  ticket(1, "Confirm tomorrow's appointments", "todo", "leo"),
  ticket(2, "Answer the supplier about the delivery date", "doing", "ana"),
  ticket(3, "Send the weekly summary", "review", "leo"),
  ticket(4, "Renew the domain", "blocked", "ana"),
];

const labels: Record<TicketStatus, string> = {
  todo: "To do",
  doing: "In progress",
  review: "In review",
  blocked: "Blocked",
  done: "Done",
  closed: "Won't do",
};

function Page() {
  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <h1 className="pb-4 text-base font-medium">Tasks</h1>
      <BoardLanes
        tickets={tickets}
        bots={bots}
        labels={labels}
        placement={{}}
        steps={new Map([["t2", "Searching the web"]])}
        onOpen={() => undefined}
        onMove={() => undefined}
      />
    </main>
  );
}

applyResolvedAppearance(params.get("theme") === "light" ? "light" : "dark");
await bootstrapI18n(locale);
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <Page />
  </I18nProvider>,
);
