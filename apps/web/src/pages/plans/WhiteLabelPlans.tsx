import { Button, EmptyState } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatMoney } from "../../lib/partner-console";
import { rpc } from "../../lib/rpc";
import { Panel, PartnerError, PartnerLoading, useAction } from "../partner/partner-ui";

const POLL_MS = 2_000;

/**
 * The partner's plans for a customer on the partner's domain: prices as the partner set them, a
 * checkout on the partner's account, plan changes and the card. Credit appears once the payment is
 * confirmed, so after paying the screen waits for it and then opens the app.
 */
export function WhiteLabelPlans() {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const action = useAction();
  const returning = params.get("checkout") === "success";
  const catalog = useQuery({
    queryKey: ["billing", "whiteLabelCatalog"],
    queryFn: () => rpc.billing.whiteLabelCatalog(),
    refetchInterval: (query) =>
      returning && query.state.data?.subscription?.state !== "active" ? POLL_MS : false,
  });
  const data = catalog.data;
  const active = data?.subscription?.state === "active";

  useEffect(() => {
    if (returning && active) navigate("/app/home", { replace: true });
  }, [returning, active, navigate]);

  if (catalog.isPending) return <PartnerLoading />;
  if (catalog.isError)
    return (
      <Frame>
        <PartnerError error={catalog.error} onRetry={() => void catalog.refetch()} />
      </Frame>
    );
  if (!data)
    return (
      <Frame>
        <EmptyState title={t`No plans`} />
      </Frame>
    );

  const money = (minor: number) => formatMoney(minor, data.currency, i18n.locale);
  const sub = data.subscription;
  const open = (url: string) => window.location.assign(url);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["billing", "whiteLabelCatalog"] });
  const buy = (input: Parameters<typeof rpc.billing.whiteLabelCheckout>[0]) =>
    action.run(async () => open((await rpc.billing.whiteLabelCheckout(input)).url));
  const change = (key: string) =>
    action.run(async () => {
      await rpc.billing.whiteLabelChangePlan({ key });
      await refresh();
    });
  const portal = () => action.run(async () => open((await rpc.billing.whiteLabelPortal()).url));

  return (
    <Frame>
      {returning && !active ? (
        <p role="status" data-testid="plans-confirming" className="text-sm text-muted-foreground">
          {t`Confirming your payment`}
        </p>
      ) : null}
      {action.error ? <PartnerError error={action.error} /> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="plans-list">
        {data.plans.map((plan) => {
          const current = sub?.planKey === plan.key;
          const pending = sub?.pendingPlanKey === plan.key;
          return (
            <div
              key={plan.key}
              data-testid={`plan-${plan.key}`}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="text-[14px] font-medium">{plan.name}</div>
              <div className="text-2xl font-light tracking-tight tabular-nums">
                {money(plan.priceMinor)}
                <span className="ms-1 text-meta text-muted-foreground">{t`/ month`}</span>
              </div>
              <div className="text-meta text-muted-foreground">
                {t`${money(plan.creditMinor)} of credit`}
              </div>
              <Button
                className="mt-auto"
                variant={current ? "secondary" : "default"}
                disabled={
                  !data.canPay || action.busy || (current && !sub?.pendingPlanKey) || pending
                }
                onClick={() =>
                  sub && sub.state !== "lapsed"
                    ? void change(plan.key)
                    : void buy({ kind: "plan", key: plan.key })
                }
              >
                {current && !sub?.pendingPlanKey
                  ? t`Current plan`
                  : pending
                    ? t`Next period`
                    : t`Choose`}
              </Button>
            </div>
          );
        })}
      </div>

      {sub && sub.state !== "lapsed" ? (
        <Panel
          title={t`Buy more`}
          data-testid="plans-topups"
          action={
            <Button
              variant="secondary"
              size="sm"
              disabled={action.busy}
              onClick={() => void portal()}
            >
              {t`Payment method`}
            </Button>
          }
        >
          <div className="flex flex-wrap gap-2">
            {data.packs.map((pack) => (
              <Button
                key={pack.key}
                variant="secondary"
                disabled={!data.canPay || action.busy}
                onClick={() => void buy({ kind: "pack", key: pack.key, quantity: 1 })}
              >
                {pack.name} · {money(pack.priceMinor)}
              </Button>
            ))}
          </div>
        </Panel>
      ) : null}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const { t } = useLingui();
  return (
    <div
      data-testid="white-label-plans"
      className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto px-6 py-6"
    >
      <h1 className="text-xl font-light tracking-tight">{t`Plans`}</h1>
      {children}
    </div>
  );
}
