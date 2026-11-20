import type { BillingStatus, PlanUsage } from "@corvo/contracts";
import { aiAddOnPriceCents, planPriceCents } from "@corvo/contracts";
import { Button, Skeleton } from "@corvo/ui-web";
import { t as translate } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ExtraComputersRow, PLAN_USAGE_KEY } from "../components/ExtraComputers";
import { ModelCreditsSettings } from "../components/ModelCredits";
import { PlanPicker } from "../components/PlanChoice";
import { PlanList } from "../components/PlanList";
import { SettingsGroup } from "../components/SettingsRows";
import { formatBillingDate, formatBillingPrice } from "../lib/billing";
import { planName } from "../lib/plan-view";
import { rpc } from "../lib/rpc";

const STATUS_KEY = ["billing", "status"];

export function BillingSettingsPanel() {
  const { t } = useLingui();
  const whiteLabel = useQuery({
    queryKey: ["billing", "whiteLabelCatalog"],
    queryFn: () => rpc.billing.whiteLabelCatalog(),
    retry: false,
    staleTime: 60_000,
  });
  // A customer of a white-label partner pays the partner, on the plans screen, not Rook.
  if (whiteLabel.data) {
    return (
      <div className="flex flex-col gap-3" data-testid="white-label-billing">
        <a
          href="/app/plans"
          className="inline-flex h-9 w-fit items-center rounded-full border border-border bg-background px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t`Plans`}
        </a>
      </div>
    );
  }
  return <BillingBody />;
}

/** Plans exist where the deployment has prices for them; the server answers null elsewhere. */
function BillingBody() {
  const { t } = useLingui();
  const client = useQueryClient();
  // Refetched when the window regains focus, which is how a checkout in another tab shows up.
  const statusQuery = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => rpc.billing.status(),
    refetchOnWindowFocus: true,
  });
  const plansQuery = useQuery({
    queryKey: PLAN_USAGE_KEY,
    queryFn: () => rpc.usage.plan(),
    retry: false,
    staleTime: 60_000,
  });
  const status = statusQuery.data;
  const usage = plansQuery.data ?? null;
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: STATUS_KEY }),
      client.invalidateQueries({ queryKey: PLAN_USAGE_KEY }),
    ]);
  };

  if (statusQuery.isError && !status) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t`Could not load billing`}
      </p>
    );
  }
  if (!status || plansQuery.isPending) return <Skeleton className="h-24 w-full max-w-2xl" />;
  if (status.funding === undefined) {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <LegacyBillingPanel status={status} />
        {usage ? <PlanList usage={usage} /> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {usage ? <PlanSection status={status} usage={usage} onChanged={refresh} /> : null}
      <ModelCreditsSettings status={status} refresh={refresh} plansOn={usage !== null} />
    </div>
  );
}

const CHANGEABLE: BillingStatus["state"][] = ["active", "trialing"];
const SUBSCRIBED: BillingStatus["state"][] = [...CHANGEABLE, "past_due", "unpaid", "paused"];

/** The plan first: what it is and how to change it, or the plans to pick one. */
function PlanSection({
  status,
  usage,
  onChanged,
}: {
  status: BillingStatus;
  usage: PlanUsage;
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  if (!SUBSCRIBED.includes(status.state)) {
    return (
      <section data-testid="plan-section" className="flex flex-col gap-3">
        <h3 className="px-1 text-[14px] font-medium text-foreground">{t`Plan`}</h3>
        <PlanPicker status={status} usage={usage} />
      </section>
    );
  }

  async function openPortal() {
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      const { url } = await rpc.billing.portal();
      window.location.assign(url);
    } catch {
      setError(true);
    } finally {
      // Desktop opens the URL in the system browser and this page stays, so re-enable.
      setPending(false);
    }
  }

  const { plan, currency, interval } = status;
  // The catalog price the subscription adds up to; a price set up by hand shows the provider's.
  const price =
    plan && currency && interval
      ? formatBillingPrice(
          {
            amount:
              planPriceCents(plan, currency, interval) +
              (status.aiUseCents ? aiAddOnPriceCents(currency, status.aiUseCents, interval) : 0),
            currency,
            interval,
            intervalCount: 1,
          },
          locale,
        )
      : status.price
        ? formatBillingPrice(status.price, locale)
        : null;
  const dateLabel = renewalLabel(status, locale);
  const waiting = status.pendingChange;
  const waitingName = waiting ? planName(waiting.plan) : "";
  const waitingDay = waiting ? formatBillingDate(waiting.effectiveAt, locale) : "";
  const current =
    plan && interval ? { plan, interval, aiUseCents: status.aiUseCents ?? null } : null;
  const canChange = status.canManage && CHANGEABLE.includes(status.state);

  return (
    <section data-testid="plan-section" className="flex flex-col gap-3">
      <div className="max-w-2xl">
        <SettingsGroup title={t`Plan`}>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 py-4">
            <div className="min-w-0">
              <p className="text-heading3 font-medium text-foreground">
                {plan ? planName(plan) : (price ?? t`Plan`)}
              </p>
              {plan && price ? (
                <p className="mt-1 text-[14px] text-foreground/75">{price}</p>
              ) : null}
              {dateLabel ? <p className="mt-1 text-sm text-muted-foreground">{dateLabel}</p> : null}
              {waiting ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {t`Changes to ${waitingName} on ${waitingDay}`}
                </p>
              ) : null}
            </div>
            {status.canManage ? (
              <div className="flex flex-wrap gap-2">
                {canChange ? (
                  <Button
                    variant="secondary"
                    aria-expanded={open}
                    onClick={() => setOpen((value) => !value)}
                  >
                    <Trans>Change plan</Trans>
                  </Button>
                ) : null}
                {status.hasCustomer ? (
                  <Button variant="secondary" disabled={pending} onClick={() => void openPortal()}>
                    <Trans>Manage billing</Trans>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {status.state === "active" ? (
            <ExtraComputersRow usage={usage} onChanged={onChanged} />
          ) : null}
        </SettingsGroup>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>Could not open billing</Trans>
        </p>
      ) : null}
      {open && canChange ? (
        <PlanPicker
          status={status}
          usage={usage}
          current={current}
          currency={currency}
          onChanged={() => {
            setOpen(false);
            void onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

/** A deployment on the old single subscription: its state and the way to manage it. */
function LegacyBillingPanel({ status }: { status: BillingStatus }) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function openPortal() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const { url } = await rpc.billing.portal();
      window.location.assign(url);
    } catch {
      setError(t`Could not open billing`);
    } finally {
      // Desktop opens the URL in the system browser and this page stays, so re-enable.
      setPending(false);
    }
  }

  const stateLabel =
    status.state === "trialing"
      ? t`Trial`
      : status.state === "active"
        ? t`Active`
        : status.state === "past_due"
          ? t`Past due`
          : status.state === "canceled"
            ? t`Canceled`
            : t`Inactive`;
  const dateLabel = renewalLabel(status, locale);
  const price = status.price ? formatBillingPrice(status.price, locale) : null;
  const seats = status.seats;

  return (
    <div data-testid="billing-settings" className="rounded-xl border border-border px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-heading3 font-medium text-foreground">{stateLabel}</h3>
          {price ? (
            <p className="mt-3 flex flex-wrap gap-x-2 text-[14px] text-foreground/75">
              <span>{price}</span>
              {seats > 1 ? (
                <span className="text-muted-foreground">
                  <Plural value={seats} one="# seat" other="# seats" />
                </span>
              ) : null}
            </p>
          ) : null}
          {dateLabel ? (
            <p className="mt-2 text-[12.5px] text-muted-foreground/80">{dateLabel}</p>
          ) : null}
        </div>
        {status.canManage && status.hasCustomer ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => void openPortal()}
          >
            <Trans>Manage</Trans>
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function renewalLabel(status: BillingStatus, locale: string): string | null {
  const date = billingDate(status);
  if (!date) return null;
  const day = formatBillingDate(date.at, locale);
  return date.kind === "trial"
    ? translate`Trial ends ${day}`
    : date.kind === "ends"
      ? translate`Ends ${day}`
      : translate`Renews ${day}`;
}

function billingDate(
  status: BillingStatus,
): { kind: "trial" | "ends" | "renews"; at: string } | null {
  if (status.state === "trialing" && status.trialEndsAt) {
    return { kind: "trial", at: status.trialEndsAt };
  }
  // Unpaid and paused subscriptions do not renew until the owner resumes them.
  if (!status.currentPeriodEndsAt || status.state === "unpaid" || status.state === "paused") {
    return null;
  }
  if (status.cancelAtPeriodEnd || status.state === "canceled") {
    return { kind: "ends", at: status.currentPeriodEndsAt };
  }
  return { kind: "renews", at: status.currentPeriodEndsAt };
}
