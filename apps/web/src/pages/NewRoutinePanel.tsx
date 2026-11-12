import type { Bot } from "@corvo/contracts";
import type { CronPreset } from "@corvo/core";
import { cronFromPreset, defaultCronPreset } from "@corvo/core";
import {
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  SidePanel,
  Textarea,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useState } from "react";
import { localTimezone } from "../lib/local-timezone";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { RoutineSchedule } from "./RoutineSchedule";

/**
 * A side panel (`?panel=new-routine`), the shortest way to a routine: which agent, what to ask it, and when. Anything finer
 * (model, triggers, notifications) stays in the agent's own routine settings.
 */
export function NewRoutinePanel({
  bots,
  defaultBotId,
  onCreated,
  onClose,
}: {
  bots: Bot[];
  defaultBotId?: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const [botId, setBotId] = useState(defaultBotId ?? bots[0]?.id ?? "");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState<CronPreset>(defaultCronPreset);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      await rpc.routines.create({
        botId,
        name: name.trim(),
        prompt: prompt.trim(),
        crons: [cronFromPreset(schedule)],
        timezone: localTimezone(),
        active: true,
      });
      onCreated();
    } catch (reason) {
      setError(errorText(reason, t`Could not create routine`));
      setSaving(false);
    }
  }

  return (
    <SidePanel
      open
      onClose={saving ? () => undefined : onClose}
      title={t`New routine`}
      closeLabel={t`Close`}
      footer={
        <>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            disabled={saving || !botId || !name.trim() || !prompt.trim()}
            onClick={() => void create()}
          >
            {saving ? <Trans>Creating…</Trans> : <Trans>Create routine</Trans>}
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
      <Input
        id={nameId}
        data-autofocus
        aria-label={t`Name`}
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t`Morning summary`}
      />
      <Textarea
        aria-label={t`Instructions`}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={t`What should the agent do?`}
      />
      <RoutineSchedule value={schedule} onChange={setSchedule} />
      {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
    </SidePanel>
  );
}
