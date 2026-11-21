import type {
  BusinessAnswer,
  ModelHeaderRow,
  OnboardingPicks,
  ThinkingLevel,
  WorkArea,
} from "@corvo/contracts";
import {
  agentCatalogLocale,
  CLOUDFLARE_AI_GATEWAY_PROVIDER_ID,
  cloudflareModelRouting,
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_TOKENS,
  isCloudflareModelProvider,
  isOllamaCloudBaseUrl,
  MAX_MODEL_CONTEXT_WINDOW,
  MAX_MODEL_MAX_TOKENS,
  ModelHeaderRowsSchema,
  modelHeadersInput,
  OLLAMA_CLOUD_BASE_URL,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  openAiCompatibleConnectReady,
  openAiCompatibleProbeSuccessMessage,
  parseAvatar,
  parseModelContextWindow,
  parseModelMaxImagesPerPrompt,
  parseModelMaxTokens,
} from "@corvo/contracts";
import type { ModelProblem } from "@corvo/core";
import {
  AGENT_CATALOG,
  CHIEF_AGENT,
  COMPATIBLE_THINKING_LEVELS,
  clampCatalogThinkingLevel,
  createModelProbe,
  initialModelProbeState,
  modelFailureData,
  pickCatalogModelId,
  popularModelProvidersFirst,
  suggestTeam,
} from "@corvo/core";
import {
  Button,
  Input,
  ModelThinkingOptions,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@corvo/ui-web";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Check, Copy } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BrandMascot } from "../components/BrandMascot";
import {
  ModelPreflightFeedback,
  modelPreflightTestingLabel,
} from "../components/ModelConnectionPreflightNotice";
import { ModelHeadersEditor } from "../components/ModelHeadersEditor";
import { ModelProblemNotice } from "../components/ModelProblemNotice";
import { PageLoading } from "../components/PageLoading";
import { authClient } from "../lib/auth";
import { botDraftKey, prefillComposerDraft } from "../lib/composer-draft";
import { useCopyText } from "../lib/copy-text";
import { desktopBridge } from "../lib/desktop";
import { localTimezone } from "../lib/local-timezone";
import { providerDisplayName } from "../lib/localized-provider-hint";
import type { ModelCatalogEntry } from "../lib/model-auth";
import type { ModelPreflightFailure } from "../lib/model-connection-preflight";
import {
  modelPreflightSuccessMessage,
  providerFailure,
  runModelConnectionPreflight,
  unavailableSelectedModel,
} from "../lib/model-connection-preflight";
import { webModelProblem } from "../lib/model-problem";
import {
  loadDoneSteps,
  loadPicks,
  mergeDoneSteps,
  saveDoneSteps,
  savePicks,
} from "../lib/onboarding-progress";
import { firstName, railDetails } from "../lib/onboarding-rail";
import type { OnboardingContext, OnboardingStepId } from "../lib/onboarding-steps";
import { nextStep, resolveStep, visibleSteps } from "../lib/onboarding-steps";
import { rpc } from "../lib/rpc";
import { useModelOAuthSignIn } from "../lib/use-model-oauth-signin";
import { errorText } from "../lib/user-error";
import { CompatibleKeyField } from "./model-settings/compatible-key-field";
import { BusinessStep } from "./onboarding/BusinessStep";
import { ComputerStep } from "./onboarding/ComputerStep";
import { FirstBotStep } from "./onboarding/FirstBotStep";
import { InviteStep } from "./onboarding/InviteStep";
import { LocalModelStep } from "./onboarding/LocalModelStep";
import { useBusinessLabels } from "./onboarding/labels";
import { OnboardingLayout } from "./onboarding/OnboardingLayout";
import { OnboardingPreview } from "./onboarding/OnboardingPreview";
import type { TeamDropped } from "./onboarding/TeamStep";
import { agentName, keptTeam, NOTHING_DROPPED, TeamStep } from "./onboarding/TeamStep";
import { WorkspaceStep } from "./onboarding/WorkspaceStep";
import { YouStep } from "./onboarding/YouStep";
import { useStoreCategoryLabels } from "./StoreCategoryChips";

const CUSTOM_MODEL_OPTION = "__corvo_custom_model__";
/** Rook credits sit among the providers as the one choice that needs no account of its own. */
const CREDITS_OPTION = "__corvo_credits__";
/** A provider whose catalog entry offers both sign-in and a key appears once per way to connect. */
type ProviderAuth = "sign-in" | "key";

const MAIN_PROVIDER_OPTIONS: ReadonlyArray<{ provider: string; auth?: ProviderAuth }> = [
  { provider: "openai-codex" },
  { provider: "anthropic", auth: "sign-in" },
  { provider: "openai" },
  { provider: "anthropic", auth: "key" },
  { provider: "openrouter" },
  { provider: "google" },
];

function providerOptionValue(provider: string, auth?: ProviderAuth): string {
  return auth ? `${provider}:${auth}` : provider;
}

export function OnboardingPage() {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const fieldId = useId();
  // The URL holds the step, so /onboarding/model and the others open directly while they apply.
  const { step: routeStep } = useParams();
  const [flow, setFlow] = useState<OnboardingContext | null>(null);
  const flowRef = useRef<OnboardingContext | null>(null);
  const [space, setSpace] = useState<{ id: string; name: string } | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(localTimezone);
  const [business, setBusiness] = useState<BusinessAnswer | null>(null);
  const [areas, setAreas] = useState<WorkArea[]>([]);
  const [person, setPerson] = useState<{ name: string; image: string | null }>({
    name: "",
    image: null,
  });
  // What is typed in a step, shown in the preview before it is saved.
  const [workspaceDraft, setWorkspaceDraft] = useState<{
    name: string;
    logo: string | null;
  } | null>(null);
  const [personDraft, setPersonDraft] = useState<{ name: string; image: string | null } | null>(
    null,
  );
  const [teamWay, setTeamWay] = useState<"team" | "import" | null>(null);
  const [dropped, setDropped] = useState<TeamDropped>(NOTHING_DROPPED);
  const businessLabels = useBusinessLabels();
  const storeCategoryLabels = useStoreCategoryLabels();
  const [done, setDone] = useState<ReadonlySet<OnboardingStepId>>(new Set());
  // The desktop app's own engine has no Docker, so its computer step is this computer or nothing.
  const [dockerOffered, setDockerOffered] = useState(true);
  const chosenBotRef = useRef<string | null>(null);
  const [picks, setPicks] = useState<OnboardingPicks | null>(null);
  const userIdRef = useRef("");
  const step: OnboardingStepId | "loading" = flow ? resolveStep(flow, routeStep, done) : "loading";
  const stepRef = useRef(step);
  stepRef.current = step;
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [provider, setProvider] = useState("");
  const [showAllProviders, setShowAllProviders] = useState(false);
  const [providerAuth, setProviderAuth] = useState<ProviderAuth | undefined>();
  const [credits, setCredits] = useState(false);
  const [modelId, setModelId] = useState("");
  const modelIdRef = useRef(modelId);
  modelIdRef.current = modelId;
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [gatewayId, setGatewayId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [headerRows, setHeaderRows] = useState<ModelHeaderRow[] | null>(null);
  const [reasoning, setReasoning] = useState(false);
  const [manualModelId, setManualModelId] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel | null>(null);
  const [maxTokens, setMaxTokens] = useState(String(DEFAULT_MODEL_MAX_TOKENS));
  const [contextWindow, setContextWindow] = useState(String(DEFAULT_MODEL_CONTEXT_WINDOW));
  const [supportsImages, setSupportsImages] = useState(false);
  const [maxImagesPerPrompt, setMaxImagesPerPrompt] = useState("");
  const [{ models: probeModels, probing }, setProbe] = useState(initialModelProbeState);
  const [modelProbe] = useState(() => createModelProbe(setProbe));
  const resetOpenAiCompatibleProbe = modelProbe.reset;
  const [error, setError] = useState<string | null>(null);
  const [connectProblem, setConnectProblem] = useState<ModelProblem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preflightTesting, setPreflightTesting] = useState(false);
  const [preflightTarget, setPreflightTarget] = useState<"api-key" | "compatible" | null>(null);
  const [preflightSuccess, setPreflightSuccess] = useState<string | null>(null);
  const [preflightFailure, setPreflightFailure] = useState<ModelPreflightFailure | null>(null);
  const preflightRevisionRef = useRef(0);
  const [codeCopied, copyOAuthCode] = useCopyText();

  const {
    oauth,
    pasteCode,
    setPasteCode,
    oauthPending,
    popupBlocked,
    cancelOAuthAttempt,
    startSubscriptionSignIn,
    submitOAuthCode,
  } = useModelOAuthSignIn({
    onClearError: () => setError(null),
    onError: setError,
    onFinished: async () => {
      advance("model");
    },
  });

  useEffect(() => {
    void Promise.all([
      rpc.me(),
      rpc.models.list().catch(() => []),
      rpc.spaces.list().catch(() => null),
    ])
      .then(([me, models, spaces]) => {
        // A partner's customer arrives with everything set up.
        if (me.partner && !routeStep) {
          navigate("/app/home", { replace: true });
          return;
        }
        setBillingEnabled(me.billingEnabled);
        setCatalog(models);
        const current = spaces?.current;
        // An account that already has a bot has nothing to set up; /onboarding opens its chat.
        const existingBot = current?.bots[0];
        if (!routeStep && existingBot) {
          navigate("/app/home", { replace: true });
          return;
        }
        const canRename = spaces?.spaces.find((row) => row.id === current?.id)?.canRename === true;
        if (current) setSpace({ id: current.id, name: current.name });
        const storedLogo = spaces?.spaces.find((row) => row.id === current?.id)?.logo;
        setLogo(storedLogo && parseAvatar(storedLogo).kind === "image" ? storedLogo : null);
        setPerson({ name: me.name, image: null });
        if (me.timezone) setTimezone(me.timezone);
        void authClient
          .getSession()
          .then((session) => {
            const image = session.data?.user.image ?? null;
            setPerson((currentPerson) => ({ ...currentPerson, image }));
          })
          .catch(() => undefined);
        userIdRef.current = me.userId;
        setDockerOffered(me.sandboxProvider === "docker");
        const local = loadDoneSteps(me.userId);
        setDone(local);
        // Steps finished on another device count too; they arrive after the first paint.
        void rpc.onboarding
          .progress()
          .then(({ done: server, answers }) => {
            setDone((current) => mergeDoneSteps(current, server));
            setBusiness((current) => current ?? answers.business);
            setAreas((current) => (current.length > 0 ? current : answers.areas));
          })
          .catch(() => undefined);
        setPicks(loadPicks(me.userId));
        begin({
          canRenameSpace: canRename,
          spaceName: current?.name ?? "",
          needsModel: me.needsModel,
          canInvite: spaces?.spaces.find((row) => row.id === current?.id)?.canInvite === true,
          canChooseHostComputer: me.canChooseHostComputer,
          computerHost: me.computerHost,
          hasDesktopHostChoice: Boolean(desktopBridge()?.computer?.managesHostChoice),
          // A new space for someone who already uses Rook skips the questions about themselves,
          // and so does a person someone invited into a space that is not theirs.
          returning:
            !canRename ||
            Boolean(spaces?.spaces.some((row) => row.id !== current?.id && row.hasContent)),
        });
      })
      .catch(() =>
        begin({
          canRenameSpace: false,
          spaceName: "",
          needsModel: false,
          canInvite: false,
          canChooseHostComputer: false,
          computerHost: null,
          hasDesktopHostChoice: false,
          returning: false,
        }),
      );
    return () => {
      modelProbe.invalidate();
    };
  }, []);

  function begin(next: OnboardingContext) {
    flowRef.current = next;
    setFlow(next);
  }

  /** Marks `from` done and opens the step after it, or the chosen bot's chat after the last one. */
  function advance(from: OnboardingStepId) {
    const context = flowRef.current;
    // A sign-in that finishes after the person went back must not move them forward.
    if (!context || from !== stepRef.current) return;
    setDone((current) => {
      const updated = new Set(current).add(from);
      saveDoneSteps(userIdRef.current, updated);
      return updated;
    });
    void rpc.onboarding.stepDone({ step: from }).catch(() => undefined);
    const next = nextStep(context, from);
    // Once a model is connected, going back must not offer to connect one again.
    if (from === "model") begin({ ...context, needsModel: false });
    if (next) {
      navigate(`/onboarding/${next}`, { replace: true });
      return;
    }
    navigate("/app/home");
  }

  /** Moves on without an answer. A model left unconnected stays to be asked for later. */
  function skip(from: OnboardingStepId) {
    const context = flowRef.current;
    if (!context || from !== stepRef.current) return;
    if (from !== "model") {
      advance(from);
      return;
    }
    const next = nextStep(context, from);
    navigate(next ? `/onboarding/${next}` : "/app/home", { replace: true });
  }

  const providers = useMemo(() => {
    const seen = new Map<string, ModelCatalogEntry>();
    for (const entry of catalog) {
      if (!seen.has(entry.provider)) seen.set(entry.provider, entry);
    }
    return popularModelProvidersFirst([...seen.values()], (entry) => entry.provider);
  }, [catalog]);

  const modelsForProvider = useMemo(
    () => catalog.filter((entry) => entry.provider === provider),
    [catalog, provider],
  );

  const selected = modelsForProvider.find((entry) => entry.id === modelId) ?? modelsForProvider[0];
  const isOpenAiCompatible = provider === OPENAI_COMPATIBLE_PROVIDER_ID;
  const isCloudflareGateway = provider === CLOUDFLARE_AI_GATEWAY_PROVIDER_ID;
  const isCloudflare = isCloudflareModelProvider(provider);
  const cloudflareRoutingReady =
    !isCloudflare || cloudflareModelRouting({ provider, accountId, gatewayId }) !== undefined;
  const subscriptionSignIn = selected?.signIn !== undefined && providerAuth !== "key";
  const acceptsKey = selected?.auth !== "oauth" && providerAuth !== "sign-in";
  const signInLabel = selected?.oauthLabel ?? t`Sign in`;
  // The first thing asked is the key; a provider chosen or Rook credits leaves this shortcut.
  const quickConnect = !provider && !credits && !showAllProviders;
  const openAiCompatibleReady = openAiCompatibleConnectReady({
    apiKey,
    baseUrl,
    modelId:
      headerRows !== null && !ModelHeaderRowsSchema.safeParse(headerRows).success ? "" : modelId,
  });
  const canSaveModel = Boolean(
    selected &&
      modelId.trim() &&
      !oauthPending &&
      cloudflareRoutingReady &&
      (isOpenAiCompatible ? openAiCompatibleReady : acceptsKey && apiKey.trim()),
  );
  const otherModelLabel = t`Other model…`;
  // Subscriptions and the common API providers first; every other provider follows.
  const providerOptions = useMemo(() => {
    const byId = new Map(providers.map((entry) => [entry.provider, entry]));
    // Beside the subscriptions, the key-based options say API.
    const optionLabel = (id: string, auth?: ProviderAuth) => {
      if (id === "anthropic" && auth === "key") return t`Anthropic API`;
      if (id === "openai") return t`OpenAI API`;
      return providerDisplayName(id, byId.get(id)?.providerName ?? id, auth);
    };
    const main = [
      ...(billingEnabled ? [{ value: CREDITS_OPTION, label: t`Rook credits` }] : []),
      ...MAIN_PROVIDER_OPTIONS.filter((option) => byId.has(option.provider)).map((option) => ({
        value: providerOptionValue(option.provider, option.auth),
        label: optionLabel(option.provider, option.auth),
      })),
    ];
    const rest = providers
      .filter(
        (entry) => !MAIN_PROVIDER_OPTIONS.some((option) => option.provider === entry.provider),
      )
      .flatMap((entry) => {
        const item = { value: entry.provider, label: entry.providerName ?? entry.provider };
        return entry.provider === OPENAI_COMPATIBLE_PROVIDER_ID
          ? [item, { value: "ollama-preset", label: t`Ollama Cloud` }]
          : [item];
      });
    return { main, rest };
  }, [billingEnabled, providers, t]);
  // Base UI Select.Value only resolves labels when Root gets `items`.
  const providerItems = useMemo(
    () => [...providerOptions.main, ...providerOptions.rest],
    [providerOptions],
  );
  const modelItems = useMemo(
    () => modelsForProvider.map((entry) => ({ value: entry.id, label: entry.label })),
    [modelsForProvider],
  );
  const probeModelItems = useMemo(
    () => [
      ...probeModels.map((id) => ({ value: id, label: id })),
      { value: CUSTOM_MODEL_OPTION, label: otherModelLabel },
    ],
    [otherModelLabel, probeModels],
  );

  function invalidatePreflight() {
    preflightRevisionRef.current += 1;
    setPreflightTesting(false);
    setPreflightTarget(null);
    setPreflightSuccess(null);
    setPreflightFailure(null);
  }

  function updateBaseUrl(nextBaseUrl: string) {
    setBaseUrl(nextBaseUrl);
    setHeaderRows(null);
    // Keep Other model… mode across URL edits; only provider change clears it.
    resetOpenAiCompatibleProbe();
    invalidatePreflight();
    setError(null);
    setNotice(null);
  }

  function updateApiKey(nextApiKey: string) {
    setApiKey(nextApiKey);
    resetOpenAiCompatibleProbe();
    invalidatePreflight();
  }

  function selectProvider(option: string, presetBaseUrl?: string) {
    if (
      option === providerOptionValue(provider, providerAuth) &&
      !presetBaseUrl &&
      !isOllamaCloudBaseUrl(baseUrl)
    )
      return;
    const [nextProvider = option, auth] = option.split(":") as [string, ProviderAuth?];
    cancelOAuthAttempt();
    setProvider(nextProvider);
    setProviderAuth(auth);
    setApiKey("");
    setHeaderRows(null);
    setAccountId("");
    setGatewayId("");
    setModelId(
      nextProvider === OPENAI_COMPATIBLE_PROVIDER_ID
        ? ""
        : pickCatalogModelId(catalog, nextProvider),
    );
    setBaseUrl(presetBaseUrl ?? "");
    setReasoning(false);
    setThinkingLevel(null);
    setManualModelId(false);
    setSupportsImages(false);
    setMaxTokens(String(DEFAULT_MODEL_MAX_TOKENS));
    setContextWindow(String(DEFAULT_MODEL_CONTEXT_WINDOW));
    setMaxImagesPerPrompt("");
    resetOpenAiCompatibleProbe();
    invalidatePreflight();
    setError(null);
    setNotice(null);
  }

  function preflightStillCurrent(revision: number): boolean {
    return revision === preflightRevisionRef.current;
  }

  async function probeServerModels() {
    if (!baseUrl.trim()) return;
    const revision = preflightRevisionRef.current;
    setError(null);
    setNotice(null);
    setPreflightSuccess(null);
    setPreflightFailure(null);
    setPreflightTarget("compatible");
    await modelProbe.probe({
      baseUrl,
      apiKey,
      request: (input) =>
        rpc.models.probeOpenAiCompatible({ ...input, headers: modelHeadersInput(headerRows) }),
      onSuccess: (models) => {
        if (!preflightStillCurrent(revision)) return;
        const trimmed = modelIdRef.current.trim();
        const next = trimmed || models[0] || "";
        if (next !== trimmed) setThinkingLevel(null);
        // Stay in manual entry across re-probes so a typed id that matches a
        // discovered model cannot yank the freeform field back to the Select.
        setManualModelId(
          (wasManual) => wasManual || (Boolean(trimmed) && !models.includes(trimmed)),
        );
        setModelId(next);
        const unavailable = unavailableSelectedModel(trimmed, models);
        if (unavailable) {
          setPreflightFailure(unavailable);
          setNotice(null);
          return;
        }
        setPreflightTarget(null);
        setPreflightFailure(null);
        setNotice(openAiCompatibleProbeSuccessMessage(models.length));
      },
      onError: (err) => {
        if (!preflightStillCurrent(revision)) return;
        setPreflightFailure(providerFailure(err, "api_key"));
        setNotice(null);
      },
    });
  }

  async function testApiKeyConnection() {
    if (!selected?.catalogProbe) return;
    const revision = preflightRevisionRef.current;
    setPreflightTarget("api-key");
    setPreflightTesting(true);
    setPreflightSuccess(null);
    setPreflightFailure(null);
    setError(null);
    setNotice(null);
    const result = await runModelConnectionPreflight({
      authKind: "api-key",
      provider: selected.provider,
      apiKey,
      modelId: selected.id,
      catalogProbe: true,
      probeCatalog: rpc.models.probeCatalog,
    });
    if (!preflightStillCurrent(revision)) return;
    setPreflightTesting(false);
    if (result.ok) {
      setPreflightSuccess(modelPreflightSuccessMessage(result.discoveredModels.length));
      return;
    }
    setPreflightFailure(result.failure);
  }

  function stagedThinkingLevel(): ThinkingLevel | null {
    return clampCatalogThinkingLevel(
      thinkingLevel,
      reasoning ? COMPATIBLE_THINKING_LEVELS : [],
    ) as ThinkingLevel | null;
  }

  async function saveModel() {
    if (!canSaveModel) return;
    setError(null);
    setConnectProblem(null);
    try {
      if (isOpenAiCompatible) {
        const parsedMaxImagesPerPrompt = parseModelMaxImagesPerPrompt(
          maxImagesPerPrompt,
          supportsImages,
        );
        if (supportsImages && maxImagesPerPrompt.trim() && parsedMaxImagesPerPrompt === undefined) {
          setError(t`Enter a whole number from 1 to 1000 for the image limit.`);
          return;
        }
        const maxImagesPerPromptInput =
          supportsImages && !maxImagesPerPrompt.trim() ? null : parsedMaxImagesPerPrompt;

        const parsedMaxTokens = parseModelMaxTokens(maxTokens);
        if (parsedMaxTokens === undefined) {
          setError(
            t`Enter a whole number from 1 to ${MAX_MODEL_MAX_TOKENS} for maximum output tokens.`,
          );
          return;
        }
        const parsedContextWindow = parseModelContextWindow(contextWindow);
        if (parsedContextWindow === undefined) {
          setError(
            t`Enter a whole number from 1 to ${MAX_MODEL_CONTEXT_WINDOW} for the context limit.`,
          );
          return;
        }
        await rpc.models.connect({
          provider,
          baseUrl: baseUrl.trim(),
          headers: modelHeadersInput(headerRows),
          modelId: modelId.trim(),
          reasoning,
          thinkingLevel: stagedThinkingLevel(),
          maxTokens: parsedMaxTokens,
          contextWindow: parsedContextWindow,
          supportsImages,
          maxImagesPerPrompt: maxImagesPerPromptInput,
          apiKey: apiKey.trim() || undefined,
          label: selected?.providerName ?? provider,
        });
      } else if (apiKey) {
        await rpc.models.connect({
          provider,
          apiKey,
          ...(isCloudflare ? { accountId: accountId.trim(), gatewayId: gatewayId.trim() } : {}),
          modelId,
          label: selected?.providerName ?? provider,
        });
      }
      advance("model");
    } catch (err) {
      if (modelFailureData(err)) setConnectProblem(webModelProblem(err, t`Could not save model`));
      else setError(errorText(err, t`Could not save model`));
    }
  }

  function focusApiKey() {
    document.getElementById(`${fieldId}-api-key`)?.focus();
  }

  async function fundWithCredits() {
    setError(null);
    try {
      await rpc.billing.selectFunding({ funding: "credits" });
      window.location.assign("/onboarding");
    } catch {
      setError(t`Could not open billing`);
    }
  }

  function beginSelectedSubscriptionSignIn() {
    if (!selected?.id) return;
    void startSubscriptionSignIn({
      provider: selected.provider,
      modelId: selected.id,
      label: selected.providerName ?? selected.provider,
    });
  }

  if (step === "loading" || !flow) return <PageLoading />;

  const sidebarLabels: Record<OnboardingStepId, string> = {
    workspace: t`Workspace`,
    business: t`Business`,
    you: t`You`,
    start: t`Team`,
    model: t`Model`,
    bot: t`First bot`,
    invite: t`People`,
    computer: t`Computer`,
  };
  const catalogLocale = agentCatalogLocale(i18n.locale);
  const suggestion = suggestTeam({ business: business?.kind ?? null, areas });
  const team = keptTeam(suggestion, dropped);
  const details = railDetails(
    {
      spaceName: space?.name ?? null,
      business: business?.kind ?? null,
      userName: person.name,
      team: teamWay ? { way: teamWay, agents: team.agents.length } : null,
    },
    {
      business: businessLabels,
      imported: t`Imported`,
      justTheChief: t`Just the Chief`,
      agents: (count) => (count === 1 ? t`1 agent` : t`${count} agents`),
    },
  );
  const steps = visibleSteps(flow).map((id) => ({
    id,
    label: sidebarLabels[id],
    detail: details[id],
  }));
  const index = steps.findIndex((entry) => entry.id === step);
  const previous = steps[index - 1];
  const mac = desktopBridge()?.platform === "darwin";
  const name = firstName(person.name);
  const narration: Record<OnboardingStepId, string> = {
    workspace: name
      ? t`Hi, ${name}. I'm the Chief. We'll set up your team in about two minutes.`
      : t`Hi. I'm the Chief. We'll set up your team in about two minutes.`,
    business: t`What does the workspace do? Every agent will know.`,
    you: t`Now a little about you.`,
    start: t`Bring agents you already use, or I'll suggest a team.`,
    model: t`I need an AI to think with.`,
    bot: t`How much should I do on my own?`,
    invite: t`Bring your people. You can do this later.`,
    computer: t`Where should my computer live?`,
  };

  return (
    <OnboardingLayout
      steps={steps}
      current={step}
      done={done}
      narration={narration[step]}
      preview={
        <OnboardingPreview
          workspaceName={workspaceDraft?.name ?? space?.name ?? ""}
          logo={workspaceDraft ? workspaceDraft.logo : logo}
          chiefName={CHIEF_AGENT.name[catalogLocale]}
          agents={
            teamWay === "import"
              ? []
              : team.agents.map((agent) => ({
                  key: agent.slug,
                  name: agentName(agent.slug, catalogLocale),
                  color: AGENT_CATALOG.find((entry) => entry.slug === agent.slug)?.color ?? "",
                }))
          }
          channels={
            teamWay === "import"
              ? []
              : team.channels.map((agent) => storeCategoryLabels[agent.category])
          }
          personName={personDraft?.name ?? person.name}
          personImage={personDraft ? personDraft.image : person.image}
        />
      }
      // The bot already exists once the computer is asked, so there is nothing to go back to.
      onBack={
        previous && step !== "invite" && step !== "computer"
          ? () => navigate(`/onboarding/${previous.id}`, { replace: true })
          : undefined
      }
      onSkip={
        step === "bot" || step === "invite" || step === "computer" ? undefined : () => skip(step)
      }
    >
      {step === "workspace" && space ? (
        <WorkspaceStep
          spaceId={space.id}
          initialName={space.name}
          initialLogo={logo}
          timezone={timezone}
          onChange={setWorkspaceDraft}
          onDone={(saved) => {
            setWorkspaceDraft(null);
            setSpace({ id: space.id, name: saved.name });
            setLogo(saved.logo);
            advance("workspace");
          }}
        />
      ) : null}
      {step === "business" ? (
        <BusinessStep
          initial={business}
          onChange={(kind) => setBusiness(kind ? { kind, summary: business?.summary ?? "" } : null)}
          onDone={(answer) => {
            setBusiness(answer);
            advance("business");
          }}
        />
      ) : null}
      {step === "you" ? (
        <YouStep
          initialName={person.name}
          initialImage={person.image}
          initialAreas={areas}
          onChange={(draft) => {
            setPersonDraft({ name: draft.name, image: draft.image });
            setAreas(draft.areas);
          }}
          onDone={(saved) => {
            setPersonDraft(null);
            setPerson({ name: saved.name, image: saved.image });
            setAreas(saved.areas);
            advance("you");
          }}
        />
      ) : null}
      {step === "start" ? (
        <TeamStep
          suggestion={suggestion}
          dropped={dropped}
          locale={catalogLocale}
          onDroppedChange={setDropped}
          onDone={(next, way) => {
            setPicks(next);
            savePicks(userIdRef.current, next);
            setTeamWay(way);
            advance("start");
          }}
        />
      ) : null}
      {step === "model" ? (
        <div>
          <BrandMascot size={64} className="mb-6" />
          <h1 className="text-[32px] font-medium text-foreground">
            <Trans>Connect a model</Trans>
          </h1>
          {quickConnect ? (
            <LocalModelStep
              catalog={catalog}
              signInOptions={providerOptions.main.filter(
                (option) => option.value === "openai-codex" || option.value === "anthropic:sign-in",
              )}
              onSelectProvider={selectProvider}
              onMore={() => setShowAllProviders(true)}
              onConnected={() => advance("model")}
            />
          ) : (
            <>
              <div className="mt-8 block text-sm font-medium text-foreground">
                <span>
                  <Trans>Provider</Trans>
                </span>
                <Select
                  value={
                    credits
                      ? CREDITS_OPTION
                      : isOpenAiCompatible && isOllamaCloudBaseUrl(baseUrl)
                        ? "ollama-preset"
                        : provider
                          ? providerOptionValue(provider, providerAuth)
                          : null
                  }
                  onValueChange={(value) => {
                    if (typeof value !== "string" || !value) return;
                    if (value === CREDITS_OPTION) {
                      cancelOAuthAttempt();
                      setProvider("");
                      setProviderAuth(undefined);
                      setCredits(true);
                      setError(null);
                      return;
                    }
                    setCredits(false);
                    if (value === "ollama-preset")
                      selectProvider(OPENAI_COMPATIBLE_PROVIDER_ID, OLLAMA_CLOUD_BASE_URL);
                    else selectProvider(value);
                  }}
                  items={providerItems}
                >
                  <SelectTrigger aria-label={t`Provider`} className="mt-2 w-full">
                    <SelectValue placeholder={t`Choose a provider`} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {providerOptions.main.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {providerOptions.main.length && providerOptions.rest.length ? (
                      <SelectSeparator />
                    ) : null}
                    <SelectGroup>
                      {providerOptions.rest.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              {provider ? (
                <>
                  {isOpenAiCompatible ? (
                    <div className="mt-6 block text-sm text-foreground">
                      <label htmlFor={`${fieldId}-base-url`} className="block font-medium">
                        <Trans>Server URL</Trans>
                        <Input
                          id={`${fieldId}-base-url`}
                          value={baseUrl}
                          onChange={(e) => updateBaseUrl(e.target.value)}
                          aria-label={t`OpenAI-compatible server URL`}
                          placeholder="http://127.0.0.1:8000/v1"
                          autoComplete="off"
                          className="mt-2"
                        />
                      </label>
                      <div className="mt-3">
                        <Button
                          variant="outline"
                          disabled={probing || !baseUrl.trim()}
                          onClick={() => void probeServerModels()}
                        >
                          {probing ? <Trans>Finding…</Trans> : <Trans>Find models</Trans>}
                        </Button>
                        {preflightTarget === "compatible" ? (
                          <ModelPreflightFeedback
                            success={null}
                            failure={preflightFailure}
                            onRetry={() => void probeServerModels()}
                          />
                        ) : null}
                      </div>
                      <div className="mt-4 block">
                        <span className="font-medium">
                          <Trans>Model</Trans>
                        </span>
                        {probeModels.length && !manualModelId ? (
                          <Select
                            value={modelId}
                            onValueChange={(value) => {
                              if (typeof value !== "string") return;
                              const next = value;
                              invalidatePreflight();
                              if (next === CUSTOM_MODEL_OPTION) {
                                setManualModelId(true);
                                setModelId("");
                              } else {
                                setManualModelId(false);
                                setModelId(next);
                              }
                            }}
                            items={probeModelItems}
                          >
                            <SelectTrigger
                              aria-label={t`Models from server`}
                              className="mt-2 w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {probeModels.map((id) => (
                                  <SelectItem key={id} value={id}>
                                    {id}
                                  </SelectItem>
                                ))}
                                <SelectItem value={CUSTOM_MODEL_OPTION}>
                                  <Trans>Other model…</Trans>
                                </SelectItem>
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            value={modelId}
                            onChange={(e) => {
                              setManualModelId(true);
                              setModelId(e.target.value);
                              invalidatePreflight();
                            }}
                            aria-label={t`Model id`}
                            placeholder="exact-model-id"
                            className="mt-2"
                          />
                        )}
                        {probeModels.length && manualModelId ? (
                          <Button
                            variant="link"
                            size="xs"
                            className="mt-2 px-0 text-muted-foreground"
                            onClick={() => {
                              setManualModelId(false);
                              setModelId(probeModels[0] ?? "");
                              invalidatePreflight();
                            }}
                          >
                            <Trans>Use a found model</Trans>
                          </Button>
                        ) : null}
                      </div>
                      <ModelThinkingOptions
                        reasoning={reasoning}
                        onReasoningChange={(value) => {
                          setReasoning(value);
                          if (!value) setThinkingLevel(null);
                        }}
                        advancedLabel={t`Advanced`}
                        thinkingLabel={t`Supports thinking`}
                        thinkingLevel={thinkingLevel}
                        onThinkingLevelChange={(value) =>
                          setThinkingLevel(value as ThinkingLevel | null)
                        }
                        thinkingLevelOptions={[
                          { value: "minimal", label: t`Minimal` },
                          { value: "low", label: t`Low` },
                          { value: "medium", label: t`Medium` },
                          { value: "high", label: t`High` },
                          { value: "xhigh", label: t`Extra high` },
                          { value: "max", label: t`Max` },
                        ]}
                        thinkingLevelLabel={t`Reasoning effort`}
                        thinkingLevelDefaultLabel={t`Default`}
                        maxTokens={maxTokens}
                        onMaxTokensChange={setMaxTokens}
                        maxTokensLabel={t`Maximum output tokens`}
                        contextWindow={contextWindow}
                        onContextWindowChange={setContextWindow}
                        contextWindowLabel={t`Context limit`}
                        supportsImages={supportsImages}
                        onSupportsImagesChange={setSupportsImages}
                        imagesLabel={t`Supports images`}
                        maxImagesPerPrompt={maxImagesPerPrompt}
                        onMaxImagesPerPromptChange={setMaxImagesPerPrompt}
                        maxImagesLabel={t`Maximum images per request`}
                      >
                        <ModelHeadersEditor
                          rows={headerRows}
                          onChange={(rows) => {
                            setHeaderRows(rows);
                            resetOpenAiCompatibleProbe();
                            invalidatePreflight();
                          }}
                        />
                      </ModelThinkingOptions>
                    </div>
                  ) : null}
                  {subscriptionSignIn ? (
                    <div className="mt-4">
                      {oauth ? (
                        <div className="rounded-lg border border-border px-3.5 py-3">
                          {oauth.mode === "auth-url" ? (
                            <>
                              <p className="text-sm text-muted-foreground">
                                <Trans>
                                  Sign in at{" "}
                                  <a
                                    href={oauth.verificationUri}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-foreground underline"
                                  >
                                    {new URL(oauth.verificationUri).hostname}
                                  </a>
                                  , then paste the code here.
                                </Trans>
                              </p>
                              <div className="mt-3 flex items-center gap-2">
                                <Input
                                  value={pasteCode}
                                  onChange={(e) => setPasteCode(e.target.value)}
                                  aria-label={t`Authorization code`}
                                  autoComplete="off"
                                  spellCheck={false}
                                />
                                <Button
                                  disabled={!pasteCode.trim()}
                                  onClick={() => void submitOAuthCode()}
                                >
                                  <Trans>Submit</Trans>
                                </Button>
                              </div>
                              <p className="mt-2 text-sm text-muted-foreground">
                                <Plural
                                  value={Math.ceil(oauth.expiresInSeconds / 60)}
                                  one="Waiting for sign-in — the link expires in about # minute."
                                  other="Waiting for sign-in — the link expires in about # minutes."
                                />
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm text-muted-foreground">
                                {popupBlocked ? (
                                  <Trans>
                                    Open{" "}
                                    <a
                                      href={oauth.verificationUri}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-foreground underline"
                                    >
                                      {oauth.verificationUri.replace(/^https:\/\//, "")}
                                    </a>{" "}
                                    and enter this code:
                                  </Trans>
                                ) : (
                                  <Trans>
                                    A sign-in tab opened at{" "}
                                    <a
                                      href={oauth.verificationUri}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-foreground underline"
                                    >
                                      {oauth.verificationUri.replace(/^https:\/\//, "")}
                                    </a>
                                    . Enter this code there — this window keeps waiting:
                                  </Trans>
                                )}
                              </p>
                              <div className="mt-2 flex items-center gap-3">
                                <p className="font-mono text-[22px] tracking-[0.2em] text-foreground">
                                  {oauth.userCode}
                                </p>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => copyOAuthCode(oauth.userCode)}
                                >
                                  {codeCopied ? (
                                    <Check size={14} strokeWidth={1.8} aria-hidden="true" />
                                  ) : (
                                    <Copy size={14} strokeWidth={1.8} aria-hidden="true" />
                                  )}
                                  {codeCopied ? <Trans>Copied</Trans> : <Trans>Copy</Trans>}
                                </Button>
                              </div>
                              <p className="mt-2 text-sm text-muted-foreground">
                                <Plural
                                  value={Math.ceil(oauth.expiresInSeconds / 60)}
                                  one="Waiting for sign-in — the code expires in about # minute."
                                  other="Waiting for sign-in — the code expires in about # minutes."
                                />
                              </p>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-2 -ml-2 text-muted-foreground"
                            onClick={() => cancelOAuthAttempt()}
                          >
                            <Trans>Cancel</Trans>
                          </Button>
                        </div>
                      ) : (
                        <Button
                          disabled={oauthPending}
                          onClick={() => beginSelectedSubscriptionSignIn()}
                        >
                          {oauthPending ? <Trans>Starting…</Trans> : signInLabel}
                        </Button>
                      )}
                    </div>
                  ) : null}
                  {isCloudflare && acceptsKey ? (
                    <div className="mt-4 grid gap-4">
                      <label
                        htmlFor={`${fieldId}-account-id`}
                        className="block text-sm font-medium text-foreground"
                      >
                        <Trans>Account ID</Trans>
                        <Input
                          id={`${fieldId}-account-id`}
                          value={accountId}
                          onChange={(event) => setAccountId(event.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                          className="mt-2"
                        />
                      </label>
                      {isCloudflareGateway ? (
                        <label
                          htmlFor={`${fieldId}-gateway-id`}
                          className="block text-sm font-medium text-foreground"
                        >
                          <Trans>Gateway ID</Trans>
                          <Input
                            id={`${fieldId}-gateway-id`}
                            value={gatewayId}
                            onChange={(event) => setGatewayId(event.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            className="mt-2"
                          />
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                  {acceptsKey ? (
                    isOpenAiCompatible ? (
                      <CompatibleKeyField
                        className="mt-4 block text-sm text-muted-foreground"
                        baseUrl={baseUrl}
                      >
                        <Input
                          aria-label={t`API key`}
                          value={apiKey}
                          onChange={(e) => updateApiKey(e.target.value)}
                          required={isOllamaCloudBaseUrl(baseUrl)}
                          placeholder={
                            isOllamaCloudBaseUrl(baseUrl) ? t`Ollama API key` : t`Optional`
                          }
                          type="password"
                          autoComplete="new-password"
                          className="mt-2"
                        />
                      </CompatibleKeyField>
                    ) : (
                      <label
                        htmlFor={`${fieldId}-api-key`}
                        className="mt-4 block text-sm font-medium text-foreground"
                      >
                        {subscriptionSignIn ? (
                          <Trans>Or paste an API key</Trans>
                        ) : (
                          <Trans>API key</Trans>
                        )}
                        <Input
                          id={`${fieldId}-api-key`}
                          value={apiKey}
                          onChange={(e) => updateApiKey(e.target.value)}
                          placeholder="sk-…"
                          type="password"
                          autoComplete="new-password"
                          className="mt-2"
                        />
                      </label>
                    )
                  ) : null}
                  {acceptsKey && !isOpenAiCompatible && selected?.catalogProbe ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-3"
                        disabled={preflightTesting || apiKey.trim().length < 8}
                        onClick={() => void testApiKeyConnection()}
                      >
                        {modelPreflightTestingLabel(
                          preflightTesting && preflightTarget === "api-key",
                          "api-key",
                        )}
                      </Button>
                      {preflightTarget === "api-key" ? (
                        <ModelPreflightFeedback
                          success={preflightSuccess}
                          failure={preflightFailure}
                          onRetry={() => void testApiKeyConnection()}
                          onAction={{ "replace-key": focusApiKey }}
                        />
                      ) : null}
                    </>
                  ) : null}
                  {/* The model is chosen once the account is connected; sign-in uses the default. */}
                  {!isOpenAiCompatible && acceptsKey && apiKey.trim() ? (
                    <div className="mt-6 block text-sm text-foreground">
                      <span className="font-medium">
                        <Trans>Model</Trans>
                      </span>
                      <Select
                        value={selected?.id ?? modelId}
                        onValueChange={(value) => {
                          if (typeof value !== "string" || !value) return;
                          if (value === modelId) return;
                          cancelOAuthAttempt();
                          setModelId(value);
                          setThinkingLevel(null);
                          invalidatePreflight();
                        }}
                        items={modelItems}
                      >
                        <SelectTrigger aria-label={t`Model`} className="mt-2 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {modelsForProvider.map((entry) => (
                              <SelectItem key={`${entry.provider}:${entry.id}`} value={entry.id}>
                                {entry.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </>
              ) : null}
              {notice ? (
                <p className="mt-3 text-sm text-success" role="status">
                  {notice}
                </p>
              ) : null}
              {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
              {connectProblem ? (
                <ModelProblemNotice
                  className="mt-3"
                  problem={
                    connectProblem.action === "replace-key"
                      ? connectProblem
                      : { ...connectProblem, action: undefined }
                  }
                  onRetry={() => void saveModel()}
                  onAction={focusApiKey}
                />
              ) : null}
              <Button
                className="mt-6"
                disabled={!credits && !canSaveModel}
                onClick={() => void (credits ? fundWithCredits() : saveModel())}
              >
                <Trans>Continue</Trans>
              </Button>
            </>
          )}
        </div>
      ) : null}
      {step === "bot" ? (
        <FirstBotStep
          locale={agentCatalogLocale(i18n.locale)}
          picks={picks}
          onReady={({ id: chiefId, pickedAgent }) => {
            if (pickedAgent) {
              // The picked agent's chat, with its first task waiting unsent in the composer.
              chosenBotRef.current = pickedAgent.botId;
              if (pickedAgent.task) {
                prefillComposerDraft(botDraftKey(pickedAgent.botId), pickedAgent.task);
              }
              advance("bot");
              return;
            }
            chosenBotRef.current = chiefId;
            // The chat opens with a first task ready to send, so it is never a blank page.
            prefillComposerDraft(
              botDraftKey(chiefId),
              t`Introduce yourself and suggest what we should do first.`,
            );
            // Landing in the Chief's chat keeps the focus choice that suggests apps to connect.
            void rpc.onboarding
              .start({ botId: chiefId })
              .then(() => rpc.onboarding.promptFocus({ botId: chiefId }))
              .catch(() => undefined)
              .finally(() => advance("bot"));
          }}
        />
      ) : null}
      {step === "invite" ? <InviteStep onDone={() => advance("invite")} /> : null}
      {step === "computer" ? (
        <ComputerStep
          hostLabel={mac ? t`this Mac` : t`this computer`}
          dockerOffered={dockerOffered}
          onDone={() => advance("computer")}
        />
      ) : null}
    </OnboardingLayout>
  );
}
