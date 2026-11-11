import type { LocalSetupReport } from "@corvo/contracts";

export type LocalFoundRow = {
  optionId: string;
  modelId: string;
  title: string;
  subtitle: string;
};

/**
 * What the engine found on its own computer, one row each. Mobile detects nothing and runs no
 * test: it only lists what the engine reports, including the account's existing connections, and
 * lets the person use it.
 */
export function localFoundRows(
  report: LocalSetupReport | undefined,
  t: (message: string) => string = (message) => message,
): LocalFoundRow[] {
  if (!report?.enabled) return [];
  return report.options.map((option) => ({
    optionId: option.id,
    modelId: option.modelId,
    title: option.kind === "local" ? t("Local models") : option.label,
    subtitle: option.modelId,
  }));
}
