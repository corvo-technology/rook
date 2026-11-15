import type { Bot, NavLink } from "@corvo/contracts";
import { accountDisplay } from "@corvo/core";
import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Sidebar,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { Search } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { MissionList } from "../../components/MissionList";
import { PasskeyOffer } from "../../components/PasskeyOffer";
import { SidebarFooter } from "../../components/SidebarFooter";
import { useBilling } from "../../components/SubscriptionGate";
import { SubscriptionRailRings } from "../../components/SubscriptionRings";
import { formatBillingDate } from "../../lib/billing";
import type { BotsSidebarDensity } from "../../lib/bots-sidebar-density-pref";
import { isEmbedded } from "../../lib/embed";
import { useLocalEdition } from "../../lib/local-edition";
import type { Panel } from "../../lib/right-panel-state";
import { clearSpaceSelection } from "../../lib/rpc";
import { useSignOut } from "../../lib/sign-out";
import { SpaceSearchResults } from "../SpaceSearch";
import type { SettingsSection } from "../shell-overlay";
import { SidebarHeader } from "./sidebar-header";
import {
  SidebarNavLive,
  SidebarPeopleList,
  usePartnerHidden,
  useSpaceSummary,
} from "./sidebar-team";
import { SpaceSwitcher } from "./space-switcher";
import type { SidebarSearch } from "./use-sidebar-search";

type User = { name?: string | null; email?: string; image?: string | null };

/** The bots sidebar: a drawer on phones, collapsible to icons elsewhere. */
export function ShellSidebar({
  isMobile,
  mobileOpen,
  setMobileOpen,
  density,
  collapsed,
  mini,
  setCollapsedPref,
  createMenuOpen,
  setCreateMenuOpen,
  search,
  bots,
  setPanel,
  navigate,
  setNewSpaceOpen,
  canCreateSpace = true,
  setCreateBotOpen,
  spaces,
  currentSpaceId,
  openSpaceChat,
  roster,
  archived,
  footerLogos,
  user,
  ticketBoardEnabled,
  navLinks,
  openSettings,
  openIntegrations,
  paused = false,
  onResume,
  activeDmUserId,
}: {
  /** The person whose conversation is open, when one is. */
  activeDmUserId?: string;
  isMobile: boolean;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  density: BotsSidebarDensity;
  collapsed: boolean;
  mini: boolean;
  setCollapsedPref: (collapsed: boolean) => void;
  createMenuOpen: boolean;
  setCreateMenuOpen: (open: boolean) => void;
  search: SidebarSearch;
  bots: Bot[];
  setPanel: (panel: Panel) => void;
  navigate: (path: string) => void;
  setNewSpaceOpen: (open: boolean) => void;
  canCreateSpace?: boolean;
  setCreateBotOpen: (open: boolean) => void;
  spaces: ComponentProps<typeof SpaceSwitcher>["spaces"];
  currentSpaceId: string | null;
  openSpaceChat: (spaceId: string, path: string) => void;
  roster: ReactNode;
  archived: ReactNode;
  footerLogos: Array<{ name: string; logo?: string | null }>;
  user: User | undefined;
  ticketBoardEnabled: boolean;
  navLinks: NavLink[];
  openSettings: (section: SettingsSection) => void;
  openIntegrations: () => void;
  paused?: boolean;
  onResume?: () => void;
}) {
  const { t } = useLingui();
  const spaceSummary = useSpaceSummary(bots);
  const {
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
    searchHits,
    searchLoading,
    showSpaceSearch,
    jumpToSearchHit,
  } = search;
  const onActivity = useLocation().pathname === "/app/activity";
  return (
    <>
      <button
        type="button"
        aria-label={t`Close navigation`}
        aria-hidden={mobileOpen ? undefined : true}
        inert={mobileOpen ? undefined : true}
        tabIndex={mobileOpen ? undefined : -1}
        onClick={() => setMobileOpen(false)}
        className={`absolute inset-y-0 end-0 start-[min(calc(100%-48px),316px)] z-30 bg-overlay transition-opacity duration-150 ease-out motion-reduce:transition-none md:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <Sidebar
        collapsible={isMobile ? "none" : "icon"}
        side={document.documentElement.dir === "rtl" ? "right" : "left"}
        data-testid="bots-sidebar"
        data-space-switch="sidebar"
        inert={isMobile && !mobileOpen ? true : undefined}
        aria-hidden={isMobile && !mobileOpen ? true : undefined}
        data-bots-sidebar-density={density}
        data-collapsed={collapsed ? "true" : "false"}
        className={
          isMobile
            ? `absolute inset-y-0 start-0 z-40 flex w-[calc(100%-48px)] max-w-[316px] shrink-0 flex-col border-e border-sidebar-border bg-sidebar transition-transform duration-200 ease-out motion-reduce:transition-none ${mobileOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full"}`
            : "h-full overflow-hidden border-sidebar-border"
        }
      >
        <SidebarHeader
          mini={mini}
          createMenuOpen={createMenuOpen}
          setCreateMenuOpen={setCreateMenuOpen}
          activityOpen={onActivity}
          onActivity={() => navigate("/app/activity")}
          searchOpen={searchOpen && !mini}
          onSearch={() => {
            if (searchOpen && !mini) {
              setQuery("");
              setSearchOpen(false);
              return;
            }
            if (mini) setCollapsedPref(false);
            setSearchOpen(true);
            requestAnimationFrame(() =>
              document.querySelector<HTMLInputElement>('input[name="sidebar-search"]')?.focus(),
            );
          }}
          setBotsSidebarCollapsedPref={setCollapsedPref}
          bots={bots}
          setMobileSidebarOpen={setMobileOpen}
          setPanel={setPanel}
          navigate={navigate}
          setNewSpaceOpen={setNewSpaceOpen}
          canCreateSpace={canCreateSpace}
          setCreateBotOpen={setCreateBotOpen}
          paused={paused}
          onResume={onResume}
        />
        {spaces.length > 0 ? (
          <SpaceSwitcher
            mini={mini}
            summary={spaceSummary}
            spaces={spaces}
            currentSpaceId={currentSpaceId}
            onSelect={openSpaceChat}
            onCreate={
              canCreateSpace
                ? () => {
                    setMobileOpen(false);
                    setNewSpaceOpen(true);
                  }
                : undefined
            }
          />
        ) : null}
        {mini ? null : (
          <SidebarNavLive
            bots={bots}
            ticketBoardEnabled={ticketBoardEnabled}
            embedded={isEmbedded()}
            onOpen={(to) => {
              setMobileOpen(false);
              navigate(to);
            }}
          />
        )}
        {mini || !(searchOpen || query) ? null : (
          <InputGroup
            data-testid="sidebar-search"
            className="mx-2.5 mb-3 w-auto rounded-xl bg-card dark:bg-input border border-border text-muted-foreground focus-within:border-ring"
          >
            <InputGroupAddon>
              <Search size={16} strokeWidth={1.8} aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                setQuery("");
                setSearchOpen(false);
              }}
              placeholder={t`Search`}
              aria-label={t`Search`}
              autoComplete="off"
              name="sidebar-search"
            />
          </InputGroup>
        )}
        <div className="rk-scroll scroll-fade-y scroll-fade-12 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2.5">
          {showSpaceSearch && !mini ? (
            <SpaceSearchResults
              hits={searchHits}
              loading={searchLoading}
              onSelect={(hit) => jumpToSearchHit(hit)}
            />
          ) : (
            <>
              {roster}
              {mini ? null : (
                <SidebarPeopleList
                  activeUserId={activeDmUserId}
                  onOpen={(userId) => {
                    setMobileOpen(false);
                    navigate(`/app/dm/${userId}`);
                  }}
                />
              )}
            </>
          )}
          <div className={mini ? "hidden" : "contents"}>{archived}</div>
        </div>
        <div className={mini ? "hidden" : "contents"}>
          <PasskeyOffer />
          <MissionList navigate={navigate} onNavigate={() => setMobileOpen(false)} />
        </div>
        {mini || isEmbedded() ? null : (
          <div className="flex justify-center pb-1">
            <SubscriptionRailRings />
          </div>
        )}
        <ShellSidebarFooter
          mini={mini}
          account={!isEmbedded()}
          logos={footerLogos}
          user={user}
          navLinks={navLinks}
          closeMobileSidebar={() => setMobileOpen(false)}
          navigate={navigate}
          openSettings={openSettings}
          openIntegrations={openIntegrations}
        />
      </Sidebar>
    </>
  );
}

export function ShellSidebarFooter({
  mini,
  account,
  logos,
  user,
  navLinks,
  closeMobileSidebar,
  navigate,
  openSettings,
  openIntegrations,
}: {
  mini: boolean;
  /** Whether this footer carries the account menu and the Store; a partner's frame has neither. */
  account: boolean;
  logos: Array<{ name: string; logo?: string | null }>;
  user: User | undefined;
  navLinks: NavLink[];
  closeMobileSidebar: () => void;
  navigate: (path: string) => void;
  openSettings: (section: SettingsSection) => void;
  openIntegrations: () => void;
}) {
  const { t, i18n } = useLingui();
  const { status: billing, showPlans } = useBilling();
  const freeUntil =
    billing?.funding === "byok" &&
    billing.byokFreeUntil &&
    new Date(billing.byokFreeUntil) > new Date()
      ? billing.byokFreeUntil
      : null;
  const localEdition = useLocalEdition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logOutError, setLogOutError] = useState<string | null>(null);
  const hideStore = usePartnerHidden().includes("store");
  const { signingOut, logOut } = useSignOut(() => {
    clearSpaceSelection();
    navigate("/");
  }, setLogOutError);
  const { label: userName, initial: initials } = accountDisplay(user ?? {}, t`You`);
  const day = freeUntil ? formatBillingDate(freeUntil, i18n.locale || "en") : "";
  return (
    <>
      {freeUntil && !mini ? (
        <div className="mx-2.5 flex items-center justify-between gap-2 ps-2.5 text-sm text-muted-foreground">
          <span className="min-w-0 truncate">
            <Trans>Free plan ends {day}</Trans>
          </span>
          {billing?.canManage ? (
            <Button variant="outline" size="sm" onClick={showPlans}>
              <Trans>Upgrade</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}
      {account ? (
        <SidebarFooter
          mini={mini}
          logos={logos}
          name={userName}
          initials={initials}
          image={user?.image}
          email={user?.email}
          open={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (!open) setLogOutError(null);
          }}
          onIntegrations={() => {
            setMenuOpen(false);
            openIntegrations();
          }}
          links={navLinks}
          onLink={(link) => {
            setMenuOpen(false);
            closeMobileSidebar();
            navigate(`/app/x/${link.id}`);
          }}
          onSettings={() => {
            setMenuOpen(false);
            openSettings("general");
          }}
          onLogOut={() => {
            setLogOutError(null);
            void logOut();
          }}
          signingOut={signingOut}
          logOutError={logOutError}
          localEdition={localEdition}
          hideStore={hideStore}
        />
      ) : null}
    </>
  );
}
