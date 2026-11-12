import { describe, expect, it } from "vitest";
import { approvalBatchClass, pendingApprovalBatches } from "./answerable-ask.js";

const actions = [
  { id: "allow", label: "Allow once" },
  { id: "always", label: "Always allow this tool" },
  { id: "deny", label: "Deny" },
];
const ask = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: "ask",
  status: "pending",
  approvalEffectId: id,
  actions,
  ...extra,
});
const message = (id: string, runId: string | null, ...blocks: ReturnType<typeof ask>[]) => ({
  id,
  runId,
  blocks,
});

describe("approvalBatchClass", () => {
  it("classes a plain approval as a tool and a fetch as a site", () => {
    expect(approvalBatchClass(ask("a"))).toBe("tool");
    expect(approvalBatchClass(ask("a", { site: "example.com" }))).toBe("site");
  });

  it.each([
    ["answered", { status: "answered" }],
    ["a secret input", { input: "secret" }],
    ["a proposal", { proposal: true }],
    ["an instruction update", { instructionUpdate: { botId: "b" } }],
    ["an outcome card", { actions: [{ ...actions[0], outcome: "created" }, actions[2]] }],
    ["a card without always", { actions: [actions[0], actions[2]] }],
    ["a plain question", { approvalEffectId: undefined, actions: undefined }],
  ])("never batches %s", (_name, extra) => {
    expect(approvalBatchClass(ask("a", extra))).toBeNull();
  });
});

describe("pendingApprovalBatches", () => {
  const all = new Set(["m1", "m2", "m3", "m4"]);

  it("groups two or more answerable approvals of one class", () => {
    const batches = pendingApprovalBatches(
      [message("m1", "r1", ask("a")), message("m2", "r2", ask("b"))],
      all,
    );
    expect(batches).toEqual([
      {
        batchClass: "tool",
        items: [
          { messageId: "m1", runId: "r1", approvalEffectId: "a" },
          { messageId: "m2", runId: "r2", approvalEffectId: "b" },
        ],
      },
    ]);
  });

  it("includes several cards on one message", () => {
    const batches = pendingApprovalBatches([message("m1", "r1", ask("a"), ask("b"))], all);
    expect(batches[0]?.items.map((item) => item.approvalEffectId)).toEqual(["a", "b"]);
  });

  it("keeps classes apart and drops a class with a single card", () => {
    expect(
      pendingApprovalBatches(
        [message("m1", "r1", ask("a")), message("m2", "r2", ask("b", { site: "example.com" }))],
        all,
      ),
    ).toEqual([]);
  });

  it("skips what the viewer cannot answer and secrets or proposals among the rest", () => {
    expect(
      pendingApprovalBatches(
        [
          message("m1", "r1", ask("a")),
          message("m2", "r2", ask("b")),
          message("m3", "r3", ask("c", { input: "secret" })),
          message("m4", null, ask("d")),
        ],
        new Set(["m1", "m3", "m4"]),
      ),
    ).toEqual([]);
  });

  it("stops at the batch limit", () => {
    const messages = Array.from({ length: 25 }, (_, i) => message(`m${i}`, `r${i}`, ask(`e${i}`)));
    const answerable = new Set(messages.map((m) => m.id));
    expect(pendingApprovalBatches(messages, answerable)[0]?.items).toHaveLength(20);
  });
});
