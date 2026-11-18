import type { PartnerPricingConfig } from "@corvo/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
} from "@corvo/ui-web";
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
import type { ModelForm, PricingForm, TierForm } from "../../lib/platform-pricing";
import { debitCredits, PRICING_CURRENCIES, tierKey } from "../../lib/platform-pricing";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { NumberInput } from "./fields";

type Live = { version: number; effectiveAt: string } | null | undefined;

/** Today's date as `YYYY-MM-DD`, in UTC, the day a version published today starts. */
const currentDay = () => new Date().toISOString().slice(0, 10);

const credits = (value: number | null, locale: string) =>
  value === null ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);

export function PricingSection({
  live,
  form,
  onForm,
  config,
  changed,
}: {
  live: Live;
  form: PricingForm;
  onForm: (next: PricingForm) => void;
  /** What the form says, or null while something typed is not valid. */
  config: PartnerPricingConfig | null;
  changed: boolean;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const queries = useSpaceQueries();
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const today = currentDay();
  const [day, setDay] = useState(today);
  const history = useQuery(queries.platform.partnerPricing.history.queryOptions());
  const publish = useMutation({
    ...queries.platform.partnerPricing.publish.mutationOptions(),
    onSuccess: async () => {
      setConfirm(false);
      await client.invalidateQueries({ queryKey: queries.platform.partnerPricing.key() });
    },
  });
  const next = (live?.version ?? 0) + 1;
  const version = live?.version ?? 0;
  const set = <K extends keyof PricingForm>(key: K, value: PricingForm[K]) =>
    onForm({ ...form, [key]: value });
  const setTier = (index: number, tier: TierForm) =>
    set(
      "tiers",
      form.tiers.map((item, at) => (at === index ? tier : item)),
    );
  const setModel = (index: number, model: ModelForm) =>
    set(
      "models",
      form.models.map((item, at) => (at === index ? model : item)),
    );
  const published = live ? new Date(live.effectiveAt) : null;
  const since = published
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(published)
    : "";

  return (
    <div className="flex flex-col gap-8" data-testid="platform-pricing">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-light tracking-tight">{t`Prices and margins`}</h1>
          {live ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t`Version ${version} live since ${since}`}
            </p>
          ) : null}
        </div>
        <Button
          disabled={!changed || !config || publish.isPending}
          onClick={() => setConfirm(true)}
        >
          {t`Publish version ${next}`}
        </Button>
      </header>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-[15px] font-semibold">{t`Partner plans`}</h2>
        <div className="overflow-hidden rounded-2xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 text-xs">
                <TableHead>{t`Plan`}</TableHead>
                <TableHead>{t`Currency`}</TableHead>
                <TableHead>{t`Monthly price`}</TableHead>
                <TableHead>{t`Included credits`}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {form.tiers.flatMap((tier, index) =>
                PRICING_CURRENCIES.map((currency, row) => (
                  <TableRow key={`${tier.key}-${currency}`}>
                    <TableCell className="font-medium">
                      {row === 0 ? (
                        <Input
                          aria-label={t`Plan name`}
                          className="h-8 w-44"
                          value={tier.name}
                          onChange={(event) =>
                            setTier(index, { ...tier, name: event.target.value })
                          }
                        />
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{currency}</TableCell>
                    <TableCell>
                      <NumberInput
                        label={`${tier.name} ${currency} ${t`Monthly price`}`}
                        value={tier.prices[currency].price}
                        onChange={(event) =>
                          setTier(index, {
                            ...tier,
                            prices: {
                              ...tier.prices,
                              [currency]: { ...tier.prices[currency], price: event.target.value },
                            },
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <NumberInput
                        label={`${tier.name} ${currency} ${t`Included credits`}`}
                        value={tier.prices[currency].credits}
                        onChange={(event) =>
                          setTier(index, {
                            ...tier,
                            prices: {
                              ...tier.prices,
                              [currency]: { ...tier.prices[currency], credits: event.target.value },
                            },
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {row === 0 ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t`Remove plan`}
                          onClick={() =>
                            set(
                              "tiers",
                              form.tiers.filter((_, at) => at !== index),
                            )
                          }
                        >
                          ×
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </div>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              set("tiers", [
                ...form.tiers,
                {
                  key: tierKey(
                    "plan",
                    form.tiers.map((tier) => tier.key),
                  ),
                  name: "",
                  prices: {
                    BRL: { price: "", credits: "" },
                    USD: { price: "", credits: "" },
                  },
                },
              ])
            }
          >
            {t`Add plan`}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold">{t`Cost and margin per resource`}</h2>
          <span className="text-xs text-muted-foreground">{t`Customer-owned models are never charged`}</span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 text-xs">
                <TableHead>{t`Resource`}</TableHead>
                <TableHead>{t`Unit`}</TableHead>
                <TableHead>{t`Provider cost (US$)`}</TableHead>
                <TableHead>{t`Margin (%)`}</TableHead>
                <TableHead>{t`Credits debited`}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {form.models.map((model, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">
                    <Input
                      aria-label={t`Model`}
                      className="h-8 w-44"
                      value={model.model}
                      onChange={(event) => setModel(index, { ...model, model: event.target.value })}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t`1M tokens in / out`}</TableCell>
                  <TableCell>
                    <div className="flex gap-1.5">
                      <NumberInput
                        label={`${model.model} ${t`Input`}`}
                        className="w-20"
                        value={model.inputCost}
                        onChange={(event) =>
                          setModel(index, { ...model, inputCost: event.target.value })
                        }
                      />
                      <NumberInput
                        label={`${model.model} ${t`Output`}`}
                        className="w-20"
                        value={model.outputCost}
                        onChange={(event) =>
                          setModel(index, { ...model, outputCost: event.target.value })
                        }
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <NumberInput
                      label={`${model.model} ${t`Margin (%)`}`}
                      className="w-20"
                      value={model.margin}
                      onChange={(event) =>
                        setModel(index, { ...model, margin: event.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {credits(debitCredits(model.inputCost, model.margin), locale)} /{" "}
                    {credits(debitCredits(model.outputCost, model.margin), locale)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium">{t`Other models`}</TableCell>
                <TableCell />
                <TableCell />
                <TableCell>
                  <NumberInput
                    label={`${t`Other models`} ${t`Margin (%)`}`}
                    className="w-20"
                    value={form.modelMargin}
                    onChange={(event) => set("modelMargin", event.target.value)}
                  />
                </TableCell>
                <TableCell />
              </TableRow>
              {(
                [
                  ["voice", t`Voice`, t`minute`, "voiceCost", "voiceMargin"],
                  ["computer", t`Computer`, t`minute`, "computerCost", "computerMargin"],
                  ["storage", t`Storage`, t`GB per month`, "storageCost", "storageMargin"],
                ] as const
              ).map(([id, label, unit, costKey, marginKey]) => (
                <TableRow key={id}>
                  <TableCell className="font-medium">{label}</TableCell>
                  <TableCell className="text-muted-foreground">{unit}</TableCell>
                  <TableCell>
                    <NumberInput
                      label={`${label} ${t`Provider cost (US$)`}`}
                      value={form[costKey]}
                      onChange={(event) => set(costKey, event.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <NumberInput
                      label={`${label} ${t`Margin (%)`}`}
                      className="w-20"
                      value={form[marginKey]}
                      onChange={(event) => set(marginKey, event.target.value)}
                    />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {credits(debitCredits(form[costKey], form[marginKey]), locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              set("models", [
                ...form.models,
                { model: "", inputCost: "0", outputCost: "0", margin: form.modelMargin },
              ])
            }
          >
            {t`Add model`}
          </Button>
          <div className="ms-auto flex items-center gap-2 text-sm text-muted-foreground">
            {t`Storage allowance (GB)`}
            <NumberInput
              label={t`Storage allowance (GB)`}
              className="w-20"
              value={form.storageAllowanceGb}
              onChange={(event) => set("storageAllowanceGb", event.target.value)}
            />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PercentCard
          label={t`Top-up markup`}
          value={form.topupMarkup}
          unit="%"
          onChange={(value) => set("topupMarkup", value)}
        />
        <PercentCard
          label={t`Top-up expiry`}
          value={form.topupExpiryDays}
          unit={t`days`}
          placeholder={t`Never`}
          onChange={(value) => set("topupExpiryDays", value)}
        />
        <PercentCard
          label={t`Low balance alert`}
          value={form.lowBalance}
          unit="%"
          onChange={(value) => set("lowBalance", value)}
        />
      </div>

      {config ? null : changed ? (
        <p role="alert" className="text-sm text-destructive">
          {t`Check the numbers`}
        </p>
      ) : null}
      {history.data && history.data.length > 0 ? (
        <section className="flex flex-col gap-2.5" data-testid="platform-pricing-history">
          <h2 className="text-[15px] font-semibold">{t`History`}</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border text-sm">
            {history.data.map((entry) => {
              const n = entry.version;
              return (
                <li key={n} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="font-medium">{t`Version ${n}`}</span>
                  <span className="text-muted-foreground">
                    {new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
                      new Date(entry.effectiveAt),
                    )}
                  </span>
                  <span className="ms-auto text-muted-foreground">
                    {{ live: t`Live`, scheduled: t`Scheduled`, past: t`Past` }[entry.status]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {publish.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(publish.error, t`Could not publish`)}
        </p>
      ) : null}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t`Publish version ${next}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {day > today
                ? t`It applies from the chosen day.`
                : t`It applies to every partner right away.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="date"
            aria-label={t`Effective date`}
            min={today}
            value={day}
            onChange={(event) => setDay(event.target.value || today)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t`Cancel`}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!config || publish.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (config)
                  publish.mutate({ config, ...(day > today ? { effectiveOn: day } : {}) });
              }}
            >
              {t`Publish`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PercentCard({
  label,
  value,
  unit,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  unit: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="text-meta uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-center gap-2">
        <NumberInput
          label={label}
          className="w-24 text-lg"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}
