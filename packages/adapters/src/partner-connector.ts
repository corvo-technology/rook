import type {
  AdapterContext,
  ConnectorCall,
  ConnectorEvent,
  ConnectorProvider,
  ConnectorTool,
} from "@corvo/adapter-kit";
import { partnerToolOffered } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { recordSecurityEvent } from "@corvo/db";
import { z } from "zod";
import { sanitizeConnectorError } from "./connector-safety.js";

export const PARTNER_CONNECTOR_ID = "partner";

/** A partner the agent's organization is a member of. */
export interface PartnerChoice {
  id: string;
  slug: string;
  name: string;
}

export const PARTNER_TOOL_NAMES = [
  "list_customers",
  "customer_usage",
  "attention",
  "revenue_summary",
  "invoices",
  "add_credit",
  "pause_customer",
  "resume_customer",
  "set_customer_limit",
] as const;
export type PartnerToolName = (typeof PARTNER_TOOL_NAMES)[number];

/**
 * What the partner tools need from the partner console. The API and the worker each wire it to the
 * console's service layer, so an agent runs the same code the console does and never reaches the
 * database on its own. Everything it returns is numbers, states and names.
 */
export interface PartnerToolsPort {
  /** The partners of the organization that owns the space; empty when it manages none. */
  partners(spaceId: string): Promise<PartnerChoice[]>;
  run(call: {
    spaceId: string;
    userId: string;
    partnerId: string;
    tool: PartnerToolName;
    args: Record<string, unknown>;
    /** Stable across retries of one call, so a retried change acts once. */
    idempotencyKey: string;
  }): Promise<unknown>;
}

const Selector = z.string().trim().max(80).optional();
const Customer = z.string().trim().min(1).max(200);
const Period = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period is YYYY-MM")
  .optional();

const ARGS = {
  list_customers: z.object({
    partner: Selector,
    filter: z.enum(["all", "credit_low", "past_due", "paused"]).default("all"),
    q: z.string().trim().max(120).optional(),
    limit: z.number().int().min(1).max(50).default(25),
  }),
  customer_usage: z.object({ partner: Selector, customer: Customer }),
  attention: z.object({ partner: Selector }),
  revenue_summary: z.object({ partner: Selector, period: Period }),
  invoices: z.object({ partner: Selector }),
  add_credit: z.object({
    partner: Selector,
    customer: Customer,
    amount_minor: z.number().int().positive().max(100_000_000),
  }),
  pause_customer: z.object({ partner: Selector, customer: Customer }),
  resume_customer: z.object({ partner: Selector, customer: Customer }),
  set_customer_limit: z.object({
    partner: Selector,
    customer: Customer,
    limit_credits: z.number().int().positive().max(1_000_000_000).nullable(),
  }),
} satisfies Record<PartnerToolName, z.ZodType>;

const partnerProperty = {
  type: "string",
  description: "Slug of the partner. Optional when the organization has only one.",
};
const customerProperty = {
  type: "string",
  description: "The customer's id, from partner_list_customers.",
};

function tool(
  name: PartnerToolName,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  readOnly: boolean,
): ConnectorTool {
  return {
    name: `${PARTNER_CONNECTOR_ID}_${name}`,
    description,
    inputSchema: {
      type: "object",
      properties: { partner: partnerProperty, ...properties },
      required,
      additionalProperties: false,
    },
    readOnly,
    route: { connectorId: PARTNER_CONNECTOR_ID, toolName: name },
  };
}

const TOOLS: ConnectorTool[] = [
  tool(
    "list_customers",
    "List the partner's customers with plan, state and how much of their credit is used. Only numbers, states and names; never what customers wrote.",
    {
      filter: { type: "string", enum: ["all", "credit_low", "past_due", "paused"] },
      q: { type: "string", description: "Part of the customer's name." },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    [],
    true,
  ),
  tool(
    "customer_usage",
    "One customer: credits used and limit, plan, state, balance and runs in the last 30 days.",
    { customer: customerProperty },
    ["customer"],
    true,
  ),
  tool(
    "attention",
    "Who needs attention: credit low, past due, connector down, near the monthly limit, and for an embedded partner a fund that will run out soon.",
    {},
    [],
    true,
  ),
  tool(
    "revenue_summary",
    "A month of results. For a referral or white-label partner: revenue (commission and markup), new and active customers. For an embedded partner: the fund balance, plan and invoices instead.",
    { period: { type: "string", description: "YYYY-MM; defaults to this month." } },
    [],
    true,
  ),
  tool("invoices", "What the partner has been invoiced, newest first.", {}, [], true),
  tool(
    "add_credit",
    "Give one customer credit. The owner approves the customer and amount first; what is approved is exactly what is done.",
    {
      customer: customerProperty,
      amount_minor: {
        type: "integer",
        minimum: 1,
        description: "In the smallest unit of the partner's currency (cents).",
      },
    },
    ["customer", "amount_minor"],
    false,
  ),
  tool(
    "pause_customer",
    "Pause one customer so their agents stop running. The owner approves first.",
    { customer: customerProperty },
    ["customer"],
    false,
  ),
  tool(
    "resume_customer",
    "Resume a paused customer. The owner approves first.",
    { customer: customerProperty },
    ["customer"],
    false,
  ),
  tool(
    "set_customer_limit",
    "Cap how many credits one customer may use per month; null removes the cap. The owner approves first.",
    {
      customer: customerProperty,
      limit_credits: { type: ["integer", "null"], minimum: 1 },
    },
    ["customer", "limit_credits"],
    false,
  ),
];

export interface PartnerConnectorOptions {
  prisma: Pick<PrismaClient, "botPartnerGrant">;
  port: PartnerToolsPort;
}

/**
 * The built-in "Parceria" connection: tools over the partner console for the agents it was given
 * to. An agent with no grant, or an organization that manages no partner, sees no tools, and
 * every call checks both again. Reads need no approval; every change asks a person, whatever the
 * level (see `toolRequiresExplicitApproval`).
 */
export class PartnerConnector implements ConnectorProvider {
  constructor(private readonly options: PartnerConnectorOptions) {}

  describe() {
    return {
      id: PARTNER_CONNECTOR_ID,
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: false, secretsBrokered: false },
    };
  }

  private async level(context: AdapterContext): Promise<"read" | "write" | null> {
    if (!context.botId) return null;
    const grant = await this.options.prisma.botPartnerGrant.findFirst({
      where: { botId: context.botId, spaceId: context.spaceId },
      select: { level: true },
    });
    if (!grant) return null;
    return grant.level === "write" ? "write" : "read";
  }

  async discoverTools(context: AdapterContext): Promise<ConnectorTool[]> {
    const level = await this.level(context);
    if (!level) return [];
    if ((await this.options.port.partners(context.spaceId)).length === 0) return [];
    return TOOLS.filter((entry) => partnerToolOffered(level, entry.route?.toolName ?? entry.name));
  }

  private pick(partners: PartnerChoice[], selector: string | undefined): PartnerChoice {
    if (partners.length === 0) throw new Error("No partner is available to this organization");
    const names = partners.map((entry) => entry.slug).join(", ");
    if (!selector) {
      if (partners.length === 1) return partners[0]!;
      throw new Error(`Name the partner to use: ${names}`);
    }
    const found = partners.find((entry) => entry.slug.toLowerCase() === selector.toLowerCase());
    if (!found) throw new Error(`That partner is not available. Available: ${names}`);
    return found;
  }

  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    const name = (call.route?.toolName ?? call.tool.replace(/^partner_/, "")) as PartnerToolName;
    if (!PARTNER_TOOL_NAMES.includes(name)) {
      yield { type: "error", message: `Unknown partner tool ${call.tool}` };
      return;
    }
    const writes = !partnerToolOffered("read", name);
    let partnerId: string | undefined;
    let customer: string | undefined;
    try {
      const level = await this.level(context);
      if (!level || !partnerToolOffered(level, name)) {
        throw new Error("This agent has no access to that partner tool");
      }
      const args = ARGS[name].parse(call.args) as Record<string, unknown> & {
        partner?: string;
        customer?: string;
      };
      const partner = this.pick(await this.options.port.partners(context.spaceId), args.partner);
      partnerId = partner.id;
      customer = args.customer;
      const data = await this.options.port.run({
        spaceId: context.spaceId,
        userId: context.userId,
        partnerId: partner.id,
        tool: name,
        args,
        idempotencyKey: call.executionId,
      });
      if (writes) await this.audit(context, name, partnerId, customer, "ok");
      yield { type: "result", data };
    } catch (error) {
      if (writes) await this.audit(context, name, partnerId, customer, "error");
      yield {
        type: "error",
        message:
          error instanceof z.ZodError
            ? `Invalid arguments: ${error.issues.map((issue) => issue.message).join("; ")}`
            : sanitizeConnectorError(error),
      };
    }
  }

  /** Who asked for a change, besides the console's own audit trail: the agent, never any content. */
  private audit(
    context: AdapterContext,
    tool: PartnerToolName,
    partnerId: string | undefined,
    customer: string | undefined,
    outcome: "ok" | "error",
  ) {
    return recordSecurityEvent({
      type: "partner.agent_action",
      userId: context.userId,
      spaceId: context.spaceId,
      metadata: { botId: context.botId, runId: context.runId, tool, partnerId, customer, outcome },
    });
  }
}
