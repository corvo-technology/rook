import { createHash, randomBytes } from "node:crypto";
import type { McpAccessKey, McpAccessKeyCreateInput, McpAccessLevel } from "@corvo/contracts";
import { MCP_KEY_PREFIX, MCP_KEYS_MAX } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";

type KeyDb = Pick<PrismaClient, "mcpAccessKey" | "spaceMember">;

export class McpAccessKeyLimitError extends Error {
  constructor() {
    super(`At most ${MCP_KEYS_MAX} keys can be active at once.`);
  }
}
export class McpAccessKeyNotFoundError extends Error {
  constructor() {
    super("Key not found");
  }
}
export class McpAccessKeySpaceError extends Error {
  constructor() {
    super("Space not found");
  }
}

/** Characters of a key kept in the clear: the marker and a few more, enough to tell keys apart. */
const PREFIX_LENGTH = MCP_KEY_PREFIX.length + 4;
/** A busy client would otherwise write on every call, so "last used" moves at most this often. */
const LAST_USED_GRANULARITY_MS = 60_000;

/** A new random key: 256 bits, so a digest of it cannot be guessed or tabulated. */
export function generateMcpAccessSecret(): string {
  return `${MCP_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** What is stored in place of the key. */
export function hashMcpAccessSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

type KeyRow = {
  id: string;
  name: string;
  level: string;
  spaceId: string | null;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  space?: { name: string } | null;
};

function viewOf(row: KeyRow): McpAccessKey {
  return {
    id: row.id,
    name: row.name,
    level: row.level as McpAccessLevel,
    spaceId: row.spaceId,
    spaceName: row.space?.name ?? null,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * Makes a key for `userId`. Run inside that user's tenant context. A key limited to a space must
 * name one the user belongs to; the whole key comes back here once and is not stored.
 */
export async function createMcpAccessKey(
  db: KeyDb,
  userId: string,
  input: McpAccessKeyCreateInput,
): Promise<{ key: McpAccessKey; secret: string }> {
  if (input.spaceId) {
    const member = await db.spaceMember.findFirst({
      where: { userId, spaceId: input.spaceId },
      select: { id: true },
    });
    if (!member) throw new McpAccessKeySpaceError();
  }
  const active = await db.mcpAccessKey.count({ where: { userId, revokedAt: null } });
  if (active >= MCP_KEYS_MAX) throw new McpAccessKeyLimitError();
  const secret = generateMcpAccessSecret();
  const row = await db.mcpAccessKey.create({
    data: {
      userId,
      name: input.name,
      level: input.level,
      spaceId: input.spaceId ?? null,
      secretHash: hashMcpAccessSecret(secret),
      prefix: secret.slice(0, PREFIX_LENGTH),
    },
    include: { space: { select: { name: true } } },
  });
  return { key: viewOf(row), secret };
}

/** The user's keys, newest first, revoked ones included so their history stays readable. */
export async function listMcpAccessKeys(db: KeyDb, userId: string): Promise<McpAccessKey[]> {
  const rows = await db.mcpAccessKey.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { space: { select: { name: true } } },
    take: 100,
  });
  return rows.map(viewOf);
}

/** Ends a key at once. Revoking one already revoked is not an error. */
export async function revokeMcpAccessKey(
  db: KeyDb,
  userId: string,
  keyId: string,
  now = new Date(),
): Promise<void> {
  const done = await db.mcpAccessKey.updateMany({
    where: { id: keyId, userId, revokedAt: null },
    data: { revokedAt: now },
  });
  if (done.count > 0) return;
  const exists = await db.mcpAccessKey.findFirst({ where: { id: keyId, userId } });
  if (!exists) throw new McpAccessKeyNotFoundError();
}

export type McpKeyIdentity = {
  id: string;
  userId: string;
  name: string;
  level: McpAccessLevel;
  spaceId: string | null;
  lastUsedAt: Date | null;
};

/**
 * Finds the live key a presented secret belongs to. The caller runs this before it knows whose key
 * it is, so it is a system-context read; revoked keys are never returned.
 */
export async function findMcpAccessKey(
  db: Pick<PrismaClient, "mcpAccessKey">,
  secret: string,
): Promise<McpKeyIdentity | null> {
  if (!secret.startsWith(MCP_KEY_PREFIX)) return null;
  const row = await db.mcpAccessKey.findUnique({
    where: { secretHash: hashMcpAccessSecret(secret) },
    select: {
      id: true,
      userId: true,
      name: true,
      level: true,
      spaceId: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
  if (!row || row.revokedAt) return null;
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    level: row.level as McpAccessLevel,
    spaceId: row.spaceId,
    lastUsedAt: row.lastUsedAt,
  };
}

/** Notes that a key was just used, when the last note is old enough to matter. */
export async function touchMcpAccessKey(
  db: Pick<PrismaClient, "mcpAccessKey">,
  key: Pick<McpKeyIdentity, "id" | "lastUsedAt">,
  now = new Date(),
): Promise<void> {
  if (key.lastUsedAt && now.getTime() - key.lastUsedAt.getTime() < LAST_USED_GRANULARITY_MS) return;
  await db.mcpAccessKey.updateMany({
    where: { id: key.id, revokedAt: null },
    data: { lastUsedAt: now },
  });
}
