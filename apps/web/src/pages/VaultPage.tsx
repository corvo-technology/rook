import type { Bot, VaultCredential, VaultUse } from "@corvo/contracts";
import { BotSecretName, commandVariableName, commandVariableProblem } from "@corvo/contracts";
import { can, knownSpacePermissions } from "@corvo/core";
import { fetchFresh } from "@corvo/core/query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  BotAvatar,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  NativeSelect,
  NativeSelectOption,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";
import { useId, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { usedByNames } from "./connections/connection-model";
import { credentialDestination, credentialPlaintext } from "./shell/bot-credentials";

type Auth = NonNullable<VaultCredential["auth"]>;
type AuthType = Auth["type"];

const fieldLabelClass = "block text-[14px] text-muted-foreground";

function authLabel(auth: Auth, t: ReturnType<typeof useLingui>["t"]): string {
  if (auth.type === "header") {
    const header = auth.name;
    return t`Header "${header}"`;
  }
  if (auth.type === "basic") {
    const username = auth.username;
    return t`Basic auth (${username})`;
  }
  if (auth.type === "login") return t`Website login`;
  if (auth.type === "command") return t`Command variable`;
  return t`Bearer token`;
}

/** The agents a credential can be given to: a checklist of the space's agents. */
function AgentChecklist({
  agents,
  selected,
  disabled,
  onToggle,
}: {
  agents: readonly Bot[];
  selected: ReadonlySet<string>;
  disabled?: boolean;
  onToggle: (botId: string) => void;
}) {
  const { t } = useLingui();
  return (
    <ul className="divide-y divide-border">
      {agents.map((bot) => (
        <li key={bot.id} className="flex items-center justify-between gap-3 py-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <BotAvatar color={bot.color} identity={bot.id} size={28} />
            <span className="truncate text-[14px] text-foreground">{bot.name}</span>
          </span>
          <Checkbox
            checked={selected.has(bot.id)}
            disabled={disabled}
            aria-label={t`Allow ${bot.name}`}
            onCheckedChange={() => onToggle(bot.id)}
          />
        </li>
      ))}
    </ul>
  );
}

function toggled(current: ReadonlySet<string>, botId: string): Set<string> {
  const next = new Set(current);
  if (next.has(botId)) next.delete(botId);
  else next.add(botId);
  return next;
}

/** A value field. The value lives only in this component's state and is cleared on every submit. */
function ValueFields({
  type,
  username,
  value,
  onUsername,
  onValue,
}: {
  type: AuthType;
  username: string;
  value: string;
  onUsername: (next: string) => void;
  onValue: (next: string) => void;
}) {
  const ids = useId();
  return (
    <>
      {type === "login" ? (
        <label htmlFor={`${ids}-username`} className={fieldLabelClass}>
          <Trans>Username</Trans>
          <Input
            id={`${ids}-username`}
            data-testid="vault-username"
            // "off" is ignored for username fields; this stops browsers saving the pair.
            autoComplete="new-password"
            spellCheck={false}
            value={username}
            onChange={(event) => onUsername(event.target.value)}
            className="mt-1.5"
          />
        </label>
      ) : null}
      <label htmlFor={`${ids}-value`} className={fieldLabelClass}>
        {type === "login" ? <Trans>Password</Trans> : <Trans>Value</Trans>}
        <Input
          id={`${ids}-value`}
          data-testid="vault-value"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={value}
          onChange={(event) => onValue(event.target.value)}
          className="mt-1.5"
        />
      </label>
    </>
  );
}

function AddSheet({
  agents,
  canShare,
  onSaved,
  onClose,
}: {
  agents: readonly Bot[];
  /** Whether the person may create a credential the whole team uses. */
  canShare: boolean;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const ids = useId();
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [authType, setAuthType] = useState<AuthType>("bearer");
  const [headerName, setHeaderName] = useState("");
  const [basicUsername, setBasicUsername] = useState("");
  const [username, setUsername] = useState("");
  const [value, setValue] = useState("");
  const [team, setTeam] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameValid = BotSecretName.safeParse(name.trim()).success;
  const variable =
    authType === "command" && nameValid ? `$${commandVariableName(name.trim())}` : undefined;
  const variableError =
    variable && commandVariableProblem(variable.slice(1))
      ? t`${variable} is reserved and cannot be used as a command variable. Choose another name.`
      : null;
  const ready =
    nameValid &&
    !variableError &&
    (authType === "command" || origin.trim().length > 0) &&
    (authType !== "header" || headerName.trim().length > 0) &&
    (authType !== "basic" || basicUsername.trim().length > 0) &&
    value.length > 0 &&
    (authType !== "login" || username.trim().length > 0);

  function newAuth(): Auth {
    if (authType === "header") return { type: "header", name: headerName.trim() };
    if (authType === "basic") return { type: "basic", username: basicUsername.trim() };
    return { type: authType };
  }

  async function save() {
    if (busy || !ready) return;
    const secret = value;
    const login = username.trim();
    // Cleared before the request, so the value is never kept once it is sent.
    setValue("");
    setUsername("");
    setBusy(true);
    setError(null);
    try {
      await rpc.vault.create({
        destination: credentialDestination(name.trim(), origin.trim(), newAuth()),
        value: credentialPlaintext(authType, login, secret),
        scope: team ? "space" : "personal",
        botIds: [...selected],
      });
      await onSaved();
      onClose();
    } catch (failure) {
      setError(errorText(failure, t`Could not save the credential`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent data-testid="vault-add-sheet" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            <Trans>Add credential</Trans>
          </SheetTitle>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={`${ids}-name`} className={fieldLabelClass}>
            <Trans>Name</Trans>
            <Input
              id={`${ids}-name`}
              data-testid="vault-name"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="github"
              className="mt-1.5"
            />
          </label>
          {variableError ? (
            <p className="text-[12px] text-destructive">{variableError}</p>
          ) : variable ? (
            <p className="text-[12px] text-muted-foreground">{t`Available to shell commands as ${variable}`}</p>
          ) : null}
          <label htmlFor={`${ids}-type`} className={fieldLabelClass}>
            <Trans>Type</Trans>
            <NativeSelect
              id={`${ids}-type`}
              data-testid="vault-type"
              className="mt-1.5 w-full"
              value={authType}
              onChange={(event) => setAuthType(event.target.value as AuthType)}
            >
              <NativeSelectOption value="bearer">{t`Bearer token`}</NativeSelectOption>
              <NativeSelectOption value="header">{t`Custom header`}</NativeSelectOption>
              <NativeSelectOption value="basic">{t`Basic auth`}</NativeSelectOption>
              <NativeSelectOption value="login">{t`Website login`}</NativeSelectOption>
              <NativeSelectOption value="command">{t`Command variable`}</NativeSelectOption>
            </NativeSelect>
          </label>
          {authType === "command" ? null : (
            <label htmlFor={`${ids}-origin`} className={fieldLabelClass}>
              <Trans>Site</Trans>
              <Input
                id={`${ids}-origin`}
                data-testid="vault-origin"
                autoComplete="off"
                spellCheck={false}
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
                placeholder="https://api.example.com"
                className="mt-1.5"
              />
            </label>
          )}
          {authType === "header" ? (
            <label htmlFor={`${ids}-header`} className={fieldLabelClass}>
              <Trans>Header name</Trans>
              <Input
                id={`${ids}-header`}
                autoComplete="off"
                spellCheck={false}
                value={headerName}
                onChange={(event) => setHeaderName(event.target.value)}
                placeholder="X-Api-Key"
                className="mt-1.5"
              />
            </label>
          ) : null}
          {authType === "basic" ? (
            <label htmlFor={`${ids}-basic`} className={fieldLabelClass}>
              <Trans>Username</Trans>
              <Input
                id={`${ids}-basic`}
                autoComplete="off"
                spellCheck={false}
                value={basicUsername}
                onChange={(event) => setBasicUsername(event.target.value)}
                className="mt-1.5"
              />
            </label>
          ) : null}
          <ValueFields
            type={authType}
            username={username}
            value={value}
            onUsername={setUsername}
            onValue={setValue}
          />
          <p className="text-xs text-muted-foreground">
            <Trans>Encrypted and never shown again</Trans>
          </p>
          {canShare ? (
            <div className="flex items-center gap-2.5 text-[14px] text-foreground">
              <Checkbox
                id={`${ids}-team`}
                checked={team}
                data-testid="vault-team"
                onCheckedChange={(checked) => setTeam(checked === true)}
              />
              <label htmlFor={`${ids}-team`}>
                <Trans>Team credential</Trans>
              </label>
            </div>
          ) : null}
          {agents.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                <Trans>Agents</Trans>
              </h3>
              <AgentChecklist
                agents={agents}
                selected={selected}
                onToggle={(botId) => setSelected((current) => toggled(current, botId))}
              />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" data-testid="vault-save" disabled={busy || !ready}>
              {busy ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function AgentsSheet({
  credential,
  agents,
  onSaved,
  onClose,
}: {
  credential: VaultCredential;
  agents: readonly Bot[];
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(credential.botIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(botId: string) {
    const next = toggled(selected, botId);
    setSelected(next);
    setBusy(true);
    setError(null);
    try {
      await rpc.vault.setAgents({ id: credential.id, botIds: [...next] });
      await onSaved();
    } catch (failure) {
      setSelected(selected);
      setError(errorText(failure, t`Could not update agent access`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent data-testid="vault-agents-sheet" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            <Trans>Who can use {credential.name}</Trans>
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          <AgentChecklist
            agents={agents}
            selected={selected}
            disabled={busy}
            onToggle={(botId) => void change(botId)}
          />
          {error ? (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ReplaceSheet({
  credential,
  onSaved,
  onClose,
}: {
  credential: VaultCredential;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const type: AuthType = credential.auth?.type ?? "bearer";
  const [username, setUsername] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = value.length > 0 && (type !== "login" || username.trim().length > 0);

  async function save() {
    if (busy || !ready) return;
    const secret = value;
    const login = username.trim();
    setValue("");
    setUsername("");
    setBusy(true);
    setError(null);
    try {
      await rpc.vault.replace({
        id: credential.id,
        value: credentialPlaintext(type, login, secret),
      });
      await onSaved();
      onClose();
    } catch (failure) {
      setError(errorText(failure, t`Could not save the credential`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent data-testid="vault-replace-sheet" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            <Trans>Replace value of {credential.name}</Trans>
          </SheetTitle>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <ValueFields
            type={type}
            username={username}
            value={value}
            onUsername={setUsername}
            onValue={setValue}
          />
          {error ? (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !ready}>
              {busy ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function UsesSheet({
  credential,
  agents,
  onClose,
}: {
  credential: VaultCredential;
  agents: readonly Bot[];
  onClose: () => void;
}) {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const uses = useQuery(queries.vault.uses.queryOptions({ input: { id: credential.id } }));
  const names = new Map(agents.map((bot) => [bot.id, bot.name]));

  function line(use: VaultUse): string {
    const agent = use.botId ? (names.get(use.botId) ?? null) : null;
    const forWhom = use.forMe ? t`you` : use.forName;
    const where = use.destination === "command" ? t`shell command` : use.destination;
    return [agent, where, forWhom ? t`for ${forWhom}` : null].filter(Boolean).join(" · ");
  }

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent data-testid="vault-uses-sheet" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            <Trans>Recent uses of {credential.name}</Trans>
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {uses.isError ? (
            <p role="alert" className="text-[13px] text-destructive">
              <Trans>Could not load recent uses</Trans>
            </p>
          ) : uses.data?.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              <Trans>Not used yet</Trans>
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {uses.data?.map((use) => (
                <li key={use.id} data-testid="vault-use" className="py-2.5">
                  <div className="break-all text-[14px] text-foreground">{line(use)}</div>
                  <div className="text-[12.5px] text-muted-foreground">
                    {new Date(use.createdAt).toLocaleString(i18n.locale)}
                    {use.outcome === "failed" ? (
                      <>
                        {" · "}
                        <span className="text-destructive">
                          <Trans>Failed</Trans>
                        </span>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

type Dialog =
  | { kind: "add" }
  | { kind: "agents" | "replace" | "uses"; credential: VaultCredential }
  | null;

/**
 * Every credential the person can see in the space, in one list: what it is, where it goes, which
 * agents may use it and when it was last used. Values are never shown, only entered.
 */
export function VaultPage() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const listOptions = queries.vault.list.queryOptions();
  const list = useQuery({ ...listOptions, refetchOnMount: "always" });
  const bots = useQuery(queries.bots.list.queryOptions());
  const roles = useQuery(queries.spaces.roles.list.queryOptions());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [removing, setRemoving] = useState<VaultCredential | null>(null);
  const [error, setError] = useState<string | null>(null);

  const agents = (bots.data ?? []).filter((bot) => !bot.archivedAt);
  const names = new Map(agents.map((bot) => [bot.id, bot.name]));
  const canShare = roles.data
    ? can(
        {
          isOwner: roles.data.me.isOwner,
          permissions: knownSpacePermissions(roles.data.me.permissions),
        },
        "manage_credentials",
      )
    : false;

  async function refresh() {
    await fetchFresh(queryClient, listOptions);
  }

  async function remove(credential: VaultCredential) {
    setError(null);
    try {
      await rpc.vault.remove({ id: credential.id });
      await refresh();
    } catch (failure) {
      setError(errorText(failure, t`Could not remove the credential`));
    }
  }

  const shownError = error ?? (list.isError ? t`Could not load credentials.` : null);

  return (
    <div data-testid="vault-page" className="space-y-4">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          data-testid="vault-add"
          onClick={() => setDialog({ kind: "add" })}
        >
          <Plus aria-hidden="true" />
          <Trans>Add</Trans>
        </Button>
      </div>
      {shownError ? (
        <p role="alert" className="text-[13px] text-destructive">
          {shownError}
        </p>
      ) : null}
      {list.data?.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {list.data.map((credential) => {
            const usedBy = usedByNames(
              credential.botIds.flatMap((id) => names.get(id) ?? []),
              i18n.locale,
            );
            const kind = credential.auth
              ? authLabel(credential.auth, t)
              : t`These saved settings can't be read.`;
            return (
              <li
                key={credential.id}
                data-testid="vault-row"
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-muted-foreground">
                  <KeyRound aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium text-foreground">
                      {credential.name}
                    </span>
                    {credential.scope === "space" ? (
                      <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] text-muted-foreground">
                        <Trans>Team</Trans>
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-[12.5px] text-muted-foreground">
                    {[kind, credential.origin || null].filter(Boolean).join(" · ")}
                  </div>
                  {usedBy ? (
                    <div className="truncate text-[12.5px] text-muted-foreground">
                      <Trans>Used by {usedBy}</Trans>
                    </div>
                  ) : null}
                  <div className="text-[12px] text-muted-foreground/70">
                    {credential.lastUsedAt
                      ? t`Last used ${new Date(credential.lastUsedAt).toLocaleDateString(i18n.locale)}`
                      : t`Added ${new Date(credential.createdAt).toLocaleDateString(i18n.locale)}`}
                  </div>
                </div>
                {credential.canManage ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDialog({ kind: "agents", credential })}
                    >
                      <Trans>Agents</Trans>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={t`More`}
                        className="rounded-full px-2 py-1 text-[14px] text-muted-foreground hover:bg-accent"
                      >
                        ⋯
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {credential.auth ? (
                          <DropdownMenuItem
                            onClick={() => setDialog({ kind: "replace", credential })}
                          >
                            <Trans>Replace value</Trans>
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onClick={() => setDialog({ kind: "uses", credential })}>
                          <Trans>Recent uses</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setRemoving(credential)}
                        >
                          <Trans>Remove</Trans>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {dialog?.kind === "add" ? (
        <AddSheet
          agents={agents}
          canShare={canShare}
          onSaved={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "agents" ? (
        <AgentsSheet
          credential={
            list.data?.find((row) => row.id === dialog.credential.id) ?? dialog.credential
          }
          agents={agents}
          onSaved={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "replace" ? (
        <ReplaceSheet
          credential={dialog.credential}
          onSaved={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "uses" ? (
        <UsesSheet credential={dialog.credential} agents={agents} onClose={() => setDialog(null)} />
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
              <Trans>Remove</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
