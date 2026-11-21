import { vi } from "vitest";
import { createTicketChangeNotifier } from "./ticket-changes.js";

export type Row = Record<string, any>;
export const NOW = new Date("2026-11-20T20:00:00Z");

/** Equality, `in`, `notIn`, `not` and nested relation filters: all these tests ask for. */
let dependenciesOf: (ticket: Row) => Row[] = () => [];

function matches(
  row: Row,
  where: Row,
  relation: (key: string, row: Row) => Row | undefined,
): boolean {
  return Object.entries(where).every(([key, want]) => {
    if (want === undefined) return true;
    if (want && typeof want === "object" && !(want instanceof Date)) {
      const nested = relation(key, row);
      if (nested) return matches(nested, want, relation);
      if ("none" in want) {
        const children = (row.id ? dependenciesOf(row) : []).filter((dep) =>
          matches(dep, want.none, relation),
        );
        return children.length === 0;
      }
      const checks: boolean[] = [];
      if ("in" in want) checks.push(want.in.includes(row[key]));
      if ("notIn" in want) checks.push(!want.notIn.includes(row[key]));
      if ("not" in want) checks.push(row[key] !== want.not);
      if ("gt" in want) checks.push(row[key] > want.gt);
      if ("lt" in want) checks.push(row[key] < want.lt);
      if ("lte" in want) checks.push(row[key] <= want.lte);
      if ("equals" in want) {
        checks.push(String(row[key]).toLowerCase() === String(want.equals).toLowerCase());
      }
      if (checks.length > 0) return checks.every(Boolean);
    }
    return row[key] === want;
  });
}

export function world() {
  const tickets = new Map<string, Row>();
  const dependencies: Row[] = [];
  const comments: Row[] = [];
  const runs: Row[] = [];
  const tasks: Row[] = [];
  const artifacts: Row[] = [];
  // Every run and comment lands a second after the one before, so "since the run started" is exact.
  let clock = NOW.getTime();
  const tick = () => {
    clock += 1000;
    return new Date(clock);
  };
  /** The language of the person who owns the agents. */
  const person: { locale: string | undefined } = { locale: undefined };
  /** Agents whose computer has no room left and is backing off. */
  const fullBots = new Set<string>();
  const board = {
    id: "b1",
    spaceId: "ws",
    name: "Board",
    ticketPrefix: "RAK",
    statusLabels: null,
    nextNumber: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  dependenciesOf = (ticket) =>
    dependencies
      .filter((row) => row.ticketId === ticket.id)
      .map((row) => ({ ...row, blocker: tickets.get(row.blockerId) }));
  const relation = (key: string, row: Row) =>
    key === "blocker"
      ? tickets.get(row.blockerId)
      : key === "ticket" && "blockerId" in row
        ? tickets.get(row.ticketId)
        : undefined;
  const apply = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      row[key] =
        value && typeof value === "object" && "increment" in value
          ? row[key] + value.increment
          : value && typeof value === "object" && "decrement" in value
            ? row[key] - value.decrement
            : value;
    }
    return row;
  };
  const find = (where: Row) =>
    [...tickets.values()].find((row) => matches(row, where, relation)) ?? null;
  const prisma: Row = {
    board: {
      findUnique: async () => board,
      update: async ({ data }: Row) => {
        board.nextNumber += data.nextNumber.increment;
        return { nextNumber: board.nextNumber };
      },
    },
    ticket: {
      findFirst: async ({ where, include }: Row) => {
        const row = find(where);
        return row && include
          ? { ...row, board: { ticketPrefix: "RAK" }, assigneeBot: { name: row.assigneeBotId } }
          : row && { ...row };
      },
      findUnique: async ({ where }: Row) => tickets.get(where.id) ?? null,
      findMany: async ({ where, orderBy, take }: Row) => {
        const hits = [...tickets.values()].filter((row) => matches(row, where, relation));
        const key = orderBy ? Object.keys(Array.isArray(orderBy) ? orderBy[0] : orderBy)[0] : "";
        if (key) hits.sort((a, b) => Number(a[key]) - Number(b[key]));
        return hits.slice(0, take).map((row) => ({ ...row }));
      },
      count: async ({ where }: Row) =>
        [...tickets.values()].filter((row) => matches(row, where, relation)).length,
      groupBy: async ({ where }: Row) =>
        [
          ...new Set(
            [...tickets.values()]
              .filter((row) => matches(row, where, relation))
              .map((row) => row.assigneeBotId),
          ),
        ].map((assigneeBotId) => ({ assigneeBotId })),
      create: async ({ data }: Row) => {
        const row = {
          id: `t${tickets.size + 1}`,
          status: "todo",
          priority: "normal",
          fields: null,
          remaining: null,
          continuations: 0,
          reviewRounds: 0,
          acceptanceCriteria: null,
          completedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
          ...data,
        };
        tickets.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: Row) => apply(tickets.get(where.id)!, data),
      updateMany: async ({ where, data }: Row) => {
        const hits = [...tickets.values()].filter((row) => matches(row, where, relation));
        for (const row of hits) apply(row, data);
        return { count: hits.length };
      },
    },
    ticketDependency: {
      count: async ({ where }: Row) =>
        dependencies.filter((row) => matches(row, where, relation)).length,
      findMany: async ({ where }: Row) =>
        dependencies
          .filter((row) => matches(row, where, relation))
          .map((row) => ({
            ...row,
            blocker: tickets.get(row.blockerId),
            ticket: tickets.get(row.ticketId),
          })),
      createMany: async ({ data }: Row) => {
        dependencies.push(...data);
        return { count: data.length };
      },
      deleteMany: async ({ where }: Row) => {
        for (let i = dependencies.length - 1; i >= 0; i--) {
          if (dependencies[i]!.ticketId === where.ticketId) dependencies.splice(i, 1);
        }
        return { count: 0 };
      },
    },
    ticketComment: {
      findFirst: async ({ where }: Row) =>
        comments.find((row) => matches(row, where, relation)) ?? null,
      create: async ({ data }: Row) => {
        const row = { id: `c${comments.length + 1}`, createdAt: tick(), updatedAt: NOW, ...data };
        comments.push(row);
        return { ...row, authorBot: { name: row.authorBotId }, authorUser: null };
      },
    },
    run: {
      create: async ({ data }: Row) => {
        const row = { id: `r${runs.length + 1}`, createdAt: tick(), ...data };
        runs.push(row);
        return row;
      },
      findFirst: async ({ where, orderBy }: Row) => {
        const hits = runs.filter((row) => matches(row, where, relation));
        return (orderBy ? hits.at(-1) : hits[0]) ?? null;
      },
      findUnique: async ({ where }: Row) => runs.find((row) => row.id === where.id) ?? null,
      findMany: async ({ where }: Row) =>
        runs.filter((row) => matches(row, where, relation)).map((row) => ({ ...row })),
      update: async ({ where, data }: Row) => apply(runs.find((row) => row.id === where.id)!, data),
    },
    artifact: {
      findFirst: async ({ where }: Row) =>
        artifacts.find((row) => matches(row, where, relation)) ?? null,
    },
    task: {
      create: async ({ data }: Row) => {
        const row = { id: `k${tasks.length + 1}`, ...data };
        tasks.push(row);
        return row;
      },
    },
    bot: {
      findFirst: async ({ where }: Row) => {
        const id = where.spawnKey ? "chief" : where.id;
        return { id, userId: "u1", thread: { id: `th-${id}` } };
      },
      findUnique: async ({ where }: Row) => ({ name: where.id, userId: "u1" }),
      findMany: async ({ where }: Row) =>
        [...fullBots]
          .filter((id) => !where.id?.in || where.id.in.includes(id))
          .map((id) => ({ id })),
    },
    user: { findUnique: async () => ({ name: "Pat", locale: person.locale }) },
    $queryRaw: async () => [],
    $transaction: async (fn: (client: Row) => unknown) => fn(prisma),
  };
  const jobs = { enqueue: vi.fn(async () => {}) };
  const onTicketChange = createTicketChangeNotifier({
    boardEvents: { notify: async () => {} } as never,
    prisma: prisma as never,
    jobs: jobs as never,
    ticketBoardEnabled: true,
  });
  const deps = { prisma: prisma as never, ticketBoardEnabled: true, onTicketChange };
  const prompts = (botId?: string) =>
    runs
      .filter((run) => botId === undefined || run.botId === botId)
      .map((run) => tasks.find((task) => task.id === run.taskId)!.prompt as string);
  const ticketByRef = (ref: string) => find({ number: Number(ref.slice(4)) })!;
  return {
    prisma,
    deps,
    jobs,
    tickets,
    comments,
    runs,
    artifacts,
    person,
    fullBots,
    prompts,
    ticketByRef,
    onTicketChange,
  };
}

export type World = ReturnType<typeof world>;
