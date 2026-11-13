import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  previewInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
  requestToJoin: vi.fn(),
}));
vi.mock("@corvo/db", () => ({
  ...db,
  runAsSystem: (_reason: string, fn: () => unknown) => fn(),
}));

import { teamToken } from "./team.js";
import { mountTeamRoutes } from "./team-routes.js";

const secret = "test-secret";
const person = { id: "u1", email: "ana@example.test", emailVerified: true };

function app(session: typeof person | null = person) {
  const hono = new Hono();
  mountTeamRoutes(hono, {
    prisma: {} as never,
    secret,
    webOrigin: "https://rook.example.test",
    session: async () => session,
    trustUnverified: false,
  });
  return hono;
}

beforeEach(() => vi.resetAllMocks());

describe("invitation routes", () => {
  it("previews with a signed link and answers the same 404 to a forged one", async () => {
    db.previewInvitation.mockResolvedValue({
      spaceName: "Team",
      inviterName: "Bia",
      email: person.email,
    });
    const ok = await app().request(`/api/v1/invitations/${teamToken(secret, "invite", "inv-1")}`);
    expect(ok.status).toBe(200);
    expect(db.previewInvitation).toHaveBeenCalledWith(expect.anything(), "inv-1");
    const forged = await app().request(
      "/api/v1/invitations/inv-1.forgedforgedforgedforgedforgedaa",
    );
    expect(forged.status).toBe(404);
    expect(db.previewInvitation).toHaveBeenCalledTimes(1);
  });

  it("accepts for the signed-in account and refuses without a session", async () => {
    db.acceptInvitation.mockResolvedValue({ spaceId: "space-1", organizationId: "org-1" });
    const token = teamToken(secret, "invite", "inv-1");
    const joined = await app().request(`/api/v1/invitations/${token}/accept`, { method: "POST" });
    expect(await joined.json()).toEqual({ spaceId: "space-1" });
    expect(db.acceptInvitation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "inv-1", user: person }),
    );
    const anonymous = await app(null).request(`/api/v1/invitations/${token}/accept`, {
      method: "POST",
    });
    expect(anonymous.status).toBe(401);
  });

  it("does not say why an acceptance failed", async () => {
    db.acceptInvitation.mockResolvedValue(null);
    const token = teamToken(secret, "invite", "inv-1");
    const response = await app().request(`/api/v1/invitations/${token}/accept`, { method: "POST" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});

describe("join link route", () => {
  it("answers requested for a forged link without touching the database", async () => {
    const response = await app().request("/api/v1/join/x.forgedforgedforgedforgedforgedaa", {
      method: "POST",
    });
    expect(await response.json()).toEqual({ status: "requested" });
    expect(db.requestToJoin).not.toHaveBeenCalled();
  });

  it("asks to join with a real link, and limits how often one person may ask", async () => {
    db.requestToJoin.mockResolvedValue("requested");
    const hono = app();
    const token = teamToken(secret, "join", "link-1");
    let last = 200;
    for (let i = 0; i < 21; i++) {
      last = (await hono.request(`/api/v1/join/${token}`, { method: "POST" })).status;
    }
    expect(db.requestToJoin).toHaveBeenCalledTimes(20);
    expect(last).toBe(429);
  });
});
