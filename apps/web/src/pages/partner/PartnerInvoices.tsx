import type { PartnerConsolePartner } from "@corvo/contracts";
import {
  Badge,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { formatMoney, monthLabel } from "../../lib/partner-console";
import { rpc } from "../../lib/rpc";
import { PartnerError, PartnerLoading } from "./partner-ui";

/** What an embedded partner has been billed by Rook, month by month. */
export function PartnerInvoices({ partner }: { partner: PartnerConsolePartner }) {
  const { t, i18n } = useLingui();
  const invoices = useQuery({
    queryKey: ["partner-console", partner.id, "invoices"],
    queryFn: () => rpc.partnerConsole.invoices({ partnerId: partner.id }),
  });
  if (invoices.isPending) return <PartnerLoading />;
  if (invoices.isError) return <PartnerError error={invoices.error} onRetry={invoices.refetch} />;
  if (invoices.data.length === 0) return <EmptyState title={t`No invoices`} />;
  const state = (value: "draft" | "issued" | "paid" | "void") => {
    switch (value) {
      case "draft":
        return t`Draft`;
      case "issued":
        return t`Issued`;
      case "paid":
        return t`Paid`;
      case "void":
        return t`Void`;
    }
  };
  return (
    <div className="rounded-xl border border-border bg-card" data-testid="partner-invoices">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t`Month`}</TableHead>
            <TableHead>{t`State`}</TableHead>
            <TableHead className="text-end">{t`Total`}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.data.map((invoice) => (
            <TableRow key={invoice.id}>
              <TableCell className="font-medium">
                {monthLabel(invoice.period, i18n.locale, "long")} {invoice.period.slice(0, 4)}
              </TableCell>
              <TableCell>
                <Badge variant={invoice.state === "issued" ? "default" : "secondary"}>
                  {state(invoice.state)}
                </Badge>
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatMoney(invoice.totalMinor, partner.currency, i18n.locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
