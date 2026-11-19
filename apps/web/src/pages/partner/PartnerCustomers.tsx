import type { PartnerConsoleCustomerFilter, PartnerConsolePartner } from "@corvo/contracts";
import {
  Badge,
  Button,
  EmptyState,
  InlineConfirm,
  Input,
  SidePanel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  formatMoney,
  formatNumber,
  newIdempotencyKey,
  parseMinor,
} from "../../lib/partner-console";
import { rpc } from "../../lib/rpc";
import { openInNewWindow, PartnerError, PartnerLoading, useAction } from "./partner-ui";

type State = "active" | "past_due" | "lapsed" | "paused";

const FILTERS: PartnerConsoleCustomerFilter[] = ["all", "credit_low", "past_due", "paused"];

function useStateLabel() {
  const { t } = useLingui();
  return (state: State) => {
    switch (state) {
      case "active":
        return t`Active`;
      case "past_due":
        return t`Past due`;
      case "lapsed":
        return t`Lapsed`;
      case "paused":
        return t`Paused`;
    }
  };
}

function StateBadge({ state }: { state: State }) {
  const label = useStateLabel();
  return (
    <Badge
      variant={state === "active" ? "secondary" : state === "paused" ? "outline" : "destructive"}
    >
      {label(state)}
    </Badge>
  );
}

/** The customers of the partner: search and filters over a table, and one customer's panel. */
export function PartnerCustomers({ partner }: { partner: PartnerConsolePartner }) {
  const { t, i18n } = useLingui();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<PartnerConsoleCustomerFilter>("all");
  const [testMode, setTestMode] = useState(false);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const selected = params.get("customer");

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const customers = useInfiniteQuery({
    queryKey: ["partner-console", partner.id, "customers", filter, q, testMode],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      rpc.partnerConsole.customers({
        partnerId: partner.id,
        filter,
        ...(testMode ? { mode: "test" as const } : {}),
        ...(q ? { q } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: 25,
      }),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const rows = customers.data?.pages.flatMap((page) => page.items) ?? [];

  const label = (value: PartnerConsoleCustomerFilter) => {
    switch (value) {
      case "all":
        return t`All`;
      case "credit_low":
        return t`Low credit`;
      case "past_due":
        return t`Past due`;
      case "paused":
        return t`Paused`;
    }
  };

  function select(tenantId: string | null) {
    const next = new URLSearchParams(params);
    if (tenantId) next.set("customer", tenantId);
    else next.delete("customer");
    setParams(next);
  }

  return (
    <div className="space-y-3" data-testid="partner-customers">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t`Search customers`}
          aria-label={t`Search customers`}
          autoComplete="off"
          className="max-w-xs"
        />
        <ToggleGroup
          aria-label={t`Filter`}
          value={[filter]}
          onValueChange={(value) => {
            const next = value[0] as PartnerConsoleCustomerFilter | undefined;
            if (next && FILTERS.includes(next)) setFilter(next);
          }}
          variant="outline"
          size="sm"
        >
          {FILTERS.map((value) => (
            <ToggleGroupItem key={value} value={value}>
              {label(value)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          aria-label={t`Test`}
          value={testMode ? ["test"] : []}
          onValueChange={(value) => setTestMode(value.includes("test"))}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="test">{t`Test`}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {customers.isPending ? (
        <PartnerLoading />
      ) : customers.isError ? (
        <PartnerError error={customers.error} onRetry={customers.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title={t`No customers`} />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t`Customer`}</TableHead>
                <TableHead>{t`Plan`}</TableHead>
                <TableHead>{t`Credit used`}</TableHead>
                <TableHead>{t`State`}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.tenantId}
                  data-state={selected === row.tenantId ? "selected" : undefined}
                >
                  <TableCell className="font-medium">
                    <button
                      type="button"
                      className="text-start outline-none hover:underline focus-visible:underline"
                      onClick={() => select(row.tenantId)}
                    >
                      {row.name}
                    </button>
                  </TableCell>
                  <TableCell>{row.plan ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">
                    {row.creditUsedPct === null
                      ? "—"
                      : `${formatNumber(row.creditUsedPct, i18n.locale)}%`}
                  </TableCell>
                  <TableCell>
                    <StateBadge state={row.state} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {customers.hasNextPage ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={customers.isFetchingNextPage}
          onClick={() => void customers.fetchNextPage()}
        >
          {t`Show more`}
        </Button>
      ) : null}
      {selected ? (
        <CustomerPanel partner={partner} tenantId={selected} onClose={() => select(null)} />
      ) : null}
    </div>
  );
}

function CustomerPanel({
  partner,
  tenantId,
  onClose,
}: {
  partner: PartnerConsolePartner;
  tenantId: string;
  onClose: () => void;
}) {
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const action = useAction();
  const detail = useQuery({
    queryKey: ["partner-console", partner.id, "customer", tenantId],
    queryFn: () => rpc.partnerConsole.customer({ partnerId: partner.id, tenantId }),
  });
  const [amount, setAmount] = useState("");
  // One key per intent: a retry after a failure repeats it, so the credit lands once.
  const creditKey = useRef<{ for: string; key: string } | null>(null);
  const data = detail.data;
  const money = (minor: number) => formatMoney(minor, partner.currency, i18n.locale);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["partner-console", partner.id] });
  }

  function change(next: "pause" | "resume") {
    void action.run(async () => {
      await rpc.partnerConsole.customerAction({
        partnerId: partner.id,
        tenantId,
        action: next,
        idempotencyKey: newIdempotencyKey(),
      });
      refresh();
    });
  }

  function addCredit() {
    const amountMinor = parseMinor(amount);
    if (!amountMinor) return;
    const intent = `${tenantId}:${amountMinor}`;
    if (creditKey.current?.for !== intent)
      creditKey.current = { for: intent, key: newIdempotencyKey() };
    const { key } = creditKey.current;
    void action.run(async () => {
      await rpc.partnerConsole.customerAction({
        partnerId: partner.id,
        tenantId,
        action: "add_credit",
        amountMinor,
        idempotencyKey: key,
      });
      creditKey.current = null;
      setAmount("");
      refresh();
    });
  }

  return (
    <SidePanel
      open
      onClose={onClose}
      closeLabel={t`Close`}
      title={data?.name ?? t`Customer`}
      data-testid="partner-customer-panel"
    >
      {detail.isPending ? (
        <PartnerLoading />
      ) : detail.isError ? (
        <PartnerError error={detail.error} onRetry={detail.refetch} />
      ) : data ? (
        <div className="space-y-5 text-[14px]">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">{t`Plan`}</dt>
            <dd>{data.plan ?? "—"}</dd>
            <dt className="text-muted-foreground">{t`State`}</dt>
            <dd>
              <StateBadge state={data.state} />
            </dd>
            <dt className="text-muted-foreground">{t`Credit left`}</dt>
            <dd className="tabular-nums">{money(data.balance.remaining)}</dd>
            {data.priceMinor !== null ? (
              <>
                <dt className="text-muted-foreground">{t`Price`}</dt>
                <dd className="tabular-nums">{money(data.priceMinor)}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t`Agents`}</dt>
            <dd>{data.agents.length > 0 ? data.agents.join(", ") : "—"}</dd>
            <dt className="text-muted-foreground">{t`Connection`}</dt>
            <dd>
              {data.connector === "ok" ? t`Working` : data.connector === "down" ? t`Down` : "—"}
            </dd>
            <dt className="text-muted-foreground">{t`Runs in 30 days`}</dt>
            <dd className="tabular-nums">{formatNumber(data.runs30d, i18n.locale)}</dd>
          </dl>
          <div className="space-y-2">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                addCredit();
              }}
            >
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder={t`Amount`}
                aria-label={t`Amount`}
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={action.busy || !parseMinor(amount)}
              >
                {t`Add credit`}
              </Button>
            </form>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(() =>
                    openInNewWindow(
                      async () =>
                        (
                          await rpc.partnerConsole.supportSession({
                            partnerId: partner.id,
                            tenantId,
                          })
                        ).url,
                    ),
                  )
                }
              >
                {t`Open as support`}
              </Button>
              {data.state === "paused" ? (
                <InlineConfirm
                  variant="secondary"
                  disabled={action.busy}
                  confirmLabel={t`Resume customer?`}
                  onConfirm={() => change("resume")}
                >
                  {t`Resume`}
                </InlineConfirm>
              ) : (
                <InlineConfirm
                  variant="secondary"
                  disabled={action.busy}
                  confirmLabel={t`Pause customer?`}
                  onConfirm={() => change("pause")}
                >
                  {t`Pause`}
                </InlineConfirm>
              )}
            </div>
          </div>
          {action.error ? <PartnerError error={action.error} /> : null}
        </div>
      ) : null}
    </SidePanel>
  );
}
