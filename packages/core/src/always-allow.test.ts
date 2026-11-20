import { describe, expect, it } from "vitest";
import {
  alwaysAllowTargets,
  scopedRuleMayApply,
  scopedRulesCover,
  scopedRuleValue,
} from "./always-allow.js";

const connector = (tool: string, hints: { destructive?: boolean } = {}) => ({
  tool,
  connection: "resource:mcp:crm",
  builtin: false,
  ...hints,
});

describe("alwaysAllowTargets", () => {
  it("offers a rule for one tool on one connection", () => {
    expect(alwaysAllowTargets([connector("crm_update_contact")])).toEqual([
      { tool: "crm_update_contact", connection: "resource:mcp:crm" },
    ]);
  });

  it("offers external actions that are not locked, such as sending", () => {
    expect(alwaysAllowTargets([connector("gmail_send_email")])).not.toBeNull();
    expect(alwaysAllowTargets([connector("destination.write")])).not.toBeNull();
  });

  it("never offers merge, deploy, run-anything, payments or deletions", () => {
    for (const tool of [
      "github_merge_pull_request",
      "deploy_service",
      "rollbackRelease",
      "run_workflow",
      "execute_sql",
      "invoke_function",
      "trigger_build",
      "create_payment",
      "chargeCard",
      "stripe_refund",
      "transfer_funds",
      "delete_record",
      "remove_member",
      "drop_table",
      "purge_cache",
      "graphql_mutation",
      "http_proxy",
      "COMPOSIO_REMOTE_BASH_TOOL",
    ]) {
      expect(alwaysAllowTargets([connector(tool)]), tool).toBeNull();
    }
  });

  it("never offers a tool its provider marks destructive", () => {
    expect(alwaysAllowTargets([connector("crm_update_contact", { destructive: true })])).toBeNull();
  });

  it("never offers explicit-approval or security-boundary tools", () => {
    for (const tool of ["partner_add_credit", "respond_agent_connection", "create_space"]) {
      expect(alwaysAllowTargets([{ tool, connection: "builtin", builtin: true }]), tool).toBeNull();
    }
  });

  it("offers only the built-in tools that spend a budget and change nothing else", () => {
    expect(
      alwaysAllowTargets([{ tool: "generate_image", connection: "builtin", builtin: true }]),
    ).not.toBeNull();
    for (const tool of ["delete_bot", "archive_bot", "forget_memory", "cloud_agent_launch"]) {
      expect(alwaysAllowTargets([{ tool, connection: "builtin", builtin: true }]), tool).toBeNull();
    }
  });

  it("offers a batch only when every action in it is offered", () => {
    expect(
      alwaysAllowTargets([connector("GMAIL_SEND_EMAIL"), connector("GMAIL_CREATE_DRAFT")]),
    ).toHaveLength(2);
    expect(
      alwaysAllowTargets([connector("GMAIL_SEND_EMAIL"), connector("GMAIL_DELETE_THREAD")]),
    ).toBeNull();
    expect(alwaysAllowTargets([])).toBeNull();
  });
});

describe("scopedRuleValue", () => {
  it("keys on agent, connection and tool, never on params", () => {
    expect(scopedRuleValue("bot1", { tool: "Send", connection: "kind:Gmail" })).toBe(
      "bot1:kind:gmail:send",
    );
    expect(scopedRuleValue("bot1", { tool: "send", connection: "kind:gmail" })).not.toBe(
      scopedRuleValue("bot2", { tool: "send", connection: "kind:gmail" }),
    );
  });
});

describe("scopedRulesCover", () => {
  const rule = (botId: string, connection: string, tool: string, id = `${botId}-${tool}`) => ({
    id,
    botId,
    connection,
    tool,
  });
  const target = { tool: "send", connection: "resource:mcp:crm" };

  it("covers the same agent, connection and tool", () => {
    expect(scopedRulesCover([rule("bot1", "resource:mcp:crm", "send")], "bot1", [target])).toEqual([
      rule("bot1", "resource:mcp:crm", "send"),
    ]);
  });

  it("does not cover another agent, another connection or another tool", () => {
    expect(
      scopedRulesCover([rule("bot2", "resource:mcp:crm", "send")], "bot1", [target]),
    ).toBeNull();
    expect(
      scopedRulesCover([rule("bot1", "resource:mcp:other", "send")], "bot1", [target]),
    ).toBeNull();
    expect(
      scopedRulesCover([rule("bot1", "resource:mcp:crm", "delete")], "bot1", [target]),
    ).toBeNull();
  });

  it("covers a batch only when every action has a rule", () => {
    const rules = [rule("bot1", "kind:gmail", "a")];
    const both = [
      { tool: "a", connection: "kind:gmail" },
      { tool: "b", connection: "kind:gmail" },
    ];
    expect(scopedRulesCover(rules, "bot1", both)).toBeNull();
    expect(
      scopedRulesCover([...rules, rule("bot1", "kind:gmail", "b")], "bot1", both),
    ).toHaveLength(2);
  });
});

describe("scopedRuleMayApply", () => {
  const base = {
    risks: ["high"] as const,
    tainted: false,
    ownerStartedRun: true,
    steeredConnector: false,
  };

  it("applies to a high-risk call in a run the owner started that read nothing outside", () => {
    expect(scopedRuleMayApply({ ...base, risks: ["high"] })).toBe(true);
    expect(scopedRuleMayApply({ ...base, risks: ["unknown"] })).toBe(true);
  });

  it("never applies to a high-risk call once outside content entered the run", () => {
    expect(scopedRuleMayApply({ ...base, risks: ["high"], tainted: true })).toBe(false);
    expect(scopedRuleMayApply({ ...base, risks: ["unknown"], tainted: true })).toBe(false);
  });

  it("never applies to a high-risk call in a run the owner did not start", () => {
    expect(scopedRuleMayApply({ ...base, risks: ["high"], ownerStartedRun: false })).toBe(false);
  });

  it("never applies on a connector that outside content may have steered the run to", () => {
    expect(scopedRuleMayApply({ ...base, risks: ["low"], steeredConnector: true })).toBe(false);
  });

  it("lets a low-risk call through in a tainted run on a connector it already used", () => {
    expect(scopedRuleMayApply({ ...base, risks: ["low"], tainted: true })).toBe(true);
  });

  it("is high when any action in a batch is", () => {
    expect(scopedRuleMayApply({ ...base, risks: ["low", "high"], tainted: true })).toBe(false);
  });
});
