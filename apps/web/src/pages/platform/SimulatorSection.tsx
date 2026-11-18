import type { PartnerPricingConfig } from "@corvo/contracts";
import { NativeSelect, NativeSelectOption } from "@corvo/ui-web";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@corvo/ui-web/components/ui/table";
import { useLingui } from "@lingui/react/macro";
import { useQueries } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import type { SimulatorForm } from "../../lib/platform-simulator";
import { simulationRequests, useDebounced } from "../../lib/platform-simulator";
import { useSpaceQueries } from "../../lib/query";
import { NumberInput, Stat } from "./fields";

const PARTS = ["total", "models", "voice", "computer"] as const;

export function SimulatorSection({
  live,
  draft,
}: {
  /** The published pricing, or undefined while it loads. */
  live: PartnerPricingConfig | null | undefined;
  /** The pricing being edited, when it differs from the published one. */
  draft: PartnerPricingConfig | null;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const queries = useSpaceQueries();
  const config = draft ?? live ?? null;
  const [form, setForm] = useState<SimulatorForm>({
    tier: "",
    customers: "10",
    model: "",
    inputM: "1",
    outputM: "0.2",
    voiceMinutes: "60",
    computerMinutes: "120",
    ownShare: "0",
  });
  const tier = config?.tiers.find((item) => item.key === form.tier) ?? config?.tiers[0];
  const models = Object.keys(config?.costs.models ?? {});
  const effective = { ...form, tier: tier?.key ?? "", model: form.model || (models[0] ?? "") };
  const settled = useDebounced(effective);
  const requests = simulationRequests(settled, live ?? null, draft);
  const results = useQueries({
    queries: PARTS.map((part) => ({
      ...queries.platform.partnerPricing.simulate.queryOptions({
        // Never sent while the form is not valid.
        input: requests?.[part] as NonNullable<typeof requests>[typeof part],
      }),
      enabled: requests !== null,
      retry: false,
    })),
  });
  const [total, modelsOnly, voice, computer] = results.map((result) => result.data);
  const failed = results.some((result) => result.isError);
  const usd = (micros: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: micros !== 0 && Math.abs(micros) < 100_000 ? 4 : 2,
    }).format(micros / 1_000_000);
  const count = (value: number) => new Intl.NumberFormat(locale).format(value);
  const customers = requests?.total.customers ?? 1;
  const { inputM, outputM, voiceMinutes, computerMinutes } = form;
  const set = <K extends keyof SimulatorForm>(key: K, value: SimulatorForm[K]) =>
    setForm({ ...effective, [key]: value });

  const cost = (value: number | undefined) => (value === undefined ? 0 : value * customers);
  const modelsCost = cost(modelsOnly?.costPerCustomer.modelsMicros);
  const voiceCost = cost(voice?.costPerCustomer.infraMicros);
  const infraCost = cost(computer?.costPerCustomer.infraMicros);
  const marginTotal = total ? total.totalMarginMicros : 0;
  const spend = modelsCost + voiceCost + infraCost + marginTotal;
  const share = (value: number) => (spend > 0 ? (value / spend) * 100 : 0);
  const segments = [
    { id: "models", label: t`Models`, value: modelsCost, className: "bg-foreground" },
    { id: "voice", label: t`Voice`, value: voiceCost, className: "bg-foreground/60" },
    { id: "infra", label: t`Infrastructure`, value: infraCost, className: "bg-foreground/35" },
    { id: "margin", label: t`Rook margin`, value: marginTotal, className: "bg-success" },
  ];
  const marginShare = spend > 0 ? Math.round(share(marginTotal)) : null;

  return (
    <div className="flex flex-col gap-6" data-testid="platform-simulator">
      <header className="flex items-center gap-3">
        <h1 className="text-2xl font-light tracking-tight">{t`Simulator`}</h1>
        {draft ? (
          <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
            {t`Draft`}
          </span>
        ) : null}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <form className="flex flex-col gap-3" onSubmit={(event) => event.preventDefault()}>
          <Field label={t`Plan`}>
            <NativeSelect
              className="w-full"
              aria-label={t`Plan`}
              value={tier?.key ?? ""}
              onChange={(event) => set("tier", event.target.value)}
            >
              {(config?.tiers ?? []).map((item) => (
                <NativeSelectOption key={item.key} value={item.key}>
                  {item.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t`Customers`}>
            <NumberInput
              label={t`Customers`}
              className="w-full"
              value={form.customers}
              onChange={(event) => set("customers", event.target.value)}
            />
          </Field>
          <p className="pt-2 text-xs text-muted-foreground">{t`One typical customer, per month`}</p>
          <Field label={t`Main model`}>
            <NativeSelect
              className="w-full"
              aria-label={t`Main model`}
              value={effective.model}
              onChange={(event) => set("model", event.target.value)}
            >
              {models.map((model) => (
                <NativeSelectOption key={model} value={model}>
                  {model}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t`Input (M tokens)`}>
              <NumberInput
                label={t`Input (M tokens)`}
                className="w-full"
                value={form.inputM}
                onChange={(event) => set("inputM", event.target.value)}
              />
            </Field>
            <Field label={t`Output (M tokens)`}>
              <NumberInput
                label={t`Output (M tokens)`}
                className="w-full"
                value={form.outputM}
                onChange={(event) => set("outputM", event.target.value)}
              />
            </Field>
            <Field label={t`Voice minutes`}>
              <NumberInput
                label={t`Voice minutes`}
                className="w-full"
                value={form.voiceMinutes}
                onChange={(event) => set("voiceMinutes", event.target.value)}
              />
            </Field>
            <Field label={t`Computer minutes`}>
              <NumberInput
                label={t`Computer minutes`}
                className="w-full"
                value={form.computerMinutes}
                onChange={(event) => set("computerMinutes", event.target.value)}
              />
            </Field>
          </div>
          <Field label={t`On own models (%)`}>
            <NumberInput
              label={t`On own models (%)`}
              className="w-full"
              value={form.ownShare}
              onChange={(event) => set("ownShare", event.target.value)}
            />
          </Field>
        </form>

        <div className="flex min-w-0 flex-col gap-6" aria-live="polite">
          {failed ? (
            <p role="alert" className="text-sm text-destructive">
              {t`This usage cannot be simulated`}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label={t`Credits per customer`}
              value={total ? count(total.creditsPerCustomer) : "—"}
            />
            <Stat
              label={t`Customers the fund supports`}
              value={total?.customersSupported != null ? count(total.customersSupported) : "—"}
              tone={total && !total.fund.covered ? "negative" : undefined}
            />
            <Stat
              label={t`Rook margin`}
              value={total ? usd(total.totalMarginMicros) : "—"}
              hint={marginShare === null ? undefined : `${marginShare}%`}
            />
          </div>

          <section className="flex flex-col gap-3" data-testid="platform-breakdown">
            <h2 className="text-[15px] font-semibold">{t`Where the money goes`}</h2>
            <div
              role="img"
              aria-label={segments
                .map((segment) => `${segment.label} ${Math.round(share(segment.value))}%`)
                .join(", ")}
              className="flex h-3 overflow-hidden rounded-full bg-muted"
            >
              {segments.map((segment) => (
                <div
                  key={segment.id}
                  className={segment.className}
                  style={{ width: `${share(segment.value)}%` }}
                />
              ))}
            </div>
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {segments.map((segment) => (
                <li key={segment.id} className="flex items-center gap-2">
                  <span className={`size-2.5 rounded-full ${segment.className}`} />
                  <span className="text-muted-foreground">{segment.label}</span>
                  <span className="tabular-nums">{usd(segment.value)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="overflow-hidden rounded-2xl border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 text-xs">
                  <TableHead>{t`One typical customer`}</TableHead>
                  <TableHead>{t`Amount`}</TableHead>
                  <TableHead>{t`Cost`}</TableHead>
                  <TableHead>{t`Credits`}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  {
                    id: "models",
                    label: effective.model,
                    amount: t`${inputM}M in, ${outputM}M out`,
                    result: modelsOnly,
                    micros: modelsOnly?.costPerCustomer.modelsMicros,
                  },
                  {
                    id: "voice",
                    label: t`Voice`,
                    amount: t`${voiceMinutes} min`,
                    result: voice,
                    micros: voice?.costPerCustomer.infraMicros,
                  },
                  {
                    id: "computer",
                    label: t`Computer`,
                    amount: t`${computerMinutes} min`,
                    result: computer,
                    micros: computer?.costPerCustomer.infraMicros,
                  },
                ].map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-muted-foreground">{row.amount}</TableCell>
                    <TableCell className="tabular-nums">
                      {row.micros === undefined ? "—" : usd(row.micros)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.result ? count(row.result.creditsPerCustomer) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>{t`Total per customer`}</TableCell>
                  <TableCell />
                  <TableCell className="tabular-nums">
                    {total
                      ? usd(total.costPerCustomer.modelsMicros + total.costPerCustomer.infraMicros)
                      : "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {total ? count(total.creditsPerCustomer) : "—"}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
