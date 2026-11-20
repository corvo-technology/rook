import type { BillingStatus, PlanUsage } from "@corvo/contracts";
import type { PlanChoice as Choice, PlanCardLabels } from "@corvo/ui-web";
import { Button, PlanCards, RookGlyph } from "@corvo/ui-web";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { computerSizeName, computerSizeSpec, formatStorage, planName } from "../lib/plan-view";
import { rpc } from "../lib/rpc";
import { useSignOut } from "../lib/sign-out";

function usePlanCardLabels(locale: string): PlanCardLabels {
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
    forWhom: (plan) =>
      ({ personal: t`For one person`, team: t`For a team`, company: t`For a company` })[plan],
    serverAndAi: (server, ai) => t`Server ${server} + AI ${ai}`,
    yearlyTotal: (total, saved) => t`${total} billed yearly, ${saved} saved`,
    subscribe: (plan) => {
      const name = planName(plan);
      return t`Subscribe to ${name}`;
    },
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

/** Three plans with prices in the person's currency; replaces the single choice where plans exist. */
export function PlanChoice({
  status,
  usage,
  dismissible = false,
}: {
  status: BillingStatus;
  usage: PlanUsage;
  dismissible?: boolean;
}) {
  const { i18n } = useLingui();
  const locale = i18n.locale || "en";
  const labels = usePlanCardLabels(locale);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const { logOut, signingOut } = useSignOut(
    () => window.location.assign("/sign-in"),
    () => setError(true),
  );
  // A choice that answers after the plans were closed must not leave the app.
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  async function subscribe(choice: Choice) {
    setPending(true);
    setError(false);
    try {
      const { url } = await rpc.billing.planCheckout(choice);
      if (!closed.current) window.location.assign(url);
    } catch {
      setError(true);
    } finally {
      // Desktop opens the URL in the system browser and this page stays, so re-enable.
      setPending(false);
    }
  }

  return (
    <div
      data-testid="billing-paywall"
      className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col items-center gap-10 px-4 py-12 sm:px-6"
    >
      {dismissible ? null : (
        <Button
          className="fixed top-4 right-6 z-10"
          variant="text"
          disabled={pending || signingOut}
          onClick={() => void logOut()}
        >
          <Trans>Log out</Trans>
        </Button>
      )}
      <h1 className="flex items-center gap-4 text-center text-4xl font-light tracking-tight sm:text-6xl">
        <Trans>Choose your plan</Trans>
        <RookGlyph size={48} />
      </h1>
      <PlanCards
        plans={usage.plans}
        locale={locale}
        canManage={usage.canManage && status.canManage}
        pending={pending || signingOut}
        labels={labels}
        onSubscribe={(choice) => void subscribe(choice)}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>Could not open billing</Trans>
        </p>
      ) : null}
    </div>
  );
}
