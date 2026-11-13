import { acceptInvitation, previewInvitation, requestToJoin, runAsSystem } from "@corvo/db";
import type { Hono } from "hono";
import { requestClientIp } from "./client-ip.js";
import type { TeamDeps } from "./team.js";
import { HitLimiter, readTeamToken, syncSeats } from "./team.js";

export interface TeamSession {
  id: string;
  email: string;
  emailVerified: boolean;
}

const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

/**
 * The link-driven steps of joining a space. A person with no space yet has no actor, so these
 * answer to the signed-in account instead. Every refusal looks the same, so a link reveals
 * nothing about who belongs, who was denied or which links exist.
 */
export function mountTeamRoutes(
  app: Hono,
  deps: TeamDeps & {
    session(request: Request): Promise<TeamSession | null>;
    /** True where no mail can be sent, so addresses cannot be confirmed. */
    trustUnverified: boolean;
  },
): void {
  const byAddress = new HitLimiter(60, 60_000);
  const byPerson = new HitLimiter(20, 60 * 60_000);

  app.get("/api/v1/invitations/:token", async (c) => {
    if (!byAddress.allow(`preview:${requestClientIp(c) ?? "unknown"}`))
      return c.json({ error: "Too many requests" }, 429, NO_STORE);
    const id = readTeamToken(deps.secret, "invite", c.req.param("token"));
    const preview = id
      ? await runAsSystem("preview an invitation", () => previewInvitation(deps.prisma, id))
      : null;
    return preview ? c.json(preview, 200, NO_STORE) : c.json({ error: "Not found" }, 404, NO_STORE);
  });

  app.post("/api/v1/invitations/:token/accept", async (c) => {
    const session = await deps.session(c.req.raw);
    if (!session) return c.json({ error: "Unauthorized" }, 401, NO_STORE);
    if (!byPerson.allow(`accept:${session.id}`))
      return c.json({ error: "Too many requests" }, 429, NO_STORE);
    const id = readTeamToken(deps.secret, "invite", c.req.param("token"));
    const joined = id
      ? await runAsSystem("accept an invitation", () =>
          acceptInvitation(deps.prisma, {
            id,
            user: session,
            trustUnverified: deps.trustUnverified,
          }),
        )
      : null;
    if (!joined) return c.json({ error: "Not found" }, 404, NO_STORE);
    syncSeats(deps, joined.organizationId);
    return c.json({ spaceId: joined.spaceId }, 200, NO_STORE);
  });

  app.post("/api/v1/join/:token", async (c) => {
    const session = await deps.session(c.req.raw);
    if (!session) return c.json({ error: "Unauthorized" }, 401, NO_STORE);
    if (!byPerson.allow(`join:${session.id}`))
      return c.json({ error: "Too many requests" }, 429, NO_STORE);
    const linkId = readTeamToken(deps.secret, "join", c.req.param("token"));
    const outcome = linkId
      ? await runAsSystem("ask to join a space", () =>
          requestToJoin(deps.prisma, { linkId, userId: session.id }),
        )
      : "requested";
    return c.json({ status: outcome }, 200, NO_STORE);
  });
}
