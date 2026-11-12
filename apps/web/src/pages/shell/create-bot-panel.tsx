import { BOT_NAME_MAX_LENGTH } from "@corvo/contracts";
import { nextBotColor } from "@corvo/core";
import { BotAvatar, Button, Input, SidePanel } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { errorText } from "../../lib/user-error";
import { BotLookPicker } from "./avatar-studio-popover";

export interface CreateBotPanelInput {
  name: string;
  /** Only when the person picked a look; otherwise the bot gets one drawn from its role. */
  color?: string;
}

/** A side panel (`?panel=new-agent`), mounted only while open; the parent unmounts it from `onCancel` or after `onCreate`. */
export function CreateBotPanel({
  onCancel,
  onCreate,
  onImport,
  takenColors = [],
}: {
  onCancel: () => void;
  onCreate: (input: CreateBotPanelInput) => Promise<void>;
  onImport?: () => void;
  /** The colors the space's bots wear, so the new one starts in a hue of its own. */
  takenColors?: readonly string[];
}) {
  const { t } = useLingui();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(() => nextBotColor(takenColors));
  const [picked, setPicked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  async function create() {
    if (!trimmed || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onCreate(picked ? { name: trimmed, color } : { name: trimmed });
    } catch (err) {
      setError(errorText(err, t`Could not create bot`));
      setSubmitting(false);
    }
  }

  return (
    <SidePanel
      open
      onClose={submitting ? () => undefined : onCancel}
      title={t`New bot`}
      closeLabel={t`Close`}
      data-testid="create-bot-panel"
      footer={
        <>
          {onImport ? (
            <Button
              type="button"
              variant="ghost"
              className="me-auto"
              disabled={submitting}
              data-testid="create-bot-import"
              onClick={onImport}
            >
              <Trans>Import</Trans>
            </Button>
          ) : null}
          <Button type="submit" form="create-bot-form" disabled={!trimmed || submitting}>
            <Trans>Create</Trans>
          </Button>
        </>
      }
    >
      <form
        id="create-bot-form"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className="flex justify-center py-4">
          <BotAvatar color={color} size={112} />
        </div>
        <Input
          data-autofocus
          aria-label={t`Name`}
          placeholder={t`Name your Bot`}
          value={name}
          maxLength={BOT_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          className="text-center"
        />
        {error ? (
          <p role="alert" data-testid="create-bot-error" className="text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
        <BotLookPicker
          value={color}
          onChange={(next) => {
            setPicked(true);
            setColor(next);
          }}
        />
      </form>
    </SidePanel>
  );
}
