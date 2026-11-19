import type { PartnerAlertKind, PartnerConsolePartner } from "@corvo/contracts";
import { Button, InlineConfirm, Input, Switch } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { rpc } from "../../lib/rpc";
import { Panel, PartnerError, PartnerLoading, useAction } from "./partner-ui";

function useAlertLabel() {
  const { t } = useLingui();
  return (kind: PartnerAlertKind) => {
    switch (kind) {
      case "customer.credit_limit_reached":
        return t`Customer reached the monthly limit`;
      case "partner.balance_low":
        return t`Credit fund running low`;
      case "partner.autotopup_started":
        return t`Automatic top-up started`;
      case "partner.autotopup_failed":
        return t`Automatic top-up failed`;
      case "invoice.issued":
        return t`New invoice`;
      case "subscription.lapsed":
        return t`Customer payment past due`;
      case "customer.connector_down":
        return t`Customer connector down`;
    }
  };
}

/** The keys, the webhook and the docs a partner connects its product with. */
export function PartnerIntegration({ partner }: { partner: PartnerConsolePartner }) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const rotate = useAction();
  const hook = useAction();
  const alert = useAction();
  const alertLabel = useAlertLabel();
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const testKey = useAction();
  const testHook = useAction();
  const wipe = useAction();
  const [freshTest, setFreshTest] = useState<string | null>(null);
  const [testUrl, setTestUrl] = useState<string | null>(null);
  const integration = useQuery({
    queryKey: ["partner-console", partner.id, "integration"],
    queryFn: () => rpc.partnerConsole.integration({ partnerId: partner.id }),
  });
  if (integration.isPending) return <PartnerLoading />;
  if (integration.isError)
    return <PartnerError error={integration.error} onRetry={integration.refetch} />;
  const data = integration.data;
  const webhook = url ?? data.webhook.url ?? "";
  const testWebhook = testUrl ?? data.testWebhook.url ?? "";
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["partner-console", partner.id, "integration"] });

  return (
    <div className="space-y-4" data-testid="partner-integration">
      <Panel title={t`Keys`}>
        <div className="space-y-3">
          {fresh ? (
            <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
              <code className="min-w-0 flex-1 break-all text-[13px]" data-testid="partner-new-key">
                {fresh}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(fresh);
                  setCopied(true);
                }}
              >
                {copied ? t`Copied` : t`Copy`}
              </Button>
            </div>
          ) : null}
          <ul className="divide-y divide-border">
            {data.keys.map((key) => (
              <li key={key.prefix} className="flex items-center justify-between gap-3 py-2">
                <code className="text-[13px]">{key.prefix}…</code>
                <InlineConfirm
                  variant="secondary"
                  size="sm"
                  disabled={rotate.busy}
                  confirmLabel={t`Replace key? The old one stops working.`}
                  onConfirm={() =>
                    void rotate.run(async () => {
                      const next = await rpc.partnerConsole.rotateKey({ partnerId: partner.id });
                      setFresh(next.key);
                      setCopied(false);
                      await refresh();
                    })
                  }
                >
                  {t`New key`}
                </InlineConfirm>
              </li>
            ))}
          </ul>
          {rotate.error ? <PartnerError error={rotate.error} /> : null}
        </div>
      </Panel>
      <Panel title={t`Test`} data-testid="partner-test-mode">
        <div className="space-y-3">
          {freshTest ? (
            <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
              <code
                className="min-w-0 flex-1 break-all text-[13px]"
                data-testid="partner-new-test-key"
              >
                {freshTest}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void navigator.clipboard?.writeText(freshTest)}
              >
                {t`Copy`}
              </Button>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            {data.testKey.prefix ? (
              <>
                <code className="text-[13px]">{data.testKey.prefix}…</code>
                <InlineConfirm
                  variant="secondary"
                  size="sm"
                  disabled={testKey.busy}
                  confirmLabel={t`Replace key? The old one stops working.`}
                  onConfirm={() =>
                    void testKey.run(async () => {
                      const next = await rpc.partnerConsole.rotateTestKey({
                        partnerId: partner.id,
                      });
                      setFreshTest(next.key);
                      await refresh();
                    })
                  }
                >
                  {t`New key`}
                </InlineConfirm>
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={testKey.busy}
                onClick={() =>
                  void testKey.run(async () => {
                    const next = await rpc.partnerConsole.rotateTestKey({ partnerId: partner.id });
                    setFreshTest(next.key);
                    await refresh();
                  })
                }
              >
                {t`Create test key`}
              </Button>
            )}
          </div>
          {testKey.error ? <PartnerError error={testKey.error} /> : null}
          {data.testKey.prefix ? (
            <>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void testHook.run(async () => {
                    await rpc.partnerConsole.setTestWebhook({
                      partnerId: partner.id,
                      url: testWebhook.trim() === "" ? null : testWebhook.trim(),
                    });
                    setTestUrl(null);
                    await refresh();
                  });
                }}
              >
                <Input
                  value={testWebhook}
                  onChange={(event) => setTestUrl(event.target.value)}
                  placeholder="https://"
                  inputMode="url"
                  aria-label={t`Test webhook URL`}
                />
                <Button type="submit" variant="secondary" disabled={testHook.busy}>
                  {t`Save`}
                </Button>
              </form>
              {testHook.error ? <PartnerError error={testHook.error} /> : null}
              {data.testKey.customers > 0 ? (
                <InlineConfirm
                  variant="secondary"
                  size="sm"
                  disabled={wipe.busy}
                  confirmLabel={t`Delete every test customer and their data?`}
                  onConfirm={() =>
                    void wipe.run(async () => {
                      await rpc.partnerConsole.clearTestData({ partnerId: partner.id });
                      await refresh();
                      await queryClient.invalidateQueries({
                        queryKey: ["partner-console", partner.id, "customers"],
                      });
                    })
                  }
                >
                  {t`Clear test data`}
                </InlineConfirm>
              ) : null}
              {wipe.error ? <PartnerError error={wipe.error} /> : null}
            </>
          ) : null}
        </div>
      </Panel>
      <Panel title={t`Email alerts`} data-testid="partner-alerts">
        <ul className="divide-y divide-border">
          {data.alerts.map((item) => (
            <li key={item.kind} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-[14px]">{alertLabel(item.kind)}</span>
              <Switch
                checked={item.email}
                disabled={alert.busy}
                aria-label={alertLabel(item.kind)}
                onCheckedChange={(email) =>
                  void alert.run(async () => {
                    await rpc.partnerConsole.setAlertEmail({
                      partnerId: partner.id,
                      kind: item.kind,
                      email,
                    });
                    await refresh();
                  })
                }
              />
            </li>
          ))}
        </ul>
        {alert.error ? <PartnerError error={alert.error} /> : null}
      </Panel>
      <Panel title={t`Webhook`}>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void hook.run(async () => {
              await rpc.partnerConsole.setWebhook({
                partnerId: partner.id,
                url: webhook.trim() === "" ? null : webhook.trim(),
              });
              setUrl(null);
              await refresh();
            });
          }}
        >
          <Input
            value={webhook}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://"
            inputMode="url"
            aria-label={t`Webhook URL`}
          />
          <Button type="submit" variant="secondary" disabled={hook.busy}>
            {t`Save`}
          </Button>
        </form>
        {hook.error ? <PartnerError error={hook.error} /> : null}
      </Panel>
      <a
        href={data.docsUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-block text-[14px] underline-offset-4 hover:underline"
      >
        {t`Documentation`}
      </a>
    </div>
  );
}
