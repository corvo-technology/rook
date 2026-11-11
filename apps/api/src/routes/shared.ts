import {
  deploymentModelRole,
  hasHostedModelCredits,
  hostCredentialSource,
  mcpStdioAvailable,
  resolveMemberMainModel,
} from "@corvo/adapters";
import type { Actor, Me } from "@corvo/contracts";
import { attachmentMaxBytes, canonicalPiProviderId, PartnerTemplate } from "@corvo/contracts";
import { parseTourDone } from "@corvo/core";
import { runAsSystem } from "@corvo/db";
import type { RouterDeps } from "../router.js";
import { isPartnerAdmin } from "./partner.js";

export { createAdapterContext as computerContext } from "@corvo/adapter-kit";

function hostCredentials(active: boolean, provider: string) {
  return active
    ? { hostCredentialProvider: provider, hostCredentialSource: hostCredentialSource(provider) }
    : { hostCredentialProvider: null, hostCredentialSource: null };
}

export async function meDto(deps: RouterDeps, actor: Actor): Promise<Me> {
  const [user, setup, partner] = await Promise.all([
    deps.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: {
        email: true,
        name: true,
        timezone: true,
        signupSurvey: { select: { userId: true } },
        coachTour: { select: { done: true, skipped: true } },
      },
    }),
    modelSetup(deps, actor),
    // Partner tables belong to the system, not to the person asking.
    runAsSystem("partner customer lookup", () =>
      deps.prisma.partnerTenant.findFirst({
        where: { ownerUserId: actor.userId },
        select: { partner: { select: { name: true, template: true } } },
      }),
    ),
  ]);
  const hostOffer = hostComputerOffer({
    provider: deps.env.sandboxProvider,
    hostConnected: deps.env.sandboxHostComputer === true,
    choiceEnabled: Boolean(deps.env.desktopHostChoiceEnabled),
    stored: setup.settings?.computerHost,
  });
  return {
    ticketBoardEnabled: deps.env.ticketBoardEnabled === true,
    phoneCallsEnabled: deps.env.phoneCallsEnabled === true,
    navLinks: deps.env.navLinks ?? [],
    maxUploadSizeBytes: attachmentMaxBytes(deps.env),
    userId: actor.userId,
    email: user.email,
    name: user.name,
    spaceId: actor.spaceId,
    isDeploymentOwner: false,
    // A partner's customer runs on the deployment's model and never sets one up.
    needsModel: partner
      ? deps.env.agentRuntime !== "scripted" && !setup.main && !deps.env.deploymentModelConfigured
      : setup.needsModel,
    defaultProvider: canonicalPiProviderId(setup.model?.provider ?? deps.env.defaultProvider),
    defaultModel: setup.model?.modelId ?? deps.env.defaultModel,
    // Set only while the active default is the deployment's own, running on host credentials.
    ...hostCredentials(
      !setup.main &&
        !setup.settings?.defaultModelProvider &&
        Boolean(deps.env.deploymentModelHostCredentials),
      deps.env.defaultProvider,
    ),
    computerHost: hostOffer.computerHost,
    canChooseHostComputer: hostOffer.canChoose,
    sandboxProvider: hostOffer.provider,
    mcpStdioEnabled: mcpStdioAvailable({
      stdioEnabled: deps.env.mcpStdioEnabled,
      allowedCommands: deps.env.mcpStdioAllowedCommands,
    }),
    avatarStyle: "organic",
    timezone: user.timezone ?? null,
    billingEnabled: Boolean(deps.billing) && !partner,
    // Only billing deployments ask; self-hosted installs never see the survey.
    needsSignupSurvey: Boolean(deps.billing) && !partner && !user.signupSurvey,
    tour: partner
      ? null
      : {
          done: parseTourDone(user.coachTour?.done ?? []),
          skipped: user.coachTour?.skipped ?? false,
        },
    partner: partner
      ? {
          name: partner.partner.name,
          hide: PartnerTemplate.safeParse(partner.partner.template).data?.hide ?? [],
          models:
            PartnerTemplate.safeParse(partner.partner.template).data?.models === "choose"
              ? ("choose" as const)
              : ("fixed" as const),
        }
      : null,
    partnerAdmin: isPartnerAdmin(deps.env, actor.email),
  };
}

/**
 * What a person can choose about where bots run, and what is on now. A Docker deployment offers
 * Docker or this Mac. The desktop app's own engine has no isolated computer but holds a connection
 * to this computer, so this Mac is its one choice; until it is allowed, computers stay off, and once
 * it is, the engine reports the desktop computer so the app shows computers as available.
 */
export function hostComputerOffer(input: {
  provider: string;
  hostConnected: boolean;
  choiceEnabled: boolean;
  stored: string | null | undefined;
}): {
  computerHost: "docker" | "this-mac" | null;
  canChoose: boolean;
  provider: string;
} {
  const { provider, stored } = input;
  if (provider === "desktop") return { computerHost: "this-mac", canChoose: false, provider };
  if (provider === "docker") {
    const chosen = stored === "this-mac" || stored === "docker" ? stored : null;
    return {
      // The desktop app's engine starts on the isolated computer, so it has nothing to ask first.
      computerHost: chosen ?? (input.hostConnected ? "docker" : null),
      canChoose: input.choiceEnabled,
      provider,
    };
  }
  if (provider === "none" && input.hostConnected) {
    const allowed = stored === "this-mac";
    return {
      computerHost: allowed ? "this-mac" : null,
      canChoose: input.choiceEnabled,
      provider: allowed ? "desktop" : provider,
    };
  }
  return { computerHost: null, canChoose: false, provider };
}

/** The main model chat runs: the member's while it can run, else the deployment's. */
export async function modelSetup(deps: RouterDeps, actor: Actor) {
  const [member, settings] = await Promise.all([
    resolveMemberMainModel({ prisma: deps.prisma, secretStore: deps.secrets }, actor),
    deps.prisma.deploymentSettings.findUnique({ where: { id: "default" } }),
  ]);
  const main =
    member &&
    (member.credential ||
      (deps.billing?.modelCreditsEnabled &&
        (await hasHostedModelCredits(deps.prisma, actor, member.provider))))
      ? member
      : null;
  const funding = deps.billing ? await deps.billing.status(actor) : null;
  const hasDeployment =
    Boolean(deps.env.deploymentModelConfigured) &&
    (!funding?.creditPurchasesEnabled || funding.funding === "credits");
  return {
    main,
    model:
      main ??
      deploymentModelRole("main", {
        settings,
        deployment: { provider: deps.env.defaultProvider, model: deps.env.defaultModel },
      }).primary,
    settings,
    funding,
    hasDeployment,
    needsModel: deps.env.agentRuntime !== "scripted" && !main && !hasDeployment,
  };
}

export const THREAD_MESSAGE_PAGE_SIZE = 100;

/** Silence longer than this on a thread stream is indistinguishable from a dead socket. */
export const HEARTBEAT_MS = 20_000;

/** A thread stream re-checks its session at least this often while it delivers. */
export const SESSION_RECHECK_MS = 10_000;

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export function isRecordNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2025");
}
