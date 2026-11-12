import type { UserMemory } from "@corvo/contracts";
import { Button } from "@corvo/ui-web";
import { Trans } from "@lingui/react/macro";
import { BuiCard } from "./ai/primitives";

export type MemoryFactCardProps = {
  memory: Pick<UserMemory, "text" | "state">;
  /** An answer is on its way, so the buttons wait. */
  busy?: boolean;
  onDecide: (decision: "save" | "discard" | "forget") => void;
};

/**
 * A fact an agent kept, or asks to keep, about the person. Nothing is stored as known before Save;
 * a fact an agent saved on its own can be undone here.
 */
export function MemoryFactCard({ memory, busy, onDecide }: MemoryFactCardProps) {
  return (
    <BuiCard
      className="flex w-full max-w-md flex-col gap-2 px-4 py-3"
      data-testid="memory-fact"
      data-state={memory.state}
    >
      <p className="text-sm text-muted-foreground">
        {memory.state === "pending" ? (
          <Trans>New memory</Trans>
        ) : memory.state === "saved" ? (
          <Trans>Remembered</Trans>
        ) : (
          <Trans>Not remembered</Trans>
        )}
      </p>
      <p className="text-sm" dir="auto">
        {memory.text}
      </p>
      {memory.state === "pending" ? (
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={busy} onClick={() => onDecide("save")}>
            <Trans>Save</Trans>
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("discard")}>
            <Trans>Discard</Trans>
          </Button>
        </div>
      ) : null}
      {memory.state === "saved" ? (
        <div className="pt-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("forget")}>
            <Trans>Undo</Trans>
          </Button>
        </div>
      ) : null}
    </BuiCard>
  );
}
