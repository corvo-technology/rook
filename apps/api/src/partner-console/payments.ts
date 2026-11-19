import type { ConnectedAccountStatus, ConnectState, PaymentsProvider } from "@corvo/adapter-kit";
import type { PartnerPaymentsSchema } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { runAsSystem, setPartnerConnectAccount, setPartnerConnectState } from "@corvo/db";
import type { z } from "zod";
import type { PartnerConsoleStore, PartnerRecord, PartnerScope } from "./types.js";
import { PartnerConsoleError } from "./types.js";

export type PartnerPaymentsResult = z.infer<typeof PartnerPaymentsSchema>;

const PAYOUTS_SHOWN = 20;
const DISPUTES_SHOWN = 10;

export interface PartnerConnectRecord {
  accountId: string | null;
  state: ConnectState;
  country: string | null;
}

/** What the receipts screen needs from storage; every read is by the partner's own id. */
export interface PartnerPaymentsStore {
  connect(partnerId: string): Promise<PartnerConnectRecord>;
  saveAccount(
    partnerId: string,
    status: Pick<ConnectedAccountStatus, "account" | "state">,
  ): Promise<void>;
  saveState(partnerId: string, state: ConnectState): Promise<void>;
  payouts(partnerId: string, limit: number): Promise<PartnerPaymentsResult["payouts"]>;
  disputes(partnerId: string, limit: number): Promise<PartnerPaymentsResult["disputes"]>;
  audit(event: { partnerId: string; actorUserId: string | null; kind: string }): Promise<void>;
}

export interface PartnerPaymentsDeps {
  partners: Pick<PartnerConsoleStore, "findPartner">;
  store: PartnerPaymentsStore;
  /** Absent where no payment provider is configured: the screen says so and starts nothing. */
  provider?: PaymentsProvider;
  webOrigin: string;
}

/** Only white-label partners collect through a connected account; any other is "not found". */
async function requireWhiteLabel(
  deps: PartnerPaymentsDeps,
  scope: PartnerScope,
  partnerId: string,
): Promise<PartnerRecord> {
  const partner = await deps.partners.findPartner(scope.organizationId, partnerId);
  if (partner?.mode !== "white_label") throw new PartnerConsoleError("not_found");
  return partner;
}

const hint = (account: string | null) => (account ? account.slice(-6) : null);

/**
 * The connected account, its state, and what reached the partner. The state is read from the
 * provider when it can be (a missed webhook must not leave a finished partner looking pending).
 */
export async function getPartnerPayments(
  deps: PartnerPaymentsDeps,
  scope: PartnerScope,
  input: { partnerId: string },
): Promise<PartnerPaymentsResult> {
  const partner = await requireWhiteLabel(deps, scope, input.partnerId);
  const connect = await deps.store.connect(partner.id);
  let state = connect.state;
  let requirementsDue: string[] = [];
  if (deps.provider && connect.accountId) {
    try {
      const status = await deps.provider.getAccountStatus(connect.accountId);
      requirementsDue = status.requirementsDue;
      if (status.state !== state) {
        state = status.state;
        await deps.store.saveState(partner.id, state);
      }
    } catch {
      // The stored state stands; the screen is still useful.
    }
  }
  const [payouts, disputes] = await Promise.all([
    deps.store.payouts(partner.id, PAYOUTS_SHOWN),
    deps.store.disputes(partner.id, DISPUTES_SHOWN),
  ]);
  return {
    state,
    accountHint: hint(connect.accountId),
    requirementsDue,
    available: Boolean(deps.provider),
    payouts,
    disputes,
  };
}

/** Opens the account once, then returns the address where the partner finishes onboarding. */
export async function startPartnerConnect(
  deps: PartnerPaymentsDeps,
  scope: PartnerScope,
  input: { partnerId: string },
): Promise<{ url: string }> {
  const partner = await requireWhiteLabel(deps, scope, input.partnerId);
  if (!deps.provider) throw new PartnerConsoleError("refused", "payments_unavailable");
  const connect = await deps.store.connect(partner.id);
  if (connect.state === "disabled") throw new PartnerConsoleError("refused", "account_disabled");
  let account = connect.accountId;
  if (!account) {
    const created = await deps.provider.createConnectedAccount({
      partnerId: partner.id,
      country: connect.country ?? (partner.currency === "BRL" ? "BR" : "US"),
      businessName: partner.name,
    });
    account = created.account;
    await deps.store.saveAccount(partner.id, { account, state: "pending" });
  }
  await deps.store.audit({
    partnerId: partner.id,
    actorUserId: scope.actorUserId ?? null,
    kind: "connect.started",
  });
  const back = `${deps.webOrigin}/app/partner/${encodeURIComponent(partner.id)}/payments`;
  return deps.provider.createOnboardingLink({ account, returnUrl: back, refreshUrl: back });
}

/** The partner's own dashboard of the connected account, once onboarding has been submitted. */
export async function openPartnerConnectDashboard(
  deps: PartnerPaymentsDeps,
  scope: PartnerScope,
  input: { partnerId: string },
): Promise<{ url: string }> {
  const partner = await requireWhiteLabel(deps, scope, input.partnerId);
  if (!deps.provider) throw new PartnerConsoleError("refused", "payments_unavailable");
  const connect = await deps.store.connect(partner.id);
  if (!connect.accountId || (connect.state !== "active" && connect.state !== "restricted")) {
    throw new PartnerConsoleError("conflict", "onboarding_incomplete");
  }
  return deps.provider.createDashboardLink(connect.accountId);
}

const system = <T>(fn: () => Promise<T>) => runAsSystem("partner payments", fn);

const isState = (value: string): value is ConnectState =>
  value === "none" ||
  value === "pending" ||
  value === "restricted" ||
  value === "active" ||
  value === "disabled";

export function createPrismaPartnerPaymentsStore(prisma: PrismaClient): PartnerPaymentsStore {
  return {
    connect: (partnerId) =>
      system(async () => {
        const row = await prisma.partner.findUniqueOrThrow({
          where: { id: partnerId },
          select: { connectAccountId: true, connectState: true, country: true },
        });
        return {
          accountId: row.connectAccountId,
          state: isState(row.connectState) ? row.connectState : "none",
          country: row.country,
        };
      }),
    saveAccount: (partnerId, status) =>
      system(async () => {
        await setPartnerConnectAccount(prisma, partnerId, status);
      }),
    saveState: (partnerId, state) => system(() => setPartnerConnectState(prisma, partnerId, state)),
    payouts: (partnerId, limit) =>
      system(async () =>
        (
          await prisma.partnerPayout.findMany({
            where: { partnerId },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
        ).map((row) => ({
          id: row.id,
          amountMinor: row.amountMinor,
          currency: row.currency === "BRL" ? ("BRL" as const) : ("USD" as const),
          status: row.status === "paid" ? ("paid" as const) : ("failed" as const),
          arrivedAt: row.arrivedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
      ),
    disputes: (partnerId, limit) =>
      system(async () =>
        (
          await prisma.partnerDispute.findMany({
            where: { partnerId },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
        ).map((row) => ({
          id: row.id,
          amountMinor: row.amountMinor,
          currency: row.currency === "BRL" ? ("BRL" as const) : ("USD" as const),
          reason: row.reason,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
        })),
      ),
    audit: (event) =>
      system(async () => {
        await prisma.partnerAuditEvent.create({
          data: { ...event, detail: {} },
        });
      }),
  };
}
