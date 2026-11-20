import type {
  AiUseCents,
  BillingCurrency,
  BillingInterval,
  ComputerSize,
  PlanId,
  PlanUsage,
} from "@corvo/contracts";
import {
  AI_USE_CENTS,
  aiAddOnPriceCents,
  BILLING_CURRENCIES,
  COMPUTER_SIZE_SPECS,
  currencyForLocale,
  extraPersonCents,
  GIB,
  planPriceCents,
} from "@corvo/contracts";
import { MenuView } from "@expo/ui/community/menu";
import { useEffect, useState } from "react";
import { Alert, Linking, ScrollView } from "react-native";
import { SettingsGroup, SettingsRow, SettingsSwitch } from "../../components/settings-group";
import { rpc } from "../../lib/api";
import { dateLocaleForUi, useI18n } from "../../lib/i18n";
import { useSideInsets } from "../../lib/side-insets";

const MONTHS = 12;
const DEFAULT_AI_USE: AiUseCents = 1000;

function money(cents: number, currency: BillingCurrency, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export default function PlansScreen() {
  const sideInsets = useSideInsets();
  const { locale: uiLocale, t } = useI18n();
  const locale = dateLocaleForUi(uiLocale);
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [plan, setPlan] = useState<PlanId>("team");
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [currency, setCurrency] = useState<BillingCurrency>(currencyForLocale(uiLocale));
  const [aiOn, setAiOn] = useState(true);
  const [aiUse, setAiUse] = useState<AiUseCents>(DEFAULT_AI_USE);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void rpc("usage/plan")
      .then((next) => {
        if (active) setUsage(next);
      })
      .catch(() => {
        if (active) Alert.alert(t("Could not load plans"));
      });
    return () => {
      active = false;
    };
  }, [t]);

  const names: Record<PlanId, string> = {
    personal: t("Personal"),
    team: t("Team"),
    company: t("Company"),
  };
  const sizeNames: Record<ComputerSize, string> = {
    small: t("Small"),
    medium: t("Medium"),
    large: t("Large"),
  };
  const entitlements = usage?.plans.find((candidate) => candidate.plan === plan);
  if (!usage || !entitlements) return <ScrollView style={sideInsets} />;

  const divisor = interval === "year" ? MONTHS : 1;
  const serverCents = planPriceCents(plan, currency, interval);
  const aiCents = aiOn ? aiAddOnPriceCents(currency, aiUse, interval) : 0;
  const perMonth = (cents: number) => money(Math.round(cents / divisor), currency, locale);
  const spec = COMPUTER_SIZE_SPECS[entitlements.computerSize];
  const size = sizeNames[entitlements.computerSize];
  const people = entitlements.seatsIncluded;
  const files = `${Math.round(entitlements.storageBytes / GIB)} GB`;
  const canManage = usage.canManage;

  async function subscribe() {
    if (pending) return;
    setPending(true);
    try {
      const { url } = await rpc("billing/planCheckout", {
        plan,
        interval,
        currency,
        aiUseCents: aiOn ? aiUse : null,
      });
      await Linking.openURL(url);
    } catch {
      Alert.alert(t("Could not open billing"));
    } finally {
      setPending(false);
    }
  }

  const choose = <T extends string>(
    items: { value: T; title: string }[],
    current: T,
    onPick: (value: T) => void,
  ) => ({
    actions: items.map((item) => ({
      id: item.value,
      title: item.title,
      state: current === item.value ? ("on" as const) : ("off" as const),
    })),
    onPressAction: ({ nativeEvent }: { nativeEvent: { event: string } }) => {
      const picked = items.find((item) => item.value === nativeEvent.event);
      if (picked) onPick(picked.value);
    },
  });

  return (
    <ScrollView style={sideInsets} contentInsetAdjustmentBehavior="automatic">
      <SettingsGroup>
        <MenuView
          {...choose(
            usage.plans.map((candidate) => ({
              value: candidate.plan,
              title: names[candidate.plan],
            })),
            plan,
            setPlan,
          )}
        >
          <SettingsRow title={t("Plan")} value={names[plan]} chevron="down" />
        </MenuView>
        <SettingsRow
          title={t("{size} computer", { size })}
          value={`${spec.cpu} CPU · ${spec.memoryGb} GB · ${spec.diskGb} GB`}
        />
        <SettingsRow
          title={people === 1 ? t("1 person") : t("{count} people", { count: people })}
          value={
            entitlements.maxSeats > people
              ? t("{price}/month per extra person, up to {max}", {
                  price: money(extraPersonCents(currency, "month"), currency, locale),
                  max: entitlements.maxSeats,
                })
              : undefined
          }
        />
        <SettingsRow title={t("{size} of files", { size: files })} />
      </SettingsGroup>
      <SettingsGroup>
        <MenuView
          {...choose(
            [
              { value: "month" as const, title: t("Monthly") },
              { value: "year" as const, title: t("Yearly · 2 months free") },
            ],
            interval,
            setInterval,
          )}
        >
          <SettingsRow
            title={t("Billing period")}
            value={interval === "year" ? t("Yearly") : t("Monthly")}
            chevron="down"
          />
        </MenuView>
        <MenuView
          {...choose(
            BILLING_CURRENCIES.map((value) => ({ value, title: value.toUpperCase() })),
            currency,
            setCurrency,
          )}
        >
          <SettingsRow title={t("Currency")} value={currency.toUpperCase()} chevron="down" />
        </MenuView>
      </SettingsGroup>
      <SettingsGroup
        footer={
          aiOn
            ? t("{amount} goes to models, at cost", { amount: money(aiUse, currency, locale) })
            : t("Use the AI you already pay for: Claude, ChatGPT or an API key")
        }
      >
        <SettingsSwitch label={t("Include AI")} value={aiOn} onChange={setAiOn} />
        {aiOn ? (
          <MenuView
            {...choose(
              AI_USE_CENTS.map((cents) => ({
                value: String(cents),
                title: t("{price}/month", {
                  price: money(aiAddOnPriceCents(currency, cents, "month"), currency, locale),
                }),
              })),
              String(aiUse),
              (value) => {
                const picked = AI_USE_CENTS.find((cents) => String(cents) === value);
                if (picked !== undefined) setAiUse(picked);
              },
            )}
          >
            <SettingsRow
              title={t("AI per month")}
              value={t("{price}/month", {
                price: money(aiAddOnPriceCents(currency, aiUse, "month"), currency, locale),
              })}
              chevron="down"
            />
          </MenuView>
        ) : null}
      </SettingsGroup>
      <SettingsGroup
        footer={
          !canManage
            ? t("Only the owner can subscribe")
            : interval === "year"
              ? t("{total} billed yearly, {saved} saved", {
                  total: money(serverCents + aiCents, currency, locale),
                  saved: money(
                    (planPriceCents(plan, currency, "month") +
                      (aiOn ? aiAddOnPriceCents(currency, aiUse, "month") : 0)) *
                      MONTHS -
                      (serverCents + aiCents),
                    currency,
                    locale,
                  ),
                })
              : aiOn
                ? t("Server {server} + AI {ai}", {
                    server: perMonth(serverCents),
                    ai: perMonth(aiCents),
                  })
                : undefined
        }
      >
        <SettingsRow
          title={t("Subscribe to {name}", { name: names[plan] })}
          value={t("{price}/month", { price: perMonth(serverCents + aiCents) })}
          disabled={!canManage || pending}
          onPress={() => void subscribe()}
        />
      </SettingsGroup>
    </ScrollView>
  );
}
