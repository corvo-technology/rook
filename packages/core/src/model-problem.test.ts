import { describe, expect, it } from "vitest";
import { describeModelProblem, modelFailureData, modelProblemFromError } from "./model-problem.js";

const NOW = Date.parse("2026-01-10T00:00:00Z");
const PROXY =
  "Your model provider couldn't be reached through the network proxy. Check the proxy settings.";

describe("describeModelProblem", () => {
  it("classifies from the transport code first", () => {
    const details = "fetch failed (api.example.test): self signed certificate";
    expect(describeModelProblem({ details, code: "SELF_SIGNED_CERT_IN_CHAIN" }).kind).toBe("tls");
    expect(describeModelProblem({ details, code: "ECONNREFUSED" }).kind).toBe("unreachable");
    expect(describeModelProblem({ details, code: "ETIMEDOUT" }).kind).toBe("timeout");
  });

  it("names a proxy refusal without an action", () => {
    const problem = describeModelProblem({ details: "Proxy Authentication Required", status: 407 });
    expect(problem.kind).toBe("proxy");
    expect(problem.line).toBe(PROXY);
    expect(problem.action).toBeUndefined();
    expect(problem.retry).toBe(true);
  });

  it("asks for a new key, or a new sign-in on an OAuth connection", () => {
    const details = '{"error":{"type":"authentication_error","message":"invalid x-api-key"}}';
    const key = describeModelProblem({ details, status: 401 });
    expect(key.kind).toBe("auth");
    expect(key.action).toBe("replace-key");
    const oauth = describeModelProblem({ details, status: 401 }, { authKind: "oauth" });
    expect(oauth.action).toBe("sign-in");
    expect(oauth.line).toBe("Your model provider sign-in is no longer valid.");
  });

  it("passes a key limit and its reset date through", () => {
    const problem = describeModelProblem(
      {
        status: 402,
        details: JSON.stringify({
          error: {
            code: 402,
            message: "Key limit exceeded",
            metadata: { limit_source: "key_limit", reset_at: "2026-02-01" },
          },
        }),
      },
      { now: NOW },
    );
    expect(problem.kind).toBe("key");
    expect(problem.action).toBe("connect");
    expect(problem.resetAt).toBe(Date.parse("2026-02-01"));
  });

  it("falls back to one generic line and keeps the raw text", () => {
    const problem = describeModelProblem({ details: "boom", status: 418 });
    expect(problem.kind).toBe("other");
    expect(problem.line).toBe("The model provider returned an error.");
    expect(problem.details).toBe("boom");
  });

  it("does not offer a retry for a context-length failure", () => {
    const problem = describeModelProblem({
      status: 400,
      details: '{"error":{"code":"context_length_exceeded","message":"too long"}}',
    });
    expect(problem.kind).toBe("context");
    expect(problem.retry).toBe(false);
  });

  it("masks secrets in the details", () => {
    const problem = describeModelProblem({
      status: 401,
      details: '{"error":{"message":"Bearer sk-test-0000000000 invalid"}}',
    });
    expect(problem.details).toContain("[redacted]");
    expect(problem.details).not.toContain("sk-test");
  });

  it("omits details that equal the line", () => {
    const line = "The model provider returned an error.";
    expect(describeModelProblem({ details: line }).details).toBeUndefined();
  });
});

describe("modelFailureData", () => {
  it("reads structured data from an RPC error", () => {
    const data = { reason: "model_failure", modelFailure: { details: "x", status: 401 } };
    expect(modelFailureData({ data })).toEqual({ details: "x", status: 401 });
  });

  it("ignores other errors", () => {
    expect(
      modelFailureData({ data: { reason: "other", modelFailure: { details: "x" } } }),
    ).toBeUndefined();
    expect(
      modelFailureData({
        data: { reason: "model_failure", modelFailure: { details: "x", status: "401" } },
      }),
    ).toBeUndefined();
    expect(modelFailureData(null)).toBeUndefined();
  });
});

describe("modelProblemFromError", () => {
  it("says offline when the server cannot be reached", () => {
    const problem = modelProblemFromError(new TypeError("Failed to fetch"), "Could not save model");
    expect(problem.kind).toBe("offline");
    expect(problem.line).toBe("Could not reach the server");
  });

  it("keeps a message written for people", () => {
    expect(modelProblemFromError(new Error("Name is taken"), "Could not save model").line).toBe(
      "Name is taken",
    );
  });
});

describe("budget and pause problems", () => {
  it.each([
    ["This bot reached its monthly token limit.", "raise-limit"],
    ["This reply reached its token cap.", "raise-limit"],
    ["Bots are paused in this space.", "resume"],
  ] as const)("gives %s the %s action and no retry", (details, action) => {
    expect(describeModelProblem({ details })).toMatchObject({ action, retry: false });
  });
});
