import type { LocalSetupReport } from "@corvo/contracts";
import { useCallback, useEffect, useState } from "react";
import { rpc } from "./rpc";

/**
 * What the engine found on its own computer. The first answer comes from memory at once and the
 * second waits for the fresh check, so the latest report replaces the one before it.
 */
export function useLocalSetup(): { report: LocalSetupReport | null; refresh: () => void } {
  const [report, setReport] = useState<LocalSetupReport | null>(null);
  const refresh = useCallback(() => {
    rpc.models
      .localSetup({ wait: true })
      .then(setReport)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const cached = await rpc.models.localSetup({ wait: false });
        if (!active) return;
        setReport(cached);
        if (!cached.enabled) return;
        const fresh = await rpc.models.localSetup({ wait: true });
        if (active) setReport(fresh);
      } catch {
        // Without a report the step stays as it is.
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  return { report, refresh };
}
