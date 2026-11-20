import type { BillingStatus } from "@corvo/contracts";
import {
  DEFAULT_MONTHLY_CREDIT_AMOUNT,
  MODEL_CREDIT_AMOUNTS,
  ModelCreditAmountSchema,
} from "@corvo/contracts";
import { MenuView } from "@expo/ui/community/menu";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, Linking, ScrollView } from "react-native";
import { SettingsGroup, SettingsRow, SettingsSwitch } from "../../components/settings-group";
import { rpc } from "../../lib/api";
import { dateLocaleForUi, useI18n } from "../../lib/i18n";
import { useSideInsets } from "../../lib/side-insets";

type Amount = (typeof MODEL_CREDIT_AMOUNTS)[number];
export default function BillingScreen() {
  const sideInsets = useSideInsets();
  const { t } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [amount, setAmount] = useState<Amount>(DEFAULT_MONTHLY_CREDIT_AMOUNT);
  const [pending, setPending] = useState(false);
  const [hasPlans, setHasPlans] = useState(false);
  useEffect(() => {
    let active = true;
    void rpc("usage/plan")
      .then((usage) => {
        if (active) setHasPlans(usage !== null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    const next = await rpc("billing/status");
    setStatus(next);
    setAmount(
      ModelCreditAmountSchema.catch(DEFAULT_MONTHLY_CREDIT_AMOUNT).parse(next.monthlyAmountCents),
    );
  }, []);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const load = () => {
        void rpc("billing/status")
          .then((next) => {
            if (active) {
              setStatus(next);
              setAmount(
                ModelCreditAmountSchema.catch(DEFAULT_MONTHLY_CREDIT_AMOUNT).parse(
                  next.monthlyAmountCents,
                ),
              );
            }
          })
          .catch(() => {
            if (active) Alert.alert(t("Could not load billing"));
          });
      };
      load();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") load();
      });
      return () => {
        active = false;
        subscription.remove();
      };
    }, [t]),
  );
  async function action(work: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    try {
      await work();
    } catch {
      Alert.alert(t("Could not update billing"));
    } finally {
      setPending(false);
    }
  }
  const freeUntil = status?.byokFreeUntil
    ? new Date(status.byokFreeUntil).toLocaleDateString(dateLocaleForUi(), {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;
  const recurring = Boolean(
    status?.monthlyAmountCents && !["none", "canceled", "incomplete"].includes(status.state),
  );
  // Switching back to your own key waits for monthly credits to end; switching to credits needs a balance.
  const canUseCredits = status?.funding === "byok" && (status.balanceUsd ?? 0) > 0;
  const canUseOwnKey =
    status?.funding !== "byok" && (!recurring || Boolean(status?.cancelAtPeriodEnd));
  return (
    <ScrollView style={sideInsets} contentInsetAdjustmentBehavior="automatic">
      {hasPlans && status?.canManage ? (
        <SettingsGroup>
          <SettingsRow title={t("Plans")} chevron="right" onPress={() => router.push("/plans")} />
        </SettingsGroup>
      ) : null}
      <SettingsGroup label={t("Credits")}>
        <SettingsRow
          title={t("Available credits")}
          value={`$${(status?.balanceUsd ?? 0).toFixed(2)}`}
        />
        <SettingsRow title={t("Refresh")} disabled={pending} onPress={() => void action(refresh)} />
      </SettingsGroup>
      {status?.canManage ? (
        <>
          <SettingsGroup
            label={t("Monthly credits")}
            footer={t("Monthly credits expire at renewal. Top-ups do not expire.")}
          >
            <MenuView
              actions={MODEL_CREDIT_AMOUNTS.map((value) => ({
                id: String(value),
                title: `$${value / 100} / month`,
                state: amount === value ? ("on" as const) : ("off" as const),
              }))}
              onPressAction={({ nativeEvent }) =>
                setAmount(ModelCreditAmountSchema.parse(Number(nativeEvent.event)))
              }
            >
              <SettingsRow
                title={t("Monthly credits")}
                value={`$${amount / 100} / month`}
                chevron="down"
                disabled={pending}
              />
            </MenuView>
            <SettingsRow
              title={
                recurring
                  ? amount > (status.monthlyAmountCents ?? 0)
                    ? t("Upgrade now")
                    : amount < (status.monthlyAmountCents ?? 0)
                      ? t("Downgrade at renewal")
                      : t("Update")
                  : t("Subscribe")
              }
              disabled={pending || !status.creditPurchasesEnabled}
              onPress={() =>
                void action(async () => {
                  if (recurring) {
                    await rpc("billing/setMonthlyCredits", { amountCents: amount });
                    await refresh();
                  } else {
                    const result = await rpc("billing/purchaseCredits", {
                      amountCents: amount,
                      monthly: true,
                    });
                    await Linking.openURL(result.url);
                  }
                })
              }
            />
          </SettingsGroup>
          <SettingsGroup>
            <MenuView
              actions={MODEL_CREDIT_AMOUNTS.map((value) => ({
                id: String(value),
                title: `$${value / 100}`,
              }))}
              onPressAction={({ nativeEvent }) =>
                void action(async () => {
                  const amountCents = ModelCreditAmountSchema.parse(Number(nativeEvent.event));
                  const result = await rpc("billing/purchaseCredits", {
                    amountCents,
                    monthly: false,
                  });
                  await Linking.openURL(result.url);
                })
              }
            >
              <SettingsRow
                title={t("Add credits")}
                chevron="right"
                disabled={pending || !status.creditPurchasesEnabled}
              />
            </MenuView>
            {status.hasCustomer ? (
              <SettingsRow
                title={t("Manage billing")}
                disabled={pending}
                onPress={() =>
                  void action(async () => {
                    const result = await rpc("billing/portal");
                    await Linking.openURL(result.url);
                  })
                }
              />
            ) : null}
          </SettingsGroup>
          {freeUntil ? (
            <SettingsGroup label={t("Your subscription or API key")}>
              <SettingsRow title={t("Free plan ends")} value={freeUntil} />
              <SettingsRow
                title={t("Subscribe")}
                disabled={pending}
                onPress={() =>
                  void action(async () => {
                    const result = await rpc("billing/checkout");
                    await Linking.openURL(result.url);
                  })
                }
              />
            </SettingsGroup>
          ) : null}
          {canUseCredits || canUseOwnKey ? (
            <SettingsGroup
              footer={
                freeUntil
                  ? undefined
                  : status.byokPriceCents
                    ? t("{price} / month. Works with your ChatGPT or Claude plan.", {
                        price: `$${status.byokPriceCents / 100}`,
                      })
                    : t("Free. Works with your ChatGPT or Claude plan.")
              }
            >
              <SettingsSwitch
                label={t("Use Rook credits")}
                value={status.funding !== "byok"}
                disabled={pending || (canUseCredits && !status.creditPurchasesEnabled)}
                onChange={(next) =>
                  void action(async () => {
                    if (next) {
                      await rpc("billing/selectFunding", { funding: "credits" });
                      router.replace("/models");
                    } else {
                      const result = await rpc("billing/selectFunding", { funding: "byok" });
                      if (result.url) await Linking.openURL(result.url);
                      else router.replace("/models");
                    }
                  })
                }
              />
            </SettingsGroup>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
