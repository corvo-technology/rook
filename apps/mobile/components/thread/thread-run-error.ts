import type { ModelProblemOptions } from "@corvo/core";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import type { MobileSnapshot } from "../../lib/api";
import { rpc } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { openModelSettings } from "../../lib/model-settings";
import { runErrorActionLabel } from "../../lib/run-error-presentation";
import { useRunError } from "../run-error-sheet";

type AuthKind = ModelProblemOptions["authKind"];

/**
 * The chat's failed run: its error, the recovery action, Try again, and whether its details are
 * open. The failed run's connection kind decides between "Sign in again" and "Replace key".
 */
export function useThreadRunError(
  run: MobileSnapshot["run"] | undefined,
  botId?: string,
  groupId?: string,
  refresh?: () => Promise<unknown>,
) {
  const { t } = useI18n();
  const router = useRouter();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [authKind, setAuthKind] = useState<AuthKind>(undefined);
  const retrying = useRef(false);
  const runError = run?.status === "failed" ? (run.error ?? null) : null;
  const normalizedRunError = useRunError(runError, false, authKind);
  const failedRunId = runError ? run?.id : null;
  const provider = run?.modelProvider;
  useEffect(() => setDetailsOpen(false), [failedRunId]);
  useEffect(() => {
    setAuthKind(undefined);
    if (!failedRunId || !provider) return;
    let current = true;
    void rpc("models/credentials")
      .then((credentials) => {
        if (current) setAuthKind(credentials.find((row) => row.provider === provider)?.authKind);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [failedRunId, provider]);
  // Only a space owner can resume, so that action waits for the space's own answer.
  const [pausedSpace, setPausedSpace] = useState<{ id: string; canPause: boolean } | null>(null);
  const needsResume = normalizedRunError?.problem.action === "resume";
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
  const action = normalizedRunError?.problem.action;
  const label = normalizedRunError
    ? runErrorActionLabel(t, action === "resume" && !pausedSpace?.canPause ? undefined : action)
    : null;
  const runBotId = run?.botId ?? botId;
  const runErrorAction = label
    ? {
        label,
        // Without a bot to change, the model settings pick the default model instead.
        onPress:
          action === "resume" && pausedSpace
            ? () => {
                setDetailsOpen(false);
                void rpc("spaces/setPaused", { spaceId: pausedSpace.id, paused: false }).catch(
                  () => undefined,
                );
              }
            : action === "raise-limit" && runBotId
              ? () => {
                  setDetailsOpen(false);
                  router.push({ pathname: "/bot-settings", params: { botId: runBotId } });
                }
              : action === "change-model" && runBotId
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
  /** Runs the failed message again on the server; one run per tap, and no second copy of it. */
  const retryRun = async () => {
    const target = groupId ? { groupId } : botId ? { botId } : null;
    if (!failedRunId || !target || retrying.current) return;
    retrying.current = true;
    try {
      await rpc("threads/retry", { ...target, runId: failedRunId });
    } catch (error) {
      // CONFLICT means this run is no longer the one to retry; the refresh shows what is.
      if (!(error instanceof Error && "code" in error && error.code === "CONFLICT")) {
        retrying.current = false;
        return;
      }
    }
    setDetailsOpen(false);
    await Promise.resolve(refresh?.()).catch(() => undefined);
    retrying.current = false;
  };
  return {
    runError,
    normalizedRunError,
    runErrorAction,
    authKind,
    retryRun,
    detailsOpen,
    setDetailsOpen,
  };
}
