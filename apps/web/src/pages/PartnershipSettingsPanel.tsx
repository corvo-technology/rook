import type { PartnerAccount } from "@corvo/contracts";
import { PartnerTemplate } from "@corvo/contracts";
import { Button, Input, Skeleton } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "../lib/rpc";
import { PartnerTemplateEditor } from "./PartnerTemplateEditor";

export function PartnershipSettingsPanel({ onAddCredit }: { onAddCredit?: () => void }) {
  const { t, i18n } = useLingui();
  const money = (usd: number) =>
    new Intl.NumberFormat(i18n.locale || "en", { style: "currency", currency: "USD" }).format(usd);
  const [account, setAccount] = useState<PartnerAccount | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  /** A template read from a file, shown in the editor to be checked and saved. */
  const [imported, setImported] = useState<PartnerTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perCustomer, setPerCustomer] = useState("");
  const [perMonth, setPerMonth] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const { partner } = await rpc.partner.status();
      setAccount(partner);
      setPerCustomer(partner?.wallet?.perTenantLimitUsd?.toString() ?? "");
      setPerMonth(partner?.wallet?.monthlyLimitUsd?.toString() ?? "");
    } catch {
      setError(t`Could not load partnership`);
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(t`Something went wrong`);
    } finally {
      setBusy(false);
    }
  }

  async function importTemplate(file: File) {
    setError(null);
    try {
      // The address of the partner's server is filled in here, so a placeholder stands for none.
      const text = (await file.text())
        .split("{{MCP_PUBLIC_URL}}")
        .join("https://placeholder.invalid");
      const parsed = PartnerTemplate.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error("invalid");
      const { connector } = parsed.data;
      setImported({
        ...parsed.data,
        ...(connector
          ? {
              connector: {
                ...connector,
                endpoint: connector.endpoint.includes("placeholder.invalid")
                  ? ""
                  : connector.endpoint,
              },
            }
          : {}),
      });
      setEditing(true);
    } catch {
      setError(t`That file is not a valid template`);
    }
  }

  const showKey = (next: string) => {
    setKey(next);
    setCopied(false);
  };

  if (account === undefined) {
    return error ? (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    ) : (
      <Skeleton className="h-9 w-64" />
    );
  }

  return (
    <div className="space-y-4">
      {key ? (
        <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
          <code className="min-w-0 flex-1 break-all text-[13px]">{key}</code>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(key);
              setCopied(true);
            }}
          >
            {copied ? t`Copied` : t`Copy`}
          </Button>
        </div>
      ) : null}

      {account === null ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void run(async () => {
              showKey((await rpc.partner.create({ name: name.trim() })).key);
              await load();
            });
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label={t`Company name`}
            placeholder={t`Company name`}
            maxLength={120}
          />
          <Button type="submit" className="h-9" disabled={busy || !name.trim()}>
            <Trans>Become a partner</Trans>
          </Button>
        </form>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
            <div className="min-w-0">
              <h3 className="text-heading3 font-medium text-foreground">{account.name}</h3>
              <p className="mt-1 text-[12.5px] text-muted-foreground">{account.keyPrefix}…</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  showKey((await rpc.partner.rotateKey()).key);
                  await load();
                })
              }
            >
              <Trans>New key</Trans>
            </Button>
          </div>
          {account.wallet ? (
            <div className="space-y-3 rounded-xl border border-border px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[14px]">
                  {t`${money(account.wallet.balanceUsd)} to pass on`} ·{" "}
                  {t`${money(account.wallet.passedOnUsd)} passed on this month`}
                </span>
                {onAddCredit ? (
                  <Button variant="secondary" size="sm" onClick={onAddCredit}>
                    <Trans>Add credit</Trans>
                  </Button>
                ) : null}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const limit = (value: string) => (value.trim() === "" ? null : Number(value));
                  const perTenantLimitUsd = limit(perCustomer);
                  const monthlyLimitUsd = limit(perMonth);
                  if (
                    [perTenantLimitUsd, monthlyLimitUsd].some(
                      (value) => value !== null && !Number.isFinite(value),
                    )
                  )
                    return;
                  void run(async () => {
                    await rpc.partner.setLimits({ perTenantLimitUsd, monthlyLimitUsd });
                    await load();
                  });
                }}
              >
                <Input
                  value={perCustomer}
                  onChange={(event) => setPerCustomer(event.target.value)}
                  aria-label={t`Limit per customer, per month`}
                  placeholder={t`Limit per customer`}
                  inputMode="decimal"
                />
                <Input
                  value={perMonth}
                  onChange={(event) => setPerMonth(event.target.value)}
                  aria-label={t`Limit in total, per month`}
                  placeholder={t`Limit in total`}
                  inputMode="decimal"
                />
                <Button type="submit" variant="secondary" size="sm" className="h-9" disabled={busy}>
                  <Trans>Save</Trans>
                </Button>
              </form>
            </div>
          ) : null}
          {editing ? (
            <PartnerTemplateEditor
              template={imported ?? account.template}
              onCancel={() => {
                setEditing(false);
                setImported(null);
              }}
              onSave={async (template) => {
                await run(async () => {
                  await rpc.partner.setTemplate({ template });
                  await load();
                  setEditing(false);
                  setImported(null);
                });
              }}
            />
          ) : (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
              <span className="text-[14px]">
                {account.template?.agents.length ? (
                  account.template.agents.map((agent) => agent.name).join(", ")
                ) : (
                  <Trans>Agents</Trans>
                )}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => importInput.current?.click()}>
                  <Trans>Import</Trans>
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  <Trans>Edit</Trans>
                </Button>
              </div>
              <input
                ref={importInput}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                tabIndex={-1}
                aria-label={t`Import`}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void importTemplate(file);
                }}
              />
            </div>
          )}
          {account.tenants.length > 0 ? (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {account.tenants.map((tenant) => (
                <li
                  key={tenant.externalTenantId}
                  className="flex items-center justify-between gap-4 px-4 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px]">{tenant.name}</span>
                    <span className="block text-[12.5px] text-muted-foreground">
                      {t`${money(tenant.usedUsd)} used`} · {t`${money(tenant.balanceUsd)} left`}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await rpc.partner.setTenantState({
                          externalTenantId: tenant.externalTenantId,
                          state: tenant.state === "enabled" ? "suspended" : "enabled",
                        });
                        await load();
                      })
                    }
                  >
                    {tenant.state === "enabled" ? t`Pause` : t`Resume`}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
