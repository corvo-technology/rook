import { randomUUID } from "node:crypto";
import {
  databaseConfigFromInput,
  queryDatabase,
  redactDatabaseError,
  sharedPgDatabaseDriver,
  validateDatabaseConfig,
} from "@corvo/adapters";
import type { DatabaseConnection } from "@corvo/contracts";
import type { Prisma } from "@corvo/db";
import { IsolationError } from "@corvo/db";
import { ORPCError } from "@orpc/server";
import { mayUsePrivateEndpoint } from "../mcp-servers.js";
import { requireSpacePermission } from "../space-owner.js";
import type { RouterContext } from "./context.js";
import { isUniqueViolation } from "./shared.js";

type Row = Prisma.DatabaseConnectionGetPayload<{
  include: { grants: { select: { botId: true } } };
}>;

function toDto(row: Row): DatabaseConnection {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    database: row.database,
    user: row.username,
    sslMode: row.sslMode as DatabaseConnection["sslMode"],
    testedOk: row.testedOk,
    botIds: row.grants.map((grant) => grant.botId),
    createdAt: row.createdAt.toISOString(),
  };
}

const INCLUDE = { grants: { select: { botId: true } } } as const;

/** Read-only database connections: who may add them is `manage_connections`; who may use them is the grant. */
export function databaseRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const driver = () => deps.databaseDriver ?? sharedPgDatabaseDriver(mayUsePrivateEndpoint(deps));
  const manage = (actor: { spaceId: string; userId: string }) =>
    requireSpacePermission(deps.prisma, actor, "manage_connections");

  /** One `SELECT 1` through the same path agents use, so a saved connection is one that works. */
  async function probe(target: Parameters<typeof queryDatabase>[1]): Promise<string | undefined> {
    const result = await queryDatabase(driver(), target, "select 1");
    return "error" in result ? result.error : undefined;
  }

  return {
    databases: {
      list: authed.databases.list.handler(async ({ context }) => {
        await manage(context.actor);
        const rows = await deps.prisma.databaseConnection.findMany({
          where: { spaceId: context.actor.spaceId },
          include: INCLUDE,
          orderBy: { createdAt: "asc" },
        });
        return rows.map(toDto);
      }),
      create: authed.databases.create.handler(async ({ context, input }) => {
        const { actor } = context;
        await manage(actor);
        let config: ReturnType<typeof databaseConfigFromInput>;
        try {
          config = databaseConfigFromInput(input);
        } catch (error) {
          throw new ORPCError("BAD_REQUEST", {
            message: error instanceof Error ? error.message : "That connection is not valid",
          });
        }
        const invalid = validateDatabaseConfig(config);
        if (invalid) throw new ORPCError("BAD_REQUEST", { message: invalid });
        const probeId = `test-${randomUUID()}`;
        const failure = await probe({ id: probeId, ...config });
        await driver().evict(probeId);
        if (failure) {
          throw new ORPCError("BAD_REQUEST", {
            message: redactDatabaseError(failure, [config.password]),
          });
        }
        const stored = await deps.secrets.put(config.password, {
          operationId: "databases.create",
          traceId: "databases.create",
          spaceId: actor.spaceId,
          userId: actor.userId,
          signal: context.signal ?? new AbortController().signal,
        });
        try {
          const row = await deps.prisma.$transaction(async (tx) => {
            await tx.secret.create({
              data: {
                id: stored.id,
                spaceId: actor.spaceId,
                userId: actor.userId,
                kind: "database",
                ciphertext: stored.ciphertext,
              },
            });
            return tx.databaseConnection.create({
              data: {
                spaceId: actor.spaceId,
                userId: actor.userId,
                name: input.name,
                host: config.host,
                port: config.port,
                database: config.database,
                username: config.user,
                sslMode: config.sslMode,
                secretId: stored.id,
                testedOk: true,
                testedAt: new Date(),
              },
              include: INCLUDE,
            });
          });
          return toDto(row);
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ORPCError("CONFLICT", { message: "A connection with that name exists" });
          }
          throw error;
        }
      }),
      test: authed.databases.test.handler(async ({ context, input }) => {
        const { actor } = context;
        await manage(actor);
        const row = await deps.prisma.databaseConnection.findFirst({
          where: { id: input.id, spaceId: actor.spaceId },
          include: { secret: true },
        });
        if (!row) throw new IsolationError();
        const password = await deps.secrets.load(row.secret.ciphertext, row.secret.id);
        const failure = await probe({
          id: row.id,
          host: row.host,
          port: row.port,
          database: row.database,
          user: row.username,
          password,
          sslMode: row.sslMode as DatabaseConnection["sslMode"],
        });
        const updated = await deps.prisma.databaseConnection.update({
          where: { id: row.id },
          data: { testedOk: !failure, testedAt: new Date() },
          include: INCLUDE,
        });
        return toDto(updated);
      }),
      remove: authed.databases.remove.handler(async ({ context, input }) => {
        const { actor } = context;
        await manage(actor);
        await deps.prisma.$transaction(async (tx) => {
          const row = await tx.databaseConnection.findFirst({
            where: { id: input.id, spaceId: actor.spaceId },
            select: { id: true, secretId: true },
          });
          if (!row) return;
          // Grants go with the connection; the password goes with it too.
          await tx.databaseConnection.delete({ where: { id: row.id } });
          await tx.secret.deleteMany({ where: { id: row.secretId, spaceId: actor.spaceId } });
        });
        await driver().evict(input.id);
        return { ok: true as const };
      }),
      setGrants: authed.databases.setGrants.handler(async ({ context, input }) => {
        const { actor } = context;
        await manage(actor);
        const botIds = [...new Set(input.botIds)];
        const row = await deps.prisma.$transaction(async (tx) => {
          const connection = await tx.databaseConnection.findFirst({
            where: { id: input.id, spaceId: actor.spaceId },
            select: { id: true },
          });
          if (!connection) throw new IsolationError();
          const bots = await tx.bot.findMany({
            where: { id: { in: botIds }, spaceId: actor.spaceId, archivedAt: null },
            select: { id: true },
          });
          if (bots.length !== botIds.length) throw new IsolationError();
          await tx.botDatabaseGrant.deleteMany({ where: { connectionId: connection.id } });
          if (botIds.length) {
            await tx.botDatabaseGrant.createMany({
              data: botIds.map((botId) => ({
                spaceId: actor.spaceId,
                botId,
                connectionId: connection.id,
              })),
            });
          }
          return tx.databaseConnection.findUniqueOrThrow({
            where: { id: connection.id },
            include: INCLUDE,
          });
        });
        return toDto(row);
      }),
    },
  };
}
