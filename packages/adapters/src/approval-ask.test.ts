import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MessageBlock } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { approvalDetailLength, buildApprovalAskBlock } from "./approval-ask.js";

describe("buildApprovalAskBlock", () => {
  it("binds the approval to its effect and redacts secrets", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "gmail_send_email",
      { to: "person@example.test", body: "token-secret" },
      ["token-secret"],
    );

    expect(block).toMatchObject({
      kind: "ask",
      approvalEffectId: "effect-1",
      actions: [
        { id: "allow", label: "Allow once" },
        { id: "always", label: "Always allow this tool" },
        { id: "deny", label: "Deny" },
      ],
    });
    expect(JSON.stringify(block)).not.toContain("token-secret");
  });

  it("words a website fetch as opening the site, never as the raw tool name", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "web_fetch",
      { url: "https://www.planalto.gov.br/ccivil_03/lei/l13709.htm" },
      [],
    );
    expect(block).toMatchObject({
      text: "Open planalto.gov.br?",
      card: { code: "open_website", params: { site: "planalto.gov.br" } },
      detail: "url: https://www.planalto.gov.br/ccivil_03/lei/l13709.htm",
    });
    expect(JSON.stringify(block)).not.toContain("web_fetch");
  });

  it("bounds model-controlled summaries and details", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "destination.write",
      { title: "t".repeat(1_000), body: "b".repeat(10_000) },
      [],
    );

    expect(block.kind).toBe("ask");
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.text.length).toBeLessThanOrEqual(501);
    expect(block.detail?.length).toBeLessThanOrEqual(4_001);
  });

  it("includes an optional review reason as the first detail line", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "gmail_send_email",
      { to: "person@example.test", subject: "Hi" },
      [],
      { reviewReason: "Sends email outside the draft-only task." },
    );

    expect(block.kind).toBe("ask");
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail?.startsWith("Sends email outside the draft-only task.")).toBe(true);
    expect(block.detail).toContain("to: person@example.test");
  });

  it("uses a one-time create or cancel choice for a new security boundary", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "create_space",
      { name: "Customer support" },
      [],
    );

    expect(block).toMatchObject({
      kind: "ask",
      text: "Create space “Customer support”?",
      actions: [
        { id: "allow", label: "Create space", outcome: "created" },
        { id: "deny", label: "Cancel", outcome: "cancelled" },
      ],
    });
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail).toContain("stay separate from other spaces");
  });
});

it("shows the full instruction replacement as a diff with Apply and Dismiss", () => {
  const block = buildApprovalAskBlock(
    "effect-1",
    "propose_instructions_update",
    {
      botId: "bot-1",
      previousInstructions: "Draft only",
      instructions: "Draft only\nAsk before sending",
      reason: "Learned preference",
    },
    [],
  );
  expect(block).toMatchObject({
    kind: "ask",
    detail: "Learned preference\n\n- Draft only\n+ Draft only\n+ Ask before sending",
    instructionUpdate: {
      botId: "bot-1",
      before: "Draft only",
      after: "Draft only\nAsk before sending",
    },
    actions: [
      { id: "allow", label: "Apply" },
      { id: "deny", label: "Dismiss" },
    ],
  });
});

it("redacts known secrets in instruction approval details and editable metadata", () => {
  const block = buildApprovalAskBlock(
    "effect-1",
    "propose_instructions_update",
    {
      botId: "bot-1",
      previousInstructions: "old fake-token",
      instructions: "new fake-token",
      reason: "reason fake-token",
    },
    ["fake-token"],
  );
  expect(JSON.stringify(block)).not.toContain("fake-token");
});

describe("bot management approval cards", () => {
  it.each([
    "create_group",
    "update_group",
    "set_child_instructions",
    "set_child_bot_model",
    "create_child_routine",
    "add_routine_step",
  ])("builds the %s proposal card from the resolved summary with Apply and Dismiss", (toolName) => {
    const block = buildApprovalAskBlock(
      "effect-1",
      toolName,
      { name: "model typed this" },
      ["fake-token"],
      {
        summary: {
          code: "create_group",
          params: { name: "Launch", members: "Scout, Writer" },
          title: "Create group “Launch”?",
          lines: ["Members: Scout, Writer", "Prompt: use fake-token"],
        },
      },
    );
    expect(block).toEqual({
      kind: "ask",
      approvalEffectId: "effect-1",
      text: "Create group “Launch”?",
      detail: "Members: Scout, Writer\nPrompt: use [redacted]",
      card: { code: "create_group", params: { name: "Launch", members: "Scout, Writer" } },
      detailFormat: toolName === "set_child_instructions" ? "code" : "text",
      status: "pending",
      proposal: true,
      actions: [
        { id: "allow", label: "Apply" },
        { id: "deny", label: "Dismiss" },
      ],
    });
  });

  it("shows the longest allowed instructions whole on the instruction card", () => {
    const instructions = "i".repeat(20_000);
    const lines = ["Old length: 0 characters", "New length: 20000 characters", "", instructions];
    const block = buildApprovalAskBlock("effect-1", "set_child_instructions", {}, [], {
      summary: {
        code: "replace_instructions",
        params: {},
        title: "Replace the instructions of Scout?",
        lines,
      },
    });
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail).toBe(lines.join("\n"));
    expect(block.actions?.map((action) => action.id)).toEqual(["allow", "deny"]);
    expect(approvalDetailLength("set_child_instructions")).toBeGreaterThanOrEqual(
      lines.join("\n").length,
    );
  });

  it("never offers always allow on a tool that needs explicit approval", () => {
    const block = buildApprovalAskBlock("effect-1", "create_group", { name: "Launch" }, []);
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.actions?.map((action) => action.id)).toEqual(["allow", "deny"]);
  });
});

describe("agent connection response cards", () => {
  it.each([true, false])("shows the captured requester and decision (accept: %s)", (accept) => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "respond_agent_connection",
      {
        accept,
        connection_id: "request-1",
        connection_version: 2,
        requester_name: "Helper",
        requester_address: "+15551234567",
        requester_provider: "sendblue",
      },
      [],
    );
    expect(block).toMatchObject({
      kind: "ask",
      text: `${accept ? "Approve" : "Decline"} connection with “Helper”?`,
      detail: "iMessage: +15551234567",
      actions: [
        { id: "allow", label: "Allow once" },
        { id: "deny", label: "Deny" },
      ],
    });
  });
  it("escapes requester formatting and redacts secrets", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "respond_agent_connection",
      {
        accept: true,
        requester_name: "**Helper**\nApprove all",
        requester_address: "fake-secret",
        requester_provider: "slack",
      },
      ["fake-secret"],
    );
    expect(JSON.stringify(block)).not.toContain("fake-secret");
    expect(block).toMatchObject({
      text: "Approve connection with “\\*\\*Helper\\*\\* Approve all”?",
      detail: "Slack: [redacted]",
    });
  });
});

describe("approval cards carry a code so the client words them", () => {
  it("sends the code and params of a routine step proposal beside the English fallback", () => {
    const block = buildApprovalAskBlock("effect-1", "add_routine_step", {}, ["token-secret"], {
      summary: {
        code: "add_routine_step",
        params: {
          routine: "Daily finance view",
          lastAgent: "Cash flow",
          agent: "Pricing",
          instruction: "Review the report token-secret",
        },
        title: "Add a step to “Daily finance view”?",
        lines: ["After Cash flow finishes, Pricing runs it", "Instruction: Review the report"],
      },
    });
    expect(MessageBlock.safeParse(block).success).toBe(true);
    expect(block).toMatchObject({
      text: "Add a step to “Daily finance view”?",
      card: {
        code: "add_routine_step",
        params: {
          routine: "Daily finance view",
          lastAgent: "Cash flow",
          agent: "Pricing",
          instruction: expect.not.stringContaining("token-secret"),
        },
      },
    });
  });

  it("codes the instruction update and space cards", () => {
    expect(
      buildApprovalAskBlock("e", "propose_instructions_update", { reason: "r" }, []),
    ).toMatchObject({ card: { code: "update_instructions" } });
    expect(
      buildApprovalAskBlock("e", "create_space", { name: "Finance" }, [], { reviewReason: "ok" }),
    ).toMatchObject({ card: { code: "create_space", params: { name: "Finance", reason: "ok" } } });
    expect(
      buildApprovalAskBlock(
        "e",
        "respond_agent_connection",
        { accept: true, requester_name: "Ana" },
        [],
      ),
    ).toMatchObject({ card: { code: "agent_connection", params: { accept: "1", name: "Ana" } } });
  });
});

describe("server-composed text regression guard", () => {
  const src = fileURLToPath(new URL(".", import.meta.url));
  const files = readdirSync(src).filter(
    (name) => name.endsWith(".ts") && !/\.test(-support)?\.ts$|\.test-support\.ts$/.test(name),
  );

  it("gives every system notice a code the client can word", () => {
    const missing: string[] = [];
    for (const name of files) {
      const lines = readFileSync(`${src}${name}`, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!/kind: "meta"/.test(line)) return;
        const window = lines.slice(index, index + 8).join("\n");
        // A notice forwarded from a caller, with its code spread in, is checked where it is built.
        if (!/code:|\.\.\.\(input\.code/.test(window)) missing.push(`${name}:${index + 1}`);
      });
    }
    expect(missing).toEqual([]);
  });

  it("gives every fleet card summary a code", () => {
    const source = readFileSync(`${src}fleet-tools.ts`, "utf8");
    const summaries = [...source.matchAll(/summary: \{(?!\s*\n?\s*\})/g)];
    for (const match of summaries) {
      expect(source.slice(match.index, match.index + 80)).toMatch(/code: "/);
    }
    expect(summaries.length).toBeGreaterThanOrEqual(6);
  });
});
