import { Button, Input, NativeSelect, NativeSelectOption, Spinner } from "@corvo/ui-web";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@corvo/ui-web/components/ui/table";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { currentPeriod, Stat } from "./fields";
import { NewPartnerDialog } from "./NewPartnerDialog";

export function PartnersSection() {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const queries = useSpaceQueries();
  const [period, setPeriod] = useState(currentPeriod());
  const [creating, setCreating] = useState(false);
  const client = useQueryClient();
  const setPlan = useMutation({
    ...queries.platform.partnerPlan.set.mutationOptions(),
    onSuccess: () => client.invalidateQueries({ queryKey: queries.platform.partners.key() }),
  });
  const pricing = useQuery(queries.platform.partnerPricing.get.queryOptions());
  const planNames = new Map(
    (pricing.data?.config.tiers ?? []).map((tier) => [tier.key, tier.name]),
  );
  const partners = useQuery(queries.platform.partners.list.queryOptions({ input: { period } }));
  const rows = partners.data ?? [];
  // Credits are US cents of the fund.
  const usd = (creditCents: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(creditCents / 100);
  const percent = (value: number) => `${value}%`;
  const charged = rows.reduce((sum, row) => sum + row.chargedCredits, 0);
  const cost = rows.reduce((sum, row) => sum + (row.costCredits ?? 0), 0);
  const modes = {
    embedded: t`Embedded`,
    white_label: t`White label`,
    referral: t`Referral`,
  } as const;

  return (
    <div className="flex flex-col gap-6" data-testid="platform-partners">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-light tracking-tight">{t`Partners`}</h1>
        <div className="flex items-center gap-2">
          <Input
            type="month"
            aria-label={t`Month`}
            className="h-8 w-40"
            value={period}
            onChange={(event) => event.target.value && setPeriod(event.target.value)}
          />
          <Button size="sm" onClick={() => setCreating(true)}>
            {t`New partner`}
          </Button>
        </div>
      </header>
      {creating ? <NewPartnerDialog onClose={() => setCreating(false)} /> : null}

      {setPlan.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(setPlan.error, t`Could not save`)}
        </p>
      ) : null}
      {partners.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(partners.error, t`Could not load`)}
        </p>
      ) : !partners.data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label={t`Charged`} value={usd(charged)} />
            <Stat label={t`Cost`} value={usd(cost)} />
            <Stat
              label={t`Real margin`}
              value={usd(charged - cost)}
              tone={charged - cost < 0 ? "negative" : undefined}
            />
          </div>
          <div className="overflow-hidden rounded-2xl border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 text-xs">
                  <TableHead>{t`Partner`}</TableHead>
                  <TableHead>{t`Mode`}</TableHead>
                  <TableHead>{t`Plan`}</TableHead>
                  <TableHead>{t`Active customers`}</TableHead>
                  <TableHead>{t`Fund`}</TableHead>
                  <TableHead>{t`Charged`}</TableHead>
                  <TableHead>{t`Cost`}</TableHead>
                  <TableHead>{t`Margin`}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const margin =
                    row.costCredits === null ? null : row.chargedCredits - row.costCredits;
                  return (
                    <TableRow key={row.id} data-testid={`platform-partner-${row.slug}`}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-muted-foreground">{modes[row.mode]}</TableCell>
                      <TableCell>
                        {row.mode === "embedded" ? (
                          <NativeSelect
                            size="sm"
                            aria-label={`${row.name} ${t`Plan`}`}
                            value={row.plan ?? ""}
                            disabled={setPlan.isPending}
                            onChange={(event) =>
                              setPlan.mutate({
                                partnerId: row.id,
                                tierKey: event.target.value || null,
                              })
                            }
                          >
                            <NativeSelectOption value="">—</NativeSelectOption>
                            {[...planNames].map(([key, name]) => (
                              <NativeSelectOption key={key} value={key}>
                                {name}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{row.activeCustomers}</TableCell>
                      <TableCell className="tabular-nums">
                        {row.fundPercent === null ? "—" : percent(row.fundPercent)}
                      </TableCell>
                      <TableCell className="tabular-nums">{usd(row.chargedCredits)}</TableCell>
                      <TableCell className="tabular-nums">
                        {row.costCredits === null ? "—" : usd(row.costCredits)}
                      </TableCell>
                      <TableCell
                        className={`tabular-nums ${margin !== null && margin < 0 ? "text-destructive" : ""}`}
                        data-negative={margin !== null && margin < 0 ? "true" : undefined}
                      >
                        {margin === null ? "—" : usd(margin)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
