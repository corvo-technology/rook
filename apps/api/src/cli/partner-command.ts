import type { VerticalId } from "@corvo/contracts";
import { PartnerTemplate, VERTICAL_IDS, verticalPartnerTemplate } from "@corvo/contracts";

const USAGE = [
  "Usage:",
  '  partner create <slug> "<name>" [--wallet-owner <email>]',
  "                                   register a partner and print its key once; its customers'",
  "                                   credit comes from the account with that email",
  "  partner rotate <slug>            issue a new key; the old one stops working",
  "  partner disable <slug>           stop accepting the partner's key",
  "  partner enable <slug>",
  "  partner apply-template <slug> <file.json> [--mcp-url <https://...>]",
  `  partner apply-template <slug> --vertical <${VERTICAL_IDS.join("|")}>`,
  "                                   set what every new customer gets, from a file or a starter; safe to repeat",
  "  partner webhook <slug> <https://...|off>",
  "                                   tell the partner about customers' credit; prints the signing secret",
  "  partner webhook-secret <slug>    print the signing secret again",
  "  partner webhook-rotate <slug>    replace the signing secret",
  "  partner retention <slug> <days|default>   days a consultation's audio and transcript are kept",
  "  partner commerce <slug> [--billing-model wallet|commerce] [--mode embedded|white_label]",
  "                   [--country BR] [--commission-bps 2000] [--checkout-url <https://...>|off]",
  "                   [--scopes tenants:write,commerce:read,commerce:write]",
  "                                   how Rook bills the partner; the country fixes the currency",
  "  partner catalog-seed <file.json> load the plans and packs with their prices; safe to repeat",
  "  partner fx-set <BRL|USD> <rate> [--date YYYY-MM-DD]   the day's USD rate (a manual override)",
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
  configureCommerce(
    slug: string,
    input: {
      billingModel?: "wallet" | "commerce";
      mode?: "embedded" | "white_label";
      country?: string;
      commissionBps?: number;
      checkoutUrl?: string | null;
      scopes?: string[];
    },
  ): Promise<{ billingModel: string; mode: string; currency: string; commissionBps: number }>;
  seedCatalog(seed: unknown): Promise<void>;
  recordFxRate(input: { quote: string; rate: string; validFrom: Date }): Promise<void>;
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
  if (args[0] === "catalog-seed") {
    const file = args[1];
    if (!file || args.length > 2) throw new Error(USAGE);
    let seed: unknown;
    try {
      seed = JSON.parse(await deps.readFile(file));
    } catch {
      throw new Error("The catalog file is not valid JSON.");
    }
    await deps.seedCatalog(seed);
    return "The catalog is loaded.";
  }
  if (args[0] === "fx-set") {
    const date = takeFlag(args, "--date");
    const [, quote, rate, ...rest] = args;
    if (!quote || !rate || rest.length > 0) throw new Error(USAGE);
    if (quote !== "BRL") throw new Error("Only BRL needs a rate.");
    const validFrom = date ? new Date(`${date}T00:00:00Z`) : new Date();
    if (Number.isNaN(validFrom.getTime())) throw new Error("The date is YYYY-MM-DD.");
    await deps.recordFxRate({ quote, rate, validFrom });
    return `USD to ${quote} is ${rate} from ${validFrom.toISOString().slice(0, 10)}.`;
  }
  const billingModel = takeFlag(args, "--billing-model");
  const mode = takeFlag(args, "--mode");
  const country = takeFlag(args, "--country");
  const commissionBps = takeFlag(args, "--commission-bps");
  const checkoutUrl = takeFlag(args, "--checkout-url");
  const scopes = takeFlag(args, "--scopes");
  const walletOwner = takeFlag(args, "--wallet-owner");
  const mcpUrl = takeFlag(args, "--mcp-url");
  const vertical = takeFlag(args, "--vertical");
  const [command, slug, name, ...extra] = args;
  if (!command || !slug || extra.length > 0) throw new Error(USAGE);
  if (!SLUG.test(slug)) {
    throw new Error("The slug must be 3 to 40 lowercase letters, digits or hyphens.");
  }
  const commerceFlags = [billingModel, mode, country, commissionBps, checkoutUrl, scopes];
  if (commerceFlags.some((flag) => flag !== undefined) && command !== "commerce") {
    throw new Error(USAGE);
  }
  if (
    (walletOwner && command !== "create") ||
    ((mcpUrl || vertical) && command !== "apply-template")
  ) {
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
      if (!name === !vertical || (vertical && mcpUrl)) throw new Error(USAGE);
      if (vertical && !VERTICAL_IDS.includes(vertical as VerticalId)) {
        throw new Error(`--vertical is one of ${VERTICAL_IDS.join(", ")}.`);
      }
      const template = vertical
        ? verticalPartnerTemplate(vertical as VerticalId)
        : parseTemplateFile(await deps.readFile(name as string), mcpUrl);
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
    case "commerce": {
      if (name) throw new Error(USAGE);
      if (billingModel && billingModel !== "wallet" && billingModel !== "commerce") {
        throw new Error("--billing-model is wallet or commerce.");
      }
      if (mode && mode !== "embedded" && mode !== "white_label") {
        throw new Error("--mode is embedded or white_label.");
      }
      if (checkoutUrl && checkoutUrl !== "off" && !isSafeAddress(checkoutUrl)) {
        throw new Error("The checkout address must be https.");
      }
      const bps = commissionBps === undefined ? undefined : Number(commissionBps);
      const partner = await deps.configureCommerce(slug, {
        ...(billingModel ? { billingModel: billingModel as "wallet" | "commerce" } : {}),
        ...(mode ? { mode: mode as "embedded" | "white_label" } : {}),
        ...(country ? { country } : {}),
        ...(bps !== undefined ? { commissionBps: bps } : {}),
        ...(checkoutUrl ? { checkoutUrl: checkoutUrl === "off" ? null : checkoutUrl } : {}),
        ...(scopes ? { scopes: scopes.split(",").map((scope) => scope.trim()) } : {}),
      });
      return `${slug}: ${partner.billingModel}, ${partner.mode}, ${partner.currency}, commission ${partner.commissionBps / 100}%.`;
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
