import { enableAreaWatches, presetToolsOf } from "@corvo/adapters";
import type { Actor } from "@corvo/contracts";
import { runAsSystem } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { RouterDeps } from "./router.js";

/**
 * A connection just became connected: turn on the change triggers of the agents that this
 * integration's calendar or inbox tools can serve. Runs after the response and never fails the
 * connect; a miss is retried the next time any connection connects.
 */
export function enableAreaWatchesFor(
  deps: Pick<RouterDeps, "prisma" | "connectors">,
  actor: Pick<Actor, "spaceId" | "userId">,
  connectionId: string,
): void {
  void runAsSystem("enable area watches after a connection", async () => {
    const row = await deps.prisma.connection.findFirst({
      where: {
        id: connectionId,
        spaceId: actor.spaceId,
        userId: actor.userId,
        status: "connected",
      },
    });
    const connector = row ? deps.connectors.managed(row.connectorId) : undefined;
    if (!row || !connector) return;
    const tools = await connector.discoverTools({
      operationId: "connections.area-watches",
      traceId: "connections.area-watches",
      spaceId: actor.spaceId,
      userId: actor.userId,
      signal: AbortSignal.timeout(20_000),
      connectedConnections: [
        {
          id: row.id,
          connectorId: row.connectorId,
          externalId: row.provider,
          displayName: row.displayName,
          providerRef: row.providerRef ?? undefined,
        },
      ],
      connectedProviders: [row.provider],
    });
    await enableAreaWatches({ prisma: deps.prisma }, actor, presetToolsOf(tools));
  }).catch((error) => getLogger().error("area watches", error));
}
