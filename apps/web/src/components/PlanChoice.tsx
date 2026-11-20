import type {
  BillingCurrency,
  BillingStatus,
  PlanId,
  PlanSelection,
  PlanUsage,
} from "@corvo/contracts";
import type { PlanChoice as Choice, PlanCardLabels } from "@corvo/ui-web";
import { BotAvatar, Button, PlanCards, planMascotColor } from "@corvo/ui-web";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { computerSizeName, computerSizeSpec, formatStorage, planName } from "../lib/plan-view";
import { rpc } from "../lib/rpc";
import { useSignOut } from "../lib/sign-out";

export function usePlanCardLabels(locale: string): PlanCardLabels {
  const { t } = useLingui();
  return {
    monthly: t`Monthly`,
    yearly: t`Yearly`,
    twoMonthsFree: t`2 months free`,
    currency: t`Currency`,
    interval: t`Billing period`,
    recommended: t`Recommended`,
    perMonth: t`/month`,
    planName,
    forWhom: (plan, count) => (plan === "personal" ? t`For you` : t`For up to ${count} people`),
    serverAndAi: (server, ai) => t`Server ${server} + AI ${ai}`,
    yearlyTotal: (total, saved) => t`${total} billed yearly, ${saved} saved`,
    subscribe: (plan) => {
      const name = planName(plan);
      return t`Subscribe to ${name}`;
    },
    change: (plan) => {
      const name = planName(plan);
      return t`Switch to ${name}`;
    },
    current: t`Current plan`,
    computer: (id) => {
      const size = computerSizeName(id);
      return t`${size} computer`;
    },
    computerSpec: (id) => computerSizeSpec(id, locale),
    people: (count) => plural(count, { one: "# person", other: "# people" }),
    extraPeople: (price, max) => t`${price}/month per extra person, up to ${max}`,
    files: (bytes) => {
      const size = formatStorage(bytes, locale);
      return t`${size} of files`;
    },
    bots: t`Bots and browser automation`,
    routines: t`Scheduled routines`,
    includeAi: t`Include AI`,
    aiAmount: t`AI per month`,
    aiPerMonth: (price) => t`${price}/month`,
    aiToModels: (amount) => t`${amount} goes to models, at cost`,
    ownAi: t`Use the AI you already pay for: Claude, ChatGPT or an API key`,
    reassurance: t`Ready in minutes · cancel anytime`,
    ownerOnly: t`Only the owner can subscribe`,
  };
}

/**
 * The three plans with prices in the person's currency. Without `current` it opens the checkout of
 * the chosen plan; with it (`null` for a price outside the catalog) the organization already
 * subscribes, so the choice moves the subscription instead and `onChanged` runs once it did.
 */
export function PlanPicker({
  status,
  usage,
  current,
  currency,
  onChanged,
  disabled = false,
}: {
  status: BillingStatus;
  usage: PlanUsage;
  current?: PlanSelection | null;
  currency?: BillingCurrency;
  onChanged?: () => void;
  disabled?: boolean;
}) {
  const { i18n } = useLingui();
  const locale = i18n.locale || "en";
  const labels = usePlanCardLabels(locale);
  // The plan whose checkout is opening, set until the page leaves.
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<"checkout" | "change" | null>(null);
  // State updates land a render late, so a second click needs its own guard.
  const opening = useRef(false);
  // A choice that answers after the plans were closed must not leave the app.
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  async function subscribe(choice: Choice) {
    if (opening.current) return;
    opening.current = true;
    setBusy(choice.plan);
    setError(null);
    try {
      if (current !== undefined) {
        const { url } = await rpc.billing.changePlan(choice);
        opening.current = false;
        if (closed.current) return;
        // A payment that needs the owner opens the portal; nothing changed yet.
        if (url) window.location.assign(url);
        else onChanged?.();
        setBusy(null);
        return;
      }
      const { url } = await rpc.billing.planCheckout(choice);
      if (closed.current) return;
      window.location.assign(url);
      // Desktop opens the URL in the system browser and this page stays, so
      // release the buttons when the person comes back; the web page is gone by then.
      window.addEventListener(
        "focus",
        () => {
          opening.current = false;
          if (!closed.current) setBusy(null);
        },
        { once: true },
      );
    } catch {
      opening.current = false;
      if (!closed.current) {
        setBusy(null);
        setError(current === undefined ? "checkout" : "change");
      }
    }
  }

  return (
    <div data-testid="plan-picker" className="flex w-full flex-col items-center gap-4">
      <PlanCards
        plans={usage.plans}
        locale={locale}
        canManage={usage.canManage && status.canManage}
        pending={busy !== null || disabled}
        busy={busy}
        labels={labels}
        current={current}
        currency={currency}
        onSubscribe={(choice) => void subscribe(choice)}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error === "checkout" ? (
            <Trans>Could not open checkout. Try again.</Trans>
          ) : (
            <Trans>Could not update billing</Trans>
          )}
        </p>
      ) : null}
    </div>
  );
}

/** The paywall: the plans on a page of their own, with the way out. */
export function PlanChoice({
  status,
  usage,
  dismissible = false,
}: {
  status: BillingStatus;
  usage: PlanUsage;
  dismissible?: boolean;
}) {
  const [error, setError] = useState(false);
  const { logOut, signingOut } = useSignOut(
    () => window.location.assign("/sign-in"),
    () => setError(true),
  );

  return (
    <div
      data-testid="billing-paywall"
      className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col items-center gap-10 px-4 py-12 sm:px-6"
    >
      {dismissible ? null : (
        <Button
          className="fixed top-4 right-6 z-10"
          variant="text"
          disabled={signingOut}
          onClick={() => void logOut()}
        >
          <Trans>Log out</Trans>
        </Button>
      )}
      <h1 className="flex items-center gap-4 text-center text-4xl font-light tracking-tight sm:text-6xl">
        <Trans>Choose your plan</Trans>
        <BotAvatar color={planMascotColor(0)} size={56} />
      </h1>
      <PlanPicker status={status} usage={usage} disabled={signingOut} />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>Could not open billing</Trans>
        </p>
      ) : null}
    </div>
  );
}
