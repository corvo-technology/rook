import type {
  ActionApprovalRule,
  ActionAutoReviewSettings,
  ApprovalMode,
  SettingsScope,
} from "@corvo/contracts";
import { humanizeToolName } from "@corvo/core";
import { writeSaved } from "@corvo/core/query";
import { Button, ToggleGroup, ToggleGroupItem } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";
import { NeverAskConfirm } from "./AutonomyPicker";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

const segmented = "rounded-lg bg-muted p-1";
const segment = "h-7 px-3 text-[13px] aria-pressed:bg-background aria-pressed:shadow-sm";

/** Approvals for the account, or for the bound Space when it customizes them. */
export function ApprovalRulesSettings({ scope }: { scope: SettingsScope }) {
  const rpc = useSpaceRpc();
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const input = { scope };
  const rulesQuery = useQuery(queries.approvalRules.list.queryOptions({ input }));
  const autoReviewQuery = useQuery(queries.autoReview.get.queryOptions({ input }));
  const rules = rulesQuery.data ?? [];
  const autoReview = autoReviewQuery.data ?? null;
  const loading = rulesQuery.isPending || autoReviewQuery.isPending;
  const loadFailed = rulesQuery.error ?? autoReviewQuery.error;
  const [saving, setSaving] = useState(false);
  const [confirmingNever, setConfirmingNever] = useState(false);
  const [actionError, setError] = useState<string | null>(null);
  const error =
    actionError ?? (loadFailed ? errorText(loadFailed, t`Could not load approval rules`) : null);
  const modeId = useId();
  // The safest choice first.
  const modes: Array<{ mode: ApprovalMode; label: string; detail: string }> = [
    { mode: "ask", label: t`Ask`, detail: t`Asks you before it changes anything.` },
    // Auto needs an approval model; it stays listed while chosen so the choice is visible.
    ...(autoReview?.checkerAvailable || autoReview?.mode === "auto"
      ? [
          {
            mode: "auto" as const,
            label: t`Auto`,
            detail: t`A second model approves what fits your request. You decide the rest.`,
          },
        ]
      : []),
    {
      mode: "never",
      label: t`Never ask`,
      detail: t`Does everything without asking. Best for bots you trust.`,
    },
  ];

  function setRules(update: (current: ActionApprovalRule[]) => ActionApprovalRule[]) {
    return writeSaved(queryClient, queries.approvalRules.list.queryKey({ input }), (current) =>
      update(current ?? []),
    );
  }

  function setAutoReview(next: ActionAutoReviewSettings) {
    return writeSaved(queryClient, queries.autoReview.get.queryKey({ input }), () => next);
  }

  async function save(work: () => Promise<unknown>, failure: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(errorText(err, failure));
    } finally {
      setSaving(false);
    }
  }

  const setMode = (mode: ApprovalMode) =>
    save(
      async () => setAutoReview(await rpc.autoReview.set({ scope, mode })),
      t`Could not save Auto Review`,
    );

  const setEffect = (rule: ActionApprovalRule, effect: "always_allow" | "deny") =>
    save(async () => {
      if (rule.matchKind === "category") return;
      const saved = await rpc.approvalRules.set({
        scope,
        effect,
        matchKind: rule.matchKind,
        matchValue: rule.matchValue,
      });
      // Saving replaces the rule's other effect on the same match.
      await setRules((current) => [...current.filter((other) => other.id !== rule.id), saved]);
    }, t`Could not save rule`);

  const removeRule = (rule: ActionApprovalRule) =>
    save(async () => {
      await rpc.approvalRules.remove({ scope, id: rule.id });
      await setRules((current) => current.filter((other) => other.id !== rule.id));
    }, t`Could not remove rule`);

  return (
    <div data-testid="approval-settings" className="space-y-8">
      <NeverAskConfirm
        open={confirmingNever}
        onCancel={() => setConfirmingNever(false)}
        onConfirm={() => {
          setConfirmingNever(false);
          void setMode("never");
        }}
      />
      <div className="space-y-2">
        {/* biome-ignore lint/a11y/useSemanticElements: a grid of option buttons, not form fields */}
        <div
          role="group"
          aria-label={t`Mode`}
          data-testid="approval-mode"
          className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]"
        >
          {modes.map(({ mode, label, detail }) => (
            <button
              key={mode}
              type="button"
              aria-label={label}
              aria-pressed={autoReview?.mode === mode}
              aria-describedby={`${modeId}-${mode}`}
              disabled={loading || saving || !autoReview}
              onClick={() => {
                if (mode === autoReview?.mode) return;
                if (mode === "never") setConfirmingNever(true);
                else void setMode(mode);
              }}
              className="flex flex-col items-start gap-1.5 rounded-xl border border-border bg-card p-4 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 aria-pressed:border-foreground aria-pressed:bg-accent"
            >
              <span className="text-body1 font-medium text-foreground">{label}</span>
              <span
                id={`${modeId}-${mode}`}
                className="text-body2 text-balance text-muted-foreground"
              >
                {detail}
              </span>
            </button>
          ))}
        </div>
        {autoReview?.mode === "auto" && !autoReview.checkerAvailable ? (
          <p className="text-[13px] text-muted-foreground">
            <Trans>Add a model in Settings to use this.</Trans>
          </p>
        ) : null}
      </div>
      {rules.length > 0 ? (
        <SettingsGroup data-testid="approval-rules">
          {rules.map((rule) => (
            <SettingsRow
              key={rule.id}
              label={ruleLabel(rule)}
              control={
                <>
                  {rule.matchKind === "category" ? (
                    <span className="text-[13px] text-muted-foreground">
                      {rule.effect === "always_allow" ? (
                        <Trans>Allow</Trans>
                      ) : rule.effect === "deny" ? (
                        <Trans>Block</Trans>
                      ) : (
                        <Trans>Ask</Trans>
                      )}
                    </span>
                  ) : (
                    <ToggleGroup
                      aria-label={ruleLabel(rule)}
                      value={[rule.effect]}
                      onValueChange={([next]) => {
                        if (next === "always_allow" || next === "deny") void setEffect(rule, next);
                      }}
                      disabled={saving}
                      spacing={1}
                      className={segmented}
                    >
                      <ToggleGroupItem value="always_allow" className={segment}>
                        <Trans>Allow</Trans>
                      </ToggleGroupItem>
                      {/* An older ask rule keeps showing what it does until it is switched. */}
                      {rule.effect === "require_approval" ? (
                        <ToggleGroupItem value="require_approval" className={segment}>
                          <Trans>Ask</Trans>
                        </ToggleGroupItem>
                      ) : null}
                      <ToggleGroupItem value="deny" className={segment}>
                        <Trans>Block</Trans>
                      </ToggleGroupItem>
                    </ToggleGroup>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    disabled={saving}
                    onClick={() => void removeRule(rule)}
                  >
                    <Trans>Remove</Trans>
                  </Button>
                </>
              }
            />
          ))}
        </SettingsGroup>
      ) : null}
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}

/** A site reads as itself; a tool, connector or older category by its name. */
function ruleLabel(rule: ActionApprovalRule): string {
  return rule.matchKind === "site" ? rule.matchValue : humanizeToolName(rule.matchValue);
}
