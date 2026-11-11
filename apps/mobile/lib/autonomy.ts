import type { ApprovalMode } from "@corvo/contracts";
import type { ApprovalSummary } from "@corvo/core";
import { approvalModeSummary } from "@corvo/core";
import { Alert } from "react-native";

type Translate = (message: string, values?: Record<string, string | number>) => string;

/** What still asks at an answer, keyed by the summary the gate yields. */
function summaryLines(t: Translate): Record<ApprovalSummary, string> {
  return {
    every_change: t(
      "Still asks before anything that changes something, and before opening a site you didn't mention.",
    ),
    reviewed: t(
      "Still asks when a second model finds it outside your request, and before security changes.",
    ),
    steered_only: t(
      "Still asks before a security change after it read outside content. Blocked actions stay blocked.",
    ),
  };
}

/** The answers to "how much does this bot do on its own", safest first. */
export function autonomyOptions(
  t: Translate,
  input: { value: ApprovalMode; checkerAvailable: boolean },
): { id: ApprovalMode; title: string; state: "on" | "off" }[] {
  const options: { id: ApprovalMode; title: string }[] = [
    { id: "ask", title: t("Asks before any change") },
    // Normal needs an approval model; it stays listed while chosen so the choice stays visible.
    ...(input.checkerAvailable || input.value === "auto"
      ? [{ id: "auto" as const, title: t("Does what fits your request") }]
      : []),
    { id: "never", title: t("Does everything without asking") },
  ];
  return options.map((option) => ({ ...option, state: option.id === input.value ? "on" : "off" }));
}

/** The one line under the answer: what still asks, as the gate decides it. */
export function autonomyLine(
  t: Translate,
  input: { mode: ApprovalMode; checkerAvailable: boolean },
): string {
  const summary = approvalModeSummary({
    mode: input.mode,
    checkerConfigured: input.checkerAvailable,
  });
  return summaryLines(t)[summary];
}

/** Asks before Never ask is chosen; dismissing counts as cancelling. */
export function confirmNeverAsk(t: Translate, name: string | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      name ? t("Let {name} act without asking?", { name }) : t("Let bots act without asking?"),
      summaryLines(t).steered_only,
      [
        { text: t("Cancel"), style: "cancel", onPress: () => resolve(false) },
        { text: t("Stop asking"), style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
