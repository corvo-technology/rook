import type { McpServer, McpTransport } from "@corvo/contracts";
import { deriveMcpSlug } from "@corvo/core";
import {
  Button,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  Toggle,
} from "@corvo/ui-web";
import { Disclosure } from "@corvo/ui-web/components/ui/disclosure";
import { Trans, useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import { useState } from "react";
import { mcpOAuthRedirectUri } from "../../lib/mcp-connect";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

type EnvRow = { id: number; name: string; value: string; file: boolean };

/** How an env value asks Rook to inject the granted OAuth access token. */
const oauthEnvReference = "{{oauth.access_token}}";

let nextEnvRowId = 0;
const emptyEnvRow = (): EnvRow => ({
  id: nextEnvRowId++,
  name: "",
  value: "",
  file: false,
});

/** Environment variable names the server accepts: capitals, digits, and underscores. */
function envName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/^(?=[0-9])/, "_");
}

/**
 * The form for an MCP server by URL (or command): to add one, or to edit the one given. It saves
 * the server itself; who may use it is the Access sheet's business, never this form's.
 */
export function McpServerForm({
  editing,
  stdioEnabled,
  onSaved,
  onCancel,
}: {
  editing: McpServer | null;
  /** Whether this deployment runs stdio servers. */
  stdioEnabled: boolean;
  onSaved: (server: McpServer) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [transport, setTransport] = useState<McpTransport>(editing?.transport ?? "streamable_http");
  const [name, setName] = useState(editing?.name ?? "");
  const [endpoint, setEndpoint] = useState(editing?.endpoint ?? "");
  const [secret, setSecret] = useState("");
  const [headerName, setHeaderName] = useState(editing?.headerKeys[0] ?? "Authorization");
  const [headerValue, setHeaderValue] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthAuthorizationServer, setOauthAuthorizationServer] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthParams, setOauthParams] = useState("");
  const [command, setCommand] = useState(editing?.command ?? "");
  const [args, setArgs] = useState(editing?.args.join(" ") ?? "");
  // Stored values are never sent back to the client, so a blank one keeps what is stored.
  const [envRows, setEnvRows] = useState<EnvRow[]>(() => {
    const rows = editing
      ? [
          ...editing.envKeys.map((name) => ({ ...emptyEnvRow(), name })),
          ...editing.fileKeys.map((name) => ({ ...emptyEnvRow(), name, file: true })),
        ]
      : [];
    return rows.length > 0 ? rows : [emptyEnvRow()];
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const duplicateNames = new Set(
    envRows
      .filter(
        (row, index) =>
          row.name &&
          envRows.some(
            (other, otherIndex) =>
              otherIndex !== index && envName(other.name) === envName(row.name),
          ),
      )
      .map((row) => row.name),
  );

  function updateEnvRow(id: number, patch: Partial<EnvRow>) {
    setEnvRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function save() {
    if (transport === "stdio" && duplicateNames.size > 0) return;
    setError(null);
    if (!name.trim()) {
      setError(t`Add a server name.`);
      return;
    }
    if (transport !== "stdio" && !endpoint.trim()) {
      setError(t`Add an HTTPS server URL.`);
      return;
    }
    if (transport === "stdio" && !command.trim()) {
      setError(t`Add a stdio command.`);
      return;
    }
    setSaving(true);
    try {
      const slug = deriveMcpSlug(name);
      const headers = {
        ...Object.fromEntries((editing?.headerKeys ?? []).map((key) => [key, ""])),
        ...(headerValue.trim()
          ? { [headerName.trim() || "Authorization"]: headerValue.trim() }
          : {}),
      };
      const oauthBase = oauthClientId.trim()
        ? {
            clientId: oauthClientId.trim(),
            clientSecret: oauthClientSecret || undefined,
            scope: oauthScope.trim() || undefined,
            authorizationParams: oauthParams.trim() || undefined,
          }
        : undefined;
      const envEntries = (file: boolean) =>
        Object.fromEntries(
          envRows
            .filter((row) => row.name && row.file === file)
            .map((row) => [row.name, row.value]),
        );
      const config =
        transport === "stdio"
          ? {
              slug,
              name: name.trim(),
              transport,
              command: command.trim(),
              // Untouched arguments keep their boundaries, spaces included.
              args:
                editing && args === editing.args.join(" ")
                  ? editing.args
                  : args.split(/\s+/).filter(Boolean),
              env: envEntries(false),
              files: envEntries(true),
              secret: secret || undefined,
              oauthClient: oauthBase
                ? {
                    ...oauthBase,
                    authorizationServer: oauthAuthorizationServer.trim(),
                  }
                : undefined,
              enabled: true,
            }
          : {
              slug,
              name: name.trim(),
              transport,
              endpoint: endpoint.trim(),
              headers,
              secret: secret || undefined,
              oauthClient: oauthBase,
              enabled: true,
            };
      const server = editing
        ? await rpc.mcp.servers.update({
            id: editing.id,
            config: {
              ...config,
              slug: editing.slug,
              description: editing.description,
              enabled: editing.enabled,
            },
          })
        : await rpc.mcp.servers.create(config);
      onSaved(server);
    } catch (err) {
      setError(errorText(err, editing ? t`Could not save` : t`Could not add MCP server`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="mcp-name">
            <Trans>Server name</Trans>
          </FieldLabel>
          <Input
            id="mcp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mobbin"
          />
        </Field>
        <Tabs value={transport} onValueChange={(value) => setTransport(value as McpTransport)}>
          <TabsList className="w-full">
            <TabsTrigger value="streamable_http">HTTP</TabsTrigger>
            <TabsTrigger value="sse">SSE</TabsTrigger>
            {stdioEnabled || editing?.transport === "stdio" ? (
              <TabsTrigger value="stdio">STDIO</TabsTrigger>
            ) : null}
          </TabsList>
        </Tabs>
        {transport === "stdio" ? (
          <>
            <Field>
              <FieldLabel htmlFor="mcp-command">
                <Trans>Command</Trans>
              </FieldLabel>
              <Input
                id="mcp-command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="/opt/mcp-server"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mcp-args">
                <Trans>Arguments</Trans>
              </FieldLabel>
              <Input
                id="mcp-args"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="--stdio"
              />
            </Field>
          </>
        ) : (
          <Field>
            <FieldLabel htmlFor="mcp-endpoint">
              <Trans>Server URL</Trans>
            </FieldLabel>
            <Input
              id="mcp-endpoint"
              type="url"
              autoComplete="off"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://api.mobbin.com/mcp"
            />
          </Field>
        )}
        <Disclosure
          className="group rounded-xl border border-border"
          summary={<Trans>Advanced</Trans>}
          summaryClassName="w-full flex items-center justify-between px-3 py-2.5 text-sm text-foreground"
        >
          <div className="space-y-4 border-t border-border p-3">
            <Field>
              <FieldLabel htmlFor="mcp-secret">
                <Trans>Access token (optional)</Trans>
              </FieldLabel>
              <Input
                id="mcp-secret"
                type="password"
                autoComplete="new-password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={t`Stored encrypted`}
              />
            </Field>
            {transport === "stdio" ? (
              <Field>
                <FieldTitle>
                  <Trans>Environment variables</Trans>
                </FieldTitle>
                {envRows.map((row) => (
                  <Field
                    key={row.id}
                    orientation="horizontal"
                    data-invalid={duplicateNames.has(row.name) || undefined}
                    className="grid grid-cols-[.7fr_1fr_auto_auto] items-start gap-2"
                  >
                    <Input
                      aria-label={t`Name`}
                      aria-invalid={duplicateNames.has(row.name) || undefined}
                      aria-describedby={
                        duplicateNames.has(row.name) ? `mcp-env-error-${row.id}` : undefined
                      }
                      autoComplete="off"
                      className={row.file ? "col-span-2" : undefined}
                      value={row.name}
                      onChange={(e) =>
                        updateEnvRow(row.id, {
                          name: envName(e.target.value),
                        })
                      }
                      placeholder="API_KEY"
                    />
                    {row.file ? null : (
                      <Input
                        aria-label={t`Value`}
                        type={row.value.includes("{{oauth.") ? "text" : "password"}
                        autoComplete={row.value.includes("{{oauth.") ? "off" : "new-password"}
                        value={row.value}
                        onChange={(e) =>
                          updateEnvRow(row.id, {
                            value: e.target.value,
                          })
                        }
                        placeholder={t`Stored encrypted`}
                      />
                    )}
                    <Toggle
                      variant="outline"
                      size="sm"
                      pressed={row.file}
                      onPressedChange={(file) => updateEnvRow(row.id, { file })}
                    >
                      <Trans>File</Trans>
                    </Toggle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t`Remove`}
                      onClick={() =>
                        setEnvRows((rows) =>
                          rows.length > 1
                            ? rows.filter((item) => item.id !== row.id)
                            : [emptyEnvRow()],
                        )
                      }
                    >
                      <X />
                    </Button>
                    {row.file ? (
                      <Textarea
                        aria-label={t`Value`}
                        autoComplete="off"
                        spellCheck={false}
                        className="col-span-full min-h-24 font-mono text-xs"
                        value={row.value}
                        onChange={(e) =>
                          updateEnvRow(row.id, {
                            value: e.target.value,
                          })
                        }
                      />
                    ) : null}
                    {duplicateNames.has(row.name) ? (
                      <FieldError id={`mcp-env-error-${row.id}`} className="col-span-full">
                        <Trans>Each name can be used once.</Trans>
                      </FieldError>
                    ) : null}
                  </Field>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="self-start"
                  onClick={() => setEnvRows((rows) => [...rows, emptyEnvRow()])}
                >
                  <Trans>Add</Trans>
                </Button>
                {oauthClientId.trim() ? (
                  <p className="text-xs text-muted-foreground">
                    <Trans>Use {oauthEnvReference} for the access token.</Trans>
                  </p>
                ) : null}
              </Field>
            ) : (
              <div className="grid grid-cols-[.7fr_1fr] gap-2">
                <Input
                  aria-label={t`Header name`}
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                />
                <Input
                  aria-label={t`Header value`}
                  type="password"
                  autoComplete="new-password"
                  value={headerValue}
                  onChange={(e) => setHeaderValue(e.target.value)}
                  placeholder={t`Optional header value`}
                />
              </div>
            )}
            <Field>
              <FieldLabel htmlFor="mcp-oauth-client-id">
                <Trans>OAuth client ID (optional)</Trans>
              </FieldLabel>
              <Input
                id="mcp-oauth-client-id"
                autoComplete="off"
                value={oauthClientId}
                onChange={(e) => setOauthClientId(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mcp-oauth-client-secret">
                <Trans>OAuth client secret (optional)</Trans>
              </FieldLabel>
              <Input
                id="mcp-oauth-client-secret"
                type="password"
                autoComplete="new-password"
                value={oauthClientSecret}
                onChange={(e) => setOauthClientSecret(e.target.value)}
                placeholder={t`Stored encrypted`}
              />
            </Field>
            {oauthClientId.trim() ? (
              <>
                {transport === "stdio" ? (
                  <Field>
                    <FieldLabel htmlFor="mcp-oauth-authorization-server">
                      <Trans>Authorization server</Trans>
                    </FieldLabel>
                    <Input
                      id="mcp-oauth-authorization-server"
                      type="url"
                      autoComplete="off"
                      value={oauthAuthorizationServer}
                      onChange={(e) => setOauthAuthorizationServer(e.target.value)}
                      placeholder="https://accounts.google.com"
                    />
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel htmlFor="mcp-oauth-scope">
                    <Trans>Scopes (optional)</Trans>
                  </FieldLabel>
                  <Input
                    id="mcp-oauth-scope"
                    autoComplete="off"
                    value={oauthScope}
                    onChange={(e) => setOauthScope(e.target.value)}
                    placeholder="openid email"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="mcp-oauth-params">
                    <Trans>Authorization parameters (optional)</Trans>
                  </FieldLabel>
                  <Input
                    id="mcp-oauth-params"
                    autoComplete="off"
                    value={oauthParams}
                    onChange={(e) => setOauthParams(e.target.value)}
                    placeholder="access_type=offline&prompt=consent"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="mcp-oauth-redirect-uri">
                    <Trans>Redirect URI</Trans>
                  </FieldLabel>
                  <Input
                    id="mcp-oauth-redirect-uri"
                    readOnly
                    value={mcpOAuthRedirectUri()}
                    onFocus={(e) => e.target.select()}
                  />
                </Field>
              </>
            ) : null}
          </div>
        </Disclosure>
      </FieldGroup>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={saving || (transport === "stdio" && duplicateNames.size > 0)}
          onClick={() => void save()}
        >
          {editing ? (
            saving ? (
              <Trans>Saving…</Trans>
            ) : (
              <Trans>Save</Trans>
            )
          ) : saving ? (
            <Trans>Adding…</Trans>
          ) : (
            <Trans>Add server</Trans>
          )}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
      </div>
    </div>
  );
}
