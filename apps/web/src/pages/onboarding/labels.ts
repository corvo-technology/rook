import type { BusinessKind, WorkArea } from "@corvo/contracts";
import { useLingui } from "@lingui/react/macro";

/** What a workspace can do, in the app's language. */
export function useBusinessLabels(): Record<BusinessKind, string> {
  const { t } = useLingui();
  return {
    agency: t`Agency`,
    "online-store": t`Online store`,
    clinic: t`Clinic or practice`,
    software: t`Software and apps`,
    "customer-service": t`Customer service`,
    "services-office": t`Services office`,
    other: t`Something else`,
  };
}

/** What a person can look after, in the app's language. */
export function useWorkAreaLabels(): Record<WorkArea, string> {
  const { t } = useLingui();
  return {
    development: t`Development`,
    marketing: t`Marketing`,
    sales: t`Sales`,
    finance: t`Finance`,
    operations: t`Operations`,
    support: t`Support`,
    other: t`Something else`,
  };
}
