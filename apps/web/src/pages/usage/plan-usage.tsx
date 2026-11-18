import type { PlanUsage } from "@corvo/contracts";
import { Button, Progress } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  computerSizeName,
  computerSizeSpec,
  formatStorage,
  planName,
  storageLevel,
  storagePercent,
} from "../../lib/plan-view";
import { useSpaceQueries } from "../../lib/query";

/**
 * Storage against the plan's limit and the plan's computers. Absent where the deployment has no
 * plans, and while it loads or fails: the page does not depend on it.
 */
export function PlanUsageSection() {
  const queries = useSpaceQueries();
  const plan = useQuery(queries.usage.plan.queryOptions());
  return plan.data ? <PlanUsageView plan={plan.data} /> : null;
}

export function PlanUsageView({ plan }: { plan: PlanUsage }) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const navigate = useNavigate();
  const { usedBytes, limitBytes } = plan.storage;
  const level = storageLevel(usedBytes, limitBytes);
  const used = formatStorage(usedBytes, locale);
  const limit = formatStorage(limitBytes, locale);
  const computersUsed = new Intl.NumberFormat(locale).format(plan.computers.used);
  const computersLimit = new Intl.NumberFormat(locale).format(plan.computers.limit);
  const peopleUsed = new Intl.NumberFormat(locale).format(plan.seats.used);
  const peopleMax = new Intl.NumberFormat(locale).format(plan.seats.max);
  return (
    <section data-testid="plan-usage" className="mb-8 border-b border-border pb-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-muted-foreground">{planName(plan.plan)}</h2>
        {plan.canManage && (level !== "ok" || plan.seats.used >= plan.seats.max) ? (
          <Button size="sm" onClick={() => navigate("/settings/billing")}>
            {t`Upgrade`}
          </Button>
        ) : null}
      </div>
      <Progress
        aria-label={t`Storage`}
        value={storagePercent(usedBytes, limitBytes)}
        className="mt-3 gap-1.5"
        data-level={level}
      >
        <span className="text-sm tabular-nums">{t`${used} of ${limit}`}</span>
      </Progress>
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
        <div>
          <dt className="text-muted-foreground">{t`People`}</dt>
          <dd className="mt-0.5 tabular-nums">{t`${peopleUsed} of ${peopleMax}`}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t`Computers`}</dt>
          <dd className="mt-0.5 tabular-nums">{t`${computersUsed} of ${computersLimit}`}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{computerSizeName(plan.computerSize)}</dt>
          <dd className="mt-0.5 tabular-nums">{computerSizeSpec(plan.computerSize, locale)}</dd>
        </div>
      </dl>
    </section>
  );
}
