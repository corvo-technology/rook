import { connectorToolIsRead } from "./action-approval.js";

export type ScopeTool = {
  name: string;
  description?: string;
  readOnly?: boolean;
  destructive?: boolean;
};

/** What a new agent is lent from a connected server: a tool list, or the server read-only. */
export type ConnectorScope = { kind: "tools"; allowedTools: string[] } | { kind: "read" };

type RoleScope = {
  /** Words in the agent's name or title that place it in this role (English and Portuguese). */
  role: RegExp;
  /** Words in a tool's name or description that put the tool in this role's domain. */
  domain: RegExp;
  /** Whether the role may also change things in its domain. Money and destructive tools never. */
  write: boolean;
};

/**
 * Least privilege by role. Only the role's own domain is lent, reads always and writes only where
 * the role works on it. Reports are read-only for everyone, and a role that is not listed gets the
 * server read-only. Call-time approval still applies to anything that changes something.
 */
export const ROLE_SCOPES: Record<"reception" | "finance" | "operations" | "quality", RoleScope> = {
  reception: {
    role: /recep|atendimento|front.?desk|concierge|secretar/i,
    domain:
      /appointment|agenda|calendar|booking|availab|client|customer|patient|contact|lead|message|whatsapp|conversation|consulta|agendamento|paciente|cliente|mensagem/i,
    write: true,
  },
  finance: {
    role: /financ|billing|cobran|contas?\b|accounting|cont[aá]bil/i,
    domain:
      /financ|cash|billing|invoice|payment|revenue|expense|receivable|payable|balance|ledger|fatura|pagamento|receita|despesa|caixa|faturamento/i,
    write: false,
  },
  operations: {
    role: /operac|opera[cç][õo]es|operations|ops\b|logistic|log[ií]stica/i,
    domain:
      /staff|employee|professional|team|shift|rota|schedul|resource|room|inventory|stock|supply|service|equipment|funcion[aá]rio|profissional|escala|estoque|sala|servi[cç]o/i,
    write: true,
  },
  quality: {
    role: /qualid|quality|\bqa\b|compliance|audit|auditor/i,
    domain:
      /report|review|feedback|satisfaction|survey|nps|metric|analytic|audit|rating|dashboard|relat[oó]rio|avalia|pesquisa|indicador/i,
    write: false,
  },
};

/** Tools that move money or destroy data are never lent by role; the owner grants those. */
const NEVER_BY_ROLE =
  /delete|remove|destroy|cancel|refund|void|payout|transfer|charge|pay\b|pay_|wipe|purge|reembols|exclu|cancelar|estorno/i;

/**
 * The tools of one connected server a new agent gets, from its role and the tools the creator
 * itself may use. `offered` is the creator's own tool list, so an agent never gets more than the
 * agent that made it. Falls back to read-only when the role is unknown or nothing fits.
 */
export function scopeConnectorForRole(
  agent: { name: string; title?: string },
  tools: readonly ScopeTool[],
  offered?: ReadonlySet<string>,
): ConnectorScope {
  const label = `${agent.name} ${agent.title ?? ""}`;
  const scope = Object.values(ROLE_SCOPES).find((candidate) => candidate.role.test(label));
  if (!scope) return { kind: "read" };
  const allowedTools = tools
    .filter((tool) => !offered || offered.has(tool.name))
    .filter((tool) => scope.domain.test(`${tool.name} ${tool.description ?? ""}`))
    .filter((tool) => {
      if (connectorToolIsRead(tool.name, tool.readOnly, tool.destructive)) return true;
      return scope.write && tool.destructive !== true && !NEVER_BY_ROLE.test(tool.name);
    })
    .map((tool) => tool.name);
  return allowedTools.length > 0 ? { kind: "tools", allowedTools } : { kind: "read" };
}
