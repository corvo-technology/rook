import { randomBytes } from "node:crypto";
import type { SecretStore } from "@corvo/adapter-kit";
import type { BotSecretDestination } from "@corvo/contracts";
import {
  BotSecretAuth,
  BotSecretName,
  botSecretDestinationSchema,
  commandVariableName,
  commandVariableProblem,
  decodeLoginSecret,
  encodeLoginSecret,
  GeneratedSecretRules,
  GenerateSecretInput,
  isPrivateNetworkHost,
  loginCommandName,
  SecretHttpRequest,
} from "@corvo/contracts";
import type { Prisma, PrismaClient } from "@corvo/db";
import {
  commandVariableClash,
  usableBotSecrets,
  visibleBotSecrets,
  withTransactionRetry,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { combineSignals, redactConnectorPayload } from "./connector-safety.js";
import type { RemoteTransportDependencies } from "./remote-mcp.js";
import { createPrivateNetworkFetch, createSafeRemoteFetch } from "./remote-mcp.js";
import { generateSecretValue } from "./secret-generator.js";
import { persistPreparedSecret } from "./secret-persistence.js";
import { readBodyCapped, withAbort } from "./web-ssrf.js";

export type BotSecretScope = { userId: string; spaceId: string; botId: string };
/** The credentials one run may use (see `usableBotSecrets`). */
function scopeFields(scope: BotSecretScope) {
  return usableBotSecrets(scope);
}

export type BotSecretUseOutcome = "ok" | "failed";

/**
 * Records one use of a credential: which agent, run and person, where it went, and the outcome.
 * Never the value. A log write must not break the work it describes, so a failure is only logged.
 */
export async function recordBotSecretUse(
  prisma: PrismaClient,
  scope: BotSecretScope & { runId?: string },
  row: { id: string; name: string },
  destination: string,
  outcome: BotSecretUseOutcome,
  options?: { oncePerRun?: boolean },
): Promise<void> {
  try {
    if (
      options?.oncePerRun &&
      scope.runId &&
      (await prisma.botSecretUse.findFirst({
        where: { secretId: row.id, runId: scope.runId, destination },
        select: { id: true },
      }))
    )
      return;
    await prisma.botSecretUse.create({
      data: {
        id: randomBytes(12).toString("hex"),
        spaceId: scope.spaceId,
        secretId: row.id,
        name: row.name,
        botId: scope.botId,
        runId: scope.runId ?? null,
        forUserId: scope.userId,
        destination,
        outcome,
      },
    });
    // The log is a recent history, not an archive.
    await prisma.botSecretUse.deleteMany({
      where: {
        secretId: row.id,
        createdAt: { lt: new Date(Date.now() - BOT_SECRET_USE_RETENTION_MS) },
      },
    });
  } catch {
    getLogger().warn("credential use could not be logged", { credentialId: row.id });
  }
}
const BOT_SECRET_USE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const metadata = { name: true, origin: true, auth: true } as const;

const SECRET_ALREADY_SAVED = "A credential with this name is already saved";
const UNUSABLE_CREDENTIAL = "Credential cannot be used with this authentication method";

/** `encodeURIComponent` throws on an unpaired surrogate. */
function percentEncoded(value: string): string | undefined {
  try {
    return encodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function commandRedactionForms(value: string): string[] {
  const forms = [value, Buffer.from(value).toString("base64")];
  const encoded = percentEncoded(value);
  if (encoded !== undefined) forms.push(encoded);
  return forms;
}

export function commandCredentialRedactions(environment: Record<string, string>): string[] {
  return [...new Set(Object.values(environment).flatMap(commandRedactionForms))];
}

function credentialHeader(destination: BotSecretDestination, plaintext: string) {
  // A login is only typed into its site, and a command variable only reaches shell commands.
  if (destination.auth.type === "login" || destination.auth.type === "command") {
    throw new Error("Credential cannot be used with this authentication method");
  }
  const name = destination.auth.type === "header" ? destination.auth.name : "Authorization";
  const value =
    destination.auth.type === "bearer"
      ? `Bearer ${plaintext}`
      : destination.auth.type === "basic"
        ? `Basic ${Buffer.from(`${destination.auth.username}:${plaintext}`).toString("base64")}`
        : plaintext;
  try {
    const headers = new Headers({ [name]: value });
    if (headers.get(name) !== value) throw new Error("Header value was normalized");
  } catch {
    throw new Error("Credential cannot be used with this authentication method");
  }
  return { name, value };
}

/** Owner escape enabling plain-HTTP origins on private LAN hosts (see #907). */
export function allowPrivateHttpSecretOrigins(): boolean {
  return process.env.CORVO_SECRETS_ALLOW_PRIVATE_HTTP === "1";
}

export function normalizeSecretDestination(value: unknown): BotSecretDestination {
  const parsed = botSecretDestinationSchema({
    allowPrivateHttpOrigin: allowPrivateHttpSecretOrigins(),
  }).safeParse(value);
  if (!parsed.success) {
    // Surface the actual failing field: models (and people) supply all three
    // parts and still fail on a name character or an origin rule, and a
    // generic "specify name, origin, auth" error sends them retrying blind.
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "credential"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid credential destination — ${detail}`);
  }
  if (parsed.data.auth.type === "command") return parsed.data;
  return { ...parsed.data, origin: new URL(parsed.data.origin).origin };
}

function isCommandCredential(auth: unknown): boolean {
  const parsed = BotSecretAuth.safeParse(auth);
  return parsed.success && parsed.data.type === "command";
}

/**
 * What the bot's tools show for a saved credential. A command variable has no site, so it is
 * listed with the environment variable its shell commands read instead.
 */
export function botSecretToolView(row: { name: string; origin: string; auth: unknown }) {
  if (!isCommandCredential(row.auth)) return row;
  const variable = commandVariableName(row.name);
  const problem = commandVariableProblem(variable);
  if (problem === undefined) return { name: row.name, auth: row.auth, variable };
  const reason =
    problem === "reserved"
      ? `$${variable} is reserved and is not exported.`
      : `$${variable} is not a valid environment variable name and is not exported.`;
  return {
    name: row.name,
    auth: row.auth,
    error: `${reason} Remove it and save it under another name.`,
  };
}

/**
 * Decrypt this bot's command variables for one shell command. Loaded per command so an added,
 * replaced, or removed value applies to the next command. The values must never be logged or
 * returned; callers register them for redaction before the command runs.
 */
export async function loadBotCommandEnvironment(
  prisma: PrismaClient,
  secretStore: Pick<SecretStore, "load">,
  scope: BotSecretScope,
  unsetVariables?: Set<string>,
  loaded?: Array<{ id: string; name: string }>,
): Promise<Record<string, string>> {
  const rows = await prisma.botSecret.findMany({
    where: scopeFields(scope),
    select: { id: true, name: true, auth: true, ciphertext: true },
    orderBy: { name: "asc" },
    take: 100,
  });
  const environment: Record<string, string> = {};
  for (const row of rows) {
    if (!isCommandCredential(row.auth)) continue;
    const variable = commandVariableName(row.name);
    if (commandVariableProblem(variable)) continue;
    let value: string;
    try {
      value = await secretStore.load(row.ciphertext, row.id);
    } catch {
      // One unreadable value must not stop every shell command; the variable is left unset.
      unsetVariables?.add(variable);
      continue;
    }
    if (value && !value.includes("\0")) {
      environment[variable] = value;
      loaded?.push({ id: row.id, name: row.name });
    }
  }
  return environment;
}

/**
 * The environment for one shell command: the space variables, with this bot's command variables
 * loaded fresh over them (the bot's own value wins a name clash). The bot's values are handed to
 * `registerRedactions` before this returns, so the command's output is redacted.
 */
export async function shellCommandEnvironment(input: {
  prisma: PrismaClient;
  secretStore: Pick<SecretStore, "load">;
  scope: BotSecretScope & { runId?: string };
  spaceEnvironment: Record<string, string>;
  registerRedactions: (values: string[]) => void;
}): Promise<{ env: Record<string, string>; unsetEnv: string[] }> {
  const unsetVariables = new Set<string>();
  const loaded: Array<{ id: string; name: string }> = [];
  const botEnvironment = await loadBotCommandEnvironment(
    input.prisma,
    input.secretStore,
    input.scope,
    unsetVariables,
    loaded,
  );
  // A shell command can read every variable it is given, so a run's first command that gets one
  // is its use; later commands of the same run are not logged again.
  for (const row of loaded) {
    await recordBotSecretUse(input.prisma, input.scope, row, "command", "ok", { oncePerRun: true });
  }
  // Encoded forms too, as secret_request does, so an accidental `base64` or URL-encoding of a
  // value is still redacted from command output.
  input.registerRedactions(commandCredentialRedactions(botEnvironment));
  const environment = { ...input.spaceEnvironment, ...botEnvironment };
  // A failed bot credential still shadows the space credential with the same name.
  for (const variable of unsetVariables) delete environment[variable];
  return { env: environment, unsetEnv: [...unsetVariables] };
}

/** Another command credential of this bot that is exported as the same variable. */
export function findCommandVariableConflict(
  client: PrismaClient | Prisma.TransactionClient,
  scope: BotSecretScope,
  destination: BotSecretDestination,
): Promise<string | undefined> {
  return commandVariableClash(client, scope, destination);
}

export type RequestSecretDestinationResult = {
  /** Metadata only. The protected value is never part of this result. */
  destination?: BotSecretDestination;
  connectionId?: string;
  error?: string;
};

/**
 * The model-facing schema is one object, so a credential often arrives beside
 * `connectionId`, as a JSON string, or as top-level `name` / `origin` / `auth`
 * instead of a nested `credential`. A destination that normalizes is the masked
 * reusable path. `connectionId` applies only when no credential was supplied.
 */
export function resolveRequestSecretDestination(
  args: Record<string, unknown>,
): RequestSecretDestinationResult {
  const credential = credentialArgument(args);
  if (credential !== undefined) {
    try {
      return { destination: normalizeSecretDestination(credential) };
    } catch (error) {
      return {
        error:
          error instanceof Error && error.message.startsWith("Invalid credential destination")
            ? error.message
            : "Specify a credential name, HTTPS origin, and auth method.",
      };
    }
  }
  const connectionId = connectionIdArgument(args.connectionId);
  if (connectionId) return { connectionId };
  return { error: "Provide either a reusable credential destination or a connectionId." };
}

const destinationFields = ["name", "origin", "auth"] as const;

/**
 * Credential object from `credential`, a JSON string of that object, or top-level fields.
 * Only destination metadata is returned. A partial `name` / `origin` / `auth` set is still
 * a credential attempt so it cannot fall through to `connectionId`.
 */
export function credentialArgument(args: Record<string, unknown>): unknown {
  if (Object.hasOwn(args, "credential") && args.credential != null && args.credential !== "") {
    return parsedCredentialObject(args.credential);
  }
  if (destinationFields.some((key) => Object.hasOwn(args, key))) {
    return destinationMetadata(args);
  }
  return undefined;
}

export function connectionIdArgument(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return undefined;
  return trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * `{ name, origin, auth }` only. Secret fields must not survive, including ones nested in
 * `auth` or carried in an origin string. The effect request is this object, and destination
 * parsing strips extras only from its own copy.
 */
function destinationMetadata(record: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const key of destinationFields) {
    if (!Object.hasOwn(record, key)) continue;
    if (key === "auth") {
      const auth = authMetadata(record.auth);
      if (auth !== undefined) metadata.auth = auth;
      continue;
    }
    if (key === "origin") {
      const origin = originMetadata(record.origin);
      if (origin !== undefined) metadata.origin = origin;
      continue;
    }
    if (typeof record.name === "string") {
      // Keep a real name. Anything else is replaced so a secret in that string is not recorded,
      // while destination validation still reports the name pattern.
      metadata.name = BotSecretName.safeParse(record.name).success ? record.name : "Invalid Name";
    }
  }
  return metadata;
}

/**
 * Parsed auth, or a stand-in that fails the same way. The stand-in does not copy the
 * original fields: an invalid method or header can still carry a secret, and the effect
 * row is written before destination validation.
 */
function authMetadata(value: unknown): unknown {
  const parsed = BotSecretAuth.safeParse(value);
  if (parsed.success) return parsed.data;
  if (!isPlainObject(value)) return undefined;
  if (value.type === "header") {
    if (typeof value.name !== "string") return { type: "header" };
    const header = BotSecretAuth.safeParse({ type: "header", name: value.name });
    const unsupported =
      !header.success &&
      header.error.issues.some((issue) => issue.message === "Unsupported credential header");
    return { type: "header", name: unsupported ? "Cookie" : "bad header" };
  }
  if (value.type === "basic") {
    if (typeof value.username !== "string") return { type: "basic" };
    return { type: "basic", username: ":" };
  }
  return { type: "invalid" };
}

/**
 * The site a credential is saved under when given a page URL: the origin of an http or https
 * URL, without its path, query or fragment. Any other scheme gets nothing, since
 * `blob:https://host/x` reports `https://host` without being a page on it. With
 * `allowUserinfo` false, a URL carrying a username or password gets nothing either, and so does
 * one longer than `maxLength`, checked on what was given rather than on the site it reduces to.
 */
export function pageUrlOrigin(
  value: string,
  { allowUserinfo, maxLength }: { allowUserinfo: boolean; maxLength: number },
): string | undefined {
  if (value.length > maxLength) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (!allowUserinfo && (url.username || url.password)) return undefined;
  return url.origin;
}

/**
 * Keep only the site. Never return the raw string: `new URL` resolves `..`, so the raw
 * path can still hold a secret while the parsed path is `/`. Userinfo, query, fragment,
 * and path are removed. A placeholder keeps the origin error when no site remains.
 */
function originMetadata(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "") return "";
  // A sign-in redirect URL can be long; the authenticated request URL's limit, not the origin's.
  return pageUrlOrigin(value, { allowUserinfo: true, maxLength: 8192 }) ?? "invalid-origin";
}

function parsedCredentialObject(value: unknown): unknown {
  if (typeof value !== "string") {
    // Not metadata. Keep the attempt, but do not forward the raw value into the effect.
    return isPlainObject(value) ? destinationMetadata(value) : {};
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isPlainObject(parsed)) return destinationMetadata(parsed);
  } catch {
    return {};
  }
  return {};
}

export function sameSecretDestination(
  left: BotSecretDestination,
  right: BotSecretDestination,
): boolean {
  return (
    left.name === right.name &&
    left.origin === right.origin &&
    JSON.stringify(left.auth) === JSON.stringify(right.auth)
  );
}

export async function findBotSecret(prisma: PrismaClient, scope: BotSecretScope, name: string) {
  const row = await prisma.botSecret.findFirst({
    where: { ...scopeFields(scope), name },
    select: metadata,
  });
  return row ? normalizeSecretDestination(row) : null;
}

/**
 * A credential with this name that the run's person can see, and whether the run's agent may
 * already use it. One the agent can use wins; otherwise the person's own.
 */
export async function findVaultCredential(
  prisma: PrismaClient,
  scope: BotSecretScope,
  name: string,
) {
  const rows = await prisma.botSecret.findMany({
    where: { ...visibleBotSecrets(scope), name },
    select: {
      id: true,
      name: true,
      origin: true,
      auth: true,
      scope: true,
      userId: true,
      botId: true,
      grants: { select: { botId: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const usable = (row: (typeof rows)[number]) =>
    (row.botId === scope.botId || row.grants.some((grant) => grant.botId === scope.botId)) &&
    (row.scope === "space" || row.userId === scope.userId);
  const row =
    rows.find(usable) ?? rows.find((candidate) => candidate.userId === scope.userId) ?? rows[0];
  if (!row) return null;
  return {
    destination: normalizeSecretDestination(row),
    scope: row.scope,
    userId: row.userId,
    usable: usable(row),
  };
}

/** Where a credential is saved: a run's agent, or the Vault itself (no agent yet). */
export type BotSecretOwnerScope = Omit<BotSecretScope, "botId"> & { botId: string | null };

/** Refuses a value the destination's authentication cannot carry. */
export function assertStorableSecretValue(destination: BotSecretDestination, plaintext: string) {
  if (!plaintext || plaintext.length > 16_384) throw new Error("Invalid credential length");
  if (destination.auth.type === "login") decodeLoginSecret(plaintext);
  else if (destination.auth.type === "command") {
    // NUL cannot be an environment value. An unpaired surrogate cannot be percent-encoded
    // later, and that throw would abort every subsequent shell command for this bot.
    if (plaintext.includes("\0") || percentEncoded(plaintext) === undefined) {
      throw new Error(UNUSABLE_CREDENTIAL);
    }
  } else credentialHeader(destination, plaintext);
}

const MAX_CREDENTIALS = 100;

export async function prepareBotSecret(input: {
  prisma: PrismaClient;
  secretStore: SecretStore;
  scope: BotSecretOwnerScope;
  destination: BotSecretDestination;
  plaintext: string;
  /** Refuse instead of replacing a credential saved under this name, even by a concurrent call. */
  createOnly?: boolean;
  /** Who may use a new credential: runs for its owner only (the default), or for any member. */
  visibility?: "personal" | "space";
  /** Agents granted a new credential besides `scope.botId`. */
  grantBotIds?: string[];
}) {
  const { prisma, secretStore, scope, plaintext } = input;
  const destination = normalizeSecretDestination(input.destination);
  assertStorableSecretValue(destination, plaintext);
  const botId = scope.botId;

  const lookup = (client: PrismaClient | Prisma.TransactionClient) =>
    client.botSecret.findFirst({
      where: {
        ...(botId === null ? visibleBotSecrets(scope) : usableBotSecrets({ ...scope, botId })),
        name: destination.name,
      },
    });
  const countAll = (client: PrismaClient | Prisma.TransactionClient) =>
    client.botSecret.count({
      where:
        botId === null
          ? { spaceId: scope.spaceId, userId: scope.userId }
          : usableBotSecrets({ ...scope, botId }),
    });
  const existing = await lookup(prisma);
  function validate(row: typeof existing, count: number) {
    if (row && input.createOnly) throw new Error(SECRET_ALREADY_SAVED);
    if (row && !sameSecretDestination(normalizeSecretDestination(row), destination))
      throw new Error("Remove the existing credential before changing its destination");
    if (!row && count >= MAX_CREDENTIALS) throw new Error("Credential limit reached");
  }
  validate(existing, await countAll(prisma));
  const id = existing?.id ?? randomBytes(12).toString("hex");
  const stored = await secretStore.put(
    plaintext,
    {
      operationId: id,
      traceId: id,
      userId: scope.userId,
      spaceId: scope.spaceId,
      signal: new AbortController().signal,
    },
    { recordId: id },
  );
  return {
    id,
    ciphertext: stored.ciphertext,
    async store(tx: Prisma.TransactionClient) {
      if (botId === null) {
        const key = `vault:${scope.spaceId}:${scope.userId}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      } else await tx.$queryRaw`SELECT id FROM bots WHERE id = ${botId} FOR UPDATE`;
      const current = await lookup(tx);
      validate(current, await countAll(tx));
      if (botId !== null) {
        const conflict = await findCommandVariableConflict(tx, { ...scope, botId }, destination);
        if (conflict) {
          throw new Error(
            `Invalid credential destination — name: ${conflict} is already exported as $${commandVariableName(destination.name)}`,
          );
        }
      }
      if (current?.id !== existing?.id)
        throw Object.assign(new Error("Credential changed while saving; retry"), { code: "P2034" });
      if (current)
        await tx.botSecret.update({ where: { id }, data: { ciphertext: stored.ciphertext } });
      else {
        await tx.botSecret.create({
          data: {
            id,
            userId: scope.userId,
            spaceId: scope.spaceId,
            botId,
            scope: input.visibility ?? "personal",
            ...destination,
            ciphertext: stored.ciphertext,
          },
        });
        const granted = [...new Set(input.grantBotIds ?? [])].filter((other) => other !== botId);
        for (const grantedBotId of granted) {
          const clash = await commandVariableClash(
            tx,
            { spaceId: scope.spaceId, botId: grantedBotId, userId: scope.userId },
            destination,
          );
          if (clash) {
            throw new Error(
              `Invalid credential destination — name: ${clash} is already exported as $${commandVariableName(destination.name)}`,
            );
          }
        }
        if (granted.length)
          await tx.botSecretGrant.createMany({
            data: granted.map((grantedBotId) => ({
              id: randomBytes(12).toString("hex"),
              secretId: id,
              botId: grantedBotId,
              spaceId: scope.spaceId,
            })),
          });
      }
    },
  };
}

export async function storeBotSecret(
  input: Omit<Parameters<typeof prepareBotSecret>[0], "scope"> & { scope: BotSecretScope },
) {
  return withTransactionRetry(async () => {
    const prepared = await prepareBotSecret(input);
    return persistPreparedSecret(input.prisma, input.secretStore, prepared, () =>
      input.prisma.$transaction(async (tx) => {
        await prepared.store(tx);
        return getBotSecretMetadata(tx, input.scope, input.destination.name);
      }),
    );
  });
}

/** Save a generated login and the command variable holding its password together, or neither. */
async function storeLoginWithCommand(
  login: Parameters<typeof prepareBotSecret>[0],
  command: Parameters<typeof prepareBotSecret>[0],
) {
  const { prisma, secretStore } = login;
  await withTransactionRetry(async () => {
    const preparedLogin = await prepareBotSecret(login);
    // Prepared inside, so a refused command variable still cleans up the login's stored value.
    await persistPreparedSecret(prisma, secretStore, preparedLogin, async () => {
      const preparedCommand = await prepareBotSecret(command);
      await persistPreparedSecret(prisma, secretStore, preparedCommand, () =>
        prisma.$transaction(async (tx) => {
          await preparedLogin.store(tx);
          await preparedCommand.store(tx);
        }),
      );
    });
  });
}

/**
 * Generate a random value and save it as a new login (with its username, for one site) or a
 * command variable. A login can also save its password as a command variable, for a CLI. Only its redaction forms are returned, for the run to hide; the model sees
 * the saved name, never the value. An existing credential is never overwritten: a site or
 * service may already use its value.
 */
export async function generateBotSecret(input: {
  prisma: PrismaClient;
  secretStore: SecretStore;
  scope: BotSecretScope;
  args: unknown;
}): Promise<{ result: Record<string, unknown>; redactions?: string[] }> {
  const parsed = GenerateSecretInput.safeParse(input.args);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
    return { result: { error: `Invalid secret — ${detail}` } };
  }
  const { name, type, origin, username } = parsed.data;
  // The same normalization as request_secret, so a sign-up page URL saves its origin.
  const { destination, error } = resolveRequestSecretDestination({
    credential: { name, origin, auth: { type } },
  });
  if (!destination) return { result: { error } };
  const command: BotSecretDestination | undefined = parsed.data.command
    ? { name: loginCommandName(name), origin: "", auth: { type: "command" } }
    : undefined;
  const existing = await findBotSecret(input.prisma, input.scope, name);
  if (existing) {
    return {
      result: sameSecretDestination(existing, destination)
        ? {
            error:
              type === "login"
                ? "A login with this name is already saved for this site; fill it with browser_act fill_secret. Use another name for a different account."
                : "A command variable with this name is already saved; use it as it is, or use another name.",
            ...botSecretToolView(existing),
          }
        : { error: "A credential with this name already exists. Use another name." },
    };
  }
  if (command && (await findBotSecret(input.prisma, input.scope, command.name))) {
    return {
      result: {
        error: `A credential named ${command.name} already exists. Use another name for the login.`,
      },
    };
  }
  const value = generateSecretValue(parsed.data.rules ?? GeneratedSecretRules.parse({}));
  const save = {
    prisma: input.prisma,
    secretStore: input.secretStore,
    scope: input.scope,
    createOnly: true,
  };
  const plaintext = username ? encodeLoginSecret({ username, password: value }) : value;
  try {
    if (command) {
      await storeLoginWithCommand(
        { ...save, destination, plaintext },
        { ...save, destination: command, plaintext: value },
      );
    } else await storeBotSecret({ ...save, destination, plaintext });
    return {
      result: {
        saved: true,
        ...botSecretToolView(destination),
        ...(command ? { command: botSecretToolView(command) } : {}),
      },
      redactions: passwordRedactionForms(value),
    };
  } catch (error) {
    return { result: { error: error instanceof Error ? error.message : "Secret was not saved." } };
  }
}

export async function listBotSecrets(prisma: PrismaClient, scope: BotSecretScope) {
  const rows = await prisma.botSecret.findMany({
    where: scopeFields(scope),
    select: metadata,
    orderBy: { name: "asc" },
    take: 100,
  });
  return rows.map(botSecretToolView);
}

// Owner-facing view: destination and timestamps only, never the row id or ciphertext.
const ownerMetadata = { ...metadata, createdAt: true, updatedAt: true } as const;

export function listBotSecretMetadata(prisma: PrismaClient, scope: BotSecretScope) {
  return prisma.botSecret.findMany({
    where: scopeFields(scope),
    select: ownerMetadata,
    orderBy: { name: "asc" },
    take: 100,
  });
}

export function getBotSecretMetadata(
  client: PrismaClient | Prisma.TransactionClient,
  scope: BotSecretScope,
  name: string,
) {
  return client.botSecret.findFirst({
    where: { ...scopeFields(scope), name },
    select: ownerMetadata,
  });
}

/**
 * Takes a credential away from this agent. One that other agents also use stays for them; only
 * the last agent's removal deletes the value.
 */
export async function forgetBotSecret(prisma: PrismaClient, scope: BotSecretScope, name: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bots WHERE id = ${scope.botId} FOR UPDATE`;
    const rows = await tx.botSecret.findMany({
      where: { ...scopeFields(scope), name },
      select: { id: true, botId: true, grants: { select: { botId: true } } },
    });
    for (const row of rows) {
      const others = new Set(row.grants.map((grant) => grant.botId));
      if (row.botId) others.add(row.botId);
      others.delete(scope.botId);
      if (others.size === 0) {
        await tx.botSecret.delete({ where: { id: row.id } });
        continue;
      }
      await tx.botSecretGrant.deleteMany({ where: { secretId: row.id, botId: scope.botId } });
      if (row.botId === scope.botId) {
        await tx.botSecret.update({ where: { id: row.id }, data: { botId: null } });
      }
    }
  });
  return { removed: true };
}

/** Credentials are resolved only inside this destination-bound HTTP boundary. */
export async function requestWithBotSecret(input: {
  prisma: PrismaClient;
  secretStore: SecretStore;
  scope: BotSecretScope & { runId?: string };
  request: unknown;
  signal: AbortSignal;
  remote?: RemoteTransportDependencies;
  registerRedactions?: (values: string[]) => void;
}): Promise<unknown> {
  const request = SecretHttpRequest.parse(input.request);
  const row = await input.prisma.botSecret.findFirst({
    where: { ...scopeFields(input.scope), name: request.name },
  });
  if (!row) return { error: "Credential is unavailable. Use request_secret to save it first." };
  const destination = normalizeSecretDestination(row);
  if (destination.auth.type === "login") {
    return { error: "Website logins can only be filled into their site with browser_act." };
  }
  if (destination.auth.type === "command") {
    return {
      error: `${UNUSABLE_CREDENTIAL}. Command variables are only available to shell commands, as $${commandVariableName(destination.name)}.`,
    };
  }
  const url = new URL(request.url);
  if (url.origin !== destination.origin || url.username || url.password || url.hash) {
    return { error: "This credential cannot be sent to that destination." };
  }
  const controller = new AbortController();
  const signal = combineSignals(input.signal, controller.signal, AbortSignal.timeout(30_000));
  const plaintext = await input.secretStore.load(row.ciphertext, {
    recordId: row.id,
    signal,
  });
  const headers = new Headers({ accept: "application/json", "content-type": request.contentType });
  const { name: headerName, value: headerValue } = credentialHeader(destination, plaintext);
  const redactions = [
    ...new Set([
      plaintext,
      headerValue,
      Buffer.from(plaintext).toString("base64"),
      encodeURIComponent(plaintext),
      headerValue.replace(/^Basic /, ""),
    ]),
  ].filter(Boolean);
  input.registerRedactions?.(redactions);
  // The safe fetch refuses plain-HTTP and private hosts outright. A credential
  // saved under the owner's private-HTTP opt-in was validated against exactly
  // those rules at save time, and the request URL is pinned to its origin, so
  // deliver it through the inverted transport instead — it re-checks that every
  // resolved address is private (metadata endpoints stay blocked) and pins the
  // connection to the validated answer.
  const privateHttpDestination =
    allowPrivateHttpSecretOrigins() &&
    url.protocol === "http:" &&
    isPrivateNetworkHost(url.hostname);
  const fetch = privateHttpDestination
    ? createPrivateNetworkFetch(input.remote?.fetch, input.remote?.resolveHostname)
    : createSafeRemoteFetch(input.remote?.fetch, input.remote?.resolveHostname);
  try {
    headers.set(headerName, headerValue);
    const response = await withAbort(
      fetch(url, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
        signal,
      }),
      signal,
    );
    const bytes = await readBodyCapped(response, 1_000_000, signal);
    const text = new TextDecoder().decode(bytes);
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* Plain text responses are supported. */
    }
    // Redact before truncating, so an output boundary cannot expose part of a value.
    const safe = JSON.stringify(redactConnectorPayload(body, redactions));
    await recordBotSecretUse(
      input.prisma,
      input.scope,
      row,
      destination.origin,
      response.status < 400 ? "ok" : "failed",
    );
    return {
      status: response.status,
      body: safe.length > 20_000 ? safe.slice(0, 20_000) : JSON.parse(safe),
      truncated: safe.length > 20_000,
    };
  } catch {
    await recordBotSecretUse(input.prisma, input.scope, row, destination.origin, "failed");
    return { error: "Authenticated request failed. Check the destination and credential." };
  } finally {
    controller.abort();
    await withAbort(fetch.close(), AbortSignal.timeout(1000)).catch(() => undefined);
  }
}

export type LoginField = "username" | "password";
const MIN_REDACTED_USERNAME = 6;
const MIN_REDACTED_PASSWORD_EVERY_RUN = MIN_REDACTED_USERNAME;

function passwordRedactionForms(password: string): string[] {
  return [
    ...new Set([
      ...commandRedactionForms(password),
      // A submitted form encodes `+` for spaces and escapes `!'()~`, unlike encodeURIComponent.
      new URLSearchParams({ v: password }).toString().slice(2),
    ]),
  ];
}

/**
 * Redaction forms of the password of every website login saved for this bot. A filled login
 * stays on its page after the run that filled it, so each run hides the passwords before any
 * tool output reaches the model. Usernames stay visible outside the filling run: one is often
 * the user's own email, which ordinary tasks need. Only login rows are decrypted.
 */
export async function loadLoginPasswordRedactions(
  prisma: PrismaClient,
  secretStore: Pick<SecretStore, "load">,
  scope: BotSecretScope,
): Promise<string[]> {
  // Every saved login, however many other credentials the bot has.
  const rows = await prisma.botSecret.findMany({
    where: { ...scopeFields(scope), auth: { path: ["type"], equals: "login" } },
    select: { id: true, auth: true, ciphertext: true },
  });
  const forms = new Set<string>();
  for (const row of rows) {
    if (BotSecretAuth.safeParse(row.auth).data?.type !== "login") continue;
    try {
      const { password } = decodeLoginSecret(await secretStore.load(row.ciphertext, row.id));
      // Every run would mangle each occurrence of a short password; the filling run still hides it.
      if (password.length < MIN_REDACTED_PASSWORD_EVERY_RUN) continue;
      for (const form of passwordRedactionForms(password)) forms.add(form);
    } catch {
      // Like an unreadable command variable, it must not stop every computer tool. The id only:
      // an operator can see which login is no longer hidden. Not under a "secret" key, which
      // the logger scrubs.
      getLogger().warn("saved login could not be loaded for redaction", { loginId: row.id });
    }
  }
  return [...forms];
}

/**
 * Resolve one field of a saved website login for a page fill. The caller must pass `origin` to
 * the page browser, which refuses to fill unless the page is still on that origin.
 */
export async function resolveLoginFill(input: {
  prisma: PrismaClient;
  secretStore: SecretStore;
  scope: BotSecretScope & { runId?: string };
  name: string;
  field: LoginField;
}): Promise<{ text: string; origin: string; redactions: string[] } | { error: string }> {
  const row = await input.prisma.botSecret.findFirst({
    where: { ...scopeFields(input.scope), name: input.name },
  });
  if (!row) return { error: "Login is unavailable. Use request_secret to save it first." };
  if (isCommandCredential(row.auth)) {
    return {
      error: `${UNUSABLE_CREDENTIAL}. Command variables are only available to shell commands.`,
    };
  }
  // Checked on the stored origin itself, so the private-LAN HTTP allowance cannot widen a login.
  let storedOrigin: URL;
  try {
    storedOrigin = new URL(row.origin);
  } catch {
    return { error: "Website logins can only be filled on an HTTPS origin." };
  }
  if (storedOrigin.protocol !== "https:") {
    return { error: "Website logins can only be filled on an HTTPS origin." };
  }
  const destination = normalizeSecretDestination(row);
  if (destination.auth.type !== "login") {
    return { error: "This credential is not a website login." };
  }
  if (destination.origin !== storedOrigin.origin) {
    return { error: "Website logins can only be filled on an HTTPS origin." };
  }
  const login = decodeLoginSecret(await input.secretStore.load(row.ciphertext, row.id));
  // The password is the use; the username alone is not a credential.
  if (input.field === "password") {
    await recordBotSecretUse(input.prisma, input.scope, row, destination.origin, "ok");
  }
  return {
    text: login[input.field],
    origin: destination.origin,
    // Redaction is substring replacement, so a short username would mangle unrelated text.
    redactions: [
      ...new Set(
        [login.password, encodeURIComponent(login.password)].concat(
          login.username.length >= MIN_REDACTED_USERNAME
            ? [login.username, encodeURIComponent(login.username)]
            : [],
        ),
      ),
    ],
  };
}
