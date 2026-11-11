import { ModelRequestError } from "@corvo/adapter-kit";
import { describe, expect, it } from "vitest";
import { modelFailureError } from "./model-failure-error.js";

describe("modelFailureError", () => {
  it("carries the masked facts of a model request error", () => {
    const error = modelFailureError(
      new ModelRequestError("API key was rejected by the provider.", {
        status: 401,
        details: "Bearer sk-test-0000000000",
      }),
      "x",
    );
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toBe("API key was rejected by the provider.");
    expect(error.data).toMatchObject({
      reason: "model_failure",
      modelFailure: { status: 401 },
    });
    const data = error.data as { modelFailure: { details: string } };
    expect(data.modelFailure.details).toContain("[redacted]");
    expect(data.modelFailure.details).not.toContain("sk-test");
  });

  it("keeps a plain error as it was", () => {
    const error = modelFailureError(new Error("Name is taken"), "x");
    expect(error.message).toBe("Name is taken");
    expect(error.data).toBeUndefined();
  });

  it("uses the fallback for a non-error", () => {
    expect(modelFailureError("nope", "Could not list models").message).toBe(
      "Could not list models",
    );
  });
});
