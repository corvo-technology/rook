import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import type { MobileSnapshot } from "../../lib/api";
import { rpc } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { openModelSettings } from "../../lib/model-settings";
import { runErrorActionLabel } from "../../lib/run-error-presentation";
import { useRunError } from "../run-error-sheet";

/** The chat's failed run: its error, the recovery action, and whether its details are open. */
export function useThreadRunError(run: MobileSnapshot["run"] | undefined, botId?: string) {
  const { t } = useI18n();
  const router = useRouter();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const runError = run?.status === "failed" ? (run.error ?? null) : null;
  const normalizedRunError = useRunError(runError, false);
  const failedRunId = runError ? run?.id : null;
  useEffect(() => setDetailsOpen(false), [failedRunId]);
  // Only a space owner can resume, so the action waits for the space's own answer.
  const [pausedSpace, setPausedSpace] = useState<{ id: string; canPause: boolean } | null>(null);
  const needsResume = normalizedRunError?.recovery === "resume";
  useEffect(() => {
    if (!needsResume) return;
    let current = true;
    void rpc("spaces/list")
      .then((navigation) => {
        const space = navigation.spaces.find((item) => item.id === navigation.current.id);
        if (current && space) setPausedSpace({ id: space.id, canPause: space.canPause === true });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [needsResume]);
  const label = normalizedRunError
    ? runErrorActionLabel(t, normalizedRunError, pausedSpace?.canPause === true)
    : null;
  const runBotId = run?.botId ?? botId;
  const runErrorAction = label
    ? {
        label,
        // Without a bot to change, the model settings pick the default model instead.
        onPress:
          normalizedRunError?.recovery === "resume" && pausedSpace
            ? () => {
                setDetailsOpen(false);
                void rpc("spaces/setPaused", { spaceId: pausedSpace.id, paused: false }).catch(
                  () => undefined,
                );
              }
            : normalizedRunError?.recovery === "budget" && runBotId
              ? () => {
                  setDetailsOpen(false);
                  router.push({ pathname: "/bot-settings", params: { botId: runBotId } });
                }
              : normalizedRunError?.recovery === "model" && runBotId
                ? () => {
                    setDetailsOpen(false);
                    router.push({
                      pathname: "/bot-settings",
                      params: { botId: runBotId, focus: "model" },
                    });
                  }
                : () => {
                    setDetailsOpen(false);
                    openModelSettings();
                  },
      }
    : null;
  return { runError, normalizedRunError, runErrorAction, detailsOpen, setDetailsOpen };
}
