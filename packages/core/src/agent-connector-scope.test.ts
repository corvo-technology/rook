import { describe, expect, it } from "vitest";
import { scopeConnectorForRole } from "./agent-connector-scope.js";

const tools = [
  { name: "list_appointments", description: "List the agenda", readOnly: true },
  { name: "create_appointment", description: "Book an appointment" },
  { name: "cancel_appointment", description: "Cancel an appointment" },
  { name: "list_clients", description: "List clients", readOnly: true },
  { name: "send_message", description: "Send a message to a client" },
  { name: "list_cash_entries", description: "Cash and financial entries", readOnly: true },
  { name: "create_invoice", description: "Create an invoice for billing" },
  { name: "refund_payment", description: "Refund a payment" },
  { name: "list_staff", description: "Staff members", readOnly: true },
  { name: "update_staff_schedule", description: "Change a staff shift" },
  { name: "list_reports", description: "Satisfaction reports", readOnly: true },
  { name: "create_report_export", description: "Export a report" },
  { name: "delete_client", description: "Delete a client", destructive: true },
];

const scope = (name: string, title = "", offered?: Set<string>) =>
  scopeConnectorForRole({ name, title }, tools, offered);

describe("scopeConnectorForRole", () => {
  it("lends reception its agenda, clients and messages, never destructive tools", () => {
    expect(scope("Lia", "Recepção")).toEqual({
      kind: "tools",
      allowedTools: ["list_appointments", "create_appointment", "list_clients", "send_message"],
    });
  });

  it("lends finance the financial reads only", () => {
    expect(scope("Caio", "Financeiro")).toEqual({
      kind: "tools",
      allowedTools: ["list_cash_entries"],
    });
  });

  it("lends operations its staff and schedule tools", () => {
    expect(scope("Nina", "Operations")).toMatchObject({
      kind: "tools",
      allowedTools: expect.arrayContaining(["list_staff", "update_staff_schedule"]),
    });
  });

  it("keeps quality read-only", () => {
    expect(scope("Dr. Alex", "Qualidade")).toEqual({
      kind: "tools",
      allowedTools: ["list_reports"],
    });
  });

  it("falls back to read-only when the role is unknown or nothing fits", () => {
    expect(scope("Zed", "Gardener")).toEqual({ kind: "read" });
    expect(scopeConnectorForRole({ name: "Lia", title: "Recepção" }, [], undefined)).toEqual({
      kind: "read",
    });
  });

  it("never lends more than the creator offers", () => {
    expect(scope("Lia", "Recepção", new Set(["list_appointments"]))).toEqual({
      kind: "tools",
      allowedTools: ["list_appointments"],
    });
  });

  it("is deterministic", () => {
    expect(scope("Lia", "Recepção")).toEqual(scope("Lia", "Recepção"));
  });
});
