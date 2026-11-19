import { describe, expect, it, vi } from "vitest";
import {
  createDeps,
  createFakeStore,
  customerRow,
  partnerRecord,
} from "./fake-store.test-support.js";
import {
  clearPartnerTestData,
  getIntegration,
  listCustomers,
  rotateIntegrationKey,
  rotateIntegrationTestKey,
  setIntegrationTestWebhook,
} from "./service.js";
import { PartnerConsoleError } from "./types.js";

const ORG_A = { organizationId: "org-a", actorUserId: "user-a" };
const ORG_B = { organizationId: "org-b", actorUserId: "user-b" };

function world() {
  const fake = createFakeStore({
    members: { pa1: ["org-a"], pb: ["org-b"] },
    partners: [partnerRecord("pa1"), partnerRecord("pb")],
    customers: { pa1: [customerRow("live1", { name: "Live Clinic" })], pb: [] },
    testCustomers: {
      pa1: [
        customerRow("t1", { name: "Try One", test: true }),
        customerRow("t2", { name: "Try Two", test: true }),
      ],
    },
  });
  return { fake, deps: createDeps(fake.store) };
}

describe("partner console test mode", () => {
  it("lists live customers by default and test customers on their own", async () => {
    const { deps } = world();
    const live = await listCustomers(deps, ORG_A, { partnerId: "pa1" });
    expect(live.items.map((item) => item.name)).toEqual(["Live Clinic"]);
    expect(live.items.some((item) => item.test)).toBe(false);
    const test = await listCustomers(deps, ORG_A, { partnerId: "pa1", mode: "test" });
    expect(test.items.map((item) => item.name).sort()).toEqual(["Try One", "Try Two"]);
    expect(test.items.every((item) => item.test === true)).toBe(true);
  });

  it("makes the test key apart from the live key and shows only its start", async () => {
    const { deps, fake } = world();
    expect((await getIntegration(deps, ORG_A, { partnerId: "pa1" })).testKey).toEqual({
      prefix: null,
      customers: 2,
    });
    const issued = await rotateIntegrationTestKey(deps, ORG_A, { partnerId: "pa1" });
    expect(issued.key.startsWith("cpk_test_")).toBe(true);
    const after = await getIntegration(deps, ORG_A, { partnerId: "pa1" });
    expect(after.testKey.prefix).toBe(issued.prefix);
    // The live key is untouched, and the audit trail names the test key apart.
    expect(after.keys[0]?.prefix).toBe("cpk_pa1");
    expect(fake.audit.at(-1)).toMatchObject({ kind: "test_key.rotated" });
    const live = await rotateIntegrationKey(deps, ORG_A, { partnerId: "pa1" });
    expect(live.key.startsWith("cpk_test_")).toBe(false);
  });

  it("keeps the test webhook apart from the live one and only takes https", async () => {
    const { deps } = world();
    await setIntegrationTestWebhook(deps, ORG_A, {
      partnerId: "pa1",
      url: "https://hooks.example.test/test",
    });
    const data = await getIntegration(deps, ORG_A, { partnerId: "pa1" });
    expect(data.testWebhook.url).toBe("https://hooks.example.test/test");
    expect(data.webhook.url).toBeNull();
    await expect(
      setIntegrationTestWebhook(deps, ORG_A, { partnerId: "pa1", url: "http://insecure.test" }),
    ).rejects.toBeInstanceOf(PartnerConsoleError);
  });

  it("wipes the test customers through their owners and leaves live customers alone", async () => {
    const { deps, fake } = world();
    const deleted: string[] = [];
    const withWipe = {
      ...deps,
      deleteTenantContent: vi.fn(async (owner: string) => {
        deleted.push(owner);
      }),
    };
    await expect(clearPartnerTestData(withWipe, ORG_A, { partnerId: "pa1" })).resolves.toEqual({
      removed: 2,
    });
    expect(deleted.sort()).toEqual(["owner-of-t1", "owner-of-t2"]);
    expect((await listCustomers(deps, ORG_A, { partnerId: "pa1", mode: "test" })).items).toEqual(
      [],
    );
    expect((await listCustomers(deps, ORG_A, { partnerId: "pa1" })).items).toHaveLength(1);
    expect(fake.audit.at(-1)).toMatchObject({ kind: "test_data.cleared", detail: { removed: 2 } });
  });

  it("keeps what could not be deleted and says so, so clearing again resumes", async () => {
    const { deps } = world();
    const flaky = {
      ...deps,
      deleteTenantContent: vi.fn(async (owner: string) => {
        if (owner === "owner-of-t2") throw new Error("sandbox unreachable");
      }),
    };
    await expect(clearPartnerTestData(flaky, ORG_A, { partnerId: "pa1" })).rejects.toMatchObject({
      code: "conflict",
    });
    const left = await listCustomers(deps, ORG_A, { partnerId: "pa1", mode: "test" });
    expect(left.items.map((item) => item.name)).toEqual(["Try Two"]);
  });

  it("only works on a partner the caller's organization manages", async () => {
    const { deps } = world();
    await expect(clearPartnerTestData(deps, ORG_B, { partnerId: "pa1" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(rotateIntegrationTestKey(deps, ORG_B, { partnerId: "pa1" })).rejects.toMatchObject(
      { code: "not_found" },
    );
  });
});
