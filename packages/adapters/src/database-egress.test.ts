import { describe, expect, it } from "vitest";
import { databaseConfigFromInput, validateDatabaseConfig } from "./database-connection-config.js";
import { resolveDatabaseAddress } from "./database-egress.js";

const resolveTo =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

describe("resolveDatabaseAddress", () => {
  it("returns the address a public host resolves to", async () => {
    await expect(
      resolveDatabaseAddress("db.example.test", {
        allowPrivate: false,
        resolveHostname: resolveTo("203.0.113.7"),
      }),
    ).resolves.toBe("203.0.113.7");
  });

  it.each([
    ["10.0.0.5"],
    ["192.168.1.10"],
    ["172.16.4.4"],
    ["127.0.0.1"],
    ["169.254.169.254"],
    ["::1"],
    ["fe80::1"],
    ["fd00::1"],
  ])("refuses a literal private or link-local address %s by default", async (address) => {
    await expect(
      resolveDatabaseAddress(address, { allowPrivate: false, resolveHostname: resolveTo() }),
    ).rejects.toThrow();
  });

  it("refuses a name that resolves to a private address, and one that mixes", async () => {
    for (const answers of [["10.1.2.3"], ["203.0.113.7", "10.1.2.3"]]) {
      await expect(
        resolveDatabaseAddress("db.example.test", {
          allowPrivate: false,
          resolveHostname: resolveTo(...answers),
        }),
      ).rejects.toThrow(/private/);
    }
  });

  it("refuses localhost and internal names", async () => {
    await expect(
      resolveDatabaseAddress("localhost", {
        allowPrivate: false,
        resolveHostname: resolveTo("127.0.0.1"),
      }),
    ).rejects.toThrow();
  });

  it("lets a deployment that opted in reach private addresses", async () => {
    await expect(
      resolveDatabaseAddress("db.internal.test", {
        allowPrivate: true,
        resolveHostname: resolveTo("10.1.2.3"),
      }),
    ).resolves.toBe("10.1.2.3");
    await expect(
      resolveDatabaseAddress("127.0.0.1", { allowPrivate: true, resolveHostname: resolveTo() }),
    ).resolves.toBe("127.0.0.1");
  });

  it("never reaches cloud metadata, even where private networks are allowed", async () => {
    await expect(
      resolveDatabaseAddress("169.254.169.254", { allowPrivate: true }),
    ).rejects.toThrow();
    await expect(
      resolveDatabaseAddress("metadata.example.test", {
        allowPrivate: true,
        resolveHostname: resolveTo("169.254.169.254"),
      }),
    ).rejects.toThrow();
  });

  it("fails when the host does not resolve", async () => {
    await expect(
      resolveDatabaseAddress("nowhere.example.test", {
        allowPrivate: false,
        resolveHostname: resolveTo(),
      }),
    ).rejects.toThrow(/resolve/);
  });
});

describe("databaseConfigFromInput", () => {
  it("reads a connection string, decoding the password", () => {
    expect(
      databaseConfigFromInput({
        name: "Main",
        connectionString:
          "postgres://report:p%40ss%2Fword@db.example.test:6543/sales?sslmode=verify-full",
      }),
    ).toEqual({
      host: "db.example.test",
      port: 6543,
      database: "sales",
      user: "report",
      password: "p@ss/word",
      sslMode: "verify-full",
    });
  });

  it("takes the parts, defaulting to port 5432 and encrypted connections", () => {
    expect(
      databaseConfigFromInput({ name: "Main", host: "h", database: "d", user: "u", password: "p" }),
    ).toMatchObject({ port: 5432, sslMode: "require" });
  });

  it("rejects other schemes and unknown ssl modes", () => {
    expect(() =>
      databaseConfigFromInput({ name: "x", connectionString: "mysql://u:p@h/d" }),
    ).toThrow();
    expect(() =>
      databaseConfigFromInput({ name: "x", connectionString: "postgres://u:p@h/d?sslmode=bogus" }),
    ).toThrow();
  });

  it("validates what is required", () => {
    expect(
      validateDatabaseConfig({
        host: "",
        port: 5432,
        database: "d",
        user: "u",
        password: "",
        sslMode: "require",
      }),
    ).toBeDefined();
    expect(
      validateDatabaseConfig({
        host: "h",
        port: 5432,
        database: "d",
        user: "u",
        password: "",
        sslMode: "require",
      }),
    ).toBeUndefined();
  });
});
