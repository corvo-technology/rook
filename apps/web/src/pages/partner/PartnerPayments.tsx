import type { PartnerConsolePartner } from "@corvo/contracts";
import {
  Button,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney } from "../../lib/partner-console";
import { rpc } from "../../lib/rpc";
import { openInNewWindow, Panel, PartnerError, PartnerLoading, useAction } from "./partner-ui";

type ConnectState = "none" | "pending" | "restricted" | "active" | "disabled";

/** The partner's connected account, what reached it, and the disputes of its customers' payments. */
export function PartnerPayments({ partner }: { partner: PartnerConsolePartner }) {
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const action = useAction();
  const key = ["partner-console", partner.id, "payments"];
  const payments = useQuery({
    queryKey: key,
    queryFn: () => rpc.partnerConsole.payments({ partnerId: partner.id }),
  });
  const stateLabel = (state: ConnectState) => {
    switch (state) {
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
  const disputeStatus = (status: string) => {
    switch (status) {
      case "needs_response":
      case "warning_needs_response":
        return t`Needs response`;
      case "under_review":
      case "warning_under_review":
        return t`Under review`;
      case "won":
      case "warning_closed":
        return t`Won`;
      case "lost":
        return t`Lost`;
      default:
        return status;
    }
  };
  const date = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(i18n.locale || "en", { dateStyle: "medium" }).format(new Date(iso))
      : "";

  if (payments.isPending) return <PartnerLoading />;
  if (payments.isError)
    return <PartnerError error={payments.error} onRetry={() => void payments.refetch()} />;
  const data = payments.data;

  const connect = () =>
    action.run(async () => {
      const { url } = await rpc.partnerConsole.connect({ partnerId: partner.id });
      window.location.assign(url);
    });
  const dashboard = () =>
    action.run(async () => {
      await openInNewWindow(async () => {
        const { url } = await rpc.partnerConsole.connectDashboard({ partnerId: partner.id });
        return url;
      });
      await queryClient.invalidateQueries({ queryKey: key });
    });
  const canOpen = data.state === "active" || data.state === "restricted";

  return (
    <div className="space-y-4" data-testid="partner-payments">
      <Panel
        data-testid="partner-connect"
        title={t`Account`}
        action={
          data.available && data.state !== "disabled" ? (
            <div className="flex items-center gap-2">
              {canOpen ? (
                <Button variant="secondary" size="sm" disabled={action.busy} onClick={dashboard}>
                  {t`Open dashboard`}
                </Button>
              ) : null}
              {data.state !== "active" ? (
                <Button size="sm" disabled={action.busy} onClick={connect}>
                  {data.state === "none" ? t`Connect account` : t`Continue setup`}
                </Button>
              ) : null}
            </div>
          ) : null
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            data-testid="partner-connect-state"
            data-state={data.state}
            className="text-lg font-light"
          >
            {data.available ? stateLabel(data.state) : t`Unavailable`}
          </span>
          {data.accountHint ? (
            <span className="text-meta tabular-nums text-muted-foreground">
              …{data.accountHint}
            </span>
          ) : null}
          {data.requirementsDue.length > 0 ? (
            <span className="text-meta text-warning">{t`More information needed`}</span>
          ) : null}
        </div>
        {action.error ? <PartnerError error={action.error} /> : null}
      </Panel>

      <Panel title={t`Payouts`}>
        {data.payouts.length === 0 ? (
          <EmptyState title={t`No payouts yet`} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t`Date`}</TableHead>
                <TableHead className="text-end">{t`Amount`}</TableHead>
                <TableHead>{t`Status`}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.payouts.map((payout) => (
                <TableRow key={payout.id}>
                  <TableCell>{date(payout.arrivedAt ?? payout.createdAt)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(payout.amountMinor, payout.currency, i18n.locale)}
                  </TableCell>
                  <TableCell
                    className={payout.status === "failed" ? "text-destructive" : undefined}
                  >
                    {payout.status === "paid" ? t`Paid` : t`Failed`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {data.disputes.length > 0 ? (
        <Panel title={t`Disputes`} data-testid="partner-disputes">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t`Date`}</TableHead>
                <TableHead className="text-end">{t`Amount`}</TableHead>
                <TableHead>{t`Status`}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.disputes.map((dispute) => (
                <TableRow key={dispute.id}>
                  <TableCell>{date(dispute.createdAt)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(dispute.amountMinor, dispute.currency, i18n.locale)}
                  </TableCell>
                  <TableCell>{disputeStatus(dispute.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      ) : null}
    </div>
  );
}
