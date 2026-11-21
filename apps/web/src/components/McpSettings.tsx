import type { McpAccessKey, McpAccessLevel, Space } from "@corvo/contracts";
import { Button, InlineConfirm, Input, OptionSelect } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { Copy, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatRelativeTime } from "../lib/relative-time";
import { rpc } from "../lib/rpc";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

/** The key just made, which is the only time its secret is known. */
type Created = { name: string; secret: string };

const ALL_SPACES = "";

function copy(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

/** Keys that let an MCP client such as Claude Code act as the person who made them. */
export function McpSettings({ spaces }: { spaces: ReadonlyArray<Pick<Space, "id" | "name">> }) {
  const { t } = useLingui();
  const [keys, setKeys] = useState<McpAccessKey[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<McpAccessLevel>("talk");
  const [spaceId, setSpaceId] = useState(ALL_SPACES);
  const [created, setCreated] = useState<Created | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `${window.location.origin}/mcp`;
  const command = `claude mcp add --transport http rook ${url} --header "Authorization: Bearer ${
    created?.secret ?? "<key>"
  }"`;

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void rpc.mcpAccess.list().then(
      (rows) => {
        if (active) setKeys(rows.filter((key) => !key.revokedAt));
      },
      () => {
        if (active) setLoadFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    try {
      const result = await rpc.mcpAccess.create({
        name: trimmed,
        level,
        ...(spaceId ? { spaceId } : {}),
      });
      setCreated({ name: result.key.name, secret: result.secret });
      setKeys((current) => [result.key, ...(current ?? [])]);
      setName("");
    } catch {
      setError(t`Could not create the key`);
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await rpc.mcpAccess.revoke({ keyId: id });
      setKeys((current) => (current ?? []).filter((key) => key.id !== id));
    } catch {
      setError(t`Could not revoke the key`);
    }
  }

  const levelLabels: Record<McpAccessLevel, string> = {
    read: t`Read`,
    talk: t`Talk`,
    configure: t`Configure`,
  };

  return (
    <div className="space-y-6" data-testid="mcp-settings">
      <SettingsGroup>
        <SettingsRow
          label={<Trans>URL</Trans>}
          control={
            <>
              <code className="min-w-0 truncate text-[13px]" data-testid="mcp-url">
                {url}
              </code>
              <Button variant="ghost" size="icon-sm" aria-label={t`Copy`} onClick={() => copy(url)}>
                <Copy />
              </Button>
            </>
          }
        />
        <SettingsRow
          label={<code className="block break-all text-[12.5px]">{command}</code>}
          control={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Copy`}
              onClick={() => copy(command)}
            >
              <Copy />
            </Button>
          }
        />
      </SettingsGroup>

      {created ? (
        <div
          role="status"
          data-testid="mcp-created"
          className="space-y-2 rounded-xl border border-border px-4 py-3"
        >
          <p className="text-[13.5px] text-foreground">
            <Trans>Copy the key now. It is not shown again.</Trans>
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-[13px]" data-testid="mcp-secret">
              {created.secret}
            </code>
            <Button
              variant="secondary"
              size="sm"
              aria-label={t`Copy`}
              onClick={() => copy(created.secret)}
            >
              <Trans>Copy</Trans>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
              <Trans>Done</Trans>
            </Button>
          </div>
        </div>
      ) : null}

      <SettingsGroup title={t`Keys`}>
        <form
          className="flex flex-wrap items-center gap-2 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Input
            aria-label={t`Name`}
            placeholder={t`Name`}
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            className="h-8 min-w-32 flex-1"
          />
          <OptionSelect
            aria-label={t`Access`}
            className="w-36"
            value={level}
            options={(Object.keys(levelLabels) as McpAccessLevel[]).map((value) => ({
              value,
              label: levelLabels[value],
            }))}
            onValueChange={setLevel}
          />
          {spaces.length > 1 ? (
            <OptionSelect
              aria-label={t`Space`}
              className="w-40"
              value={spaceId}
              options={[
                { value: ALL_SPACES, label: t`All spaces` },
                ...spaces.map((space) => ({ value: space.id, label: space.name })),
              ]}
              onValueChange={setSpaceId}
            />
          ) : null}
          <Button type="submit" size="sm" disabled={pending || !name.trim()}>
            <Trans>Create key</Trans>
          </Button>
        </form>
        {loadFailed ? (
          <div
            role="alert"
            className="flex items-center gap-2 px-4 py-3 text-[13.5px] text-destructive"
          >
            <Trans>Could not load</Trans>
            <Button variant="outline" size="xs" onClick={() => setAttempt((value) => value + 1)}>
              <Trans>Retry</Trans>
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="px-4 py-3 text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}
        {(keys ?? []).length > 0 ? (
          <ul className="divide-y divide-border">
            {(keys ?? []).map((key) => (
              <li key={key.id} className="flex min-h-14 items-center gap-2 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-foreground">{key.name}</p>
                  <p className="truncate text-[12.5px] text-muted-foreground">
                    {[
                      levelLabels[key.level],
                      key.spaceName,
                      key.lastUsedAt ? formatRelativeTime(key.lastUsedAt) : t`Never used`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <InlineConfirm
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t`Revoke ${key.name}`}
                  confirmLabel={t`Confirm revoke?`}
                  className="text-destructive hover:text-destructive data-armed:w-auto data-armed:px-2.5"
                  onConfirm={() => void revoke(key.id)}
                >
                  <Trash2 />
                </InlineConfirm>
              </li>
            ))}
          </ul>
        ) : null}
      </SettingsGroup>
    </div>
  );
}
