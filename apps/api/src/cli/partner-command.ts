import { PartnerTemplate } from "@corvo/contracts";

const USAGE = [
  "Usage:",
  '  partner create <slug> "<name>" [--wallet-owner <email>]',
  "                                   register a partner and print its key once; its customers'",
  "                                   credit comes from the account with that email",
  "  partner rotate <slug>            issue a new key; the old one stops working",
  "  partner disable <slug>           stop accepting the partner's key",
  "  partner enable <slug>",
  "  partner apply-template <slug> <file.json> [--mcp-url <https://...>]",
  "                                   set what every new customer gets; safe to repeat",
  "  partner webhook <slug> <https://...|off>",
  "                                   tell the partner about customers' credit; prints the signing secret",
  "  partner webhook-secret <slug>    print the signing secret again",
  "  partner webhook-rotate <slug>    replace the signing secret",
  "  partner retention <slug> <days|default>   days a consultation's audio and transcript are kept",
].join("\n");

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
/** Where a template file names the address of the partner's MCP server, filled in when applied. */
export const MCP_URL_PLACEHOLDER = "{{MCP_PUBLIC_URL}}";

type Issued = { partner: { slug: string; name: string }; key: string };

export interface PartnerCommandDeps {
  createPartner(input: { slug: string; name: string; walletOwnerUserId?: string }): Promise<Issued>;
  rotatePartnerKey(slug: string): Promise<Issued>;
  setPartnerEnabled(slug: string, enabled: boolean): Promise<void>;
  setScribeRetentionDays(slug: string, days: number | null): Promise<void>;
  findUserIdByEmail(email: string): Promise<string | null>;
  readFile(path: string): Promise<string>;
  /** False when no partner has the slug. */
  setTemplate(slug: string, template: PartnerTemplate): Promise<boolean>;
  setWebhookUrl(
    slug: string,
    url: string | null,
  ): Promise<{ id: string; webhookSecretVersion: number }>;
  findPartner(slug: string): Promise<{ id: string; webhookSecretVersion: number } | null>;
  rotateWebhookSecret(slug: string): Promise<{ id: string; webhookSecretVersion: number }>;
  webhookSecret(partner: { id: string; webhookSecretVersion: number }): string;
}

function takeFlag(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith("--")) throw new Error(USAGE);
  args.splice(at, 2);
  return value;
}

const isSafeAddress = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    );
  } catch {
    return false;
  }
};

/** Reads a template file, fills in the MCP address, and checks it is a whole, valid template. */
export function parseTemplateFile(raw: string, mcpUrl?: string): PartnerTemplate {
  let text = raw;
  if (mcpUrl) {
    if (!isSafeAddress(mcpUrl)) throw new Error("--mcp-url must be an https address.");
    text = text.split(MCP_URL_PLACEHOLDER).join(mcpUrl.replace(/\/+$/, ""));
  }
  if (text.includes(MCP_URL_PLACEHOLDER)) {
    throw new Error("The template names the MCP address; pass it with --mcp-url <https://...>.");
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The template file is not valid JSON.");
  }
  const parsed = PartnerTemplate.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `The template is not valid: ${issue?.path.join(".") || "template"}: ${issue?.message}`,
    );
  }
  return parsed.data;
}

/** Runs one command and returns what to print. Nothing is touched until the arguments are valid. */
export async function runPartnerCommand(
  argv: readonly string[],
  deps: PartnerCommandDeps,
): Promise<string> {
  const args = [...argv];
  const walletOwner = takeFlag(args, "--wallet-owner");
  const mcpUrl = takeFlag(args, "--mcp-url");
  const [command, slug, name, ...extra] = args;
  if (!command || !slug || extra.length > 0) throw new Error(USAGE);
  if (!SLUG.test(slug)) {
    throw new Error("The slug must be 3 to 40 lowercase letters, digits or hyphens.");
  }
  if ((walletOwner && command !== "create") || (mcpUrl && command !== "apply-template")) {
    throw new Error(USAGE);
  }
  switch (command) {
    case "create": {
      if (!name?.trim()) throw new Error(USAGE);
      let walletOwnerUserId: string | undefined;
      if (walletOwner) {
        walletOwnerUserId = (await deps.findUserIdByEmail(walletOwner)) ?? undefined;
        if (!walletOwnerUserId) throw new Error("No account has that email.");
      }
      const { partner, key } = await deps.createPartner({
        slug,
        name: name.trim(),
        ...(walletOwnerUserId ? { walletOwnerUserId } : {}),
      });
      return `Created ${partner.slug}.\nKey: ${key}\nThis key will not be shown again. Store it in the partner's server secrets.`;
    }
    case "rotate": {
      if (name) throw new Error(USAGE);
      const { partner, key } = await deps.rotatePartnerKey(slug);
      return `New key for ${partner.slug}: ${key}\nThe old key no longer works. This key will not be shown again.`;
    }
    case "disable":
    case "enable": {
      if (name) throw new Error(USAGE);
      await deps.setPartnerEnabled(slug, command === "enable");
      return `${slug} is ${command}d.`;
    }
    case "apply-template": {
      if (!name) throw new Error(USAGE);
      const template = parseTemplateFile(await deps.readFile(name), mcpUrl);
      if (!(await deps.setTemplate(slug, template))) throw new Error(`Unknown partner: ${slug}`);
      const agents = template.agents.map((agent) => agent.name).join(", ") || "none";
      return `Applied the template to ${slug}. Agents: ${agents}.\nCustomers made from now on get it; existing customers keep their own agents.`;
    }
    case "webhook": {
      if (!name) throw new Error(USAGE);
      if (name !== "off" && !isSafeAddress(name))
        throw new Error("The webhook address must be https.");
      const partner = await deps.setWebhookUrl(slug, name === "off" ? null : name);
      return name === "off"
        ? `${slug} no longer gets webhooks.`
        : `${slug} gets webhooks at ${name}.\nSigning secret: ${deps.webhookSecret(partner)}`;
    }
    case "webhook-secret":
    case "webhook-rotate": {
      if (name) throw new Error(USAGE);
      const partner =
        command === "webhook-rotate"
          ? await deps.rotateWebhookSecret(slug)
          : await deps.findPartner(slug);
      if (!partner) throw new Error(`Unknown partner: ${slug}`);
      return `Signing secret for ${slug}: ${deps.webhookSecret(partner)}`;
    }
    case "retention": {
      if (name === "default") {
        await deps.setScribeRetentionDays(slug, null);
        return `${slug} keeps consultation recordings for the default 30 days.`;
      }
      const days = Number(name);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new Error("The retention must be a whole number of days from 1 to 365, or default.");
      }
      await deps.setScribeRetentionDays(slug, days);
      return `${slug} keeps consultation recordings for ${days} days.`;
    }
    default:
      throw new Error(USAGE);
  }
}
