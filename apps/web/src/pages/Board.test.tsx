// @vitest-environment jsdom

import type * as UiWeb from "@corvo/ui-web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  boards: { subscribe: vi.fn(), get: vi.fn(), rename: vi.fn() },
  bots: { list: vi.fn() },
  tickets: {
    list: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    create: vi.fn(),
    comment: vi.fn(),
    comments: vi.fn(),
  },
}));
vi.mock("../lib/rpc", () => ({
  rpc: api,
  rpcForSpace: () => api,
  createSpaceRpc: () => api,
  selectedSpaceId: () => null,
}));
vi.mock("../lib/relative-time", () => ({ formatRelativeTime: () => "5m ago" }));
vi.mock("./WindowChrome", () => ({ WindowChrome: () => null }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + String(values[index] ?? ""), "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@corvo/chat-ui/web", () => ({
  ChatMarkdown: ({ children }: { children?: ReactNode }) => (
    <div data-testid="chat-markdown">{children}</div>
  ),
}));
vi.mock("@corvo/ui-web", async (importOriginal) => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const original = await importOriginal<typeof UiWeb>();
  return {
    BotAvatar: () => <span data-testid="bot-avatar" />,
    cn: original.cn,
    Button: (props: ComponentProps<"button">) => <button {...props} />,
    buttonVariants: original.buttonVariants,
    SidePanel: ({
      title,
      footer,
      children,
    }: {
      title?: ReactNode;
      footer?: ReactNode;
      children?: ReactNode;
    }) => (
      <aside>
        <h2>{title}</h2>
        {children}
        <footer>{footer}</footer>
      </aside>
    ),
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
    NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
    Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
  };
});

import { BoardPage } from "./Board";

/** Query results reach components on a timer, real or fake. */
async function settle() {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function bot(id: string, name: string) {
  return { id, name };
}

function ticket(
  title: string,
  id: string,
  status = "todo",
  ref = "RAK-1",
  assigneeBotId: string | null = null,
  description: string | null = null,
) {
  return {
    id,
    boardId: "board-1",
    spaceId: "space-1",
    number: 1,
    ref,
    title,
    description,
    status,
    priority: "normal",
    assigneeBotId,
    createdByBotId: null,
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    fields: [],
  };
}

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

async function renderBoard(
  stream?: AsyncIterable<{ ticketId?: string }>,
  refusal?: unknown,
  labels: Record<string, string> = {},
  path = "/app/board",
) {
  api.boards.subscribe.mockReset();
  api.boards.get.mockResolvedValue({ id: "board-1", statusLabels: labels });
  api.boards.subscribe.mockResolvedValue(
    stream ?? {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    },
  );
  if (refusal) api.boards.subscribe.mockRejectedValueOnce(refusal);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <BoardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  // Let query results reach the screen.
  await settle();
  return {
    container,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("renders status columns and opens a ticket with comments", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper")]);
  api.tickets.list.mockResolvedValue({
    tickets: [ticket("Ship", "ticket-1", "todo", "RAK-1", "bot-1", "Details")],
  });
  api.tickets.comments.mockResolvedValue([
    {
      id: "comment-1",
      body: "Ready",
      authorName: "Board tester",
      createdAt: "2026-10-10T10:00:00Z",
    },
    { id: "comment-2", body: "Reviewed", authorName: "Helper", createdAt: "2026-10-10T10:01:00Z" },
  ]);
  const page = await renderBoard();
  try {
    expect(
      Array.from(page.container.querySelectorAll("h2")).map((node) => node.textContent),
    ).toEqual(["To do", "In progress", "In review", "Blocked", "Done", "Won't do"]);
    await act(async () =>
      (
        page.container.querySelector('[data-testid="board-card-ticket-1"]') as HTMLButtonElement
      ).click(),
    );
    await settle();
    expect(page.container.querySelector('[data-testid="ticket-description"]')?.textContent).toBe(
      "Details",
    );
    expect(page.container.querySelector('[data-testid="ticket-comments"]')?.textContent).toContain(
      "Ready",
    );
    const comments = page.container.querySelector('[data-testid="ticket-comments"]')!;
    expect(comments.textContent).toContain("Board tester");
    expect(comments.textContent).toContain("Helper");
    expect(Array.from(comments.querySelectorAll("time")).map((node) => node.textContent)).toEqual([
      "5m ago",
      "5m ago",
    ]);
    expect(
      Array.from(page.container.querySelectorAll("select")).every(
        (node) => node.className === "w-full",
      ),
    ).toBe(true);
    const submitButtons = page.container.querySelectorAll('button[type="submit"]');
    expect(Array.from(submitButtons).map((node) => node.parentElement?.className)).toEqual([
      "flex justify-end",
      "flex justify-end",
    ]);
    expect(api.tickets.comments).toHaveBeenCalledWith({ ticketId: "ticket-1" }, expect.anything());
  } finally {
    await page.cleanup();
  }
});

it("creates a ticket without a status picker", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper")]);
  api.tickets.list.mockResolvedValue({ tickets: [] });
  api.tickets.create.mockResolvedValue({});
  const page = await renderBoard();
  try {
    expect(page.container.textContent).toContain("No tickets yet");
    await act(async () =>
      Array.from(page.container.querySelectorAll("button"))
        .find((button) => button.textContent === "New ticket")!
        .click(),
    );
    expect(
      Array.from(page.container.querySelectorAll("label")).map((label) => label.textContent),
    ).not.toContain("Status");
    const input = page.container.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Launch",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      page.container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(api.tickets.create).toHaveBeenCalledWith({
      title: "Launch",
      description: "",
      assigneeBotId: "bot-1",
      priority: "normal",
    });
  } finally {
    await page.cleanup();
  }
});

function liveStream() {
  let deliver: ((result: IteratorResult<{ ticketId?: string }>) => void) | undefined;
  let fail: ((cause: Error) => void) | undefined;
  return {
    stream: {
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise<IteratorResult<{ ticketId?: string }>>((resolve, reject) => {
            deliver = resolve;
            fail = reject;
          }),
      }),
    },
    event: (ticketId: string, extra: Record<string, unknown> = {}) =>
      deliver?.({ done: false, value: { ticketId, ...extra } }),
    end: () => deliver?.({ done: true, value: undefined }),
    error: () => fail?.(new Error("Disconnected")),
  };
}

it("saves only edits and refreshes comments for the open ticket", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper"), bot("bot-2", "Other")]);
  api.tickets.list.mockResolvedValue({
    tickets: [ticket("Ship", "ticket-1", "todo", "RAK-1", "bot-1", "Details")],
  });
  api.tickets.comments.mockReset().mockResolvedValue([{ id: "comment-1", body: "Ready" }]);
  api.tickets.update.mockReset().mockResolvedValue({});
  const live = liveStream();
  const page = await renderBoard(live.stream);
  try {
    await act(async () =>
      (
        page.container.querySelector('[data-testid="board-card-ticket-1"]') as HTMLButtonElement
      ).click(),
    );
    await settle();
    const calls = api.tickets.comments.mock.calls.length;
    await act(async () => live.event("ticket-2"));
    expect(api.tickets.comments).toHaveBeenCalledTimes(calls);
    api.tickets.comments.mockResolvedValue([{ id: "comment-2", body: "Bot progress" }]);
    api.tickets.list.mockResolvedValue({
      tickets: [ticket("Ship", "ticket-1", "doing", "RAK-1", "bot-2", "Details")],
    });
    await act(async () => live.event("ticket-1"));
    await settle();
    expect(page.container.querySelector('[data-testid="ticket-comments"]')?.textContent).toContain(
      "Bot progress",
    );
    const input = page.container.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Ship today",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      page.container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(api.tickets.update).toHaveBeenCalledWith({ id: "ticket-1", title: "Ship today" });
  } finally {
    await page.cleanup();
  }
});

it("closes the subscription before retrying a failed ticket refresh", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper")]);
  api.tickets.list
    .mockReset()
    .mockResolvedValueOnce({ tickets: [] })
    .mockRejectedValueOnce(new Error("Refresh failed"))
    .mockResolvedValue({ tickets: [ticket("After retry", "ticket-1")] });
  const next = vi.fn(() => new Promise<IteratorResult<{ ticketId?: string }>>(() => {}));
  const page = await renderBoard({ [Symbol.asyncIterator]: () => ({ next }) });
  try {
    const firstSignal = api.boards.subscribe.mock.calls[0]![1].signal as AbortSignal;
    expect(firstSignal.aborted).toBe(true);
    expect(next).not.toHaveBeenCalled();
    expect(api.boards.subscribe).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(api.boards.subscribe).toHaveBeenCalledTimes(2);
    const retrySignal = api.boards.subscribe.mock.calls[1]![1].signal as AbortSignal;
    expect(retrySignal).not.toBe(firstSignal);
    expect(retrySignal.aborted).toBe(false);
    expect(page.container.textContent).toContain("After retry");

    await page.cleanup();
    expect(retrySignal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(api.boards.subscribe).toHaveBeenCalledTimes(2);
  } finally {
    if (page.container.isConnected) await page.cleanup();
    vi.useRealTimers();
  }
});

it.each(["end", "error"] as const)(
  "reconnects after subscription %s and stops on unmount",
  async (failure) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    api.bots.list.mockResolvedValue([bot("bot-1", "Helper")]);
    api.tickets.list.mockReset().mockResolvedValue({ tickets: [] });
    const live = liveStream();
    const page = await renderBoard(live.stream);
    try {
      const reconnected = liveStream();
      api.boards.subscribe.mockResolvedValue(reconnected.stream);
      await act(async () => live[failure]());
      const calls = api.tickets.list.mock.calls.length;
      api.tickets.list.mockResolvedValue({ tickets: [ticket("After reconnect", "ticket-1")] });
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      await settle();
      expect(api.boards.subscribe).toHaveBeenCalledTimes(2);
      expect(api.tickets.list).toHaveBeenCalledTimes(calls + 1);
      await act(async () => {
        await vi.waitFor(() => expect(page.container.textContent).toContain("After reconnect"));
      });
      await act(async () => reconnected.end());
      await page.cleanup();
      await act(async () => vi.advanceTimersByTimeAsync(5_000));
      expect(api.boards.subscribe).toHaveBeenCalledTimes(2);
      expect(api.boards.subscribe.mock.calls[1]![1].signal.aborted).toBe(true);
    } finally {
      if (page.container.isConnected) await page.cleanup();
      vi.useRealTimers();
    }
  },
);

it.each([
  [403, 1],
  [404, 1],
  [503, 2],
])("after a %i subscribing, reconnect attempts total %i", async (status, attempts) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  api.bots.list.mockResolvedValue([]);
  api.tickets.list.mockReset().mockResolvedValue({ tickets: [] });
  const page = await renderBoard(undefined, Object.assign(new Error("Refused"), { status }));
  try {
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(api.boards.subscribe).toHaveBeenCalledTimes(attempts);
  } finally {
    await page.cleanup();
    vi.useRealTimers();
  }
});

it("renders the back control as a plain link", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([]);
  api.tickets.list.mockResolvedValue({ tickets: [] });
  const page = await renderBoard();
  try {
    const back = page.container.querySelector('a[href="/app"]');
    if (!back) throw new Error("Missing back link");
    expect(back.hasAttribute("type")).toBe(false);
    expect(back.hasAttribute("role")).toBe(false);
  } finally {
    await page.cleanup();
    vi.unstubAllGlobals();
  }
});

it("reopens with cached tickets and refreshes them in the background", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper")]);
  api.tickets.list.mockReset().mockResolvedValue({ tickets: [ticket("Cached", "ticket-1")] });
  const first = await renderBoard();
  expect(first.container.textContent).toContain("Cached");
  await first.cleanup();
  await client.invalidateQueries();

  let finish: (value: { tickets: ReturnType<typeof ticket>[] }) => void = () => undefined;
  api.tickets.list.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  const page = await renderBoard();
  try {
    // Painted from the cache while the refresh is still out.
    expect(page.container.textContent).toContain("Cached");
    await act(async () => finish({ tickets: [ticket("Fresh", "ticket-1")] }));
    await act(async () => {
      await vi.waitFor(() => expect(page.container.textContent).toContain("Fresh"));
    });
  } finally {
    await page.cleanup();
    vi.unstubAllGlobals();
  }
});

async function openTicketAndComment(page: { container: HTMLElement }, text: string) {
  await act(async () =>
    (
      page.container.querySelector('[data-testid="board-card-ticket-1"]') as HTMLButtonElement
    ).click(),
  );
  await settle();
  const box = page.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const form = box.closest("form")!;
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

function commentsText(page: { container: HTMLElement }) {
  return page.container.querySelector('[data-testid="ticket-comments"]')?.textContent ?? "";
}

it("shows every comment when one is posted before the first read lands", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper")]);
  api.tickets.list.mockResolvedValue({
    tickets: [ticket("Ship", "ticket-1", "todo", "RAK-1", "bot-1")],
  });
  const posted = { id: "comment-2", body: "New note", createdAt: "2026-10-10T10:01:00Z" };
  const earlier = { id: "comment-1", body: "Ready", createdAt: "2026-10-10T10:00:00Z" };
  // The first read never answers; the read after posting has both.
  api.tickets.comments
    .mockReset()
    .mockImplementationOnce(() => new Promise(() => undefined))
    .mockResolvedValue([earlier, posted]);
  api.tickets.comment.mockReset().mockResolvedValue(posted);
  const page = await renderBoard();
  try {
    await openTicketAndComment(page, "New note");
    await settle();
    await vi.waitFor(() => {
      expect(commentsText(page)).toContain("Ready");
      expect(commentsText(page)).toContain("New note");
    });
  } finally {
    await page.cleanup();
  }
});

it("does not repeat a posted comment a refresh already brought", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper")]);
  api.tickets.list.mockResolvedValue({
    tickets: [ticket("Ship", "ticket-1", "todo", "RAK-1", "bot-1")],
  });
  const earlier = { id: "comment-1", body: "Ready", createdAt: "2026-10-10T10:00:00Z" };
  const posted = { id: "comment-2", body: "New note", createdAt: "2026-10-10T10:01:00Z" };
  api.tickets.comments.mockReset().mockResolvedValue([earlier]);
  let answerPost!: (row: typeof posted) => void;
  api.tickets.comment
    .mockReset()
    .mockImplementation(() => new Promise((resolve) => (answerPost = resolve)));
  const live = liveStream();
  const page = await renderBoard(live.stream);
  try {
    await openTicketAndComment(page, "New note");
    // A live refresh lands with the new comment before the post answers.
    api.tickets.comments.mockResolvedValue([earlier, posted]);
    await act(async () => live.event("ticket-1"));
    await settle();
    expect(commentsText(page)).toContain("New note");
    // Every later read hangs, so only the post's own write can change the list now.
    api.tickets.comments.mockImplementation(() => new Promise(() => undefined));
    await act(async () => answerPost(posted));
    await settle();
    expect(commentsText(page).split("New note")).toHaveLength(2);
  } finally {
    await page.cleanup();
  }
});

it("shows the column names the board chose and saves a new one from the settings", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper")]);
  api.tickets.list.mockResolvedValue({ tickets: [] });
  api.boards.rename.mockResolvedValue({ id: "board-1", statusLabels: { doing: "In contact" } });
  const view = await renderBoard(undefined, undefined, { review: "Check" });
  const headings = [...view.container.querySelectorAll("h2")].map((node) => node.textContent);
  expect(headings).toContain("Check");
  expect(headings).toContain("In progress");

  await act(async () =>
    view.container.querySelector<HTMLButtonElement>('button[aria-label="Task settings"]')?.click(),
  );
  const input = view.container.querySelector<HTMLInputElement>('input[name="label-doing"]');
  expect(input?.value).toBe("");
  expect(input?.placeholder).toBe("In progress");
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(input, "In contact");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    view.container.querySelector<HTMLFormElement>("form#board-settings")?.requestSubmit(),
  );
  expect(api.boards.rename).toHaveBeenCalledWith({ statusLabels: { doing: "In contact" } });
  await view.cleanup();
});

function typeInto(input: HTMLInputElement | null | undefined, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input?.dispatchEvent(new Event("input", { bubbles: true }));
}

it("edits the named fields of a ticket and sends only what changed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper")]);
  api.tickets.list.mockResolvedValue({
    tickets: [
      {
        ...ticket("Lead", "ticket-1", "todo", "RAK-1", "bot-1"),
        fields: [
          { name: "Contact", value: "ana@example.com" },
          { name: "Source", value: "Fair" },
        ],
      },
    ],
  });
  api.tickets.comments.mockResolvedValue([]);
  api.tickets.update.mockResolvedValue({});
  const page = await renderBoard();
  try {
    await act(async () =>
      page.container
        .querySelector<HTMLButtonElement>('[data-testid="board-card-ticket-1"]')
        ?.click(),
    );
    await settle();
    const names = () => [
      ...page.container.querySelectorAll<HTMLInputElement>('input[aria-label="Field name"]'),
    ];
    expect(names().map((input) => input.value)).toEqual(["Contact", "Source"]);
    await act(async () =>
      page.container
        .querySelectorAll<HTMLButtonElement>('button[aria-label="Remove field"]')[1]
        ?.click(),
    );
    await act(async () =>
      [...page.container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Add field")
        ?.click(),
    );
    await act(async () => {
      typeInto(names()[1], "City");
      typeInto(
        page.container.querySelectorAll<HTMLInputElement>('input[aria-label="Field value"]')[1],
        "Lisbon",
      );
    });
    await act(async () => page.container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(api.tickets.update).toHaveBeenCalledWith({
      id: "ticket-1",
      fields: { City: "Lisbon", Source: "" },
    });
  } finally {
    await page.cleanup();
  }
});

it("marks a card whose owner is working on it right now", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([
    { id: "bot-1", name: "Helper", status: "running" },
    { id: "bot-2", name: "Rest", status: "idle" },
  ]);
  api.tickets.list.mockResolvedValue({
    tickets: [
      ticket("Live", "ticket-1", "doing", "RAK-1", "bot-1"),
      ticket("Quiet", "ticket-2", "doing", "RAK-2", "bot-2"),
      ticket("Waiting", "ticket-3", "todo", "RAK-3", "bot-1"),
    ],
  });
  const page = await renderBoard();
  try {
    const marked = (id: string) =>
      page.container.querySelector(`[data-testid="board-card-${id}"] [data-working]`) !== null;
    expect(marked("ticket-1")).toBe(true);
    expect(marked("ticket-2")).toBe(false);
    // A card that is not started has nothing being worked on, whatever its owner is doing.
    expect(marked("ticket-3")).toBe(false);
  } finally {
    await page.cleanup();
  }
});

it("shows the step an agent is on under its card while it works, and takes it away when the run ends", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([{ id: "bot-1", name: "Helper", status: "idle" }]);
  api.tickets.list.mockReset().mockResolvedValue({
    tickets: [ticket("Live", "ticket-1", "doing", "RAK-1", "bot-1")],
  });
  const live = liveStream();
  const page = await renderBoard(live.stream);
  try {
    const step = () => page.container.querySelector('[data-testid="card-step"]')?.textContent;
    expect(step()).toBeUndefined();
    const reads = api.tickets.list.mock.calls.length;
    await act(async () =>
      live.event("ticket-1", { step: { botId: "bot-1", text: "Searching the web" } }),
    );
    await settle();
    expect(step()).toBe("Searching the web");
    expect(page.container.querySelector("[data-working]")).not.toBeNull();
    // A step changes nothing in the list, so the board does not read it again.
    expect(api.tickets.list).toHaveBeenCalledTimes(reads);
    await act(async () =>
      live.event("ticket-1", { step: { botId: "bot-1", text: "Writing the reply" } }),
    );
    await settle();
    expect(step()).toBe("Writing the reply");
    await act(async () => live.event("ticket-1", { step: null }));
    await settle();
    expect(step()).toBeUndefined();
  } finally {
    await page.cleanup();
  }
});

it("shows only one owner's cards when the board is filtered by owner", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper"), bot("bot-2", "Scout")]);
  api.tickets.list.mockResolvedValue({
    tickets: [
      ticket("Mine", "ticket-1", "todo", "RAK-1", "bot-1"),
      ticket("Theirs", "ticket-2", "todo", "RAK-2", "bot-2"),
    ],
  });
  const page = await renderBoard();
  try {
    const select = page.container.querySelector<HTMLSelectElement>('select[aria-label="Owner"]');
    expect(select).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        select,
        "bot-2",
      );
      select?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const cards = [...page.container.querySelectorAll('[data-testid^="board-card-"]')].map((node) =>
      node.getAttribute("data-testid"),
    );
    expect(cards).toEqual(["board-card-ticket-2"]);
  } finally {
    await page.cleanup();
  }
});

it("opens the ticket named in the address", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper")]);
  api.tickets.list.mockResolvedValue({
    tickets: [ticket("Call Ana", "ticket-1", "doing", "RAK-4", "bot-1")],
  });
  api.tickets.comments.mockResolvedValue([]);
  const page = await renderBoard(undefined, undefined, {}, "/app/board?ticket=rak-4");
  try {
    await settle();
    expect(page.container.querySelector<HTMLInputElement>("input[required]")?.value).toBe(
      "Call Ana",
    );
  } finally {
    await page.cleanup();
  }
});

/** jsdom has no layout: give each column and card a box so the drag can tell them apart. */
function layOut(container: HTMLElement, statuses: string[]) {
  statuses.forEach((status, index) => {
    const lane = container.querySelector(`[data-testid="board-lane-${status}"]`) as HTMLElement;
    lane.getBoundingClientRect = () => new DOMRect(index * 200, 0, 190, 600);
  });
  // Anything else, the card in hand included, is one card's size.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(4, 40, 180, 80),
  );
}

/** The card changes column mid-drag, so keys go to where it is now. */
async function press(container: HTMLElement, code: string) {
  await act(async () => {
    container
      .querySelector('[data-testid="board-card-ticket-1"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
  });
  // Measuring and the next key handler both wait a tick after each step.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
}

const STATUS_ORDER = ["todo", "doing", "review", "blocked", "done", "closed"];

it("moves a card to the next column with the keyboard and keeps it there while saving", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper")]);
  api.tickets.list.mockResolvedValue({ tickets: [ticket("Ship", "ticket-1", "todo")] });
  let finish!: (saved: unknown) => void;
  api.tickets.move.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const page = await renderBoard();
  try {
    layOut(page.container, STATUS_ORDER);
    await press(page.container, "Space");
    await press(page.container, "ArrowRight");
    await press(page.container, "Space");
    expect(api.tickets.move).toHaveBeenCalledWith({ id: "ticket-1", status: "doing" });
    const inLane = (status: string) =>
      page.container.querySelector(
        `[data-testid="board-lane-${status}"] [data-testid="board-card-ticket-1"]`,
      );
    expect(inLane("doing")).not.toBeNull();
    expect(inLane("todo")).toBeNull();
    await act(async () => finish(ticket("Ship", "ticket-1", "doing")));
  } finally {
    await page.cleanup();
  }
});

it("puts the card back and says why when a move is refused", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockResolvedValue([bot("bot-1", "Helper")]);
  api.tickets.list.mockResolvedValue({ tickets: [ticket("Ship", "ticket-1", "todo")] });
  api.tickets.move.mockRejectedValue(new Error("Not allowed"));
  const page = await renderBoard();
  try {
    layOut(page.container, STATUS_ORDER);
    await press(page.container, "Space");
    await press(page.container, "ArrowRight");
    await press(page.container, "Space");
    await settle();
    expect(
      page.container.querySelector(
        '[data-testid="board-lane-todo"] [data-testid="board-card-ticket-1"]',
      ),
    ).not.toBeNull();
    expect(page.container.querySelector('[role="alert"]')?.textContent).toContain("Not allowed");
  } finally {
    await page.cleanup();
  }
});
