import type { PartnerBranding, PartnerConsolePartner } from "@corvo/contracts";
import { Button, EmptyState, Input } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { brandingErrorText } from "../../lib/branding-errors";
import { rpc } from "../../lib/rpc";
import { brandingKey, useBranding } from "./PartnerBrand";
import { Panel, PartnerError, PartnerLoading, useAction } from "./partner-ui";

type Domain = NonNullable<PartnerBranding["domain"]>;

export function PartnerDomain({ partner }: { partner: PartnerConsolePartner }) {
  const { t } = useLingui();
  const branding = useBranding(partner);
  const queryClient = useQueryClient();
  const action = useAction();
  if (branding.isPending) return <PartnerLoading />;
  if (branding.isError) return <PartnerError error={branding.error} onRetry={branding.refetch} />;
  const data = branding.data;
  if (!data.domainsAvailable && !data.senderAvailable) {
    return <EmptyState title={t`Not available`} />;
  }
  const apply = (call: () => Promise<PartnerBranding>) =>
    action.run(async () => {
      queryClient.setQueryData(brandingKey(partner.id), await call());
    });
  const id = { partnerId: partner.id };
  return (
    <div className="space-y-4" data-testid="partner-domain">
      {data.domainsAvailable ? (
        <HostPanel
          domain={data.domain}
          busy={action.busy}
          onAdd={(hostname) => apply(() => rpc.partnerConsole.addDomain({ ...id, hostname }))}
          onCheck={() => apply(() => rpc.partnerConsole.checkDomain(id))}
          onRemove={() => apply(() => rpc.partnerConsole.removeDomain(id))}
        />
      ) : null}
      {data.senderAvailable && data.brand ? (
        <SenderPanel
          sender={data.sender}
          busy={action.busy}
          onSet={(domain) => apply(() => rpc.partnerConsole.setSenderDomain({ ...id, domain }))}
          onCheck={() => apply(() => rpc.partnerConsole.checkSenderDomain(id))}
        />
      ) : null}
      {action.error ? (
        <PartnerError error={action.error} message={brandingErrorText(action.error)} />
      ) : null}
    </div>
  );
}

function StateLabel({ state }: { state: string }) {
  const { t } = useLingui();
  const label =
    state === "active" || state === "verified"
      ? state === "active"
        ? t`Active`
        : t`Verified`
      : state === "failed"
        ? t`Failed`
        : t`Pending`;
  return (
    <span
      data-testid="domain-state"
      data-state={state}
      className="rounded-full border border-border px-2 py-0.5 text-caption text-muted-foreground"
    >
      {label}
    </span>
  );
}

function HostPanel({
  domain,
  busy,
  onAdd,
  onCheck,
  onRemove,
}: {
  domain: Domain | null;
  busy: boolean;
  onAdd: (hostname: string) => Promise<void>;
  onCheck: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [hostname, setHostname] = useState("");
  if (!domain) {
    return (
      <Panel>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (hostname.trim()) void onAdd(hostname.trim());
          }}
        >
          <Input
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            placeholder="app.example.com"
            aria-label={t`Domain`}
            inputMode="url"
          />
          <Button type="submit" disabled={busy || hostname.trim() === ""}>
            {t`Add`}
          </Button>
        </form>
      </Panel>
    );
  }
  return (
    <Panel
      title={domain.hostname}
      action={<StateLabel state={domain.state} />}
      data-testid="domain-panel"
    >
      <div className="space-y-3">
        {domain.nextStep === "add_cname" && domain.cname ? (
          <>
            <p className="text-sm">{t`Add this record at your DNS provider.`}</p>
            <DnsTable rows={[["CNAME", domain.cname.name, domain.cname.target]]} />
          </>
        ) : null}
        {domain.nextStep === "wait" ? (
          <p className="text-sm text-muted-foreground">{t`Waiting for the certificate.`}</p>
        ) : null}
        {domain.nextStep === "add_legal_links" ? (
          <p className="text-sm">{t`Add your terms and privacy links in Brand to go live.`}</p>
        ) : null}
        {domain.nextStep === "fix_error" && domain.error ? (
          <p role="alert" className="text-sm text-destructive">
            {domain.error}
          </p>
        ) : null}
        <div className="flex gap-2">
          {domain.state !== "active" ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void onCheck()}
            >
              {t`Check again`}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void onRemove()}
          >
            {t`Remove`}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function SenderPanel({
  sender,
  busy,
  onSet,
  onCheck,
}: {
  sender: PartnerBranding["sender"];
  busy: boolean;
  onSet: (domain: string | null) => Promise<void>;
  onCheck: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [domain, setDomain] = useState("");
  if (!sender.domain) {
    return (
      <Panel title={t`Email domain`}>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (domain.trim()) void onSet(domain.trim());
          }}
        >
          <Input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="mail.example.com"
            aria-label={t`Email domain`}
            inputMode="url"
          />
          <Button type="submit" disabled={busy || domain.trim() === ""}>
            {t`Add`}
          </Button>
        </form>
      </Panel>
    );
  }
  return (
    <Panel
      title={sender.domain}
      action={<StateLabel state={sender.state} />}
      data-testid="sender-panel"
    >
      <div className="space-y-3">
        {sender.state !== "verified" ? (
          <>
            <p className="text-sm">{t`Add these records at your DNS provider.`}</p>
            <DnsTable rows={sender.records.map((row) => [row.type, row.name, row.value])} />
          </>
        ) : null}
        <div className="flex gap-2">
          {sender.state !== "verified" ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void onCheck()}
            >
              {t`Check again`}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void onSet(null)}
          >
            {t`Remove`}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** DNS records exactly as they are typed at a provider: type, name, value. */
function DnsTable({ rows }: { rows: Array<[string, string, string]> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-start font-mono text-xs">
        <tbody>
          {rows.map(([type, name, value]) => (
            <tr
              key={`${type}-${name}-${value}`}
              className="border-t border-border first:border-t-0"
            >
              <td className="px-3 py-2 text-muted-foreground">{type}</td>
              <td className="px-3 py-2 break-all">{name}</td>
              <td className="px-3 py-2 break-all">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
