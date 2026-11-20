import type { Bot, Connection, ConnectionCatalogItem, Group, Routine } from "@corvo/contracts";
import { buildComposerMentionOptions, mentionConnectorsFrom } from "@corvo/core";
import { useLingui } from "@lingui/react/macro";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { connectedAppMarks } from "../../lib/connected-apps";
import { cronLabels } from "../../lib/cron";
import type { SpaceQueries } from "../../lib/query";
import { queryClient } from "../../lib/query";
import type { createSpaceRpc } from "../../lib/rpc";
import { useSpaceHint } from "../../lib/space-hints";

const NO_PEOPLE: Array<{ id: string; name: string; image: string | null }> = [];

function routineListData(results: Array<{ data?: Routine[] }>) {
  return results.map((result) => result.data);
}

function connectedAppMarksOf(
  data: { catalog: ConnectionCatalogItem[] | null; connections: Connection[] | null } | undefined,
) {
  return data?.catalog && data.connections ? connectedAppMarks(data.catalog, data.connections) : [];
}

/** What the composer can @mention, and the connected apps the sidebar footer shows. */
export function useComposerMentions({
  rpc,
  queries,
  bots,
  groups,
  inGroup,
  groupId,
  botId,
  initialBotsLoaded,
  routinesWanted,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  queries: SpaceQueries;
  bots: Bot[];
  groups: Group[];
  inGroup: boolean;
  groupId: string | undefined;
  /** The agent whose own chat is open; people can be named there only if they can read it. */
  botId: string | undefined;
  initialBotsLoaded: boolean;
  /** Routines are one call per agent: read them only once the mention list has been opened. */
  routinesWanted: boolean;
}) {
  const { i18n } = useLingui();
  const routineLists = useQueries({
    queries: bots.map((bot) => ({
      ...queries.routines.list.queryOptions({ input: { botId: bot.id } }),
      enabled: routinesWanted,
    })),
    combine: routineListData,
  });
  const routinesKey = queries.routines.list.key();
  useSpaceHint("routines", () => {
    if (routinesWanted) void queryClient.invalidateQueries({ queryKey: routinesKey });
  });
  const mentionRoutines = useMemo(
    () =>
      bots.flatMap((bot, index) =>
        (routineLists[index] ?? []).map((routine) => ({ ...routine, botName: bot.name })),
      ),
    [bots, routineLists],
  );
  const peopleTarget = groupId ? { groupId } : botId ? { botId } : undefined;
  const peopleQuery = useQuery({
    ...queries.threads.people.queryOptions({ input: peopleTarget ?? {} }),
    enabled: initialBotsLoaded && peopleTarget !== undefined,
  });
  const mentionPeople = useMemo(
    () =>
      (peopleTarget ? peopleQuery.data : undefined)?.map((person) => ({
        id: person.userId,
        name: person.name,
        image: person.image,
      })) ?? NO_PEOPLE,
    [peopleQuery.data, peopleTarget],
  );
  const composerConnections = useQuery({
    queryKey: [...queries.connections.catalog.queryKey({ input: {} }), "with-connections"],
    // The catalog call reconciles connection rows, so list them after it.
    queryFn: async () => {
      const catalog = await rpc.connections.catalog({}).catch(() => null);
      const connections = await rpc.connections.list().catch(() => null);
      return { catalog, connections };
    },
    enabled: initialBotsLoaded,
  });
  // A changed roster refreshes connection data too, as it did before it was cached.
  const mentionBotsKey = useMemo(
    () => bots.map((bot) => `${bot.id}:${bot.name}`).join(","),
    [bots],
  );
  const connectionsRoster = useRef<string | null>(null);
  useEffect(() => {
    if (!initialBotsLoaded) return;
    const previous = connectionsRoster.current;
    connectionsRoster.current = mentionBotsKey;
    if (previous !== null && previous !== mentionBotsKey) void composerConnections.refetch();
  }, [initialBotsLoaded, mentionBotsKey]);
  const [footerLogos, setFooterLogos] = useState(() =>
    connectedAppMarksOf(composerConnections.data),
  );
  useEffect(() => {
    if (composerConnections.data?.catalog && composerConnections.data.connections) {
      setFooterLogos(connectedAppMarksOf(composerConnections.data));
    }
  }, [composerConnections.data]);
  const mentionConnectors = useMemo(() => {
    const { catalog, connections } = composerConnections.data ?? {};
    return bots.length === 0 ? [] : mentionConnectorsFrom(connections ?? [], catalog ?? []);
  }, [bots.length, composerConnections.data]);
  const composerMentionTargets = useMemo(
    () =>
      buildComposerMentionOptions({
        query: "",
        includeEveryone: inGroup,
        currentGroupId: groupId,
        bots: bots.map((bot) => ({ id: bot.id, name: bot.name, color: bot.color })),
        people: mentionPeople,
        groups: groups.map((group) => ({ id: group.id, name: group.name })),
        routines: mentionRoutines.map((routine) => ({
          id: routine.id,
          name: routine.name,
          crons: routine.crons,
          botId: routine.botId,
          botName: routine.botName,
        })),
        connectors: mentionConnectors,
        cronLabels: cronLabels(i18n.locale),
      }),
    [
      bots,
      groupId,
      groups,
      i18n.locale,
      inGroup,
      mentionConnectors,
      mentionPeople,
      mentionRoutines,
    ],
  );
  return { composerMentionTargets, mentionPeople, footerLogos, setFooterLogos };
}
