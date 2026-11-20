import { Tabs, TabsList, TabsTrigger } from "@corvo/ui-web";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMissions } from "../lib/use-missions";

const CALENDAR = "/app/routines";
const FLOWS = "/app/workflows";

/** Routines and their multi-step flows are one place; the flows tab waits for its mission. */
export function RoutinesTabs({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const missions = useMissions();
  const onFlows = pathname === FLOWS;
  const showTabs = onFlows || missions.shows("workflows");
  return (
    <div className="flex h-full flex-col">
      {showTabs ? (
        <Tabs
          value={onFlows ? FLOWS : CALENDAR}
          onValueChange={(to) => navigate(String(to))}
          className="px-6 pt-3"
        >
          <TabsList>
            <TabsTrigger value={CALENDAR}>
              <Trans>Calendar</Trans>
            </TabsTrigger>
            <TabsTrigger value={FLOWS}>
              <Trans>Flows</Trans>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
