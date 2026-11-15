import type {
  CustomSpaceRole,
  Space,
  SpaceInvitation,
  SpaceJoinRequest,
  SpaceMember,
} from "@corvo/contracts";
import { agentCatalogLocale } from "@corvo/contracts";
import type { SpaceMembership } from "@corvo/core";
import {
  can,
  holdsAll,
  knownSpacePermissions,
  parseInviteAddresses,
  personName,
  splitInvitees,
} from "@corvo/core";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  InlineConfirm,
  Input,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@corvo/ui-web";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useState } from "react";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { rpc, rpcForSpace } from "../lib/rpc";

type InviteLink = { link: string | null };

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

const EVERYONE = "everyone";
const ADMIN = "admin";

/** What an invitation gives: everyone's role by default, Admin, or one of the space's own roles. */
function InviteRolePicker({
  value,
  roles,
  canGiveAdmin,
  onChange,
}: {
  value: string;
  roles: CustomSpaceRole[];
  canGiveAdmin: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useLingui();
  const items = [
    { value: EVERYONE, label: t`Everyone` },
    ...(canGiveAdmin ? [{ value: ADMIN, label: t`Admin` }] : []),
    ...roles.map((role) => ({ value: role.id, label: role.name })),
  ];
  return (
    <Select value={value} items={items} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger aria-label={t`Role`} className="w-40 rounded-full">
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

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground">
      {children}
    </span>
  );
}

/** What a member holds besides everyone's role: ownership, Admin and the space's own roles. */
function RoleChips({ member, roles }: { member: SpaceMember; roles: CustomSpaceRole[] }) {
  const custom = roles.filter((role) => !role.systemKey && member.roleIds.includes(role.id));
  return (
    <>
      {member.role === "owner" ? (
        <Chip>
          <Trans>Owner</Trans>
        </Chip>
      ) : member.role === "admin" ? (
        <Chip>
          <Trans>Admin</Trans>
        </Chip>
      ) : null}
      {custom.map((role) => (
        <Chip key={role.id}>{role.name}</Chip>
      ))}
    </>
  );
}

function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="rounded-full px-2 py-1 text-[14px] text-muted-foreground hover:bg-accent"
      >
        ⋯
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
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
  /** Absent when this person may not create workspaces. */
  onCreate?: (name: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const items = [
    ...spaces.map((space) => ({ value: space.id, label: space.name })),
    ...(onCreate ? [{ value: NEW_WORKSPACE, label: t`New workspace` }] : []),
  ];

  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await onCreate?.(name.trim());
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
  canCreateSpace = true,
  membersCanCreateSpaces = null,
  onMembersCanCreateSpaces,
}: {
  userId: string;
  spaces: Space[];
  currentSpaceId: string | null;
  onCreated: (space: Space) => void;
  canCreateSpace?: boolean;
  /** The owner's switch; null for anyone who is not the owner. */
  membersCanCreateSpaces?: boolean | null;
  onMembersCanCreateSpaces?: (allowed: boolean) => void;
}) {
  const { t, i18n } = useLingui();
  const membersCanCreateId = useId();
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
  const [addresses, setAddresses] = useState("");
  const [inviteRole, setInviteRole] = useState(EVERYONE);
  const [sending, setSending] = useState(false);
  const [notEmailed, setNotEmailed] = useState<SpaceInvitation[]>([]);
  const [sent, setSent] = useState<number | null>(null);
  const [roles, setRoles] = useState<CustomSpaceRole[]>([]);
  const [mine, setMine] = useState<SpaceMembership | null>(null);

  const myRole = members?.find((member) => member.userId === userId)?.role ?? "member";
  const manages = can(mine, "manage_members");
  const invites = can(mine, "invite_people");
  // Roles the person invited could carry: the ones the sender holds every key of.
  const givable = roles.filter(
    (candidate) => !candidate.systemKey && mine && (mine.isOwner || holdsAll(mine, candidate.keys)),
  );
  const canGiveAdmin = manages || myRole === "owner" || myRole === "admin";
  const parsed = parseInviteAddresses(addresses);
  const { toInvite, alreadyIn } = splitInvitees(
    parsed.addresses,
    (members ?? []).map((member) => member.email),
  );

  const load = useCallback(async () => {
    try {
      const [list, rolesNow] = await Promise.all([
        client.spaces.members.list(),
        client.spaces.roles.list(),
      ]);
      setMembers(list);
      setRoles(rolesNow.roles);
      const standing: SpaceMembership = {
        isOwner: rolesNow.me.isOwner,
        roleIds: rolesNow.me.roleIds,
        permissions: knownSpacePermissions(rolesNow.me.permissions),
      };
      setMine(standing);
      if (can(standing, "invite_people")) {
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
    setRoles([]);
    setMine(null);
    setInviteRole(EVERYONE);
    setSent(null);
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
    if (sending || toInvite.length === 0 || parsed.rejected.length > 0) return;
    setSending(true);
    setError(null);
    try {
      const admin = inviteRole === ADMIN;
      const result = await client.spaces.invitations.create({
        addresses: toInvite.join("\n"),
        role: admin ? "admin" : "member",
        roleIds: admin || inviteRole === EVERYONE ? [] : [inviteRole],
      });
      setNotEmailed(result.emailed ? [] : result.invitations);
      setSent(result.invitations.length);
      setAddresses("");
      setInviteRole(EVERYONE);
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

  async function allowMembersToCreate(allowed: boolean) {
    setError(null);
    try {
      await rpc.spaces.setMembersCanCreate({ allowed });
      onMembersCanCreateSpaces?.(allowed);
    } catch (err) {
      setError(message(err, t`Could not save`));
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
          onCreate={canCreateSpace ? createWorkspace : undefined}
        />
      ) : null}
      {invites ? (
        <div className="space-y-2">
          <Textarea
            aria-label={t`Email addresses`}
            placeholder={t`Email addresses`}
            rows={3}
            value={addresses}
            disabled={sending}
            onChange={(event) => {
              setAddresses(event.target.value);
              setSent(null);
            }}
          />
          {parsed.rejected.length > 0 ? (
            <p className="text-[12.5px] text-destructive">{parsed.rejected.join(", ")}</p>
          ) : null}
          {alreadyIn.length > 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              {alreadyIn.join(", ")} <Trans>already in the space</Trans>
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <InviteRolePicker
              value={inviteRole}
              roles={givable}
              canGiveAdmin={canGiveAdmin}
              onChange={setInviteRole}
            />
            <div className="flex items-center gap-3">
              {sent !== null && sent > 0 ? (
                <span role="status" className="text-[12.5px] text-muted-foreground">
                  <Plural value={sent} one="# invitation sent" other="# invitations sent" />
                </span>
              ) : null}
              <Button
                className="rounded-full"
                disabled={sending || toInvite.length === 0 || parsed.rejected.length > 0}
                onClick={() => void send()}
              >
                <Trans>Invite</Trans>
              </Button>
            </div>
          </div>
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

      <SettingsGroup data-testid="members-list">
        {requests.map((request) => (
          <SettingsRow
            key={request.id}
            label={
              <div className="min-w-0">
                <p className="truncate">{personName(request.name, request.email)}</p>
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
        {invitations
          .filter((invitation) => invitation.status === "pending")
          .map((invitation) => (
            <SettingsRow
              key={invitation.id}
              label={
                <div className="min-w-0">
                  <p className="truncate">{invitation.email}</p>
                  <p className="truncate text-[12.5px] text-muted-foreground">
                    <Trans>Invitation sent</Trans>
                  </p>
                </div>
              }
              control={
                <RowMenu label={t`Invitation to ${invitation.email}`}>
                  <DropdownMenuItem
                    onClick={() =>
                      void run(
                        () => client.spaces.invitations.resend({ id: invitation.id }),
                        t`Could not resend`,
                      )
                    }
                  >
                    <Trans>Resend</Trans>
                  </DropdownMenuItem>
                  {invitation.link ? (
                    <DropdownMenuItem onClick={() => copy(invitation.link ?? "")}>
                      <Trans>Copy link</Trans>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    onClick={() =>
                      void run(
                        () => client.spaces.invitations.cancel({ id: invitation.id }),
                        t`Could not cancel`,
                      )
                    }
                  >
                    <Trans>Cancel</Trans>
                  </DropdownMenuItem>
                </RowMenu>
              }
            />
          ))}
        {(members ?? []).map((member) => {
          const self = member.userId === userId;
          const managed = manages && !self && (myRole === "owner" || member.role !== "owner");
          const name = personName(member.name, member.email);
          const held = member.roleIds.filter((id) =>
            roles.some((role) => role.id === id && role.systemKey !== "everyone"),
          );
          return (
            <SettingsRow
              key={member.userId}
              label={
                <div className="min-w-0">
                  <p className="truncate">{name}</p>
                  <p className="truncate text-[12.5px] text-muted-foreground">{member.email}</p>
                </div>
              }
              control={
                <>
                  <RoleChips member={member} roles={roles} />
                  {managed && (canGiveAdmin || givable.length > 0) ? (
                    <RowMenu label={t`Roles of ${name}`}>
                      {canGiveAdmin ? (
                        <DropdownMenuCheckboxItem
                          checked={member.role === "admin"}
                          onCheckedChange={(on) =>
                            void run(
                              () =>
                                client.spaces.members.setRole({
                                  userId: member.userId,
                                  role: on ? "admin" : "member",
                                }),
                              t`Could not change the role`,
                            )
                          }
                        >
                          <Trans>Admin</Trans>
                        </DropdownMenuCheckboxItem>
                      ) : null}
                      {givable.map((role) => (
                        <DropdownMenuCheckboxItem
                          key={role.id}
                          checked={member.roleIds.includes(role.id)}
                          onCheckedChange={(on) =>
                            void run(
                              () =>
                                client.spaces.members.setRoles({
                                  userId: member.userId,
                                  roleIds: on
                                    ? [...held, role.id]
                                    : held.filter((id) => id !== role.id),
                                }),
                              t`Could not change the role`,
                            )
                          }
                        >
                          {role.name}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </RowMenu>
                  ) : null}
                  {managed ? (
                    <InlineConfirm
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      confirmLabel={t`Remove ${name}?`}
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

      {invites ? (
        <SettingsGroup>
          <SettingsRow
            label={
              <span className="text-[13px] text-muted-foreground">
                <Trans>Anyone with the link asks to join</Trans>
              </span>
            }
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

      {membersCanCreateSpaces !== null &&
      picked?.id === currentSpaceId &&
      (members?.length ?? 0) > 1 ? (
        <SettingsGroup>
          <SettingsRow
            label={
              <Label htmlFor={membersCanCreateId} className="text-[14px] font-normal">
                <Trans>Members can create spaces</Trans>
              </Label>
            }
            control={
              <Switch
                id={membersCanCreateId}
                data-testid="members-can-create-spaces"
                checked={membersCanCreateSpaces}
                onCheckedChange={(checked) => void allowMembersToCreate(checked)}
              />
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
