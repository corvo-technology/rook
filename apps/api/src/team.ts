import { createHmac, timingSafeEqual } from "node:crypto";
import type { TransactionalEmailProvider } from "@corvo/adapter-kit";
import type { MailBrand } from "@corvo/auth";
import { invitationEmail } from "@corvo/auth";
import type { PrismaClient } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { BillingService } from "./billing.js";

export interface TeamDeps {
  prisma: PrismaClient;
  /** Server secret the link tokens are signed with. */
  secret: string;
  webOrigin: string;
  /** Absent where no mail is configured: the inviter shares the link instead. */
  email?: TransactionalEmailProvider;
  billing?: Pick<BillingService, "syncSeats">;
  /** The partner look of mail sent for a space whose organization is a white label customer. */
  mailBrand?: (spaceId: string) => Promise<MailBrand | undefined>;
}

type TokenKind = "invite" | "join" | "invite-mail";

function signature(secret: string, kind: TokenKind, id: string): string {
  return createHmac("sha256", secret).update(`${kind}:${id}`).digest("base64url").slice(0, 32);
}

/** `<id>.<signature>`: the id plus an HMAC of it, so the same link can be shown or sent again. */
export function teamToken(secret: string, kind: TokenKind, id: string): string {
  return `${id}.${signature(secret, kind, id)}`;
}

/** The id inside a token that was signed by this server, else null. */
export function readTeamToken(secret: string, kind: TokenKind, token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const id = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(secret, kind, id));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export const invitationUrl = (deps: TeamDeps, id: string): string =>
  new URL(`/invite/${teamToken(deps.secret, "invite", id)}`, deps.webOrigin).href;

/**
 * What only the invitation's own email carries. The link alone can be copied and handed to anyone
 * (the inviter sees it in the members list), so it proves no mailbox; this proof does.
 */
export const invitationMailProof = (secret: string, id: string): string =>
  signature(secret, "invite-mail", id);

export function isInvitationMailProof(secret: string, id: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(invitationMailProof(secret, id));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The link in the invitation email: the shareable one plus the mailbox proof. */
export const invitationEmailUrl = (deps: TeamDeps, id: string): string => {
  const url = new URL(invitationUrl(deps, id));
  url.searchParams.set("mail", invitationMailProof(deps.secret, id));
  return url.href;
};

export const joinUrl = (deps: TeamDeps, id: string): string =>
  new URL(`/join/${teamToken(deps.secret, "join", id)}`, deps.webOrigin).href;

/** Sends the invitation email without waiting on delivery; a failure is logged, never shown. */
export async function sendInvitationEmail(
  deps: TeamDeps,
  input: { id: string; email: string; inviterName: string; spaceName: string; spaceId?: string },
): Promise<boolean> {
  const email = deps.email;
  if (!email) return false;
  const mail =
    input.spaceId && deps.mailBrand
      ? await deps.mailBrand(input.spaceId).catch(() => undefined)
      : undefined;
  const link = new URL(invitationEmailUrl(deps, input.id));
  if (mail) {
    const origin = new URL(mail.origin);
    link.protocol = origin.protocol;
    link.host = origin.host;
  }
  const message = await invitationEmail(
    mail?.origin ?? deps.webOrigin,
    {
      to: input.email,
      inviterName: input.inviterName,
      spaceName: input.spaceName,
      url: link.href,
    },
    mail?.brand,
  );
  if (mail?.from) message.from = mail.from;
  void email.send(message).catch((error) => getLogger().error("invitation email failed", error));
  return true;
}

/** Keeps billed seats in step with who belongs; best effort, and nothing where billing is off. */
export function syncSeats(deps: TeamDeps, organizationId: string): void {
  void deps.billing
    ?.syncSeats(organizationId)
    .catch((error) => getLogger().error("seat sync after membership change failed", error));
}

/** Counts hits per key in a sliding window; for the few public endpoints that take a link. */
export class HitLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** True when this hit is within the limit. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) {
      for (const [stale, times] of this.hits) {
        if (times.every((at) => now - at >= this.windowMs)) this.hits.delete(stale);
      }
    }
    return true;
  }
}
