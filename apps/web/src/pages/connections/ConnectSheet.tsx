import type { McpServer } from "@corvo/contracts";
import { Button, Input, Sheet, SheetContent, SheetHeader, SheetTitle } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight, Database, Mail, Server } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { AppCatalogGrid } from "../AppCatalogGrid";
import { DatabaseForm } from "./DatabaseForm";
import { MailboxForm } from "./MailboxForm";
import { McpServerForm } from "./McpServerForm";

type View = "pick" | "mcp" | "database" | "mailbox";

function Choice({
  icon,
  children,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-start text-[15px] font-medium text-foreground hover:bg-accent/60"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground rtl:rotate-180" />
    </button>
  );
}

/**
 * Adds a connection: an app from the catalog, an MCP server by URL, a database or a mailbox. It
 * also edits the MCP server it is given. Nothing here is on the page until it is asked for.
 */
export function ConnectSheet({
  editing,
  servers,
  canManage,
  stdioEnabled,
  onChanged,
  onClose,
}: {
  editing: McpServer | null;
  servers: readonly McpServer[];
  /** Whether this member may add a database. */
  canManage: boolean;
  stdioEnabled: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [view, setView] = useState<View>(editing ? "mcp" : "pick");
  const [query, setQuery] = useState("");
  const done = () => {
    onChanged();
    onClose();
  };
  const titles: Record<View, string> = {
    pick: t`Connect`,
    mcp: editing ? editing.name : t`MCP server by URL`,
    database: t`Database`,
    mailbox: t`Mailbox`,
  };

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent data-testid="connect-sheet" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-1">
            {view !== "pick" && !editing ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t`Back`}
                onClick={() => setView("pick")}
              >
                <ChevronLeft className="rtl:rotate-180" />
              </Button>
            ) : null}
            {titles[view]}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {view === "pick" ? (
            <div className="space-y-4">
              <Input
                aria-label={t`Search`}
                placeholder={t`Search`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <AppCatalogGrid
                query={query}
                servers={servers}
                onChanged={onChanged}
                hideAccess
                singleColumn
              />
              <div>
                <Choice icon={<Server className="size-4" />} onClick={() => setView("mcp")}>
                  <Trans>MCP server by URL</Trans>
                </Choice>
                {canManage ? (
                  <Choice
                    icon={<Database className="size-4" />}
                    onClick={() => setView("database")}
                  >
                    <Trans>Database</Trans>
                  </Choice>
                ) : null}
                <Choice icon={<Mail className="size-4" />} onClick={() => setView("mailbox")}>
                  <Trans>Mailbox</Trans>
                </Choice>
              </div>
            </div>
          ) : null}
          {view === "mcp" ? (
            <McpServerForm
              editing={editing}
              stdioEnabled={stdioEnabled}
              onSaved={done}
              onCancel={editing ? onClose : () => setView("pick")}
            />
          ) : null}
          {view === "database" ? (
            <DatabaseForm onSaved={done} onCancel={() => setView("pick")} />
          ) : null}
          {view === "mailbox" ? (
            <MailboxForm onSaved={done} onCancel={() => setView("pick")} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
