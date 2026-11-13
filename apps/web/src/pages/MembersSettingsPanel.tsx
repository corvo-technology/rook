import type {
  Space,
  SpaceInvitation,
  SpaceJoinRequest,
  SpaceMember,
  SpaceRole,
} from "@corvo/contracts";
import { agentCatalogLocale } from "@corvo/contracts";
import { can } from "@corvo/core";
import {
  Button,
  InlineConfirm,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { rpc, rpcForSpace } from "../lib/rpc";

type InviteLink = { link: string | null };

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function RolePicker({
  value,
  label,
  grantable,
  onChange,
}: {
  value: SpaceRole;
  label: string;
  grantable: SpaceRole[];
  onChange: (role: SpaceRole) => void;
}) {
  const { t } = useLingui();
  const names: Record<SpaceRole, string> = {
    owner: t`Owner`,
    admin: t`Admin`,
    member: t`Member`,
  };
  const items = grantable.map((role) => ({ value: role, label: names[role] }));
  return (
    <Select
      value={value}
      items={items}
      onValueChange={(next) => {
        if (next === "owner" || next === "admin" || next === "member") onChange(next);
      }}
    >
      <SelectTrigger aria-label={label} className="w-32 rounded-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end">
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

const NEW_WORKSPACE = "new-workspace";

/** Picks which workspace the section acts on, or starts a new one inline. */
function WorkspacePicker({
  spaces,
  value,
  onPick,
  onCreate,
}: {
  spaces: Space[];
  value: string;
  onPick: (spaceId: string) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const items = [
    ...spaces.map((space) => ({ value: space.id, label: space.name })),
    { value: NEW_WORKSPACE, label: t`New workspace` },
  ];

  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await onCreate(name.trim());
      setName("");
      setCreating(false);
    } catch {
      // The section shows the error.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Select
        value={value}
        items={items}
        onValueChange={(next) => {
          if (next === NEW_WORKSPACE) setCreating(true);
          else if (next) {
            setCreating(false);
            onPick(next);
          }
        }}
      >
        <SelectTrigger aria-label={t`Workspace`} className="w-full rounded-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {creating ? (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            aria-label={t`Workspace name`}
            placeholder={t`Workspace name`}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) void create();
              if (event.key === "Escape") setCreating(false);
            }}
          />
          <Button
            className="rounded-full"
            disabled={busy || !name.trim()}
            onClick={() => void create()}
          >
            <Trans>Create</Trans>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Who belongs to a workspace, and the ways to bring someone in. Owners and admins manage it. The
 * workspace defaults to the selected one and can be switched here without changing the app's.
 */
export function MembersSettingsPanel({
  userId,
  spaces,
  currentSpaceId,
  onCreated,
}: {
  userId: string;
  spaces: Space[];
  currentSpaceId: string | null;
  onCreated: (space: Space) => void;
}) {
  const { t, i18n } = useLingui();
  const invitable = spaces.filter((space) => space.canInvite === true);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked =
    invitable.find((space) => space.id === pickedId) ??
    invitable.find((space) => space.id === currentSpaceId) ??
    invitable[0] ??
    null;
  // Without a pickable workspace the section keeps acting on the selected one.
  const client = picked ? rpcForSpace(picked.id) : rpc;
  const pickedKey = picked?.id ?? null;
  const [members, setMembers] = useState<SpaceMember[] | null>(null);
  const [invitations, setInvitations] = useState<SpaceInvitation[]>([]);
  const [requests, setRequests] = useState<SpaceJoinRequest[]>([]);
  const [inviteLink, setInviteLink] = useState<InviteLink>({ link: null });
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [addresses, setAddresses] = useState("");
  const [role, setRole] = useState<SpaceRole>("member");
  const [sending, setSending] = useState(false);
  const [notEmailed, setNotEmailed] = useState<SpaceInvitation[]>([]);

  const myRole = members?.find((member) => member.userId === userId)?.role ?? "member";
  const manages = can({ role: myRole }, "manage_members");
  const grantable: SpaceRole[] =
    myRole === "owner" ? ["owner", "admin", "member"] : ["admin", "member"];

  const load = useCallback(async () => {
    try {
      const list = await client.spaces.members.list();
      setMembers(list);
      const mine = list.find((member) => member.userId === userId)?.role ?? "member";
      if (can({ role: mine }, "invite")) {
        const [pending, asking, link] = await Promise.all([
          client.spaces.invitations.list(),
          client.spaces.joinRequests.list(),
          client.spaces.inviteLink.get(),
        ]);
        setInvitations(pending);
        setRequests(asking);
        setInviteLink(link);
      }
    } catch (err) {
      setError(message(err, t`Could not load members`));
    }
  }, [client, t, userId]);

  useEffect(() => {
    setMembers(null);
    setInvitations([]);
    setRequests([]);
    setInviteLink({ link: null });
    setNotEmailed([]);
    setError(null);
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(message(err, fallback));
    }
  }

  async function send() {
    if (sending || !addresses.trim()) return;
    setSending(true);
    setError(null);
    try {
      const result = await client.spaces.invitations.create({ addresses, role });
      setNotEmailed(result.emailed ? [] : result.invitations);
      setAddresses("");
      setInviting(false);
      await load();
    } catch (err) {
      setError(message(err, t`Could not send invitations`));
    } finally {
      setSending(false);
    }
  }

  async function createWorkspace(name: string) {
    try {
      const space = await rpc.spaces.create({ name, locale: agentCatalogLocale(i18n.locale) });
      onCreated(space);
      setPickedId(space.id);
    } catch (err) {
      setError(message(err, t`Could not create the workspace`));
      throw err;
    }
  }

  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);

  return (
    <div
      className="space-y-8"
      data-testid="members-settings"
      data-space-id={pickedKey ?? undefined}
    >
      {invitable.length > 1 && picked ? (
        <WorkspacePicker
          spaces={invitable}
          value={picked.id}
          onPick={setPickedId}
          onCreate={createWorkspace}
        />
      ) : null}
      <SettingsGroup>
        {(members ?? []).map((member) => {
          const self = member.userId === userId;
          const managed = manages && !self && (myRole === "owner" || member.role !== "owner");
          return (
            <SettingsRow
              key={member.userId}
              label={
                <div className="min-w-0">
                  <p className="truncate">{member.name}</p>
                  <p className="truncate text-[12.5px] text-muted-foreground">{member.email}</p>
                </div>
              }
              control={
                <>
                  {managed ? (
                    <RolePicker
                      value={member.role}
                      label={t`Role of ${member.name}`}
                      grantable={grantable}
                      onChange={(next) =>
                        void run(
                          () =>
                            client.spaces.members.setRole({ userId: member.userId, role: next }),
                          t`Could not change the role`,
                        )
                      }
                    />
                  ) : (
                    <span className="text-[13px] text-muted-foreground">
                      {member.role === "owner" ? (
                        <Trans>Owner</Trans>
                      ) : member.role === "admin" ? (
                        <Trans>Admin</Trans>
                      ) : (
                        <Trans>Member</Trans>
                      )}
                    </span>
                  )}
                  {managed ? (
                    <InlineConfirm
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      confirmLabel={t`Remove ${member.name}?`}
                      onConfirm={() =>
                        void run(
                          () => client.spaces.members.remove({ userId: member.userId }),
                          t`Could not remove`,
                        )
                      }
                    >
                      <Trans>Remove</Trans>
                    </InlineConfirm>
                  ) : null}
                  {self ? (
                    <InlineConfirm
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      confirmLabel={t`Leave this space?`}
                      onConfirm={() =>
                        void client.spaces.members
                          .leave()
                          .then(() => window.location.assign("/app"))
                          .catch((err: unknown) => setError(message(err, t`Could not leave`)))
                      }
                    >
                      <Trans>Leave</Trans>
                    </InlineConfirm>
                  ) : null}
                </>
              }
            />
          );
        })}
      </SettingsGroup>

      {can({ role: myRole }, "invite") ? (
        <div className="space-y-3">
          {inviting ? (
            <div className="space-y-3 rounded-xl border border-border p-4">
              <Input
                aria-label={t`Email addresses`}
                placeholder={t`Email addresses`}
                value={addresses}
                disabled={sending}
                onChange={(event) => setAddresses(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) void send();
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <RolePicker value={role} label={t`Role`} grantable={grantable} onChange={setRole} />
                <Button
                  className="rounded-full"
                  disabled={sending || !addresses.trim()}
                  onClick={() => void send()}
                >
                  <Trans>Invite</Trans>
                </Button>
              </div>
            </div>
          ) : (
            <Button className="rounded-full" onClick={() => setInviting(true)}>
              <Trans>Invite</Trans>
            </Button>
          )}
          {notEmailed.map((invitation) => (
            <SettingsRow
              key={invitation.id}
              label={<span className="truncate">{invitation.email}</span>}
              control={
                invitation.link ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="rounded-full"
                    onClick={() => copy(invitation.link ?? "")}
                  >
                    <Trans>Copy link</Trans>
                  </Button>
                ) : null
              }
            />
          ))}
        </div>
      ) : null}

      {invitations.length > 0 ? (
        <SettingsGroup title={t`Invitations`}>
          {invitations.map((invitation) => (
            <SettingsRow
              key={invitation.id}
              label={
                invitation.status === "accepted" ? (
                  <span className="truncate">
                    {invitation.acceptedByName || invitation.email} <Trans>joined</Trans>
                  </span>
                ) : (
                  <span className="truncate">{invitation.email}</span>
                )
              }
              control={
                invitation.status === "pending" ? (
                  <>
                    {invitation.link ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-full"
                        onClick={() => copy(invitation.link ?? "")}
                      >
                        <Trans>Copy link</Trans>
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      onClick={() =>
                        void run(
                          () => client.spaces.invitations.resend({ id: invitation.id }),
                          t`Could not resend`,
                        )
                      }
                    >
                      <Trans>Resend</Trans>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      onClick={() =>
                        void run(
                          () => client.spaces.invitations.cancel({ id: invitation.id }),
                          t`Could not cancel`,
                        )
                      }
                    >
                      <Trans>Cancel</Trans>
                    </Button>
                  </>
                ) : null
              }
            />
          ))}
        </SettingsGroup>
      ) : null}

      {requests.length > 0 ? (
        <SettingsGroup title={t`Requests`}>
          {requests.map((request) => (
            <SettingsRow
              key={request.id}
              label={
                <div className="min-w-0">
                  <p className="truncate">{request.name}</p>
                  <p className="truncate text-[12.5px] text-muted-foreground">{request.email}</p>
                </div>
              }
              control={
                <>
                  <Button
                    size="sm"
                    className="rounded-full"
                    onClick={() =>
                      void run(
                        () => client.spaces.joinRequests.answer({ id: request.id, approve: true }),
                        t`Could not approve`,
                      )
                    }
                  >
                    <Trans>Approve</Trans>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full"
                    onClick={() =>
                      void run(
                        () => client.spaces.joinRequests.answer({ id: request.id, approve: false }),
                        t`Could not deny`,
                      )
                    }
                  >
                    <Trans>Deny</Trans>
                  </Button>
                </>
              }
            />
          ))}
        </SettingsGroup>
      ) : null}

      {manages || can({ role: myRole }, "invite") ? (
        <SettingsGroup>
          <SettingsRow
            label={<Trans>Invite link</Trans>}
            control={
              inviteLink.link ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="rounded-full"
                    onClick={() => copy(inviteLink.link ?? "")}
                  >
                    <Trans>Copy link</Trans>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full"
                    onClick={() =>
                      void run(() => client.spaces.inviteLink.disable(), t`Could not turn off`)
                    }
                  >
                    <Trans>Turn off</Trans>
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={() =>
                    void run(() => client.spaces.inviteLink.create(), t`Could not create the link`)
                  }
                >
                  <Trans>Create</Trans>
                </Button>
              )
            }
          />
        </SettingsGroup>
      ) : null}

      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
