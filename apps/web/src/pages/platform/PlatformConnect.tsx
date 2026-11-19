import {
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
import { useSpaceQueries } from "../../lib/query";
import { Panel, PartnerError, PartnerLoading } from "../partner/partner-ui";

const MONTHS = 12;

/** For Rook's admins: where each white label partner's account stands, and the ledger against the provider. */
export function PlatformConnect() {
  const { t, i18n } = useLingui();
  const [period, setPeriod] = useState(currentPeriod());
  const queries = useSpaceQueries();
  const partners = useQuery(queries.platform.connect.list.queryOptions());
  const reconciliation = useQuery(
    queries.platform.connect.reconcile.queryOptions({ input: { period } }),
  );
  const periods = Array.from({ length: MONTHS }, (_, index) =>
    previousPeriod(currentPeriod(), index),
  );
  const state = (value: "none" | "pending" | "restricted" | "active" | "disabled") => {
    switch (value) {
      case "none":
        return t`Not connected`;
      case "pending":
        return t`Setup in progress`;
      case "restricted":
        return t`Action needed`;
      case "active":
        return t`Active`;
      case "disabled":
        return t`Disabled`;
    }
  };

  return (
    <div data-testid="platform-connect" className="flex flex-col gap-4">
      <Panel>
        {partners.isPending ? (
          <PartnerLoading />
        ) : partners.isError ? (
          <PartnerError error={partners.error} onRetry={() => void partners.refetch()} />
        ) : partners.data.length === 0 ? (
          <EmptyState title={t`No white label partners`} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t`Partner`}</TableHead>
                <TableHead>{t`Status`}</TableHead>
                <TableHead className="text-end">{t`Customers`}</TableHead>
                <TableHead className="text-end">{t`Disputes`}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.data.map((partner) => (
                <TableRow key={partner.id}>
                  <TableCell className="font-medium">{partner.name}</TableCell>
                  <TableCell data-state={partner.state}>
                    {state(partner.state)}
                    {partner.accountHint ? (
                      <span className="ms-2 text-meta text-muted-foreground">
                        …{partner.accountHint}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{partner.customers}</TableCell>
                  <TableCell className="text-end tabular-nums">{partner.disputesOpen}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel
        title={t`Fees`}
        action={
          <NativeSelect
            size="sm"
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
        }
      >
        {reconciliation.isPending ? (
          <PartnerLoading />
        ) : reconciliation.isError ? (
          <PartnerError
            error={reconciliation.error}
            onRetry={() => void reconciliation.refetch()}
          />
        ) : reconciliation.data.rows.length === 0 ? (
          <EmptyState title={t`No fees this month`} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t`Partner`}</TableHead>
                <TableHead className="text-end">{t`Ledger`}</TableHead>
                <TableHead className="text-end">{t`Provider`}</TableHead>
                <TableHead className="text-end">{t`Difference`}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reconciliation.data.rows.map((row) => (
                <TableRow key={`${row.partnerId}-${row.currency}`}>
                  <TableCell className="font-medium">{row.partnerName}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(row.ledgerMinor, row.currency, i18n.locale)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(row.providerMinor, row.currency, i18n.locale)}
                  </TableCell>
                  <TableCell
                    data-testid="platform-connect-difference"
                    className={`text-end tabular-nums ${row.differenceMinor === 0 ? "" : "text-warning"}`}
                  >
                    {formatMoney(row.differenceMinor, row.currency, i18n.locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
