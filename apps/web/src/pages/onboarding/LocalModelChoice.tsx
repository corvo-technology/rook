import type { LocalModelOption, LocalModelTest, LocalSetupReport } from "@corvo/contracts";
import {
  Button,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useState } from "react";
import { Shimmer } from "../../components/ai/primitives";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

type TestState = { pending: true } | { pending: false; result: LocalModelTest };

/**
 * The models already on this computer or account, one preselected, so a person can continue in
 * one click. Pasting a key stays behind one link.
 */
export function LocalModelChoice({
  report,
  onContinue,
  onFallback,
}: {
  report: LocalSetupReport;
  onContinue: () => void;
  onFallback: () => void;
}) {
  const { t } = useLingui();
  const groupId = useId();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [chosenModels, setChosenModels] = useState<Record<string, string>>({});
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = report.options.find((option) => option.id === chosenId) ?? report.options[0];
  if (!selected) return null;
  const modelOf = (option: LocalModelOption) => chosenModels[option.id] ?? option.modelId;
  const selectedModel = modelOf(selected);

  async function test(option: LocalModelOption) {
    setTests((current) => ({ ...current, [option.id]: { pending: true } }));
    let result: LocalModelTest;
    try {
      result = await rpc.models.testLocal({ optionId: option.id, modelId: modelOf(option) });
    } catch (err) {
      result = { ok: false, ms: 0, error: errorText(err) };
    }
    setTests((current) => ({ ...current, [option.id]: { pending: false, result } }));
  }

  async function use() {
    if (!selected || pending) return;
    setPending(true);
    setError(null);
    try {
      // biome-ignore lint/correctness/useHookAtTopLevel: an RPC named after its action, not a hook.
      await rpc.models.useLocal({ optionId: selected.id, modelId: selectedModel });
      onContinue();
    } catch (err) {
      setError(errorText(err, t`Could not save model`));
      setPending(false);
    }
  }

  return (
    <div className="mt-8">
      <p className="text-sm font-medium text-foreground">
        <Trans>Found on this computer</Trans>
      </p>
      <RadioGroup
        aria-label={t`Found on this computer`}
        value={selected.id}
        onValueChange={(value) => {
          if (typeof value === "string") setChosenId(value);
        }}
        className="mt-3"
      >
        {report.options.map((option) => {
          const state = tests[option.id];
          const result = state && !state.pending ? state.result : null;
          return (
            <div
              key={option.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border p-3"
            >
              <RadioGroupItem
                value={option.id}
                id={`${groupId}-${option.id}`}
                aria-label={option.label}
              />
              <label
                htmlFor={`${groupId}-${option.id}`}
                className="min-w-0 flex-1 cursor-pointer text-sm text-foreground"
              >
                {option.label}
              </label>
              {option.testable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t`Test ${option.label}`}
                  disabled={state?.pending === true}
                  onClick={() => void test(option)}
                >
                  {state?.pending ? (
                    <Shimmer>
                      <Trans>Testing…</Trans>
                    </Shimmer>
                  ) : (
                    <Trans>Test</Trans>
                  )}
                </Button>
              ) : null}
              {result?.ok ? (
                <p className="basis-full text-sm text-muted-foreground" role="status">
                  {t`Answered in ${(result.ms / 1000).toFixed(1)} s`}
                </p>
              ) : null}
              {result && !result.ok ? (
                <p className="basis-full text-sm text-destructive" role="alert">
                  {result.error}
                </p>
              ) : null}
            </div>
          );
        })}
      </RadioGroup>
      {selected.models.length > 1 ? (
        <Select
          value={selectedModel}
          onValueChange={(value) => {
            if (typeof value !== "string" || !value) return;
            setChosenModels((current) => ({ ...current, [selected.id]: value }));
            setTests((current) => {
              const { [selected.id]: _dropped, ...rest } = current;
              return rest;
            });
          }}
          items={selected.models.map((id) => ({ value: id, label: id }))}
        >
          <SelectTrigger aria-label={t`Model`} className="mt-4 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {selected.models.map((id) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="mt-6" type="button" disabled={pending} onClick={() => void use()}>
        <Trans>Continue</Trans>
      </Button>
      <button
        type="button"
        className="mt-6 block text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        onClick={onFallback}
      >
        <Trans>Other ways to connect</Trans>
      </button>
    </div>
  );
}
