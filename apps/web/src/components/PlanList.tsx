import type { PlanUsage } from "@corvo/contracts";
import { Plural, useLingui } from "@lingui/react/macro";
import { computerSizeName, formatStorage, planName } from "../lib/plan-view";

/** What each plan includes, so an owner can compare. Absent where the deployment has no plans. */
export function PlanList({ usage }: { usage: PlanUsage }) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  // One computer on every plan says nothing; it shows only where the plans differ.
  const computersDiffer = new Set(usage.plans.map((plan) => plan.computers)).size > 1;
  return (
    <ul data-testid="plan-list" className="m-0 flex list-none flex-col gap-2 p-0">
      {usage.plans.map((plan) => {
        const { computers, seatsIncluded: seats, maxSeats } = plan;
        const files = formatStorage(plan.storageBytes, locale);
        const size = computerSizeName(plan.computerSize);
        return (
          <li
            key={plan.plan}
            aria-current={plan.plan === usage.plan ? "true" : undefined}
            className="rounded-xl border border-border px-4 py-3 aria-[current=true]:border-foreground"
          >
            <h3 className="text-[14px] font-medium">{planName(plan.plan)}</h3>
            <p className="mt-1 flex flex-wrap gap-x-3 text-[13px] text-muted-foreground">
              <span>{t`${size} computer`}</span>
              {computersDiffer ? (
                <span>
                  <Plural value={computers} one="# computer" other="# computers" />
                </span>
              ) : null}
              <span>{t`${files} of files`}</span>
              <span>
                <Plural value={seats} one="# seat" other="# seats" />
                {maxSeats > seats ? ` · ${t`up to ${maxSeats}`}` : null}
              </span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
