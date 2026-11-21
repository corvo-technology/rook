import { Button, InlineConfirm, Input, undoable } from "@corvo/ui-web";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useState } from "react";
import { AvatarEditor } from "../components/AvatarEditor";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { SpaceAvatar } from "../components/SpaceAvatar";
import { SpaceRolesSettings } from "./SpaceRolesSettings";
import { SpaceSettingOverrides } from "./SpaceSettingOverrides";
import { SpaceTransfer } from "./SpaceTransfer";
import type { SettingsSpace } from "./shell/dialogs";

/** One space's page: its name, the account settings it customizes, and deletion for its owner. */
export function SpaceSettingsPanel({
  space,
  onRename,
  onSetAvatar,
  onSetPaused,
  onDelete,
  onImported,
  onBusyChange,
}: {
  space: SettingsSpace;
  onRename: (name: string) => Promise<void>;
  /** Saves the space's avatar; null goes back to the default look. */
  onSetAvatar?: (avatar: string | null) => Promise<void>;
  onSetPaused?: (paused: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  onImported?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const [draft, setDraft] = useState(space.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [overridesBusy, setOverridesBusy] = useState(false);
  // A rename in flight holds the dialog open, so a failure is shown instead of lost on leaving.
  const busy = pending || overridesBusy;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  async function save() {
    const trimmed = draft.trim();
    if (pending) return;
    // An empty or unchanged name keeps the current one without a request.
    if (!trimmed || trimmed === space.name) {
      setDraft(space.name);
      setError(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onRename(trimmed);
      setDraft(trimmed);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() ? err.message : t`Could not rename space`,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-8" data-testid="space-settings">
      {space.canRename ? (
        <SettingsGroup>
          <SettingsRow
            label={
              <label htmlFor={nameId}>
                <Trans>Name</Trans>
              </label>
            }
            control={
              <Input
                id={nameId}
                className="w-56"
                maxLength={60}
                value={draft}
                disabled={pending}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError(null);
                }}
                onBlur={() => void save()}
                onKeyDown={(event) => {
                  // Enter that confirms an IME composition is not a commit.
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setDraft(space.name);
                    setError(null);
                  }
                }}
              />
            }
          >
            {error ? (
              <p role="alert" className="pt-2 text-[12.5px] text-destructive">
                {error}
              </p>
            ) : null}
          </SettingsRow>
          {onSetAvatar ? (
            <SettingsRow
              label={<Trans>Avatar</Trans>}
              control={
                <AvatarEditor
                  value={space.logo}
                  preview={(value) => (
                    <SpaceAvatar name={draft || space.name} logo={value} size={36} />
                  )}
                  onSave={onSetAvatar}
                />
              }
            />
          ) : null}
        </SettingsGroup>
      ) : null}
      <SpaceRolesSettings />
      <SpaceSettingOverrides onBusyChange={setOverridesBusy} />
      <SpaceTransfer spaceName={space.name} onImported={onImported} />
      {space.canPause && onSetPaused ? (
        <Button
          variant="outline"
          className="rounded-full"
          disabled={resuming}
          onClick={() => {
            setResuming(true);
            setError(null);
            // Pausing is reversible, so it runs at once with an Undo.
            (space.pausedAt
              ? onSetPaused(false)
              : undoable({
                  message: t`Bots paused`,
                  undoLabel: t`Undo`,
                  run: () => onSetPaused(true),
                  undo: () => onSetPaused(false),
                })
            )
              .catch((err: unknown) =>
                setError(
                  err instanceof Error && err.message.trim() ? err.message : t`Could not save`,
                ),
              )
              .finally(() => setResuming(false));
          }}
        >
          {space.pausedAt ? <Trans>Resume bots</Trans> : <Trans>Pause all bots</Trans>}
        </Button>
      ) : null}
      {space.canDelete ? (
        <InlineConfirm
          variant="destructive"
          className="rounded-full"
          confirmLabel={
            (space.botCount ?? 0) > 0
              ? t`Delete ${space.name} and ${plural(space.botCount ?? 0, { one: "its # bot", other: "its # bots" })}?`
              : t`Delete ${space.name}?`
          }
          onConfirm={() => {
            setError(null);
            onDelete().catch((err: unknown) =>
              setError(
                err instanceof Error && err.message.trim()
                  ? err.message
                  : t`Could not delete space`,
              ),
            );
          }}
        >
          <Trans>Delete space</Trans>
        </InlineConfirm>
      ) : null}
      {error && !space.canRename ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
