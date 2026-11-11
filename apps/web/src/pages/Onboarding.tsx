import type { ModelHeaderRow, OnboardingPicks, ThinkingLevel } from "@corvo/contracts";
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
  parseModelContextWindow,
  parseModelMaxImagesPerPrompt,
  parseModelMaxTokens,
} from "@corvo/contracts";
import {
  COMPATIBLE_THINKING_LEVELS,
  clampCatalogThinkingLevel,
  createModelProbe,
  initialModelProbeState,
  pickCatalogModelId,
  popularModelProvidersFirst,
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
import { PageLoading } from "../components/PageLoading";
import { botDraftKey, prefillComposerDraft } from "../lib/composer-draft";
import { useCopyText } from "../lib/copy-text";
import { desktopBridge } from "../lib/desktop";
import { providerDisplayName } from "../lib/localized-provider-hint";
import type { ModelCatalogEntry } from "../lib/model-auth";
import type { ModelPreflightFailure } from "../lib/model-connection-preflight";
import {
  classifyModelConnectionFailure,
  modelPreflightSuccessMessage,
  runModelConnectionPreflight,
  unavailableSelectedModel,
} from "../lib/model-connection-preflight";
import { loadDoneSteps, loadPicks, saveDoneSteps, savePicks } from "../lib/onboarding-progress";
import type { OnboardingContext, OnboardingStepId } from "../lib/onboarding-steps";
import { nextStep, resolveStep, visibleSteps } from "../lib/onboarding-steps";
import { rpc } from "../lib/rpc";
import { useModelOAuthSignIn } from "../lib/use-model-oauth-signin";
import { errorText } from "../lib/user-error";
import { CompatibleKeyField } from "./model-settings/compatible-key-field";
import { ComputerStep } from "./onboarding/ComputerStep";
import { FirstBotStep } from "./onboarding/FirstBotStep";
import { OnboardingLayout } from "./onboarding/OnboardingLayout";
import { UseStep } from "./onboarding/UseStep";
import { WorkspaceStep } from "./onboarding/WorkspaceStep";
import { QuickKeyConnect } from "./onboarding-quick-connect";

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
          navigate("/app", { replace: true });
          return;
        }
        setBillingEnabled(me.billingEnabled);
        setCatalog(models);
        const current = spaces?.current;
        // An account that already has a bot has nothing to set up; /onboarding opens its chat.
        const existingBot = current?.bots[0];
        if (!routeStep && existingBot) {
          navigate(`/app/${existingBot.id}`, { replace: true });
          return;
        }
        const canRename = spaces?.spaces.find((row) => row.id === current?.id)?.canRename === true;
        if (current) setSpace({ id: current.id, name: current.name });
        userIdRef.current = me.userId;
        setDockerOffered(me.sandboxProvider === "docker");
        setDone(loadDoneSteps(me.userId));
        setPicks(loadPicks(me.userId));
        begin({
          canRenameSpace: canRename,
          spaceName: current?.name ?? "",
          needsModel: me.needsModel,
          canChooseHostComputer: me.canChooseHostComputer,
          computerHost: me.computerHost,
          hasDesktopHostChoice: Boolean(desktopBridge()?.computer?.managesHostChoice),
          // A new space for someone who already uses Rook skips the questions about themselves.
          returning: Boolean(
            spaces?.spaces.some((row) => row.id !== current?.id && row.hasContent),
          ),
        });
      })
      .catch(() =>
        begin({
          canRenameSpace: false,
          spaceName: "",
          needsModel: false,
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
    const next = nextStep(context, from);
    // Once a model is connected, going back must not offer to connect one again.
    if (from === "model") begin({ ...context, needsModel: false });
    if (next) {
      navigate(`/onboarding/${next}`, { replace: true });
      return;
    }
    navigate(chosenBotRef.current ? `/app/${chosenBotRef.current}` : "/app");
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
        setPreflightFailure(classifyModelConnectionFailure(err, { modelId }));
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
      setError(errorText(err, t`Could not save model`));
    }
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
    survey: t`Use`,
    model: t`Model`,
    bot: t`First bot`,
    computer: t`Computer`,
  };
  const steps = visibleSteps(flow).map((id) => ({
    id,
    label: sidebarLabels[id],
    detail: id === "workspace" && space ? space.name : undefined,
  }));
  const index = steps.findIndex((entry) => entry.id === step);
  const previous = steps[index - 1];
  const mac = desktopBridge()?.platform === "darwin";

  return (
    <OnboardingLayout
      steps={steps}
      current={step}
      done={done}
      // The bot already exists once the computer is asked, so there is nothing to go back to.
      onBack={
        previous && step !== "computer"
          ? () => navigate(`/onboarding/${previous.id}`, { replace: true })
          : undefined
      }
    >
      {step === "workspace" && space ? (
        <WorkspaceStep
          spaceId={space.id}
          initialName={space.name}
          onDone={(name) => {
            setSpace({ id: space.id, name });
            advance("workspace");
          }}
        />
      ) : null}
      {step === "survey" ? (
        <UseStep
          onDone={(next) => {
            setPicks(next);
            savePicks(userIdRef.current, next);
            advance("survey");
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
            <QuickKeyConnect
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
                          <ModelPreflightFeedback success={null} failure={preflightFailure} />
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
            // Landing in the Chief's chat keeps the focus choice that suggests apps to connect.
            void rpc.onboarding
              .start({ botId: chiefId })
              .then(() => rpc.onboarding.promptFocus({ botId: chiefId }))
              .catch(() => undefined)
              .finally(() => advance("bot"));
          }}
        />
      ) : null}
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
