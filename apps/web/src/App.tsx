import type { LinkFavicons } from "@corvo/chat-ui/web";
import { LinkFaviconsContext, RemoteImagesContext } from "@corvo/chat-ui/web";
import { analyticsScreen } from "@corvo/core";
import { Button } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { AppNavSidebar } from "./components/AppNavSidebar";
import { LoadingState } from "./components/ai/primitives";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PageLoading } from "./components/PageLoading";
import { SubscriptionGate } from "./components/SubscriptionGate";
import { authClient } from "./lib/auth";
import { getTicketBoardEnabled, subscribeTicketBoardEnabled } from "./lib/bootstrap";
import { desktopBridge } from "./lib/desktop";
import { identifyMonitoringUser } from "./lib/monitoring";
import { markAfterPaint, markOnce } from "./lib/performance";
import { importChunk, lazyComponent } from "./lib/preload-recovery";
import { QueryUserProvider, setQueryUser } from "./lib/query";
import { railSection } from "./lib/rail-section";
import { getRemoteImagesEnabled, subscribeRemoteImages } from "./lib/remote-images-preference";
import { rpc } from "./lib/rpc";
import {
  holdAnonymousGate,
  holdUnreachableGate,
  sessionGate,
  sessionRetryDelayMs,
  showSessionUnavailable,
} from "./lib/session-gate";
import { completeSsoCallback, SSO_CALLBACK_PATH } from "./lib/sso-flow";
import { IntegrationCallbackPage } from "./pages/IntegrationCallback";
import { IntegrationSetupPage } from "./pages/IntegrationSetup";
import { McpOAuthCallbackPage } from "./pages/McpOAuthCallback";
import { ShellPage } from "./pages/Shell";
import { useBoardNotifications } from "./pages/shell/use-board-notifications";

const AuthPage = lazyComponent(() => import("./pages/Auth").then((module) => module.AuthPage));
const NamePage = lazyComponent(() => import("./pages/Auth").then((module) => module.NamePage));
const PasswordResetPage = lazyComponent(() =>
  import("./pages/Auth").then((module) => module.PasswordResetPage),
);
const EmbedPage = lazyComponent(() =>
  import("./pages/EmbedPage").then((module) => module.EmbedPage),
);
const OnboardingPage = lazyComponent(() =>
  import("./pages/Onboarding").then((module) => module.OnboardingPage),
);
const loadArtifacts = () => import("./pages/Artifacts").then((module) => module.ArtifactsPage);
const loadUsage = () => import("./pages/Usage").then((module) => module.UsagePage);
const loadWorkflows = () => import("./pages/Workflows").then((module) => module.WorkflowsPage);
const loadRoutines = () => import("./pages/Routines").then((module) => module.RoutinesPage);
const loadWiki = () => import("./pages/WikiPage").then((module) => module.WikiPage);
const ArtifactsPage = lazyComponent(loadArtifacts);
const UsagePage = lazyComponent(loadUsage);
const WorkflowsPage = lazyComponent(loadWorkflows);
const RoutinesPage = lazyComponent(loadRoutines);
const WikiPage = lazyComponent(loadWiki);
/** The areas the bar moves between; fetched once the app is idle so moving to one never waits. */
const AREA_LOADERS = [loadUsage, loadWorkflows, loadRoutines, loadArtifacts, loadWiki];
const TeamPage = lazyComponent(() => import("./pages/TeamPage").then((module) => module.TeamPage));
const SquadPage = lazyComponent(() =>
  import("./pages/SquadPage").then((module) => module.SquadPage),
);
const BoardPage = lazyComponent(() => import("./pages/Board").then((module) => module.BoardPage));
const NavLinkPage = lazyComponent(() =>
  import("./pages/NavLinkPage").then((module) => module.NavLinkPage),
);

function SsoCallbackPage() {
  useEffect(() => {
    completeSsoCallback();
  }, []);
  return null;
}

// Link icons come from our API, which fetches and caches them; the browser never asks the site.
const linkFavicons: LinkFavicons = {
  load: (origin) => rpc.links.favicon({ origin }),
};

export function App() {
  const loadRemoteImages = useSyncExternalStore(
    subscribeRemoteImages,
    getRemoteImagesEnabled,
    () => false,
  );
  return (
    <RemoteImagesContext.Provider value={loadRemoteImages}>
      <LinkFaviconsContext.Provider value={linkFavicons}>
        <ErrorBoundary fallback={<AppFailed />}>
          {window.location.pathname === SSO_CALLBACK_PATH ? (
            <SsoCallbackPage />
          ) : window.location.pathname === "/integrations/callback" ? (
            <IntegrationCallbackPage />
          ) : (
            <SessionApp />
          )}
        </ErrorBoundary>
      </LinkFaviconsContext.Provider>
    </RemoteImagesContext.Provider>
  );
}

function SessionApp() {
  const [searchParams] = useSearchParams();
  const signInDestination =
    searchParams.get("next") === "/integrations/setup" ? "/integrations/setup" : "/app";
  const ticketBoardEnabled = useSyncExternalStore(
    subscribeTicketBoardEnabled,
    getTicketBoardEnabled,
    () => false,
  );
  const session = authClient.useSession();
  const pathname = useLocation().pathname;
  const screen = analyticsScreen(pathname);
  const analyticsUserId = session.data?.user.id;
  const lastScreen = useRef<string | undefined>(undefined);
  useEffect(() => {
    // A pending session is not a sign-out; startup already tagged the signed-in user.
    if (session.isPending) return;
    void identifyMonitoringUser(Boolean(analyticsUserId));
  }, [analyticsUserId, session.isPending]);
  useEffect(() => {
    if (!analyticsUserId) {
      lastScreen.current = undefined;
      return;
    }
    if (!screen) return;
    const key = `${analyticsUserId}:${screen}`;
    if (lastScreen.current === key) return;
    lastScreen.current = key;
    void Promise.resolve()
      .then(() => rpc.analytics.screen({ screen, surface: desktopBridge() ? "desktop" : "web" }))
      .catch(() => undefined);
  }, [analyticsUserId, screen]);
  const gate = sessionGate(session);
  useEffect(() => {
    if (gate === "authenticated" || gate === "anonymous") setQueryUser(analyticsUserId ?? null);
  }, [gate, analyticsUserId]);
  const [holdingUnreachable, setHoldingUnreachable] = useState(false);
  const nextHolding = holdUnreachableGate(gate, holdingUnreachable);
  if (nextHolding !== holdingUnreachable) setHoldingUnreachable(nextHolding);
  const [holdingAnonymous, setHoldingAnonymous] = useState(false);
  const nextHoldingAnonymous = holdAnonymousGate(gate, holdingAnonymous);
  if (nextHoldingAnonymous !== holdingAnonymous) setHoldingAnonymous(nextHoldingAnonymous);

  useLayoutEffect(() => {
    if (session.isPending) return;
    markOnce("rk:renderer:session-committed");
    markAfterPaint("rk:renderer:session-painted");
  }, [session.isPending]);

  if (showSessionUnavailable(gate, nextHolding)) {
    return <SessionUnavailable refetch={session.refetch} />;
  }
  if (gate === "loading" && !nextHoldingAnonymous) {
    return <PageLoading data-corvo-app-state="session-pending" />;
  }

  const user = session.data?.user;
  return (
    <QueryUserProvider value={user?.id ?? null}>
      <div className="h-full" data-corvo-app-state="ready">
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Navigate to={user ? "/app" : "/sign-in"} replace />} />
            <Route
              path="/sign-in"
              element={
                user ? <Navigate to={signInDestination} replace /> : <AuthPage key="in" mode="in" />
              }
            />
            <Route
              path="/sign-up"
              element={
                user ? <Navigate to="/onboarding" replace /> : <AuthPage key="up" mode="up" />
              }
            />
            <Route
              path="/forgot-password"
              element={
                user ? <Navigate to="/app" replace /> : <AuthPage key="forgot" mode="forgot" />
              }
            />
            <Route path="/reset-password" element={<PasswordResetPage />} />
            <Route path="/embed" element={<EmbedPage />} />
            <Route
              path="/mcp/oauth/callback"
              element={user ? <McpOAuthCallbackPage /> : <Navigate to="/sign-in" replace />}
            />
            <Route
              path="/integrations/setup"
              element={
                user ? (
                  <IntegrationSetupPage />
                ) : (
                  <Navigate to="/sign-in?next=/integrations/setup" replace />
                )
              }
            />
            <Route
              element={
                user ? (
                  // A new account is named before anything else.
                  user.name?.trim() ? (
                    <SubscriptionGate fallback={<PageLoading />}>
                      <Outlet />
                    </SubscriptionGate>
                  ) : (
                    <NamePage />
                  )
                ) : (
                  <Navigate to="/sign-in" replace />
                )
              }
            >
              <Route path="/onboarding/:step?" element={<OnboardingPage />} />
              <Route element={<AppFrame ticketBoardEnabled={ticketBoardEnabled} />}>
                <Route path="/app" element={<ShellPage />} />
                <Route path="/app/g/:groupId" element={<ShellPage />} />
                <Route path="/app/g/:groupId/squad" element={<SquadPage />} />
                <Route path="/app/team" element={<TeamPage />} />
                <Route path="/app/usage" element={<UsagePage />} />
                <Route path="/app/workflows" element={<WorkflowsPage />} />
                <Route path="/app/routines" element={<RoutinesPage />} />
                <Route path="/app/artifacts" element={<ArtifactsPage />} />
                <Route path="/app/artifacts/:artifactId" element={<ArtifactsPage />} />
                <Route path="/app/wiki" element={<WikiPage />} />
                {ticketBoardEnabled ? <Route path="/app/board" element={<BoardPage />} /> : null}
                <Route path="/app/x/:linkId" element={<NavLinkPage />} />
                <Route path="/app/:botId" element={<ShellPage />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </div>
    </QueryUserProvider>
  );
}

/** The frame of every signed-in screen: the agents screen brings its own sidebar, the others get the navigation one. */
function AppFrame({ ticketBoardEnabled }: { ticketBoardEnabled: boolean }) {
  useBoardNotifications(ticketBoardEnabled);
  // Moving between areas fades the new one in; moving between agents keeps the same screen.
  const area = railSection(useLocation().pathname, "") ?? "other";
  useEffect(() => {
    // A failed fetch here is not an error: the area loads on demand when it is opened.
    const preload = () => {
      for (const load of AREA_LOADERS) importChunk(load).catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(preload, { timeout: 3_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(preload, 1_500);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="flex h-full min-w-0">
      {/* The agents screen carries its own sidebar; every other area gets the navigation one. */}
      {area === "agents" ? null : <AppNavSidebar ticketBoardEnabled={ticketBoardEnabled} />}
      {/* The transform makes the agents sidebar's fixed position start inside this area. */}
      <div
        key={area}
        className="h-full min-w-0 flex-1 transform-gpu animate-in fade-in-0 duration-200 motion-reduce:animate-none"
      >
        {/* Only this area waits for its page; the sidebar stays where it is. */}
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * A session lookup that never reached the server is not a sign-out, so the app
 * waits and retries here instead of routing to sign-in and stranding a signed-in
 * user. Better Auth only polls once a session exists, so the retry lives here.
 */
function SessionUnavailable({ refetch }: { refetch: () => Promise<void> }) {
  const { t } = useLingui();
  const [attempt, setAttempt] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const retryImmediately = useRef(false);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    let cancelled = false;
    const delay = retryImmediately.current ? 0 : sessionRetryDelayMs(attempt);
    retryImmediately.current = false;
    const timer = setTimeout(() => {
      void refetchRef.current().finally(() => {
        if (!cancelled) setAttempt((value) => value + 1);
      });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attempt, retryKey]);

  return (
    <div className="grid h-full place-items-center bg-background px-6 text-center">
      <div className="flex flex-col items-center">
        <LoadingState label={t`Reconnecting`} />
        <p className="mt-3 text-[13.5px] text-muted-foreground/80">
          <Trans>Can&apos;t reach the server.</Trans>
        </p>
        <div className="mt-4">
          <Button
            variant="secondary"
            onClick={() => {
              retryImmediately.current = true;
              setAttempt(0);
              setRetryKey((key) => key + 1);
            }}
          >
            <Trans>Retry now</Trans>
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Last resort for a render failure no inner boundary caught: offer a reload instead of a blank page. */
function AppFailed() {
  return (
    <div
      className="grid h-full place-items-center bg-background px-6 text-center"
      data-corvo-app-state="failed"
    >
      <div className="flex flex-col items-center">
        <p className="text-[13.5px] text-muted-foreground/80">
          <Trans>Something went wrong. Try again.</Trans>
        </p>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => window.location.reload()}>
            <Trans>Refresh</Trans>
          </Button>
        </div>
      </div>
    </div>
  );
}
