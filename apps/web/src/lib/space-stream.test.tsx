// @vitest-environment jsdom
import type { SpaceHint } from "@corvo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaceBootstrap, useSpaceRoster } from "../pages/shell/use-space-roster";
import { computerUpdates } from "./computer-updates";
import type { createSpaceRpc } from "./rpc";
import { useDirectPeople } from "./use-direct-people";
import { usePendingApprovals } from "./use-pending-approvals";
import { useSpaceStream } from "./use-space-stream";

const calls = vi.hoisted(() => ({
  approvals: 0,
  people: 0,
  roster: 0,
  computer: 0,
  subscribe: 0,
}));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));
vi.mock("./bootstrap", () => ({
  takeInitialBootstrap: () => new Promise(() => {}),
}));
vi.mock("./rpc", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("./rpc")),
  rpc: {
    computer: {
      updates: async () => {
        calls.computer++;
        return [];
      },
    },
  },
  onRpcTargetGone: () => () => {},
}));
vi.mock("./query", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("./query");
  const options = (key: string, counter: "approvals" | "people") => ({
    queryOptions: () => ({
      queryKey: [key],
      queryFn: async () => {
        calls[counter]++;
        return [];
      },
    }),
  });
  return {
    ...actual,
    useSpaceQueries: () => ({
      approvals: { list: options("approvals", "approvals") },
      directMessages: { people: options("people", "people") },
    }),
  };
});

let root: Root;
let client: QueryClient;
const sent: Array<(hint: SpaceHint) => void> = [];

function fakeRpc(streamOpens: { current: number }) {
  return {
    spaces: {
      list: async () => {
        calls.roster++;
        return { current: { bots: [], botSections: [], groups: [] }, spaces: [] };
      },
      subscribe: async (_input: unknown, { signal }: { signal: AbortSignal }) => {
        calls.subscribe++;
        streamOpens.current++;
        return {
          async *[Symbol.asyncIterator]() {
            const queue: SpaceHint[] = [];
            let wake: (() => void) | undefined;
            sent.push((hint) => {
              queue.push(hint);
              wake?.();
            });
            signal.addEventListener("abort", () => wake?.());
            // The server beats every 20 seconds.
            const beat = setInterval(() => {
              queue.push({ kind: "heartbeat", createdAt: "now" });
              wake?.();
            }, 20_000);
            signal.addEventListener("abort", () => clearInterval(beat));
            while (!signal.aborted) {
              const hint = queue.shift();
              if (hint) yield hint;
              else await new Promise<void>((resolve) => (wake = resolve));
            }
          },
        };
      },
    },
    bots: { listArchived: async () => [] },
    groups: { listArchived: async () => [] },
  } as unknown as ReturnType<typeof createSpaceRpc>;
}

/** Stands in for the chat state the bootstrap hook writes to; these tests only watch the roster. */
const anything = new Proxy({}, { get: () => Object.assign(vi.fn(), { current: null }) }) as never;

function Harness({ rpc }: { rpc: ReturnType<typeof createSpaceRpc> }) {
  usePendingApprovals();
  useDirectPeople();
  useSpaceStream(rpc);
  const roster = useSpaceRoster({
    rpc,
    seed: undefined,
    botId: undefined,
    groupId: undefined,
    navigate: vi.fn(),
    redirectKeepingOverlay: vi.fn(),
  } as never);
  useSpaceBootstrap({
    rpc,
    roster,
    thread: anything,
    commitComputer: vi.fn(),
    userId: "user-1",
    shellSpaceId: "space-1",
    seed: undefined,
    startChat: undefined,
    botId: undefined,
    groupId: undefined,
    chat: undefined,
    navigate: vi.fn(),
    redirectKeepingOverlay: vi.fn(),
  } as never);
  return null;
}

const total = () => calls.approvals + calls.people + calls.roster + calls.computer;
const reset = () => {
  calls.approvals = calls.people = calls.roster = calls.computer = calls.subscribe = 0;
};

async function mount() {
  const opens = { current: 0 };
  client = new QueryClient();
  root = createRoot(document.createElement("div"));
  const stop = computerUpdates.watch();
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness rpc={fakeRpc(opens)} />
      </QueryClientProvider>,
    );
  });
  // The first read of every list, as when the shell opens.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  return { opens, stop };
}

describe("a shell that follows the space stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    sent.length = 0;
    reset();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  afterEach(() => {
    act(() => root.unmount());
    client.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("makes about three requests in a quiet minute, where it used to make about 87", async () => {
    const { stop } = await mount();
    reset();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    stop();
    // Before: spaces.list every 3 s (20), approvals every 4 s (15), people every 5 s (12) and a
    // computer update that sits failed every 1.5 s (40): 87 a minute. Now one fallback read each.
    expect(total()).toBeLessThanOrEqual(4);
    expect(calls.subscribe).toBe(0); // no reconnects
  });

  it("reads again only the list a hint names", async () => {
    const { stop } = await mount();
    reset();
    await act(async () => {
      sent[0]?.({ kind: "approvals", createdAt: "now" });
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(calls.approvals).toBe(1);
    expect(calls.people + calls.roster + calls.computer).toBe(0);
    await act(async () => {
      sent[0]?.({ kind: "roster", createdAt: "now" });
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(calls.roster).toBe(1);
    await act(async () => {
      sent[0]?.({ kind: "dm", createdAt: "now" });
      sent[0]?.({ kind: "heartbeat", createdAt: "now" });
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(calls.people).toBe(1);
    stop();
  });

  it("reads every list once when the stream connects", async () => {
    reset();
    const { stop } = await mount();
    expect(calls.approvals).toBeGreaterThanOrEqual(1);
    expect(calls.people).toBeGreaterThanOrEqual(1);
    expect(calls.roster).toBeGreaterThanOrEqual(1);
    expect(calls.computer).toBeGreaterThanOrEqual(1);
    stop();
  });
});
