import type { AppBootstrap, Me, SpaceMemoryConfig } from "@corvo/contracts";
import { writeSaved } from "@corvo/core/query";
import type { SettingsLayoutSection } from "@corvo/ui-web";
import { Button, SettingsLayout } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  CloudDownload,
  Cpu,
  CreditCard,
  Gauge,
  Handshake,
  Monitor,
  Plug,
  Server,
  Settings,
  ShieldCheck,
  Users,
  Volume2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { ApprovalRulesSettings } from "../components/ApprovalRulesSettings";
import { SETTINGS_CONTENT_WIDTH, SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { authClient } from "../lib/auth";
import { takeInitialBootstrap } from "../lib/bootstrap";
import { computersAreUnavailable, showsComputerSettings } from "../lib/computer-sandbox";
import { desktopBridge } from "../lib/desktop";
import { useLocalEdition } from "../lib/local-edition";
import { useSpaceQueries } from "../lib/query";
import { rpc, selectedSpaceId, selectSpace } from "../lib/rpc";
import { settingsPath, useSettingsNavigation } from "../lib/settings-route";
import { SpaceRpcProvider } from "../lib/space-rpc";
import {
  ComputerSettingsPanel,
  GeneralSettingsPanels,
  UpdatesSettingsPanel,
  UsageSettingsPanel,
} from "./AccountSettingsOverlay";
import { BillingSettingsPanel } from "./BillingSettingsPanel";
import { ConnectionsSettingsPanel } from "./ConnectionsSettingsPanel";
import { McpServersSettings } from "./McpServersSettings";
import { MembersSettingsPanel } from "./MembersSettingsPanel";
import { MemorySettingsOverlay } from "./MemorySettingsOverlay";
import { ModelSettingsOverlay } from "./ModelSettingsOverlay";
import { PartnershipSettingsPanel } from "./PartnershipSettingsPanel";
import { SpaceSettingsPanel } from "./SpaceSettingsPanel";
import { commitSpaceRename } from "./shell/space-sidebar";
import { VoiceSettingsOverlay } from "./VoiceSettingsOverlay";

type PageSection = SettingsLayoutSection & { content: ReactNode; width?: "prose" | "full" };

/** Bounds the voice status refresh on leaving, so a hung request never lingers. */
const VOICE_STATUS_REFRESH_TIMEOUT_MS = 10_000;

function voiceStatusRefreshTimeout(): Promise<never> {
  return new Promise((_, reject) => {
    AbortSignal.timeout(VOICE_STATUS_REFRESH_TIMEOUT_MS).addEventListener("abort", () => {
      reject(new DOMException("Voice status refresh timed out", "TimeoutError"));
    });
  });
}

/** Sections that depend on the account's flags wait for it before anyone is sent elsewhere. */
const ACCOUNT_SECTIONS = ["computer", "billing", "partnership", "mcp", "members"];

/**
 * Settings as a page, one route per section (`/settings/:section`, and `/settings/space/:spaceId`
 * for one space's own page). To add a section, add it to `sections` below; the nav, deep links,
 * Esc and the way back come from `SettingsLayout`.
 */
export function SettingsPage() {
  const { t } = useLingui();
  const { section: sectionParam, spaceId: spaceParam } = useParams();
  const [searchParams] = useSearchParams();
  const navigation = useSettingsNavigation();
  const client = useQueryClient();
  const queries = useSpaceQueries();
  const session = authClient.useSession();
  const user = session.data?.user;
  const localEdition = useLocalEdition();
  const managedLocal = localEdition && Boolean(desktopBridge()?.desktopControl);

  const bootstrapKey = queries.bootstrap.queryKey({ input: {} });
  const bootstrap = useQuery({
    queryKey: bootstrapKey,
    queryFn: () => takeInitialBootstrap(),
  });
  const me: Me | null | undefined = bootstrap.data ? (bootstrap.data.me ?? null) : undefined;
  const spaces = bootstrap.data?.spaces ?? [];
  const bootstrapKeyRef = useRef(bootstrapKey);
  bootstrapKeyRef.current = bootstrapKey;
  const updateBootstrap = useCallback(
    (update: (current: AppBootstrap) => AppBootstrap) => {
      client.setQueryData<AppBootstrap>(bootstrapKeyRef.current, (current) =>
        current ? update(current) : current,
      );
    },
    [client],
  );
  const patchMe = (patch: Partial<Me>) =>
    updateBootstrap((current) =>
      current.me ? { ...current, me: { ...current.me, ...patch } } : current,
    );

  const [keepComputerRecovery, setKeepComputerRecovery] = useState(false);
  const recoveryHoldTimer = useRef<number | undefined>(undefined);
  const releaseComputerRecovery = useCallback(() => {
    window.clearTimeout(recoveryHoldTimer.current);
    recoveryHoldTimer.current = undefined;
    setKeepComputerRecovery(false);
  }, []);
  const holdComputerRecovery = useCallback(() => {
    setKeepComputerRecovery(true);
    window.clearTimeout(recoveryHoldTimer.current);
    recoveryHoldTimer.current = window.setTimeout(() => {
      recoveryHoldTimer.current = undefined;
      setKeepComputerRecovery(false);
    }, 4000);
  }, []);
  useEffect(() => () => window.clearTimeout(recoveryHoldTimer.current), []);

  const sandboxProvider = me?.sandboxProvider;
  const showComputer = showsComputerSettings({
    provider: sandboxProvider,
    recovering: keepComputerRecovery,
    managedLocal,
  });
  const billingEnabled = me?.billingEnabled === true;
  const partnerAdmin = me?.partnerAdmin === true;
  const showConnections = managedLocal && Boolean(desktopBridge()?.connections);
  const showUpdates = Boolean(desktopBridge()?.update);

  const activeId = spaceParam ? "space" : sectionParam;
  useEffect(() => {
    if (activeId !== "computer") releaseComputerRecovery();
  }, [activeId, releaseComputerRecovery]);

  // Read when Usage opens; a reopened Usage shows the last summary while it refreshes.
  const usageRef = useRef<HTMLDivElement>(null);
  const usage = useQuery({
    ...queries.usage.summary.queryOptions(),
    enabled: activeId === "usage",
  });
  useEffect(() => {
    if (activeId === "usage") usageRef.current?.focus();
  }, [activeId]);

  const memoryConfigKey = queries.memory.providerConfig.queryKey();
  const memoryConfigQuery = useQuery({
    ...queries.memory.providerConfig.queryOptions(),
    enabled: activeId === "memory",
  });
  // Undefined while it first loads; null when the space has none or it could not be read.
  const memoryConfig: SpaceMemoryConfig | null | undefined =
    memoryConfigQuery.data !== undefined
      ? memoryConfigQuery.data
      : memoryConfigQuery.isError
        ? null
        : undefined;

  // Voice readiness feeds the call buttons, so leaving Settings refreshes it.
  const voiceStatusKey = queries.voice.status.queryKey();
  const voiceStatusKeyRef = useRef(voiceStatusKey);
  voiceStatusKeyRef.current = voiceStatusKey;
  useEffect(
    () => () => {
      const key = voiceStatusKeyRef.current;
      void Promise.race([rpc.voice.status(), voiceStatusRefreshTimeout()])
        .then((status) => client.setQueryData(key, status))
        .catch(() => {
          // Prefer reopening Voice settings over starting a call with stale readiness.
          void client.resetQueries({ queryKey: key });
        });
    },
    [client],
  );

  async function renameSpace(spaceId: string, name: string) {
    await commitSpaceRename({
      rename: async () => {
        await rpc.spaces.rename({ spaceId, name });
      },
      apply: () =>
        updateBootstrap((current) => ({
          ...current,
          spaces: current.spaces.map((space) =>
            space.id === spaceId ? { ...space, name } : space,
          ),
        })),
      refresh: () => client.invalidateQueries({ queryKey: bootstrapKey }),
    });
  }

  async function setSpacePaused(spaceId: string, paused: boolean) {
    const result = await rpc.spaces.setPaused({ spaceId, paused });
    updateBootstrap((current) => ({
      ...current,
      spaces: current.spaces.map((space) =>
        space.id === spaceId ? { ...space, pausedAt: result.pausedAt } : space,
      ),
    }));
    void client.invalidateQueries({ queryKey: bootstrapKey });
  }

  async function removeSpace(spaceId: string) {
    const result = await rpc.spaces.remove({ spaceId });
    const effectiveSpaceId = selectedSpaceId() ?? me?.spaceId;
    if (effectiveSpaceId === spaceId && selectSpace(result.activeSpaceId)) {
      // The auth boundary changed, so reload like a space switch.
      window.location.assign("/app");
      return;
    }
    await client.invalidateQueries({ queryKey: bootstrapKey });
    navigation.select("general");
  }

  const sections: PageSection[] = [
    {
      id: "general",
      label: t`General`,
      icon: Settings,
      content: (
        <div className="space-y-8">
          <GeneralSettingsPanels
            email={user?.email}
            name={user?.name ?? ""}
            onNameSaved={async () => {
              await session.refetch({ query: { disableCookieCache: true } });
            }}
            timezone={me?.timezone ?? null}
            onTimezoneChange={async (timezone) => {
              const next = await rpc.preferences.update({ timezone });
              patchMe({ timezone: next.timezone });
            }}
          />
          {/* One space is just the app, so there is nothing to tell apart or manage. */}
          {spaces.length > 1 ? (
            <SettingsGroup title={t`Spaces`} data-testid="settings-spaces">
              {spaces.map((option) => (
                <SettingsRow
                  key={option.id}
                  label={<p className="break-words">{option.name}</p>}
                  control={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      aria-label={t`Manage ${option.name}`}
                      onClick={() => navigation.openSpace(option.id)}
                    >
                      {t`Manage`}
                    </Button>
                  }
                />
              ))}
            </SettingsGroup>
          ) : null}
        </div>
      ),
    },
    {
      id: "models",
      label: t`Models`,
      icon: Cpu,
      content: <ModelSettingsOverlay scope="account" />,
    },
    {
      id: "voice",
      label: t`Voice`,
      icon: Volume2,
      content: <VoiceSettingsOverlay scope="account" />,
    },
    {
      id: "approvals",
      label: t`Approvals`,
      icon: ShieldCheck,
      content: <ApprovalRulesSettings scope="account" />,
    },
    {
      id: "memory",
      label: t`Memory`,
      icon: Brain,
      content: (
        <MemorySettingsOverlay
          config={memoryConfig}
          onConfigChange={(config) => {
            void writeSaved(client, memoryConfigKey, () => config);
          }}
        />
      ),
    },
    ...(me
      ? [
          {
            id: "members",
            label: t`Members`,
            icon: Users,
            content: <MembersSettingsPanel userId={me.userId} />,
          },
        ]
      : []),
    {
      id: "usage",
      label: t`Usage`,
      icon: Gauge,
      width: "full",
      content: <UsageSettingsPanel usage={usage.data ?? null} panelRef={usageRef} />,
    },
    {
      id: "mcp",
      label: t`MCP servers`,
      icon: Server,
      width: "full",
      content: (
        <McpServersSettings
          editServerId={searchParams.get("server") || undefined}
          stdioEnabled={me?.mcpStdioEnabled === true}
        />
      ),
    },
    ...(showComputer
      ? [
          {
            id: "computer",
            label: t`Computer`,
            icon: Monitor,
            content: (
              <ComputerSettingsPanel
                sandboxProvider={sandboxProvider}
                showHint={keepComputerRecovery || computersAreUnavailable(sandboxProvider)}
                onSandboxProviderChange={(next) => {
                  patchMe({ sandboxProvider: next });
                  holdComputerRecovery();
                }}
                onRecoveryDismissed={releaseComputerRecovery}
              />
            ),
          },
        ]
      : []),
    ...(billingEnabled
      ? [{ id: "billing", label: t`Billing`, icon: CreditCard, content: <BillingSettingsPanel /> }]
      : []),
    ...(partnerAdmin
      ? [
          {
            id: "partnership",
            label: t`Partnership`,
            icon: Handshake,
            content: (
              <PartnershipSettingsPanel
                onAddCredit={billingEnabled ? () => navigation.select("billing") : undefined}
              />
            ),
          },
        ]
      : []),
    ...(showConnections
      ? [
          {
            id: "connections",
            label: t`Connections`,
            icon: Plug,
            content: <ConnectionsSettingsPanel />,
          },
        ]
      : []),
    ...(showUpdates
      ? [
          {
            id: "updates",
            label: t`Updates`,
            icon: CloudDownload,
            content: <UpdatesSettingsPanel />,
          },
        ]
      : []),
  ];

  if (!activeId) return <Navigate to={settingsPath("general")} replace />;

  if (spaceParam) {
    const space = spaces.find((candidate) => candidate.id === spaceParam);
    // A space that is gone never shows another space's settings.
    if (bootstrap.data && !space) return <Navigate to={settingsPath("general")} replace />;
    return (
      <SettingsLayout
        title={t`Settings`}
        onBack={navigation.back}
        sections={sections}
        activeId="general"
        onSelect={navigation.select}
        heading={space?.name ?? t`Space`}
      >
        {space ? (
          <SpaceRpcProvider spaceId={space.id}>
            <div className={SETTINGS_CONTENT_WIDTH}>
              <SpaceSettingsPanel
                key={space.id}
                space={space}
                onRename={(name) => renameSpace(space.id, name)}
                onSetPaused={(paused) => setSpacePaused(space.id, paused)}
                onDelete={() => removeSpace(space.id)}
              />
            </div>
          </SpaceRpcProvider>
        ) : null}
      </SettingsLayout>
    );
  }

  const active = sections.find((candidate) => candidate.id === activeId);
  if (!active) {
    if (me === undefined && ACCOUNT_SECTIONS.includes(activeId)) return null;
    return <Navigate to={settingsPath("general")} replace />;
  }
  return (
    <SettingsLayout
      title={t`Settings`}
      onBack={navigation.back}
      sections={sections}
      activeId={active.id}
      onSelect={navigation.select}
      width={active.width}
    >
      {active.content}
    </SettingsLayout>
  );
}
