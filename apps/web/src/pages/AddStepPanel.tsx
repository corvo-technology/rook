import type { Bot } from "@corvo/contracts";
import { Button, NativeSelect, NativeSelectOption, SidePanel, Textarea } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

/** One more step for a workflow: which agent continues the work, and what it is asked to do. */
export function AddStepPanel({
  bots,
  saving,
  error,
  onAdd,
  onClose,
}: {
  bots: Bot[];
  saving: boolean;
  error: string | null;
  onAdd: (step: { botId: string; instruction: string }) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [botId, setBotId] = useState(bots[0]?.id ?? "");
  const [instruction, setInstruction] = useState("");
  return (
    <SidePanel
      open
      onClose={saving ? () => undefined : onClose}
      title={t`Add step`}
      closeLabel={t`Close`}
      data-testid="add-step-panel"
      footer={
        <>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            disabled={saving || !botId || !instruction.trim()}
            onClick={() => onAdd({ botId, instruction: instruction.trim() })}
          >
            <Trans>Add</Trans>
          </Button>
        </>
      }
    >
      <NativeSelect
        aria-label={t`Agent`}
        value={botId}
        onChange={(event) => setBotId(event.target.value)}
      >
        {bots.map((bot) => (
          <NativeSelectOption key={bot.id} value={bot.id}>
            {bot.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Textarea
        data-autofocus
        aria-label={t`Instructions`}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        placeholder={t`What should the agent do?`}
      />
      {error ? (
        <p role="alert" className="text-[13.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </SidePanel>
  );
}
