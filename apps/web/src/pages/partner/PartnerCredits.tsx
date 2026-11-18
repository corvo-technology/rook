import type { PartnerCredits as Credits, PartnerConsolePartner } from "@corvo/contracts";
import {
  Button,
  Input,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  formatMoney,
  formatNumber,
  minorText,
  newIdempotencyKey,
  parseMinor,
} from "../../lib/partner-console";
import { rpc } from "../../lib/rpc";
import { Kpi, openInNewWindow, Panel, PartnerError, PartnerLoading, useAction } from "./partner-ui";

/** Embedded partners: the plan, the one fund every customer spends from, and each customer's use. */
export function PartnerCredits({ partner }: { partner: PartnerConsolePartner }) {
  const queryClient = useQueryClient();
  const credits = useQuery({
    queryKey: ["partner-console", partner.id, "credits"],
    queryFn: () => rpc.partnerConsole.credits({ partnerId: partner.id }),
  });
  if (credits.isPending) return <PartnerLoading />;
  if (credits.isError) return <PartnerError error={credits.error} onRetry={credits.refetch} />;
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["partner-console", partner.id, "credits"] });
  return (
    <div className="space-y-4" data-testid="partner-credits">
      <FundPanel partner={partner} credits={credits.data} />
      <AutoTopupPanel partner={partner} credits={credits.data} onSaved={refresh} />
      <ModelsPanel partner={partner} credits={credits.data} onSaved={refresh} />
      <CustomersPanel partner={partner} credits={credits.data} onSaved={refresh} />
    </div>
  );
}

function FundPanel({ partner, credits }: { partner: PartnerConsolePartner; credits: Credits }) {
  const { t, i18n } = useLingui();
  const action = useAction();
  const [amount, setAmount] = useState("");
  const key = useRef<{ for: number; key: string } | null>(null);
  const total = credits.balance.planCredits + credits.balance.topupCredits;
  const number = (value: number) => formatNumber(value, i18n.locale);

  function topUp() {
    const amountMinor = parseMinor(amount);
    if (!amountMinor) return;
    if (key.current?.for !== amountMinor)
      key.current = { for: amountMinor, key: newIdempotencyKey() };
    const { key: idempotencyKey } = key.current;
    void action.run(async () => {
      await openInNewWindow(
        async () =>
          (await rpc.partnerConsole.topup({ partnerId: partner.id, amountMinor, idempotencyKey }))
            .url,
      );
      key.current = null;
      setAmount("");
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={t`Plan`}
          value={credits.plan?.name ?? "—"}
          detail={
            credits.plan
              ? formatMoney(credits.plan.priceMinor, credits.currency, i18n.locale)
              : undefined
          }
        />
        <Kpi label={t`Fund`} value={number(total)} />
        <Kpi label={t`From the plan`} value={number(credits.balance.planCredits)} />
        <Kpi label={t`From top-ups`} value={number(credits.balance.topupCredits)} />
      </div>
      <form
        className="flex max-w-sm gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          topUp();
        }}
      >
        <Input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          placeholder={t`Amount`}
          aria-label={t`Amount`}
        />
        <Button type="submit" disabled={action.busy || !parseMinor(amount)}>
          {t`Top up`}
        </Button>
      </form>
      {action.error ? <PartnerError error={action.error} /> : null}
    </div>
  );
}

function AutoTopupPanel({
  partner,
  credits,
  onSaved,
}: {
  partner: PartnerConsolePartner;
  credits: Credits;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const action = useAction();
  const [enabled, setEnabled] = useState(credits.autoTopup.enabled);
  const [threshold, setThreshold] = useState(
    credits.autoTopup.thresholdCredits === null ? "" : String(credits.autoTopup.thresholdCredits),
  );
  const [amount, setAmount] = useState(minorText(credits.autoTopup.amountMinor ?? 0));
  const thresholdCredits = Number.parseInt(threshold, 10);
  const amountMinor = parseMinor(amount);
  const valid = !enabled || (thresholdCredits > 0 && Boolean(amountMinor));

  return (
    <Panel title={t`Automatic top-up`}>
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          void action.run(async () => {
            await rpc.partnerConsole.setAutoTopup({
              partnerId: partner.id,
              enabled,
              thresholdCredits: enabled ? thresholdCredits : null,
              amountMinor: enabled ? amountMinor : null,
            });
            onSaved();
          });
        }}
      >
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t`Automatic top-up`} />
        <Input
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
          disabled={!enabled}
          inputMode="numeric"
          placeholder={t`Below credits`}
          aria-label={t`Below credits`}
          className="w-36"
        />
        <Input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={!enabled}
          inputMode="decimal"
          placeholder={t`Amount`}
          aria-label={t`Amount`}
          className="w-28"
        />
        <Button type="submit" variant="secondary" disabled={action.busy || !valid}>
          {t`Save`}
        </Button>
      </form>
      {action.error ? <PartnerError error={action.error} /> : null}
    </Panel>
  );
}

function ModelsPanel({
  partner,
  credits,
  onSaved,
}: {
  partner: PartnerConsolePartner;
  credits: Credits;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const action = useAction();
  const [text, setText] = useState(credits.allowedModels.join(", "));
  return (
    <Panel title={t`Allowed models`}>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const models = [
            ...new Set(
              text
                .split(/[,\n]/)
                .map((model) => model.trim())
                .filter(Boolean),
            ),
          ];
          void action.run(async () => {
            const saved = await rpc.partnerConsole.setAllowedModels({
              partnerId: partner.id,
              models,
            });
            setText(saved.models.join(", "));
            onSaved();
          });
        }}
      >
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t`All models`}
          aria-label={t`Allowed models`}
        />
        <Button type="submit" variant="secondary" disabled={action.busy}>
          {t`Save`}
        </Button>
      </form>
      {action.error ? <PartnerError error={action.error} /> : null}
    </Panel>
  );
}

function CustomersPanel({
  partner,
  credits,
  onSaved,
}: {
  partner: PartnerConsolePartner;
  credits: Credits;
  onSaved: () => void;
}) {
  const { t, i18n } = useLingui();
  if (credits.customers.length === 0) return null;
  return (
    <Panel title={t`Use by customer`} data-testid="partner-credit-customers">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t`Customer`}</TableHead>
            <TableHead>{t`Used`}</TableHead>
            <TableHead>{t`Monthly limit`}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {credits.customers.map((customer) => (
            <TableRow key={customer.tenantId}>
              <TableCell className="font-medium">{customer.name}</TableCell>
              <TableCell className="tabular-nums">
                {formatNumber(customer.usedCredits, i18n.locale)}
              </TableCell>
              <TableCell>
                <LimitField
                  key={`${customer.tenantId}:${customer.limitCredits ?? ""}`}
                  partnerId={partner.id}
                  tenantId={customer.tenantId}
                  name={customer.name}
                  limit={customer.limitCredits}
                  onSaved={onSaved}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

/** A customer's monthly cap; empty removes it. Saved when the field is left. */
function LimitField({
  partnerId,
  tenantId,
  name,
  limit,
  onSaved,
}: {
  partnerId: string;
  tenantId: string;
  name: string;
  limit: number | null;
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const action = useAction();
  const saved = limit === null ? "" : String(limit);
  const [text, setText] = useState(saved);

  function save() {
    const digits = text.replace(/\D/g, "");
    const next = digits ? Number(digits) : null;
    setText(next === null ? "" : String(next));
    if ((next === null ? "" : String(next)) === saved) return;
    void action.run(async () => {
      await rpc.partnerConsole.setCustomerLimit({ partnerId, tenantId, limitCredits: next });
      onSaved();
    });
  }

  return (
    <div>
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        inputMode="numeric"
        placeholder={t`No limit`}
        aria-label={t`Monthly limit for ${name}`}
        aria-invalid={action.error ? true : undefined}
        disabled={action.busy}
        className="w-32"
      />
      {action.error ? <PartnerError error={action.error} /> : null}
    </div>
  );
}
