import type { PartnerConsolePartner, PartnerConsolePricing as Pricing } from "@corvo/contracts";
import { Button, Input, NativeSelect, NativeSelectOption } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  finalMinor,
  formatMoney,
  type Markup,
  minorText,
  parseMinor,
} from "../../lib/partner-console";
import { rpc } from "../../lib/rpc";
import { Panel, PartnerError, PartnerLoading, useAction } from "./partner-ui";

type Item = Pricing["plans"][number];
type Draft = { kind: Markup["kind"]; text: string };

const draftOf = (item: Item): Draft => ({
  kind: item.markup.kind,
  text: minorText(item.markup.value),
});
const markupOf = (draft: Draft): Markup | null => {
  if (draft.text.trim() === "") return { kind: draft.kind, value: 0 };
  const value = parseMinor(draft.text);
  return value === null ? null : { kind: draft.kind, value };
};

/** Referral and white-label partners: a markup on each plan and pack, with the price it makes. */
export function PartnerPricing({ partner }: { partner: PartnerConsolePartner }) {
  const pricing = useQuery({
    queryKey: ["partner-console", partner.id, "pricing"],
    queryFn: () => rpc.partnerConsole.pricing({ partnerId: partner.id }),
  });
  if (pricing.isPending) return <PartnerLoading />;
  if (pricing.isError) return <PartnerError error={pricing.error} onRetry={pricing.refetch} />;
  // The form restarts from the saved prices whenever they change.
  return (
    <PricingForm key={JSON.stringify(pricing.data)} partner={partner} pricing={pricing.data} />
  );
}

function PricingForm({ partner, pricing }: { partner: PartnerConsolePartner; pricing: Pricing }) {
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const action = useAction();
  const items = [...pricing.plans, ...pricing.packs];
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(items.map((item) => [item.itemId, draftOf(item)])),
  );
  const [checkoutUrl, setCheckoutUrl] = useState(pricing.checkoutUrl ?? "");
  const money = (minor: number) => formatMoney(minor, pricing.currency, i18n.locale);

  const parsed = items.map((item) => ({ item, markup: markupOf(drafts[item.itemId] as Draft) }));
  const valid = parsed.every((row) => row.markup !== null);
  const dirty =
    checkoutUrl.trim() !== (pricing.checkoutUrl ?? "") ||
    parsed.some(
      (row) =>
        row.markup &&
        (row.markup.kind !== row.item.markup.kind || row.markup.value !== row.item.markup.value) &&
        !(row.markup.value === 0 && row.item.markup.value === 0),
    );

  function row(item: Item, markup: Markup | null) {
    const draft = drafts[item.itemId] as Draft;
    const set = (next: Partial<Draft>) =>
      setDrafts((current) => ({ ...current, [item.itemId]: { ...draft, ...next } }));
    return (
      <tr key={item.itemId} className="border-t border-border first:border-t-0">
        <td className="py-2 pe-3 font-medium">{item.name}</td>
        <td className="py-2 pe-3 tabular-nums">{money(item.baseMinor)}</td>
        <td className="py-2 pe-3 tabular-nums">{money(item.commissionMinor)}</td>
        <td className="py-2 pe-3">
          <div className="flex gap-1.5">
            <NativeSelect
              value={draft.kind}
              onChange={(event) => set({ kind: event.target.value as Markup["kind"] })}
              aria-label={t`Markup type for ${item.name}`}
              size="sm"
            >
              <NativeSelectOption value="fixed">{pricing.currency}</NativeSelectOption>
              <NativeSelectOption value="percent">%</NativeSelectOption>
            </NativeSelect>
            <Input
              value={draft.text}
              onChange={(event) => set({ text: event.target.value })}
              inputMode="decimal"
              placeholder="0"
              aria-label={t`Markup for ${item.name}`}
              aria-invalid={markup === null ? true : undefined}
              className="w-24"
            />
          </div>
        </td>
        <td className="py-2 text-end font-medium tabular-nums">
          {markup ? money(finalMinor(item.baseMinor, markup)) : "—"}
        </td>
      </tr>
    );
  }

  const table = (list: Item[], title: string) =>
    list.length === 0 ? null : (
      <Panel title={title}>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-[14px]">
            <thead>
              <tr className="text-start text-caption text-muted-foreground">
                <th className="pb-2 pe-3 text-start font-normal">{t`Item`}</th>
                <th className="pb-2 pe-3 text-start font-normal">{t`Base`}</th>
                <th className="pb-2 pe-3 text-start font-normal">{t`Commission`}</th>
                <th className="pb-2 pe-3 text-start font-normal">{t`Markup`}</th>
                <th className="pb-2 text-end font-normal">{t`Customer pays`}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) =>
                row(
                  item,
                  parsed.find((entry) => entry.item.itemId === item.itemId)?.markup ?? null,
                ),
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    );

  return (
    <form
      className="space-y-4"
      data-testid="partner-pricing"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || !dirty) return;
        void action.run(async () => {
          const saved = await rpc.partnerConsole.setPricing({
            partnerId: partner.id,
            checkoutUrl: checkoutUrl.trim() === "" ? null : checkoutUrl.trim(),
            markups: parsed.flatMap(({ item, markup }) =>
              markup ? [{ itemId: item.itemId, kind: markup.kind, value: markup.value }] : [],
            ),
          });
          queryClient.setQueryData(["partner-console", partner.id, "pricing"], saved);
        });
      }}
    >
      {table(pricing.plans, t`Plans`)}
      {table(pricing.packs, t`Credit packs`)}
      <Panel title={t`Checkout`}>
        <Input
          value={checkoutUrl}
          onChange={(event) => setCheckoutUrl(event.target.value)}
          placeholder="https://"
          inputMode="url"
          aria-label={t`Checkout URL`}
        />
      </Panel>
      {action.error ? <PartnerError error={action.error} /> : null}
      <Button type="submit" disabled={action.busy || !valid || !dirty}>
        {t`Save`}
      </Button>
    </form>
  );
}
