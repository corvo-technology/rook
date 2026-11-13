import { createHmac, timingSafeEqual } from "node:crypto";
import type { TransactionalEmailProvider } from "@corvo/adapter-kit";
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
}

type TokenKind = "invite" | "join";

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

export const joinUrl = (deps: TeamDeps, id: string): string =>
  new URL(`/join/${teamToken(deps.secret, "join", id)}`, deps.webOrigin).href;

/** Sends the invitation email without waiting on delivery; a failure is logged, never shown. */
export async function sendInvitationEmail(
  deps: TeamDeps,
  input: { id: string; email: string; inviterName: string; spaceName: string },
): Promise<boolean> {
  const email = deps.email;
  if (!email) return false;
  const message = await invitationEmail(deps.webOrigin, {
    to: input.email,
    inviterName: input.inviterName,
    spaceName: input.spaceName,
    url: invitationUrl(deps, input.id),
  });
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
