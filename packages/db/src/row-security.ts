import { AsyncLocalStorage } from "node:async_hooks";
import { getLogger } from "@corvo/logging";
import type { Pool, PoolClient } from "pg";
import { escapeLiteral } from "pg";
import type { PrismaClient } from "./generated/prisma/client.js";
import { Prisma } from "./generated/prisma/client.js";

/**
 * Who a database operation runs for. Row-level security policies read the
 * matching `app.*` settings on the connection that runs the statement.
 *
 * - `tenant`: rows are limited to one Space (and, for user-owned rows, one user).
 * - `system`: an explicit, named bypass for work that legitimately spans
 *   tenants (job dispatch, reconcilers, webhooks before they resolve a tenant).
 *
 * Without a context, protected tables return no rows and reject writes.
 */
export type DbContext =
  | { kind: "tenant"; spaceId: string; userId: string }
  | { kind: "system"; reason: string };

const storage = new AsyncLocalStorage<DbContext>();

export function currentDbContext(): DbContext | undefined {
  return storage.getStore();
}

/** Run `fn` with row-level security scoped to one Space and user. */
export function runAsTenant<T>(
  tenant: { spaceId: string; userId: string },
  fn: () => T | PromiseLike<T>,
): Promise<T> {
  return within({ kind: "tenant", spaceId: tenant.spaceId, userId: tenant.userId }, fn);
}

/**
 * Run `fn` across tenants. Each call is an audited bypass of row-level
 * security, so name why: `grep -rn "runAsSystem("` lists every one.
 */
export function runAsSystem<T>(reason: string, fn: () => T | PromiseLike<T>): Promise<T> {
  return within({ kind: "system", reason }, fn);
}

/**
 * The same client with every call run as an explicit system context, for test
 * fixtures and assertions that have no request or job around them. Code under
 * test keeps the context its request or job gives it.
 */
export function asSystem<T extends object>(client: T, reason = "test fixture"): T {
  return new Proxy(client, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value === "function") {
        return (...args: unknown[]) =>
          runAsSystem(reason, () => Reflect.apply(value, target, args));
      }
      if (value && typeof value === "object") return asSystem(value, reason);
      return value;
    },
  });
}

type SqlClient = Pick<PrismaClient, "$queryRaw">;

/**
 * runAsSystem for a step inside an interactive transaction a tenant opened: the
 * transaction's connection keeps the settings it was checked out with, so this
 * turns the bypass on for `fn` and back afterwards. Name why, as for runAsSystem.
 */
export async function runAsSystemInTransaction<T>(
  tx: SqlClient,
  reason: string,
  fn: () => Promise<T>,
): Promise<T> {
  const [previous] = await tx.$queryRaw<Array<{ bypass: string | null }>>`
    SELECT current_setting('app.rls_bypass', true) AS bypass`;
  const restore = () =>
    tx.$queryRaw`SELECT set_config('app.rls_bypass', ${previous?.bypass ?? "off"}, true)`;
  await tx.$queryRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
  let result: T;
  try {
    result = await within({ kind: "system", reason }, fn);
  } catch (error) {
    // A failed statement aborts the transaction, which drops the local setting anyway.
    await restore().catch(() => undefined);
    throw error;
  }
  await restore();
  return result;
}

// Prisma operations are lazy and start when awaited. Await inside the scope so
// an operation returned from `fn` still runs with this context.
function within<T>(context: DbContext, fn: () => T | PromiseLike<T>): Promise<T> {
  return storage.run(context, async () => await fn());
}

/** Prisma models whose tables have row-level security enabled. */
/**
 * Tables scoped to an organization by a policy that lets server code with no space (webhooks, the
 * worker) through. Unlike the models below, an unscoped query is not refused by the client.
 */
export const ORGANIZATION_SCOPED_TABLES: readonly string[] = [
  "model_credit_accounts",
  "model_credit_entries",
  "model_credit_lots",
];

export const ROW_SECURITY_MODELS: ReadonlySet<string> = new Set([
  "BillingAuditEvent",
  "Partner",
  "PartnerTenant",
  "PartnerEntryCode",
  "PartnerRequestWindow",
  "PartnerWebhookEvent",
  "CatalogPlan",
  "CatalogPlanPrice",
  "CatalogPack",
  "CatalogPackPrice",
  "FxRate",
  "CommerceSetting",
  "TenantSubscription",
  "CreditGrant",
  "RevenueShareEntry",
  "PartnerInvoice",
  "PartnerInvoiceLine",
  "IdempotencyRecord",
  "Consultation",
  "ConsultationChunk",
  "WaitlistEntry",
  "PartnerLead",
  "PushToken",
  "Thread",
  "Message",
  "Event",
  "MemoryDocument",
  "MemoryRevision",
  "Artifact",
  "ArtifactTranscript",
  "Secret",
  "BotSecret",
  "AgentSecret",
  "UserModelCredential",
  "UserVoiceCredential",
  "TaughtSkill",
  "AgentSkill",
  "AgentImport",
  "Bot",
  "Run",
  "Task",
  "Routine",
  "Connection",
  "McpServer",
  "McpOAuthSession",
  "ModelOAuthSession",
  "ProviderQuota",
  "MissionState",
  "BotMcpServer",
  "DatabaseConnection",
  "BotDatabaseGrant",
  "Mailbox",
  "BotMailbox",
  "MailboxSend",
  "Computer",
  "ComputerRun",
  "Board",
  "Ticket",
  "TicketComment",
  "MessagingIdentity",
  "MessagingInstallation",
  "MessagingInstallSession",
  "MessagingOutbound",
  "ExternalConversation",
  "ExternalMessage",
  "SteeringMessage",
  "UsageRecord",
  "ScratchpadItem",
  "ActionApprovalRule",
  "SpaceModelRoleChoice",
  "SpaceSettingOverride",
  "SpaceModelConnection",
  "SpaceMemberModelSetting",
  "ThreadMemberRead",
  "Notification",
  "SpaceRole",
  "SpaceMemberRole",
  "SpaceInvitation",
  "SpaceInviteLink",
  "SpaceJoinRequest",
  "ChatGroupPerson",
  "DirectThread",
  "WikiSettings",
  "WikiSource",
  "WikiChange",
  "WikiImport",
  "WhatsAppAuthEntry",
  "UserMemory",
  "UserModelRoleChoice",
  "UserModelPreference",
  "UserVoicePreference",
  "UserActionApprovalRule",
  "UserActionAutoReviewPreference",
  "SecurityEvent",
]);

/**
 * The policy generation this release enforces. Policies added for a newer
 * generation stay open to a connection that does not claim it, which is the
 * previous release while it runs beside this one during a deploy.
 */
const RLS_VERSION = "2";

type Settings = [spaceId: string, userId: string, bypass: "on" | "off", version: string];

function settingsFor(context: DbContext | undefined): Settings {
  if (context?.kind === "tenant") return [context.spaceId, context.userId, "off", RLS_VERSION];
  return ["", "", context?.kind === "system" ? "on" : "off", RLS_VERSION];
}

/**
 * The settings as one simple-protocol statement list, so they travel in the same round trip as
 * the BEGIN they belong to. SET LOCAL lasts until that transaction ends and takes no snapshot, so
 * a SET TRANSACTION ISOLATION LEVEL may still follow.
 */
function setLocalStatements(settings: Settings): string {
  const [space, user, bypass, version] = settings;
  return [
    ["app.space_id", space],
    ["app.user_id", user],
    ["app.rls_bypass", bypass],
    ["app.rls_version", version],
  ]
    .map(([name, value]) => `SET LOCAL ${name} = ${escapeLiteral(value!)}`)
    .join("; ");
}

const BEGINS = /^\s*(begin|start\s+transaction)\b/i;
const ENDS = /^\s*(commit|end|rollback)\b(?!\s+to\b)/i;

type QueryArgs = unknown[];
type Queryable = { query: (...args: QueryArgs) => Promise<unknown> };

function textOf(args: QueryArgs): string {
  const first = args[0];
  const text = typeof first === "string" ? first : (first as { text?: unknown } | undefined)?.text;
  // A cursor or another submittable would run outside the transaction that carries the context.
  if (typeof text !== "string") throw new Error("Unsupported query for a scoped database client");
  return text;
}

/** `pg` takes a callback as the last argument as well as returning a promise; honour both. */
function query(run: (args: QueryArgs) => Promise<unknown>) {
  return (...args: QueryArgs): Promise<unknown> | undefined => {
    const callback =
      typeof args.at(-1) === "function"
        ? (args.pop() as (...values: unknown[]) => void)
        : undefined;
    const result = run(args);
    if (!callback) return result;
    result.then(
      (value) => callback(null, value),
      (error: Error) => callback(error),
    );
    return undefined;
  };
}

/**
 * Runs one statement as its own transaction that sets the context first: BEGIN and the settings
 * in one round trip, the statement with its own parameters, COMMIT.
 */
async function queryInOwnTransaction(
  client: Queryable,
  settings: Settings,
  args: QueryArgs,
): Promise<unknown> {
  await client.query(`BEGIN; ${setLocalStatements(settings)}`);
  let result: unknown;
  try {
    result = await client.query(...args);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  await client.query("COMMIT");
  return result;
}

function proxyOf<T extends object>(target: T, overrides: Record<string, unknown>): T {
  return new Proxy(target, {
    get(object, key) {
      if (typeof key === "string" && key in overrides) return overrides[key];
      const value = Reflect.get(object, key, object);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
}

/**
 * The client with the context applied to every transaction it runs. The settings are transaction
 * local and sent with each BEGIN, because a pooler (PgBouncer in transaction mode, most hosted
 * ones by default) may serve each transaction on a different server connection: session state set
 * on checkout would stay on the server connection that ran it, and the next transaction could
 * run on one holding another tenant's settings. A statement outside a transaction gets one of
 * its own.
 */
function scopedClient(client: PoolClient): PoolClient {
  let inTransaction = false;
  const run = async (args: QueryArgs): Promise<unknown> => {
    const text = textOf(args);
    const raw = client as unknown as Queryable;
    if (BEGINS.test(text)) {
      inTransaction = true;
      try {
        const results = await raw.query(
          `${text}; ${setLocalStatements(settingsFor(storage.getStore()))}`,
        );
        return Array.isArray(results) ? results[0] : results;
      } catch (error) {
        inTransaction = false;
        throw error;
      }
    }
    if (!inTransaction) return queryInOwnTransaction(raw, settingsFor(storage.getStore()), args);
    try {
      return await raw.query(...args);
    } finally {
      if (ENDS.test(text)) inTransaction = false;
    }
  };
  return proxyOf(client, { query: query(run) });
}

/**
 * The pool as the application's database client must use it. Everything run through it carries
 * the context of the code that asked, set inside the transaction that runs the statements (see
 * scopedClient); a statement with no context sees no rows of a protected table. The pool itself
 * stays unscoped for queues, locks and listeners, which touch no protected table.
 */
export function scopeToDbContext(pool: Pool): Pool {
  const connect = (callback?: (...args: unknown[]) => void): Promise<PoolClient> | undefined => {
    if (!callback) return pool.connect().then(scopedClient);
    (pool.connect as (callback: unknown) => void)(
      (error: Error | undefined, client: PoolClient | undefined, done: unknown) =>
        callback(error, client && scopedClient(client), done),
    );
    return undefined;
  };
  const run = async (args: QueryArgs): Promise<unknown> => {
    textOf(args);
    const settings = settingsFor(storage.getStore());
    const client = await pool.connect();
    try {
      return await queryInOwnTransaction(client as unknown as Queryable, settings, args);
    } finally {
      client.release();
    }
  };
  return proxyOf(pool, { connect, query: query(run) });
}

const LOCAL_SETTINGS = (settings: Settings) =>
  Prisma.sql`SELECT set_config('app.space_id', ${settings[0]}, true), set_config('app.user_id', ${settings[1]}, true), set_config('app.rls_bypass', ${settings[2]}, true), set_config('app.rls_version', ${settings[3]}, true)`;

// A wrapped read keeps the pool's checkout timeout and no run limit it did not
// have before, instead of Prisma's 2s/5s transaction defaults.
const WRAPPED_OPERATION_OPTIONS = { maxWait: 10_000, timeout: 300_000 };

type InternalParams = { transaction?: { kind?: string }; dataPath?: unknown[] };
type RuntimeDataModel = { models: Record<string, { fields: Array<{ name: string }> }> };
type Where = Record<string, unknown>;

const LOGICAL = new Set(["AND", "OR", "NOT"]);

/**
 * The same filter as a findUnique `where`, for findFirst: compound unique keys
 * (`spaceId_name: { spaceId, name }`) become their fields. Undefined when the
 * shape is not recognised.
 */
function uniqueAsFilter(where: Where, fields: Set<string>): Where | undefined {
  const filter: Where = {};
  const compounds: Where[] = [];
  for (const [key, value] of Object.entries(where)) {
    if (fields.has(key) || LOGICAL.has(key)) filter[key] = value;
    else if (value && typeof value === "object" && !Array.isArray(value))
      compounds.push(value as Where);
    else return undefined;
  }
  if (!compounds.length) return filter;
  const and = filter.AND === undefined ? [] : Array.isArray(filter.AND) ? filter.AND : [filter.AND];
  return { ...filter, AND: [...and, ...compounds] };
}

const reportedMissing = new Set<string>();
const MAX_REPORTED = 500;

// The database already returns nothing here, so log once per call site to point
// at the missing runAsTenant / runAsSystem instead of an empty result.
function missingContext(model: string, operation: string): void {
  const error = new Error(`${model}.${operation} ran outside runAsTenant/runAsSystem`);
  const callSite = (error.stack ?? "")
    .split("\n")
    .slice(1)
    .filter((frame) => !/row-security|@prisma|node:internal/.test(frame))
    .slice(0, 3)
    .join("\n");
  const key = `${model}.${operation}\n${callSite}`;
  if (reportedMissing.has(key) || reportedMissing.size >= MAX_REPORTED) return;
  reportedMissing.add(key);
  getLogger().error("database access without a tenant or system context", error, {
    model,
    operation,
  });
}

/**
 * The call sites logged since the last call, cleared as they are returned. Test
 * runs fail on any, so a path that reaches a protected table without a context
 * is caught in CI instead of returning nothing in production.
 */
export function drainUnscopedDatabaseAccess(): string[] {
  const sites = [...reportedMissing];
  reportedMissing.clear();
  return sites;
}

/**
 * Covers the two cases where Prisma, not the caller, decides when a
 * connection is checked out, so the pool would see the wrong context:
 * - outside a transaction, Prisma batches `findUnique` calls from one tick and
 *   runs them on the next, so each one runs as the equivalent findFirst;
 * - a batch `$transaction([...])` starts on the next tick as well, so it is
 *   rejected inside a context; use an interactive transaction instead.
 */
export function withRowLevelSecurity(prisma: PrismaClient): PrismaClient {
  const models = (prisma as unknown as { _runtimeDataModel?: RuntimeDataModel })._runtimeDataModel
    ?.models;
  const fieldSets = new Map<string, Set<string>>();
  const fieldsOf = (model: string) => {
    const fields = models?.[model]?.fields;
    if (!fields) return undefined;
    let set = fieldSets.get(model);
    if (!set) {
      set = new Set(fields.map((field) => field.name));
      fieldSets.set(model, set);
    }
    return set;
  };
  return prisma.$extends({
    query: {
      async $allOperations({ model, operation, args, query, ...rest }) {
        const context = storage.getStore();
        if (!context) {
          if (model && ROW_SECURITY_MODELS.has(model)) missingContext(model, operation);
          return query(args);
        }
        const internal = (rest as { __internalParams?: InternalParams }).__internalParams;
        const transaction = internal?.transaction;
        if (transaction?.kind === "batch") {
          throw new Error(
            "Batch $transaction([...]) cannot carry a database context; use an interactive transaction",
          );
        }
        if (transaction || (operation !== "findUnique" && operation !== "findUniqueOrThrow")) {
          return query(args);
        }
        // Prisma would batch this with other findUnique calls of the same tick and
        // run them all in whichever context came first. findFirst runs at once,
        // in this one, with the same plan.
        const fields = model ? fieldsOf(model) : undefined;
        const where = (args as { where?: Where }).where;
        const filter =
          fields && where && !internal?.dataPath?.length && uniqueAsFilter(where, fields);
        if (model && filter) {
          const delegate = Reflect.get(prisma, model[0]!.toLowerCase() + model.slice(1));
          const first = operation === "findUnique" ? "findFirst" : "findFirstOrThrow";
          return Reflect.apply(delegate[first], delegate, [{ ...args, where: filter }]);
        }
        // Fluent relation reads (`findUnique(...).messages()`) keep Prisma's own
        // shape, so they run in a short transaction that sets the context first.
        const [, result] = await prisma.$transaction(
          [prisma.$executeRaw(LOCAL_SETTINGS(settingsFor(context))), query(args)],
          WRAPPED_OPERATION_OPTIONS as never,
        );
        return result;
      },
    },
  }) as unknown as PrismaClient;
}
