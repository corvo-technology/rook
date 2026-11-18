import type { PartnerConsolePartner } from "@corvo/contracts";
import {
  Button,
  EmptyState,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { currentPeriod, formatMoney, monthLabel, previousPeriod } from "../../lib/partner-console";
import { rpc } from "../../lib/rpc";
import { Kpi, PartnerError, PartnerLoading, useAction } from "./partner-ui";

const MONTHS = 12;

/** What a referral or white-label partner earned in a month, line by line, and the CSV of it. */
export function PartnerRevenue({ partner }: { partner: PartnerConsolePartner }) {
  const { t, i18n } = useLingui();
  const [period, setPeriod] = useState(currentPeriod());
  const download = useAction();
  const revenue = useQuery({
    queryKey: ["partner-console", partner.id, "revenue", period],
    queryFn: () => rpc.partnerConsole.revenue({ partnerId: partner.id, period }),
  });
  const periods = Array.from({ length: MONTHS }, (_, index) =>
    previousPeriod(currentPeriod(), index),
  );
  const kind = (value: "subscription" | "topup" | "refund" | "adjustment") => {
    switch (value) {
      case "subscription":
        return t`Subscription`;
      case "topup":
        return t`Top-up`;
      case "refund":
        return t`Refund`;
      case "adjustment":
        return t`Adjustment`;
    }
  };

  async function downloadCsv() {
    const file = await rpc.partnerConsole.revenueCsv({ partnerId: partner.id, period });
    const link = document.createElement("a");
    link.href = file.url;
    link.download = file.filename;
    document.body.append(link);
    link.click();
    link.remove();
  }

  return (
    <div className="space-y-4" data-testid="partner-revenue">
      <div className="flex items-center justify-between gap-3">
        <NativeSelect
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
          aria-label={t`Month`}
        >
          {periods.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {monthLabel(value, i18n.locale, "long")} {value.slice(0, 4)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          variant="secondary"
          disabled={download.busy || !revenue.data}
          onClick={() => void download.run(downloadCsv)}
        >
          {t`Download CSV`}
        </Button>
      </div>
      {download.error ? <PartnerError error={download.error} /> : null}
      {revenue.isPending ? (
        <PartnerLoading />
      ) : revenue.isError ? (
        <PartnerError error={revenue.error} onRetry={revenue.refetch} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(() => {
              const money = (minor: number) =>
                formatMoney(minor, revenue.data.currency, i18n.locale);
              const totals = revenue.data.totals;
              return (
                <>
                  <Kpi label={t`You earn`} value={money(totals.partnerMinor)} />
                  <Kpi label={t`Commission`} value={money(totals.commissionMinor)} />
                  <Kpi label={t`Markup`} value={money(totals.markupMinor)} />
                  <Kpi label={t`Customers paid`} value={money(totals.paidMinor)} />
                </>
              );
            })()}
          </div>
          {revenue.data.lines.length === 0 ? (
            <EmptyState title={t`No revenue this month`} />
          ) : (
            <div className="rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t`Customer`}</TableHead>
                    <TableHead>{t`Type`}</TableHead>
                    <TableHead className="text-end">{t`Commission`}</TableHead>
                    <TableHead className="text-end">{t`Markup`}</TableHead>
                    <TableHead className="text-end">{t`Paid`}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revenue.data.lines.map((line) => {
                    const money = (minor: number) =>
                      formatMoney(minor, revenue.data.currency, i18n.locale);
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="font-medium">{line.tenantName}</TableCell>
                        <TableCell>{kind(line.kind)}</TableCell>
                        <TableCell className="text-end tabular-nums">
                          {money(line.commissionMinor)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {money(line.markupMinor)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {money(line.paidMinor)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
