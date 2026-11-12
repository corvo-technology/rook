import type { Bot, BotSection } from "@corvo/contracts";
import { Button, InlineConfirm, Input, RadioGroup, RadioGroupItem, SidePanel } from "@corvo/ui-web";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Lock } from "lucide-react";
import { useId, useRef, useState } from "react";
import { errorText } from "../../lib/user-error";

/** Each panel is mounted only while open and the parent unmounts it from `onCancel`. Closing is
 * ignored while a request is in flight. */
function closeUnlessBusy(busy: boolean, onCancel: () => void) {
  return () => {
    if (!busy) onCancel();
  };
}

/**
 * A side panel for an action that cannot be undone: what goes with it, then a two-step button.
 * Nothing in the shell has a trigger to confirm in place, so the panel is where it is armed.
 */
function ConfirmPanel({
  title,
  description,
  busy,
  error,
  actionLabel,
  onCancel,
  onConfirm,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  busy: boolean;
  error: string | null;
  actionLabel: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useLingui();
  return (
    <SidePanel
      open
      onClose={closeUnlessBusy(busy, onCancel)}
      title={<span className="break-words">{title}</span>}
      closeLabel={t`Close`}
      data-testid="confirm-panel"
      footer={
        <InlineConfirm
          variant="destructive"
          disabled={busy}
          confirmLabel={t`Confirm`}
          onConfirm={onConfirm}
        >
          {actionLabel}
        </InlineConfirm>
      }
    >
      {description ? <p className="text-[13.5px] text-muted-foreground">{description}</p> : null}
      {children}
      {error ? (
        <p role="alert" className="text-[13.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </SidePanel>
  );
}

export function NewSpacePanel({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (name: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    void onConfirm(trimmed).catch((reason: unknown) => {
      setError(errorText(reason, t`Could not create space`));
      setSaving(false);
    });
  };

  return (
    <SidePanel
      open
      onClose={closeUnlessBusy(saving, onCancel)}
      title={
        <span className="flex items-center gap-2.5">
          <Lock size={17} strokeWidth={1.8} className="text-muted-foreground" aria-hidden="true" />
          <Trans>New space</Trans>
        </span>
      }
      closeLabel={t`Close`}
      data-testid="new-space-panel"
      footer={
        <Button type="submit" form={`${nameId}-form`} disabled={saving || !name.trim()}>
          {saving ? <Trans>Creating…</Trans> : <Trans>Create space</Trans>}
        </Button>
      }
    >
      <form
        id={`${nameId}-form`}
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <label htmlFor={nameId} className="block text-[13.5px] text-foreground/75">
          <Trans>Name</Trans>
          <Input
            id={nameId}
            data-autofocus
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t`Customer support`}
            className="mt-2"
          />
        </label>
      </form>
      {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
    </SidePanel>
  );
}

export function NewBotSectionPanel({
  bot,
  onCancel,
  onConfirm,
}: {
  bot: Pick<Bot, "name">;
  onCancel: () => void;
  onConfirm: (name: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <SidePanel
      open
      onClose={closeUnlessBusy(saving, onCancel)}
      title={t`New section`}
      closeLabel={t`Close`}
      data-testid="new-section-panel"
      footer={
        <Button type="submit" form={`${nameId}-form`} disabled={saving || !name.trim()}>
          {saving ? <Trans>Creating…</Trans> : <Trans>Create</Trans>}
        </Button>
      }
    >
      <p className="text-[13.5px] text-muted-foreground">
        <Trans>Create a section and move {bot.name} into it.</Trans>
      </p>
      <form
        id={`${nameId}-form`}
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed || saving) return;
          setSaving(true);
          setError(null);
          void onConfirm(trimmed).catch((err: unknown) => {
            setError(errorText(err, t`Could not create section`));
            setSaving(false);
          });
        }}
      >
        <label htmlFor={nameId} className="block text-[13.5px] text-foreground/75">
          <Trans>Name</Trans>
          <Input
            id={nameId}
            data-autofocus
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2"
          />
        </label>
      </form>
      {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
    </SidePanel>
  );
}

export function RenameBotSectionPanel({
  section,
  onCancel,
  onConfirm,
}: {
  section: Pick<BotSection, "name">;
  onCancel: () => void;
  onConfirm: (name: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const [name, setName] = useState(section.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const unchanged = trimmed === section.name;

  return (
    <SidePanel
      open
      onClose={closeUnlessBusy(saving, onCancel)}
      title={t`Rename section`}
      closeLabel={t`Close`}
      data-testid="rename-section-panel"
      footer={
        <Button type="submit" form={`${nameId}-form`} disabled={saving || !trimmed || unchanged}>
          {saving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
        </Button>
      }
    >
      <form
        id={`${nameId}-form`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed || saving || unchanged) return;
          setSaving(true);
          setError(null);
          void onConfirm(trimmed).catch((err: unknown) => {
            setError(errorText(err, t`Could not rename section`));
            setSaving(false);
          });
        }}
      >
        <label htmlFor={nameId} className="block text-[13.5px] text-foreground/75">
          <Trans>Name</Trans>
          <Input
            id={nameId}
            data-autofocus
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2"
          />
        </label>
      </form>
      {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
    </SidePanel>
  );
}

export function ClearConversationPanel({
  bot,
  onCancel,
  onConfirm,
}: {
  bot: Pick<Bot, "name">;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <ConfirmPanel
      title={<Trans>Clear {bot.name}’s conversation?</Trans>}
      description={
        <Trans>
          This permanently removes every message and stops current work. The chat remains available.
        </Trans>
      }
      busy={clearing}
      error={error}
      actionLabel={clearing ? <Trans>Clearing…</Trans> : <Trans>Clear</Trans>}
      onCancel={onCancel}
      onConfirm={() => {
        setClearing(true);
        setError(null);
        void onConfirm().catch((err: unknown) => {
          setError(errorText(err, t`Could not clear conversation`));
          setClearing(false);
        });
      }}
    />
  );
}

export function DeleteBotPanel({
  bot,
  onCancel,
  onConfirm,
}: {
  bot: Bot;
  onCancel: () => void;
  onConfirm: (deleteMemories: boolean) => Promise<void>;
}) {
  const { t } = useLingui();
  const [deleting, setDeleting] = useState(false);
  const [deleteMemories, setDeleteMemories] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const memoriesLabelId = useId();

  return (
    <ConfirmPanel
      title={<Trans>Delete {bot.name}?</Trans>}
      description={
        <Trans>
          Its conversation, files, and routines will be permanently deleted. Bots it created stay in
          your list.
        </Trans>
      }
      busy={deleting}
      error={error}
      actionLabel={deleting ? <Trans>Deleting…</Trans> : <Trans>Delete</Trans>}
      onCancel={onCancel}
      onConfirm={() => {
        setDeleting(true);
        setError(null);
        void onConfirm(deleteMemories).catch((err: unknown) => {
          setError(errorText(err, t`Could not delete bot`));
          setDeleting(false);
        });
      }}
    >
      <div className="space-y-2">
        <p id={memoriesLabelId} className="mb-2 text-[13.5px] text-foreground/75">
          <Trans>What about its memories?</Trans>
        </p>
        <RadioGroup
          aria-labelledby={memoriesLabelId}
          value={deleteMemories ? "delete" : "keep"}
          onValueChange={(value) => setDeleteMemories(value === "delete")}
        >
          {/* biome-ignore lint/a11y/noLabelWithoutControl: the wrapped RadioGroupItem is the control. */}
          <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3">
            <RadioGroupItem value="keep" className="mt-0.5" />
            <span>
              <span className="block text-[14px] text-foreground">
                <Trans>Keep memories</Trans>
              </span>
              <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                <Trans>Move them to your shared memory.</Trans>
              </span>
            </span>
          </label>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: the wrapped RadioGroupItem is the control. */}
          <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3">
            <RadioGroupItem value="delete" className="mt-0.5" />
            <span>
              <span className="block text-[14px] text-foreground">
                <Trans>Delete memories too</Trans>
              </span>
              <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                <Trans>This cannot be undone.</Trans>
              </span>
            </span>
          </label>
        </RadioGroup>
      </div>
    </ConfirmPanel>
  );
}

/** The space the Space settings section acts on. */
export type SettingsSpace = {
  id: string;
  name: string;
  canRename?: boolean;
  canDelete?: boolean;
  /** True only for an owner of the space. */
  canPause?: boolean;
  /** When the owner paused every bot in the space; null or missing while it runs. */
  pausedAt?: string | null;
  /** Every bot deleting the space removes, from the server. */
  botCount?: number;
};
/** Pausing cancels work in progress, so it arms first; a second tap while it runs does nothing. */
export function PauseSpacePanel({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [pausing, setPausing] = useState(false);
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmPanel
      title={<Trans>Pause all bots</Trans>}
      description={<Trans>Running work stops and nothing starts until you resume.</Trans>}
      busy={pausing}
      error={error}
      actionLabel={<Trans>Pause all bots</Trans>}
      onCancel={onCancel}
      onConfirm={() => {
        if (started.current) return;
        started.current = true;
        setPausing(true);
        setError(null);
        void onConfirm().catch((err: unknown) => {
          setError(errorText(err, t`Could not save`));
          started.current = false;
          setPausing(false);
        });
      }}
    />
  );
}

/** Names what goes with the space: its bots, and with them their chats and groups. */
export function DeleteSpacePanel({
  space,
  onCancel,
  onConfirm,
}: {
  space: SettingsSpace;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const botCount = space.botCount ?? 0;
  const name = space.name;
  return (
    <DeleteItemPanel
      item={space}
      noun="space"
      title={
        botCount > 0 ? (
          <Plural
            value={botCount}
            one={`Delete ${name} and its # bot?`}
            other={`Delete ${name} and its # bots?`}
          />
        ) : undefined
      }
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function DeleteItemPanel({
  item,
  noun,
  title,
  description,
  onCancel,
  onConfirm,
}: {
  item: { name: string };
  noun: "group" | "routine" | "section" | "space";
  title?: React.ReactNode;
  description?: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <ConfirmPanel
      title={title ?? <Trans>Delete {item.name}?</Trans>}
      description={description ?? <Trans>This cannot be undone.</Trans>}
      busy={deleting}
      error={error}
      actionLabel={deleting ? <Trans>Deleting…</Trans> : <Trans>Delete</Trans>}
      onCancel={onCancel}
      onConfirm={() => {
        setDeleting(true);
        setError(null);
        void onConfirm().catch((err: unknown) => {
          setError(
            errorText(
              err,
              noun === "group"
                ? t`Could not delete group`
                : noun === "space"
                  ? t`Could not delete space`
                  : noun === "section"
                    ? t`Could not delete section`
                    : t`Could not delete routine`,
            ),
          );
          setDeleting(false);
        });
      }}
    />
  );
}
