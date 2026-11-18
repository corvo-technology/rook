import type { CustomSpaceRole, SpaceMember } from "@corvo/contracts";
import type { SpacePermission } from "@corvo/core";
import {
  can,
  holdsAll,
  knownSpacePermissions,
  SPACE_PERMISSION_AREAS,
  spaceRank,
} from "@corvo/core";
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
  Switch,
} from "@corvo/ui-web";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";

type Loaded = {
  roles: CustomSpaceRole[];
  me: { isOwner: boolean; roleIds: string[]; permissions: string[] };
  members: SpaceMember[];
};

/** The role's name as a person reads it: the base role has no name of its own to edit. */
export function useRoleName() {
  const { t } = useLingui();
  return (role: Pick<CustomSpaceRole, "name" | "systemKey">) =>
    role.systemKey === "everyone" ? t`Everyone` : role.name;
}

/** Roles that add up: who may do what in the space. Shown to whoever manages roles. */
export function SpaceRolesSettings() {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const roleName = useRoleName();
  const [data, setData] = useState<Loaded | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, members] = await Promise.all([
        rpc.spaces.roles.list(),
        rpc.spaces.members.list(),
      ]);
      setData({ roles: list.roles, me: list.me, members });
    } catch (err) {
      setError(errorText(err));
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = useMemo(
    () =>
      data
        ? { isOwner: data.me.isOwner, permissions: knownSpacePermissions(data.me.permissions) }
        : null,
    [data],
  );
  if (!data || !mine || !can(mine, "manage_roles")) return null;

  const positions = new Map(data.roles.map((role) => [role.id, role.position]));
  const rank = spaceRank({ ...mine, roleIds: data.me.roleIds }, positions);
  const ordered = data.roles.filter((role) => role.systemKey !== "everyone");
  const everyone = data.roles.find((role) => role.systemKey === "everyone");

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function create() {
    const name = draft?.trim();
    if (!name) return;
    setDraft(null);
    await run(async () => {
      const created = await rpc.spaces.roles.create({ name, keys: [] });
      setOpenId(created.id);
    });
  }

  function move(index: number, by: -1 | 1) {
    const ids = ordered.map((role) => role.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved as string);
    void run(() => rpc.spaces.roles.reorder({ ids }));
  }

  const rows = [...ordered, ...(everyone ? [everyone] : [])];
  return (
    <section className="space-y-3" data-testid="space-roles">
      <SettingsGroup title={t`Roles`}>
        {rows.map((role, index) => {
          const editable = role.systemKey === "everyone" || mine.isOwner || rank < role.position;
          return (
            <div key={role.id}>
              <SettingsRow
                label={
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    aria-expanded={openId === role.id}
                    onClick={() => setOpenId(openId === role.id ? null : role.id)}
                  >
                    <p className="truncate">{roleName(role)}</p>
                    <p className="truncate text-[12.5px] text-muted-foreground">
                      {role.keys.includes("administrator")
                        ? t`Administrator`
                        : plural(role.keys.length, {
                            one: "# permission",
                            other: "# permissions",
                          })}
                    </p>
                  </button>
                }
                control={
                  role.systemKey === "everyone" ||
                  !(mine.isOwner || rank < role.position) ? null : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t`Move ${role.name} up`}
                        disabled={
                          index === 0 || (!mine.isOwner && rank >= (rows[index - 1]?.position ?? 0))
                        }
                        onClick={() => move(index, -1)}
                      >
                        <ChevronUp aria-hidden className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t`Move ${role.name} down`}
                        disabled={index === ordered.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ChevronDown aria-hidden className="size-4" />
                      </Button>
                    </>
                  )
                }
              />
              {openId === role.id ? (
                <RoleEditor
                  role={role}
                  data={data}
                  mine={{ ...mine, roleIds: data.me.roleIds }}
                  editable={editable}
                  onChange={(action) => run(action)}
                  onDeleted={() => setOpenId(null)}
                />
              ) : null}
            </div>
          );
        })}
      </SettingsGroup>
      {draft === null ? (
        <Button variant="secondary" size="sm" className="rounded-full" onClick={() => setDraft("")}>
          <Trans>New role</Trans>
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            aria-label={t`Role name`}
            placeholder={t`Role name`}
            maxLength={40}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) void create();
              if (event.key === "Escape") setDraft(null);
            }}
          />
          <Button className="rounded-full" disabled={!draft.trim()} onClick={() => void create()}>
            <Trans>Create</Trans>
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function RoleEditor({
  role,
  data,
  mine,
  editable,
  onChange,
  onDeleted,
}: {
  role: CustomSpaceRole;
  data: Loaded;
  mine: { isOwner: boolean; roleIds: string[]; permissions: SpacePermission[] };
  editable: boolean;
  onChange: (action: () => Promise<unknown>) => Promise<void>;
  onDeleted: () => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const labels = useKeyLabels();
  const [name, setName] = useState(role.name);
  const held = new Set(role.keys);
  const admin = held.has("administrator");
  const holders = data.members.filter((member) => member.roleIds.includes(role.id));
  const candidates = data.members.filter(
    (member) => !member.roleIds.includes(role.id) && member.role !== "owner",
  );
  const base = role.systemKey === "everyone";

  function toggle(key: string, on: boolean) {
    const keys = on ? [...role.keys, key] : role.keys.filter((candidate) => candidate !== key);
    void onChange(() => rpc.spaces.roles.update({ id: role.id, keys }));
  }
  // The server refuses a key one does not hold; the switch says so before the request.
  const mayTouch = (key: string) => editable && (mine.isOwner || holdsAll({ ...mine }, [key]));

  function assign(userId: string, roleIds: string[]) {
    void onChange(() => rpc.spaces.members.setRoles({ userId, roleIds }));
  }

  return (
    <div className="space-y-4 border-t border-border bg-muted/30 px-4 py-4">
      {base || !editable ? null : (
        <Input
          aria-label={t`Role name`}
          maxLength={40}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const next = name.trim();
            if (next && next !== role.name)
              void onChange(() => rpc.spaces.roles.update({ id: role.id, name: next }));
            else setName(role.name);
          }}
        />
      )}
      {base ? null : (
        <KeySwitch
          label={t`Administrator`}
          checked={admin}
          disabled={!mayTouch("administrator")}
          onChange={(on) => toggle("administrator", on)}
        />
      )}
      {(Object.keys(SPACE_PERMISSION_AREAS) as Array<keyof typeof SPACE_PERMISSION_AREAS>).map(
        (area) => (
          <div key={area} className="space-y-1">
            <h4 className="text-[12.5px] font-medium text-muted-foreground">
              {labels.areas[area]}
            </h4>
            {SPACE_PERMISSION_AREAS[area].map((key) => (
              <KeySwitch
                key={key}
                label={labels.keys[key]}
                checked={admin || held.has(key)}
                disabled={admin || !mayTouch(key)}
                onChange={(on) => toggle(key, on)}
              />
            ))}
          </div>
        ),
      )}
      {base ? null : (
        <div className="space-y-2">
          <h4 className="text-[12.5px] font-medium text-muted-foreground">
            <Trans>People</Trans>
          </h4>
          <div className="flex flex-wrap items-center gap-2">
            {holders.map((member) => (
              <span
                key={member.userId}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12.5px]"
              >
                {member.name}
                {editable ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t`Remove ${member.name}`}
                    onClick={() =>
                      assign(
                        member.userId,
                        member.roleIds.filter((id) => id !== role.id),
                      )
                    }
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
            {editable && candidates.length > 0 ? (
              <Select
                value=""
                items={candidates.map((member) => ({ value: member.userId, label: member.name }))}
                onValueChange={(userId) => {
                  const member = candidates.find((candidate) => candidate.userId === userId);
                  if (member) assign(member.userId, [...member.roleIds, role.id]);
                }}
              >
                <SelectTrigger aria-label={t`Add person`} className="w-36 rounded-full">
                  <SelectValue placeholder={t`Add person`} />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {candidates.map((member) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>
      )}
      {base || !editable || role.systemKey ? null : (
        <InlineConfirm
          variant="ghost"
          size="sm"
          className="rounded-full"
          confirmLabel={t`Delete ${role.name}?`}
          onConfirm={() => {
            onDeleted();
            void onChange(() => rpc.spaces.roles.remove({ id: role.id }));
          }}
        >
          <Trans>Delete</Trans>
        </InlineConfirm>
      )}
    </div>
  );
}

function KeySwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 text-[14px]">
      <label htmlFor={id} className="min-w-0 truncate">
        {label}
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

/** What each key and area is called on screen. */
export function useKeyLabels() {
  const { t } = useLingui();
  return {
    areas: {
      chat: t`Chat`,
      agents: t`Agents`,
      tools: t`Tools`,
      knowledge: t`Knowledge`,
      space: t`Space`,
    },
    keys: {
      post: t`Post messages`,
      create_channels: t`Create channels`,
      manage_channels: t`Manage channels`,
      talk_to_agents: t`Talk to agents`,
      assign_work: t`Assign work`,
      manage_routines: t`Manage routines`,
      approve_actions: t`Approve actions`,
      create_agents: t`Create agents`,
      manage_agents: t`Manage agents`,
      use_computers: t`Use computers`,
      control_computers: t`Control computers`,
      manage_connections: t`Manage connections`,
      manage_credentials: t`Manage credentials`,
      edit_wiki: t`Edit the wiki`,
      upload_files: t`Upload files`,
      review_memory: t`Review memory`,
      invite_people: t`Invite people`,
      view_usage: t`View usage`,
      configure: t`Configure the space`,
      manage_members: t`Manage members`,
      manage_roles: t`Manage roles`,
      manage_billing: t`Manage billing`,
      create_spaces: t`Create spaces`,
      manage_partner: t`Manage partners`,
    } satisfies Record<Exclude<SpacePermission, "administrator">, string>,
  };
}
