import type { PartnerConsolePartner } from "@corvo/contracts";
import { Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { formatMoney, formatNumber, monthLabel, partnerPath } from "../../lib/partner-console";
import { rpc } from "../../lib/rpc";
import { Kpi, Panel, PartnerError, PartnerLoading } from "./partner-ui";

type Attention = {
  kind: "credit_low" | "past_due" | "connector_down" | "invoice_issued";
  tenantId?: string;
  tenantName?: string;
  detail: string;
};

/** What the partner earns this month, how the customers are doing, and what needs the partner. */
export function PartnerOverview({ partner }: { partner: PartnerConsolePartner }) {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const overview = useQuery({
    queryKey: ["partner-console", partner.id, "overview"],
    queryFn: () => rpc.partnerConsole.overview({ partnerId: partner.id }),
  });
  if (overview.isPending) return <PartnerLoading />;
  if (overview.isError) return <PartnerError error={overview.error} onRetry={overview.refetch} />;
  const data = overview.data;
  const money = (minor: number) => formatMoney(minor, data.currency, i18n.locale);
  const top = Math.max(1, ...data.monthly.map((month) => month.total));

  function attentionText(item: Attention): string {
    const name = item.tenantName ?? "";
    switch (item.kind) {
      case "credit_low":
        return t`${name} · credit at ${item.detail}`;
      case "past_due":
        return t`${name} · payment overdue`;
      case "connector_down":
        return t`${name} · connection down`;
      case "invoice_issued":
        return t`Invoice for ${item.detail} issued`;
    }
  }

  function open(item: Attention) {
    if (item.kind === "invoice_issued") {
      navigate(partnerPath(partner.id, partner.mode === "embedded" ? "invoices" : "revenue"));
      return;
    }
    const to = partnerPath(partner.id, "customers");
    navigate(item.tenantId ? `${to}?customer=${encodeURIComponent(item.tenantId)}` : to);
  }

  return (
    <div className="space-y-4" data-testid="partner-overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={t`Revenue`}
          value={money(data.revenue.total)}
          detail={t`${money(data.revenue.commission)} commission · ${money(data.revenue.markup)} markup`}
        />
        <Kpi
          label={t`Active customers`}
          value={formatNumber(data.activeCustomers, i18n.locale)}
          detail={t`${data.newCustomers} new`}
        />
        <Kpi label={t`Low credit`} value={formatNumber(data.creditLow, i18n.locale)} />
        <Kpi label={t`Past due`} value={formatNumber(data.pastDue, i18n.locale)} />
      </div>
      <Panel title={t`Revenue by month`}>
        <div
          className="flex h-40 items-end gap-2"
          role="img"
          aria-label={t`Revenue by month`}
          data-testid="partner-bars"
        >
          {data.monthly.map((month) => (
            <div
              key={month.month}
              className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1"
            >
              <div
                title={money(month.total)}
                className="w-full rounded-t-sm bg-primary"
                style={{ height: `${Math.max(2, (month.total / top) * 100)}%` }}
              />
              <div className="text-center text-meta text-muted-foreground">
                {monthLabel(month.month, i18n.locale)}
              </div>
            </div>
          ))}
        </div>
      </Panel>
      {data.attention.length > 0 ? (
        <Panel title={t`Needs you`}>
          <ul className="divide-y divide-border">
            {data.attention.map((item) => (
              <li
                key={`${item.kind}:${item.tenantId ?? ""}:${item.detail}`}
                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <span className="min-w-0 truncate text-[14px]">{attentionText(item)}</span>
                <Button variant="secondary" size="sm" onClick={() => open(item)}>
                  {t`Open`}
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
