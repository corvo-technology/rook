import { describe, expect, it } from "vitest";
import { classifyConnectorTool, toolNameWords } from "./tool-risk.js";

const risk = (name: string, hints: Parameters<typeof classifyConnectorTool>[1] = {}) =>
  classifyConnectorTool(name, hints);

describe("toolNameWords", () => {
  it("splits snake, kebab, dotted, camel and upper case names", () => {
    expect(toolNameWords("getPetById")).toEqual(["get", "pet", "by", "id"]);
    expect(toolNameWords("GMAIL_FETCH_EMAILS")).toEqual(["gmail", "fetch", "emails"]);
    expect(toolNameWords("mcp__crm__list-contacts.v2")).toEqual([
      "mcp",
      "crm",
      "list",
      "contacts",
      "v2",
    ]);
    expect(toolNameWords("parseHTMLString")).toEqual(["parse", "html", "string"]);
  });
});

describe("classifyConnectorTool", () => {
  it("reads by verb in snake, camel and upper case", () => {
    for (const name of [
      "fetch_emails",
      "query_rows",
      "describe_table",
      "check_domain_availability",
      "whoami",
      "getPetById",
      "listPets",
      "findPetsByStatus",
      "GMAIL_FETCH_EMAILS",
      "contacts_get",
      "gmail_list_threads",
      "get_commit",
      "search_threads",
    ]) {
      expect(risk(name), name).toBe("read");
    }
  });

  it("treats other writes as low risk", () => {
    for (const name of ["create_issue", "update_contact", "add_label", "createPet", "move_card"]) {
      expect(risk(name), name).toBe("low");
    }
  });

  it("locks external, irreversible and open-ended actions as high risk", () => {
    for (const name of [
      "send_email",
      "post_message",
      "create_payment",
      "charge_card",
      "delete_record",
      "merge_pull_request",
      "deploy",
      "run_workflow",
      "gmail_send_email",
      "publishPost",
      "share_file",
      "execute_sql",
    ]) {
      expect(risk(name), name).toBe("high");
    }
  });

  it("reads a locked word after a read verb as what it looks at, but not further on", () => {
    expect(risk("get_post")).toBe("read");
    expect(risk("list_commits")).toBe("read");
    expect(risk("get_run")).toBe("read");
    expect(risk("search_console_post_site")).toBe("high");
    expect(risk("search_console_delete_site")).toBe("high");
  });

  it("ignores the server's name in an MCP tool", () => {
    expect(risk("mcp__get_data__post_message")).toBe("high");
    expect(risk("mcp__search_console__delete_site")).toBe("high");
    expect(risk("mcp__deploy_hq__list_projects")).toBe("read");
    expect(risk("mcp__crm__create_contact")).toBe("low");
  });

  it("asks about names that match nothing", () => {
    expect(risk("profile_card")).toBe("unknown");
    expect(risk("do_the_thing")).toBe("unknown");
  });

  it("lets a read-only hint make an unlocked name a read, never a locked one", () => {
    expect(risk("profile_card", { readOnly: true })).toBe("read");
    expect(risk("create_issue", { readOnly: true })).toBe("read");
    expect(risk("send_email", { readOnly: true })).toBe("high");
    expect(risk("delete_item", { readOnly: true })).toBe("high");
    expect(risk("create_payment", { readOnly: true })).toBe("high");
  });

  it("never lets a hint lower a destructive tool", () => {
    expect(risk("update_contact", { destructive: true })).toBe("high");
    expect(risk("get_contact", { destructive: true, readOnly: true })).toBe("high");
  });

  it("asks when a tool is declared a write but reads like one", () => {
    expect(risk("read_profile_card", { readOnly: false })).toBe("unknown");
    expect(risk("get_contact", { readOnly: false })).toBe("unknown");
    expect(risk("update_contact", { readOnly: false })).toBe("low");
  });

  it("does not treat a compound of actions as a read", () => {
    expect(risk("get_or_create_contact")).toBe("low");
    expect(risk("notion_search_and_update")).toBe("low");
    expect(risk("get_and_delete")).toBe("high");
    expect(risk("fetch_then_send")).toBe("high");
  });

  it("keeps the partner connection's own writes high risk", () => {
    expect(risk("partner_add_credit")).toBe("high");
    expect(risk("partner_add_credit", { readOnly: true })).toBe("high");
    expect(risk("partner_invoices", { readOnly: true, fromPartnerConnector: true })).toBe("read");
  });
});
