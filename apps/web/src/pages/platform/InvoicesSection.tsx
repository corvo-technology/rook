import type { PartnerInvoice } from "@corvo/contracts";
import { Button, Input, Spinner } from "@corvo/ui-web";
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
import { PageTitle } from "../../components/PageHeader";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { currentPeriod } from "./fields";

type State = PartnerInvoice["state"];
const NEXT: Record<State, Array<"issued" | "paid" | "void">> = {
  draft: ["issued", "void"],
  issued: ["paid", "void"],
  paid: [],
  void: [],
};

export function InvoicesSection() {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const queries = useSpaceQueries();
  const client = useQueryClient();
  const [period, setPeriod] = useState(currentPeriod());
  const [refs, setRefs] = useState<Record<string, string>>({});
  const listKey = queries.platform.invoices.list.queryOptions({ input: { period } }).queryKey;
  const invoices = useQuery(queries.platform.invoices.list.queryOptions({ input: { period } }));
  const refresh = () => client.invalidateQueries({ queryKey: listKey });
  const draft = useMutation({
    ...queries.platform.invoices.draft.mutationOptions(),
    onSuccess: refresh,
  });
  const setState = useMutation({
    ...queries.platform.invoices.setState.mutationOptions(),
    onSuccess: refresh,
  });
  const states: Record<State, string> = {
    draft: t`Draft`,
    issued: t`Issued`,
    paid: t`Paid`,
    void: t`Void`,
  };
  const actions = { issued: t`Issue`, paid: t`Mark paid`, void: t`Void` } as const;
  const money = (minor: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
  const error = invoices.error ?? draft.error ?? setState.error;

  return (
    <div className="flex flex-col gap-6" data-testid="platform-invoices">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle>{t`Invoices`}</PageTitle>
        <div className="flex items-center gap-2">
          <Input
            type="month"
            aria-label={t`Month`}
            className="h-8 w-40"
            value={period}
            onChange={(event) => event.target.value && setPeriod(event.target.value)}
          />
          <Button
            variant="outline"
            disabled={draft.isPending}
            onClick={() => draft.mutate({ period })}
          >
            {t`Draft invoices`}
          </Button>
        </div>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(error, t`Could not load`)}
        </p>
      ) : null}
      {!invoices.data ? (
        invoices.error ? null : (
          <Spinner />
        )
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 text-xs">
                <TableHead>{t`Partner`}</TableHead>
                <TableHead>{t`Status`}</TableHead>
                <TableHead>{t`Total`}</TableHead>
                <TableHead>{t`Lines`}</TableHead>
                <TableHead>{t`Document`}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.data.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">{invoice.partner}</TableCell>
                  <TableCell>{states[invoice.state]}</TableCell>
                  <TableCell className="tabular-nums">
                    {money(invoice.totalMinor, invoice.currency)}
                  </TableCell>
                  <TableCell className="tabular-nums">{invoice.lines}</TableCell>
                  <TableCell>
                    {invoice.state === "draft" || invoice.state === "issued" ? (
                      <Input
                        aria-label={t`Document number`}
                        className="h-8 w-36"
                        value={refs[invoice.id] ?? invoice.externalRef ?? ""}
                        onChange={(event) => setRefs({ ...refs, [invoice.id]: event.target.value })}
                      />
                    ) : (
                      (invoice.externalRef ?? "—")
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {NEXT[invoice.state].map((state) => (
                        <Button
                          key={state}
                          variant={state === "void" ? "ghost" : "outline"}
                          size="sm"
                          disabled={setState.isPending}
                          onClick={() => {
                            const externalRef = (refs[invoice.id] ?? "").trim();
                            setState.mutate({
                              id: invoice.id,
                              state,
                              ...(externalRef && state !== "void" ? { externalRef } : {}),
                            });
                          }}
                        >
                          {actions[state]}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
