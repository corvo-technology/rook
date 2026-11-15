import type { McpServer } from "@corvo/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { Database, Mail, Plus, Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { connectMcpOauth, MCP_OAUTH_CHANNEL } from "../lib/mcp-connect";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { AccessSheet } from "./connections/AccessSheet";
import { ConnectSheet } from "./connections/ConnectSheet";
import type { AccessLevelChoice, ConnectionItem } from "./connections/connection-model";
import { levelsFor, usedByNames } from "./connections/connection-model";
import { ErrorDetails } from "./connections/ErrorDetails";
import { useConnections } from "./connections/use-connections";

const TONE_DOT = {
  ok: "bg-success",
  warn: "bg-warning",
  error: "bg-destructive",
  idle: "bg-muted-foreground/50",
} as const;

function ConnectionIcon({ item }: { item: ConnectionItem }) {
  const [failed, setFailed] = useState(false);
  if (item.iconUrl && !failed) {
    return (
      <img
        src={item.iconUrl}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="size-9 shrink-0 rounded-xl bg-accent object-contain"
        onError={() => setFailed(true)}
      />
    );
  }
  const Icon = item.kind === "database" ? Database : item.kind === "mailbox" ? Mail : Server;
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-muted-foreground">
      <Icon aria-hidden="true" className="size-4" />
    </span>
  );
}

type Sheet =
  | { kind: "connect"; editing: McpServer | null }
  | { kind: "access"; item: ConnectionItem }
  | null;

/**
 * Every connection in one list, whatever it is: an app, an MCP server, a database or a mailbox.
 * Adding is a sheet and who may use one is a sheet, so nothing here is a form or a wall of agents.
 */
export function ConnectionsPage({
  editServerId,
  stdioEnabled,
}: {
  /** Opens with this server's form, as an import's setup checklist does. */
  editServerId?: string;
  stdioEnabled: boolean;
}) {
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [removing, setRemoving] = useState<ConnectionItem | null>(null);
  const [testing, setTesting] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const { items, access, agents, canManage, failed, refresh } = useConnections({
    testing: testing.size > 0,
  });
  const servers = items.flatMap((item) => (item.server ? [item.server] : []));

  const opened = useRef(false);
  useEffect(() => {
    if (!editServerId || opened.current) return;
    const server = servers.find((item) => item.id === editServerId);
    if (!server) return;
    opened.current = true;
    setSheet({ kind: "connect", editing: server });
  }, [editServerId, servers]);

  useEffect(() => {
    // The sign-in popup reports back over a channel: provider login pages sever window.opener.
    const channel = new BroadcastChannel(MCP_OAUTH_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === "mcp-oauth-complete") {
        void refresh().catch(() => undefined);
      }
    };
    return () => channel.close();
  }, [refresh]);

  async function attempt(fallback: string, run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
    } catch (failure) {
      setError(errorText(failure, fallback));
    }
  }

  const signIn = (server: McpServer) =>
    attempt(t`Could not start OAuth`, async () => {
      const result = await connectMcpOauth(server.id);
      await refresh();
      if (result === "already_connected") {
        setError(t`This server is already connected. Disconnect it first to authorize again.`);
      } else if (result === "authorization_not_requested") {
        setError(t`This server did not request browser authorization.`);
      }
    });

  const disconnect = (server: McpServer) =>
    attempt(t`Could not disconnect OAuth`, async () => {
      await rpc.mcp.oauth.disconnect({ serverId: server.id });
      await refresh();
    });

  const test = (item: ConnectionItem) =>
    attempt(t`Could not test MCP server`, async () => {
      setTesting((current) => new Set(current).add(item.id));
      try {
        if (item.kind === "database") {
          await rpc.databases.test({ id: item.id });
        } else {
          const updated = await rpc.mcp.servers.test({ id: item.id });
          if (updated.health.status === "ok") toast.success(t`${updated.name} is running`);
          else if (updated.health.status === "error")
            toast.error(t`${updated.name} is not working`);
        }
        await refresh();
      } finally {
        setTesting((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }
    });

  const remove = (item: ConnectionItem) =>
    attempt(t`Could not delete MCP server`, async () => {
      if (item.kind === "mcp") await rpc.mcp.servers.remove({ id: item.id });
      else if (item.kind === "database") await rpc.databases.remove({ id: item.id });
      else await rpc.mailboxes.remove({ id: item.id });
      await refresh();
    });

  async function setLevel(item: ConnectionItem, botIds: string[], level: AccessLevelChoice) {
    if (botIds.length === 0) return;
    await rpc.access.set({ kind: item.kind, connectionId: item.id, botIds, level });
    await refresh();
  }

  const botName = new Map(agents.map((bot) => [bot.id, bot.name]));
  const shownError = error ?? (failed ? t`Could not load MCP servers` : null);

  return (
    <div data-testid="connections-page" className="space-y-4">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={() => setSheet({ kind: "connect", editing: null })}
        >
          <Plus aria-hidden="true" />
          <Trans>Connect</Trans>
        </Button>
      </div>
      {shownError ? (
        <p role="alert" className="text-[13px] text-destructive">
          {shownError}
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {items.map((item) => {
            const levels = levelsFor(access, item.kind, item.id);
            const names = agents.flatMap((bot) =>
              levels.has(bot.id) ? [botName.get(bot.id)!] : [],
            );
            const usedBy = usedByNames(names, i18n.locale);
            const server = item.server;
            const signable =
              server && !item.otherOwner && (server.transport !== "stdio" || server.oauthClientId);
            return (
              <li
                key={`${item.kind}:${item.id}`}
                data-testid="connection-row"
                data-kind={item.kind}
                className="flex items-center gap-3 px-4 py-3"
              >
                <ConnectionIcon item={item} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium text-foreground">
                    {item.name}
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
                    <span
                      aria-hidden="true"
                      className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[item.tone]}`}
                    />
                    <span className="truncate">
                      {testing.has(item.id) ? t`Testing…` : item.status}
                    </span>
                  </div>
                  {server?.health.status === "error" && server.health.message ? (
                    <ErrorDetails message={server.health.message} />
                  ) : null}
                  {usedBy ? (
                    <div className="truncate text-[12.5px] text-muted-foreground">
                      <Trans>Used by {usedBy}</Trans>
                    </div>
                  ) : null}
                </div>
                {item.otherOwner ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSheet({ kind: "access", item })}
                  >
                    <Trans>Access</Trans>
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={t`More`}
                    className="rounded-full px-2 py-1 text-[14px] text-muted-foreground hover:bg-accent"
                  >
                    ⋯
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {signable ? (
                      <DropdownMenuItem onClick={() => void signIn(server)}>
                        {server.oauthStatus === "none" ? (
                          <Trans>Connect OAuth</Trans>
                        ) : (
                          <Trans>Reconnect OAuth</Trans>
                        )}
                      </DropdownMenuItem>
                    ) : null}
                    {signable && server.oauthStatus !== "none" ? (
                      <DropdownMenuItem onClick={() => void disconnect(server)}>
                        <Trans>Disconnect</Trans>
                      </DropdownMenuItem>
                    ) : null}
                    {server ? (
                      <DropdownMenuItem
                        onClick={() => setSheet({ kind: "connect", editing: server })}
                      >
                        <Trans>Edit</Trans>
                      </DropdownMenuItem>
                    ) : null}
                    {item.kind !== "mailbox" ? (
                      <DropdownMenuItem
                        disabled={testing.has(item.id) || server?.health.status === "installing"}
                        onClick={() => void test(item)}
                      >
                        <Trans>Test connection</Trans>
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem variant="destructive" onClick={() => setRemoving(item)}>
                      <Trans>Delete</Trans>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      ) : null}
      {sheet?.kind === "connect" ? (
        <ConnectSheet
          editing={sheet.editing}
          servers={servers}
          canManage={canManage}
          stdioEnabled={stdioEnabled}
          onChanged={() => void refresh().catch(() => undefined)}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet?.kind === "access" ? (
        <AccessSheet
          item={sheet.item}
          agents={agents}
          levels={levelsFor(access, sheet.item.kind, sheet.item.id)}
          onChange={(botIds, level) => setLevel(sheet.item, botIds, level)}
          onClose={() => setSheet(null)}
        />
      ) : null}
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? null : setRemoving(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Remove {removing?.name}?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">{removing?.name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removing) void remove(removing);
                setRemoving(null);
              }}
            >
              <Trans>Delete</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
