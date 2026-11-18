import type { PrismaClient } from "@corvo/db";
import { describe, expect, it } from "vitest";
import type { ExecutorDeps } from "./executor-deps.js";
import { resolveModelKey } from "./run-model.js";

/**
 * A run on a model the customer owns (its own key) never touches the credit ledger: every table
 * that holds credit throws if it is read or written, and the run resolves its own key with no
 * meter attached.
 */
describe("a customer's own model and the credit ledger", () => {
  const ledgerTouches: string[] = [];
  const ledgerTable = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, method) => async () => {
          ledgerTouches.push(`${name}.${String(method)}`);
          throw new Error("The credit ledger must not be reached");
        },
      },
    );
  const prisma = {
    spaceModelConnection: { findUnique: async () => null },
    secret: {
      findFirst: async () => ({ id: "secret-1", userId: "customer", ciphertext: "sk-own-key" }),
    },
    modelCreditEntry: ledgerTable("modelCreditEntry"),
    modelCreditAccount: ledgerTable("modelCreditAccount"),
    modelCreditLot: ledgerTable("modelCreditLot"),
    $transaction: async () => {
      ledgerTouches.push("$transaction");
      throw new Error("The credit ledger must not be reached");
    },
  } as unknown as PrismaClient;
  const deps = {
    prisma,
    secretStore: { load: async (ciphertext: string) => ciphertext },
    // Credits are on for the deployment: the customer's own key still bypasses them.
    billingEnabled: true,
  } as unknown as ExecutorDeps;

  it("debits zero model credits and blocks nothing", async () => {
    const credential = {
      id: "credential-1",
      secretId: "secret-1",
      provider: "anthropic",
    };
    const resolved = await resolveModelKey(
      deps,
      "customer",
      "space-1",
      credential,
      "anthropic",
      "claude-sonnet-4-5",
    );
    expect(resolved.apiKey).toBe("sk-own-key");
    expect(resolved.callObserver).toBeUndefined();
    expect(ledgerTouches).toEqual([]);
  });
});
