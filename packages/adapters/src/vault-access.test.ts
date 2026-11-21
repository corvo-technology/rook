import { describe, expect, it, vi } from "vitest";
import {
  findVaultCredential,
  forgetBotSecret,
  listBotSecrets,
  loadBotCommandEnvironment,
  requestWithBotSecret,
  resolveLoginFill,
  storeBotSecret,
} from "./bot-secrets.js";
import { fakeDatabase } from "./bot-secrets.test-support.js";
import { EncryptedSecretStore } from "./secrets.js";

// Offline: an in-memory stand-in for the credential tables. Encryption, validation, redaction and
// the access rules are the real implementations.
const secretStore = new EncryptedSecretStore("test-only-encryption-key");
const owner = { userId: "user-1", spaceId: "space-1", botId: "bot-1" };
const publicResolver = async () => [{ address: "203.0.113.10", family: 4 as const }];
const VALUE = "fake-vault-value-SENTINEL-1";
const api = {
  name: "example_api",
  origin: "https://api.example.test",
  auth: { type: "bearer" },
} as const;

async function save(
  db: ReturnType<typeof fakeDatabase>,
  visibility: "personal" | "space",
  destination: { name: string; origin: string; auth: { type: "bearer" } | { type: "command" } },
  scope = owner,
) {
  await storeBotSecret({
    prisma: db.prisma,
    secretStore,
    scope,
    destination,
    plaintext: VALUE,
    visibility,
  });
}

function request(db: ReturnType<typeof fakeDatabase>, scope: typeof owner & { runId?: string }) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true }));
  return {
    fetch,
    send: () =>
      requestWithBotSecret({
        prisma: db.prisma,
        secretStore,
        scope,
        request: { name: "example_api", url: "https://api.example.test/v1/items" },
        signal: new AbortController().signal,
        remote: { fetch, resolveHostname: publicResolver },
      }),
  };
}

describe("who may use a credential", () => {
  it("keeps a personal credential to runs for its owner", async () => {
    const db = fakeDatabase();
    await save(db, "personal", api);
    const own = request(db, owner);
    expect(await own.send()).toMatchObject({ status: 200 });

    const other = request(db, { ...owner, userId: "user-2" });
    expect(await other.send()).toEqual({
      error: "Credential is unavailable. Use request_secret to save it first.",
    });
    expect(other.fetch).not.toHaveBeenCalled();
    expect(await listBotSecrets(db.prisma, { ...owner, userId: "user-2" })).toEqual([]);
  });

  it("keeps a personal command variable out of another person's shell", async () => {
    const db = fakeDatabase();
    await save(db, "personal", { name: "cli-token", origin: "", auth: { type: "command" } });
    expect(await loadBotCommandEnvironment(db.prisma, secretStore, owner)).toEqual({
      CLI_TOKEN: VALUE,
    });
    expect(
      await loadBotCommandEnvironment(db.prisma, secretStore, { ...owner, userId: "user-2" }),
    ).toEqual({});
  });

  it("gives a team credential only to the agents granted it, for any member", async () => {
    const db = fakeDatabase();
    await save(db, "space", api);
    // Another agent is not granted it, whoever runs it.
    const ungranted = request(db, { ...owner, botId: "bot-2", userId: "user-2" });
    expect(await ungranted.send()).toMatchObject({ error: expect.stringContaining("unavailable") });
    expect(ungranted.fetch).not.toHaveBeenCalled();

    db.rows()[0]!.grants = [{ botId: "bot-2" }];
    const granted = request(db, { ...owner, botId: "bot-2", userId: "user-2" });
    expect(await granted.send()).toMatchObject({ status: 200 });
    // The agent it was first saved for still has it, for a member who did not save it.
    expect(await request(db, { ...owner, userId: "user-3" }).send()).toMatchObject({ status: 200 });
  });

  it("takes only this agent's access away, so a shared credential stays for the others", async () => {
    const db = fakeDatabase();
    await save(db, "space", api);
    db.rows()[0]!.grants = [{ botId: "bot-2" }];
    await forgetBotSecret(db.prisma, owner, "example_api");
    expect(db.rows()).toHaveLength(1);
    expect(db.rows()[0]!.botId).toBeNull();
    expect(await request(db, { ...owner, botId: "bot-2", userId: "user-2" }).send()).toMatchObject({
      status: 200,
    });
    expect(await request(db, owner).send()).toMatchObject({ error: expect.any(String) });

    await forgetBotSecret(db.prisma, { ...owner, botId: "bot-2" }, "example_api");
    expect(db.rows()).toEqual([]);
  });

  it("refuses a website login to a run for someone else", async () => {
    const db = fakeDatabase();
    await storeBotSecret({
      prisma: db.prisma,
      secretStore,
      scope: owner,
      destination: { name: "site", origin: "https://login.example.test", auth: { type: "login" } },
      plaintext: JSON.stringify({ username: "person@example.test", password: VALUE }),
    });
    const fill = (userId: string) =>
      resolveLoginFill({
        prisma: db.prisma,
        secretStore,
        scope: { ...owner, userId },
        name: "site",
        field: "password",
      });
    expect(await fill("user-1")).toMatchObject({ text: VALUE });
    expect(await fill("user-2")).toEqual({
      error: "Login is unavailable. Use request_secret to save it first.",
    });
  });
});

describe("offering a credential already in the Vault", () => {
  it("finds the person's credential for an agent that may not use it yet", async () => {
    const db = fakeDatabase();
    await save(db, "personal", api);
    const other = { ...owner, botId: "bot-2" };
    expect(await findVaultCredential(db.prisma, other, "example_api")).toMatchObject({
      usable: false,
      destination: api,
    });
    expect(await findVaultCredential(db.prisma, owner, "example_api")).toMatchObject({
      usable: true,
    });
    db.rows()[0]!.grants = [{ botId: "bot-2" }];
    expect(await findVaultCredential(db.prisma, other, "example_api")).toMatchObject({
      usable: true,
    });
  });

  it("does not offer a personal credential of someone else", async () => {
    const db = fakeDatabase();
    await save(db, "personal", api);
    expect(
      await findVaultCredential(
        db.prisma,
        { ...owner, userId: "user-2", botId: "bot-2" },
        "example_api",
      ),
    ).toBeNull();
    await save(db, "space", { ...api, name: "team_api" });
    expect(
      await findVaultCredential(
        db.prisma,
        { ...owner, userId: "user-2", botId: "bot-2" },
        "team_api",
      ),
    ).toMatchObject({ usable: false, scope: "space" });
  });
});

describe("the usage log", () => {
  it("records the agent, run, person, destination and outcome, never the value", async () => {
    const db = fakeDatabase();
    await save(db, "personal", api);
    const create = db.prisma.botSecretUse.create as unknown as ReturnType<typeof vi.fn>;
    await request(db, { ...owner, runId: "run-1" }).send();
    expect(create).toHaveBeenCalledOnce();
    const { data } = create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({
      spaceId: "space-1",
      name: "example_api",
      botId: "bot-1",
      runId: "run-1",
      forUserId: "user-1",
      destination: "https://api.example.test",
      outcome: "ok",
    });
    expect(JSON.stringify(data)).not.toContain(VALUE);
    expect(Object.keys(data).sort()).toEqual(
      [
        "botId",
        "destination",
        "forUserId",
        "id",
        "name",
        "outcome",
        "runId",
        "secretId",
        "spaceId",
      ].sort(),
    );
  });

  it("records a failed request as failed, and nothing for a refused one", async () => {
    const db = fakeDatabase();
    await save(db, "personal", api);
    const create = db.prisma.botSecretUse.create as unknown as ReturnType<typeof vi.fn>;
    await request(db, { ...owner, userId: "user-2" }).send();
    expect(create).not.toHaveBeenCalled();

    const failing = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error(`connection refused for ${VALUE}`);
    });
    const result = await requestWithBotSecret({
      prisma: db.prisma,
      secretStore,
      scope: owner,
      request: { name: "example_api", url: "https://api.example.test/v1/items" },
      signal: new AbortController().signal,
      remote: { fetch: failing, resolveHostname: publicResolver },
    });
    expect(JSON.stringify(result)).not.toContain(VALUE);
    expect((create.mock.calls[0]![0] as { data: { outcome: string } }).data.outcome).toBe("failed");
  });

  it("does not let a log failure break the request", async () => {
    const db = fakeDatabase();
    await save(db, "personal", api);
    (db.prisma.botSecretUse.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    expect(await request(db, owner).send()).toMatchObject({ status: 200 });
  });
});

describe("a stored value never leaves the backend", () => {
  it("is absent from everything a tool or a listing returns", async () => {
    const db = fakeDatabase();
    await save(db, "personal", api);
    const listed = await listBotSecrets(db.prisma, owner);
    expect(JSON.stringify(listed)).not.toContain(VALUE);
    expect(db.rows()[0]!.ciphertext).not.toContain(VALUE);
  });
});
