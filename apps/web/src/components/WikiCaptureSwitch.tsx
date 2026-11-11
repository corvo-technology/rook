import type { WikiCaptureState } from "@corvo/contracts";
import { Switch } from "@corvo/ui-web";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { useSpaceRpc } from "../lib/space-rpc";

export type WikiCaptureTarget = { botId: string } | { groupId: string };

/** Whether the wiki curator reads one conversation; hidden when it cannot. */
export function WikiCaptureSwitch({ target }: { target: WikiCaptureTarget }) {
  const rpc = useSpaceRpc();
  const queryClient = useQueryClient();
  const id = useId();
  const key = ["wiki", "capture", target];
  const state = useQuery({ queryKey: key, queryFn: () => rpc.wiki.capture.get(target) });
  if (!state.data?.available) return null;
  const { on, canChange } = state.data;

  async function change(next: boolean) {
    queryClient.setQueryData<WikiCaptureState>(key, (current) =>
      current ? { ...current, capture: next, on: next } : current,
    );
    try {
      await rpc.wiki.capture.set({ ...target, capture: next });
    } catch {
      await queryClient.invalidateQueries({ queryKey: key });
    }
  }

  return (
    <div className="mt-4 flex min-h-11 items-center justify-between gap-3 text-sm">
      <label htmlFor={id}>
        <Trans>Learn from this conversation</Trans>
      </label>
      <Switch
        id={id}
        checked={on}
        disabled={!canChange}
        onCheckedChange={(next) => void change(next)}
      />
    </div>
  );
}
