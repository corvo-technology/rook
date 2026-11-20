import type {
  AiUseCents,
  BillingCurrency,
  BillingInterval,
  ComputerSize,
  PlanEntitlements,
  PlanId,
} from "@corvo/contracts";
import {
  AI_USE_CENTS,
  aiAddOnPriceCents,
  BILLING_CURRENCIES,
  currencyForLocale,
  extraPersonCents,
  planPriceCents,
} from "@corvo/contracts";
import { BOT_COLOR_LIST, DEFAULT_BOT_AVATAR_COLOR } from "@corvo/core";
import { useState } from "react";
import { BotAvatar } from "./bot-avatar.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.js";
import { Spinner } from "./components/ui/spinner.js";
import { Switch } from "./components/ui/switch.js";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group.js";
import { cn } from "./lib/utils.js";

/** The translated strings, so this package stays free of the app's message catalogs. */
export interface PlanCardLabels {
  monthly: string;
  yearly: string;
  twoMonthsFree: string;
  currency: string;
  interval: string;
  recommended: string;
  perMonth: string;
  planName: (plan: PlanId) => string;
  forWhom: (plan: PlanId, people: number) => string;
  serverAndAi: (server: string, ai: string) => string;
  yearlyTotal: (total: string, saved: string) => string;
  subscribe: (plan: PlanId) => string;
  computer: (size: ComputerSize) => string;
  computerSpec: (size: ComputerSize) => string;
  people: (count: number) => string;
  extraPeople: (price: string, max: number) => string;
  files: (bytes: number) => string;
  bots: string;
  routines: string;
  includeAi: string;
  aiAmount: string;
  aiPerMonth: (price: string) => string;
  aiToModels: (amount: string) => string;
  ownAi: string;
  reassurance: string;
  ownerOnly: string;
}

export interface PlanChoice {
  plan: PlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  aiUseCents: AiUseCents | null;
}

export interface PlanCardsProps {
  plans: Omit<PlanEntitlements, "extraSeatPriceId">[];
  locale: string;
  canManage: boolean;
  /** Disables every subscribe button, for any reason. */
  pending: boolean;
  /** The plan whose checkout is opening; only its button shows progress. */
  busy?: PlanId | null;
  labels: PlanCardLabels;
  onSubscribe: (choice: PlanChoice) => void;
}

const RECOMMENDED: PlanId = "team";
const PLAN_ORDER: PlanId[] = ["personal", "team", "company"];
const MAX_MASCOTS = 5;
/** Each rook gets its own mascot color, like the bots do. */
const MASCOT_COLOR_IDS = ["green", "blue", "violet", "magenta", "orange", "yellow", "cyan"];

/** The mascot color at a position, wrapping around the palette. */
export function planMascotColor(index: number): string {
  const id = MASCOT_COLOR_IDS[index % MASCOT_COLOR_IDS.length];
  return BOT_COLOR_LIST.find((color) => color.id === id)?.hex ?? DEFAULT_BOT_AVATAR_COLOR;
}
const DEFAULT_AI_USE: AiUseCents = 1000;
const MONTHS = 12;

function money(cents: number, currency: BillingCurrency, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const pill =
  "rounded-full px-4 text-sm data-pressed:bg-foreground data-pressed:text-background aria-pressed:bg-foreground aria-pressed:text-background";

function Pills<T extends string>({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: string; extra?: string }[];
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      spacing={1}
      className="rounded-full border border-border bg-background p-1"
      onValueChange={(next) => {
        const picked = next[0] as T | undefined;
        if (picked !== undefined) onChange(picked);
      }}
    >
      {items.map((item) => (
        <ToggleGroupItem key={item.value} value={item.value} className={pill}>
          {item.label}
          {item.extra ? <span className="ml-2 text-xs opacity-70">{item.extra}</span> : null}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function Row({ title, detail, dark }: { title: string; detail?: string; dark: boolean }) {
  return (
    <li className={cn("border-t py-3", dark ? "border-background/15" : "border-border")}>
      <p className="text-sm font-medium">{title}</p>
      {detail ? (
        <p className={cn("text-sm", dark ? "text-background/70" : "text-muted-foreground")}>
          {detail}
        </p>
      ) : null}
    </li>
  );
}

function PlanCard({
  entitlements,
  interval,
  currency,
  locale,
  canManage,
  pending,
  busy,
  labels,
  onSubscribe,
}: Omit<PlanCardsProps, "plans"> & {
  entitlements: Omit<PlanEntitlements, "extraSeatPriceId">;
  interval: BillingInterval;
  currency: BillingCurrency;
}) {
  const { plan } = entitlements;
  const dark = plan === RECOMMENDED;
  const [aiOn, setAiOn] = useState(true);
  const [aiUse, setAiUse] = useState<AiUseCents>(DEFAULT_AI_USE);
  const divisor = interval === "year" ? MONTHS : 1;
  const serverCents = planPriceCents(plan, currency, interval);
  const aiCents = aiOn ? aiAddOnPriceCents(currency, aiUse, interval) : 0;
  const perMonth = (cents: number) => money(Math.round(cents / divisor), currency, locale);
  const hasExtraPeople = entitlements.maxSeats > entitlements.seatsIncluded;
  const muted = dark ? "text-background/70" : "text-muted-foreground";
  const mascots = Math.min(entitlements.seatsIncluded, MAX_MASCOTS);
  const offset = PLAN_ORDER.indexOf(plan) * 2;
  // Only the server has free months yearly; AI costs the same per month either way.
  const savedCents = planPriceCents(plan, currency, "month") * MONTHS - serverCents;

  return (
    <section
      data-plan={plan}
      className={cn(
        "flex flex-col rounded-3xl border p-6",
        dark
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-card-foreground",
      )}
    >
      <div className="flex items-center justify-between">
        <div aria-hidden className="flex gap-1">
          {Array.from({ length: mascots }, (_, index) => (
            <BotAvatar key={index} color={planMascotColor(index + offset)} size={26} />
          ))}
        </div>
        {dark ? (
          <Badge className="bg-background text-foreground">{labels.recommended}</Badge>
        ) : null}
      </div>
      <h3 className="mt-5 text-xl font-medium">{labels.planName(plan)}</h3>
      <p className={cn("text-sm", muted)}>{labels.forWhom(plan, entitlements.seatsIncluded)}</p>
      <p className="mt-5 flex items-baseline gap-1 whitespace-nowrap">
        <span className="text-4xl font-light tracking-tight">
          {perMonth(serverCents + aiCents)}
        </span>
        <span className={cn("text-sm", muted)}>{labels.perMonth}</span>
      </p>
      {aiOn ? (
        <p className={cn("mt-1 text-sm", muted)}>
          {labels.serverAndAi(perMonth(serverCents), perMonth(aiCents))}
        </p>
      ) : null}
      {interval === "year" ? (
        <p className={cn("mt-1 text-sm", muted)}>
          {labels.yearlyTotal(
            money(serverCents + aiCents, currency, locale),
            money(savedCents, currency, locale),
          )}
        </p>
      ) : null}
      <Button
        data-subscribe
        size="lg"
        disabled={!canManage || pending}
        aria-busy={busy === plan || undefined}
        className={cn(
          "mt-5 w-full",
          dark && "bg-background text-foreground hover:bg-background/90",
        )}
        onClick={() => onSubscribe({ plan, interval, currency, aiUseCents: aiOn ? aiUse : null })}
      >
        {busy === plan ? <Spinner aria-hidden role="presentation" /> : null}
        {labels.subscribe(plan)}
      </Button>
      <ul className="mt-6 flex list-none flex-col p-0">
        <Row
          dark={dark}
          title={labels.computer(entitlements.computerSize)}
          detail={labels.computerSpec(entitlements.computerSize)}
        />
        <Row
          dark={dark}
          title={labels.people(entitlements.seatsIncluded)}
          detail={
            hasExtraPeople
              ? labels.extraPeople(
                  money(extraPersonCents(currency, "month"), currency, locale),
                  entitlements.maxSeats,
                )
              : undefined
          }
        />
        <Row dark={dark} title={labels.files(entitlements.storageBytes)} />
        <Row dark={dark} title={labels.bots} detail={labels.routines} />
      </ul>
      <div
        className={cn(
          "mt-1 flex flex-col gap-3 border-t pt-4",
          dark ? "border-background/15" : "border-border",
        )}
      >
        <div className="flex items-center justify-between gap-3 text-sm font-medium">
          {labels.includeAi}
          <Switch
            aria-label={labels.includeAi}
            checked={aiOn}
            onCheckedChange={setAiOn}
            className={cn(
              dark && "data-checked:bg-background *:data-[slot=switch-thumb]:bg-foreground!",
            )}
          />
        </div>
        {aiOn ? (
          <>
            <Select
              value={aiUse}
              onValueChange={(next) => {
                const picked = AI_USE_CENTS.find((cents) => cents === next);
                if (picked !== undefined) setAiUse(picked);
              }}
              items={AI_USE_CENTS.map((cents) => ({
                value: cents,
                label: labels.aiPerMonth(
                  money(aiAddOnPriceCents(currency, cents, "month"), currency, locale),
                ),
              }))}
            >
              <SelectTrigger
                aria-label={labels.aiAmount}
                className={cn("w-full rounded-xl", dark && "border-background/25 text-background")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="start">
                {AI_USE_CENTS.map((cents) => (
                  <SelectItem key={cents} value={cents}>
                    {labels.aiPerMonth(
                      money(aiAddOnPriceCents(currency, cents, "month"), currency, locale),
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className={cn("text-sm", muted)}>
              {labels.aiToModels(money(aiUse, currency, locale))}
            </p>
          </>
        ) : (
          <p className={cn("text-sm", muted)}>{labels.ownAi}</p>
        )}
      </div>
    </section>
  );
}

/** The three plans with the monthly or yearly switch, the currency, and the AI add-on in each. */
export function PlanCards({
  plans,
  locale,
  canManage,
  pending,
  busy,
  labels,
  onSubscribe,
}: PlanCardsProps) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [currency, setCurrency] = useState<BillingCurrency>(currencyForLocale(locale));
  return (
    <div data-testid="plan-cards" className="flex w-full flex-col items-center gap-8">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Pills
          label={labels.interval}
          value={interval}
          onChange={setInterval}
          items={[
            { value: "month", label: labels.monthly },
            { value: "year", label: labels.yearly, extra: labels.twoMonthsFree },
          ]}
        />
        <Pills
          label={labels.currency}
          value={currency}
          onChange={setCurrency}
          items={BILLING_CURRENCIES.map((value) => ({ value, label: value.toUpperCase() }))}
        />
      </div>
      <div className="w-full rounded-[2rem] bg-linear-to-r from-band-mint via-band-lavender to-band-peach p-3 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.map((entitlements) => (
            <PlanCard
              key={entitlements.plan}
              entitlements={entitlements}
              interval={interval}
              currency={currency}
              locale={locale}
              canManage={canManage}
              pending={pending}
              busy={busy}
              labels={labels}
              onSubscribe={onSubscribe}
            />
          ))}
        </div>
      </div>
      {canManage ? null : <p className="text-sm text-muted-foreground">{labels.ownerOnly}</p>}
      <p className="text-sm text-muted-foreground">{labels.reassurance}</p>
    </div>
  );
}
