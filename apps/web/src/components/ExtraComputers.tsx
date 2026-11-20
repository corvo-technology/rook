import type { PlanUsage } from "@corvo/contracts";
import { MAX_EXTRA_COMPUTERS } from "@corvo/contracts";
import { Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatBillingPrice } from "../lib/billing";
import { rpc } from "../lib/rpc";
import { useOpenSettings } from "../lib/settings-route";
import { SettingsRow } from "./SettingsRows";

export const PLAN_USAGE_KEY = ["usage", "plan"];

/**
 * The owner's way to buy computers above the plan's: how many are in use out of how many are
 * allowed, with a place to add or remove one. Shown only where extra computers can be bought.
 */
export function ExtraComputersRow({
  usage,
  onChanged,
}: {
  usage: PlanUsage;
  onChanged: () => Promise<void> | void;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const { used, limit, extra, extraPrice } = usage.computers;
  if (!extraPrice && extra === 0) return null;
  const computersUsed = new Intl.NumberFormat(locale).format(used);
  const computersLimit = new Intl.NumberFormat(locale).format(limit);
  const price = extraPrice
    ? formatBillingPrice(
        {
          amount: extraPrice.amount,
          currency: extraPrice.currency,
          interval: extraPrice.interval as "month" | "year",
          intervalCount: 1,
        },
        locale,
      )
    : null;

  async function change(quantity: number) {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const { url } = await rpc.billing.setExtraComputers({ quantity });
      // A payment that needs the owner opens the portal; nothing changed yet.
      if (url) window.location.assign(url);
      else await onChanged();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsRow
      label={
        <div>
          <p>{t`Computers`}</p>
          <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
            {t`${computersUsed} of ${computersLimit}`}
            {price ? ` · ${price}` : ""}
          </p>
        </div>
      }
      control={
        usage.canManage ? (
          <>
            <Button
              variant="secondary"
              disabled={pending || extra < 1 || used >= limit}
              onClick={() => void change(extra - 1)}
            >
              {t`Remove computer`}
            </Button>
            <Button
              variant="secondary"
              disabled={pending || !extraPrice || extra >= MAX_EXTRA_COMPUTERS}
              onClick={() => void change(extra + 1)}
            >
              {t`Add computer`}
            </Button>
          </>
        ) : null
      }
    >
      {failed ? (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {t`Something went wrong. Try again.`}
        </p>
      ) : null}
    </SettingsRow>
  );
}

/**
 * What to do when the plan has no room for another computer. Every plan includes one, so the
 * owner can only add one, never upgrade for it; anyone else is told who can. Nothing where plans
 * are off or extra computers are not offered.
 */
export function ComputerLimitAction() {
  const { t } = useLingui();
  const openSettings = useOpenSettings();
  const usage = useQuery({
    queryKey: PLAN_USAGE_KEY,
    queryFn: () => rpc.usage.plan(),
    retry: false,
    staleTime: 60_000,
  });
  const plan = usage.data;
  if (!plan) return null;
  if (!plan.canManage)
    return (
      <p data-testid="computer-limit-owner-only" className="text-sm text-muted-foreground">
        {t`Only the owner can add computers.`}
      </p>
    );
  if (!plan.computers.extraPrice) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      data-testid="computer-limit-add"
      onClick={() => openSettings("billing")}
    >
      {t`Add computer`}
    </Button>
  );
}
