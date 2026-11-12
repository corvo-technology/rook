import type { Board, BoardStatusLabels, TicketStatus } from "@corvo/contracts";
import { BOARD_LABEL_MAX_LENGTH, TICKET_STATUSES } from "@corvo/contracts";
import { Button, Input, SidePanel } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useBuiltinStatusLabels } from "../lib/ticket-status";
import { errorText } from "../lib/user-error";

/** What to send for the labels a person typed: only what changed, null to go back to the built-in name. */
export function labelChanges(
  current: BoardStatusLabels,
  typed: Record<TicketStatus, string>,
): Partial<Record<TicketStatus, string | null>> {
  const changes: Partial<Record<TicketStatus, string | null>> = {};
  for (const status of TICKET_STATUSES) {
    const next = typed[status].trim();
    const before = current[status] ?? "";
    if (next === before) continue;
    changes[status] = next === "" ? null : next;
  }
  return changes;
}

export function BoardSettings({
  board,
  onClose,
  onSave,
}: {
  board: Pick<Board, "statusLabels">;
  onClose: () => void;
  onSave: (changes: Partial<Record<TicketStatus, string | null>>) => Promise<void>;
}) {
  const { t } = useLingui();
  const builtin = useBuiltinStatusLabels();
  const [typed, setTyped] = useState(
    () =>
      Object.fromEntries(
        TICKET_STATUSES.map((status) => [status, board.statusLabels[status] ?? ""]),
      ) as Record<TicketStatus, string>,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const changes = labelChanges(board.statusLabels, typed);
    if (Object.keys(changes).length === 0) return onClose();
    setSaving(true);
    try {
      await onSave(changes);
      onClose();
    } catch (cause) {
      setError(errorText(cause));
      setSaving(false);
    }
  }

  return (
    <SidePanel
      open
      onClose={onClose}
      title={t`Task settings`}
      closeLabel={t`Close`}
      data-testid="board-settings-panel"
      footer={
        <Button type="submit" form="board-settings" disabled={saving}>
          {t`Save`}
        </Button>
      }
    >
      <form id="board-settings" onSubmit={submit} className="space-y-2">
        {TICKET_STATUSES.map((status, index) => (
          <Input
            key={status}
            data-autofocus={index === 0 ? "" : undefined}
            name={`label-${status}`}
            aria-label={builtin[status]}
            placeholder={builtin[status]}
            maxLength={BOARD_LABEL_MAX_LENGTH}
            value={typed[status]}
            onChange={(event) => setTyped({ ...typed, [status]: event.target.value })}
          />
        ))}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </SidePanel>
  );
}
