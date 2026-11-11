import type { AppBootstrap, NavLink } from "@corvo/contracts";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { authClient } from "../lib/auth";
import { isEmbedded } from "../lib/embed";
import { useSpaceQueries } from "../lib/query";
import { ShellSidebarFooter } from "../pages/shell/shell-sidebar";
import { WindowChrome } from "../pages/WindowChrome";
import { SidebarNav } from "./SidebarNav";
import { SubscriptionRailRings } from "./SubscriptionRings";

/** The sidebar of every area but the agents: the navigation list on top, the account at the bottom. */
export function AppNavSidebar({ ticketBoardEnabled }: { ticketBoardEnabled: boolean }) {
  const navigate = useNavigate();
  const queries = useSpaceQueries();
  const session = authClient.useSession();
  const navLinks: NavLink[] =
    useQuery({
      ...queries.bootstrap.queryOptions({ input: {} }),
      // Reads what the screen beside the sidebar already loaded; it never fetches, because
      // taking the first bootstrap here would make the agents screen request it a second time.
      queryFn: skipToken,
      select: (bootstrap: AppBootstrap) => bootstrap.me?.navLinks ?? [],
    }).data ?? [];
  const embedded = isEmbedded();
  return (
    <aside
      data-testid="app-nav-sidebar"
      className="hidden w-[280px] shrink-0 flex-col border-e border-sidebar-border bg-sidebar md:flex"
    >
      <div className="app-drag flex h-12 shrink-0 items-center px-[18px] pt-2">
        <WindowChrome />
      </div>
      <SidebarNav ticketBoardEnabled={ticketBoardEnabled} />
      <div className="mt-auto flex flex-col">
        {embedded ? null : <SubscriptionRailRings />}
        {embedded ? null : (
          <ShellSidebarFooter
            mini={false}
            account
            logos={[]}
            user={session.data?.user}
            // The list above has its own Board, so the account menu does not repeat it.
            ticketBoardEnabled={false}
            navLinks={navLinks}
            closeMobileSidebar={() => {}}
            navigate={navigate}
            openSettings={(section) => navigate(`/app?settings=${section}`)}
            openIntegrations={() => navigate("/app?integrations")}
          />
        )}
      </div>
    </aside>
  );
}
