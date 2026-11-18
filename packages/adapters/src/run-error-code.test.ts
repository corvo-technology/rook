import {
  ModelAccountError,
  ModelOutputError,
  SandboxDamagedError,
  SandboxRateLimitError,
  SandboxStorageFullError,
  SandboxUnavailableError,
  TransientModelError,
} from "@corvo/adapter-kit";
import { PLAN_ERROR_CODES, RUN_ERROR_CODES, RUN_STOP_REASONS } from "@corvo/contracts";
import {
  ACCOUNT_PAUSED_RUN_ERROR,
  BOT_DAILY_LIMIT_RUN_ERROR,
  BOT_MONTHLY_LIMIT_RUN_ERROR,
  BOT_REPLY_CAP_RUN_ERROR,
  MEMBER_MONTHLY_LIMIT_RUN_ERROR,
  MISSING_MODEL_RUN_ERROR,
  MODEL_ACCESS_REQUIRED_RUN_ERROR,
  PARTNER_CREDIT_USED_UP_RUN_ERROR,
  PARTNER_MODEL_NOT_ALLOWED_RUN_ERROR,
  SPACE_PAUSED_RUN_ERROR,
} from "@corvo/core";
import { describe, expect, it } from "vitest";
import { markComputerSetupFailure } from "./computer-setup-error.js";
import { classifyRunError } from "./run-error-code.js";

const classify = (error: Error, context = {}) => classifyRunError(error, error.message, context);

describe("classifyRunError", () => {
  it("maps a full computer with its agent, disk use and largest directories", () => {
    const error = new SandboxStorageFullError({
      usage: ".codex 475 MB, .browser-profiles 340 MB",
      disk: { usedBytes: 9.8 * 1024 ** 3, totalBytes: 10 * 1024 ** 3 },
    });
    expect(classify(error, { botName: "QA" })).toEqual({
      code: "computer_storage_full",
      params: {
        agent: "QA",
        top: ".codex 475 MB, .browser-profiles 340 MB",
        usedMb: "10035",
        totalMb: "10240",
      },
    });
  });

  it("keeps a full computer that failed its start a full computer, not a start failure", () => {
    const error = markComputerSetupFailure(new SandboxStorageFullError());
    expect(classify(error).code).toBe("computer_storage_full");
  });

  it("recognizes a full disk in the system's own words", () => {
    expect(classify(new Error("write failed: No space left on device")).code).toBe(
      "computer_storage_full",
    );
  });

  it.each([
    ["a computer that could not start", markComputerSetupFailure(new Error("boom"))],
    ["the computer provider's rate limit", new SandboxRateLimitError()],
    ["a computer that did not come up", new SandboxUnavailableError()],
  ])("maps %s to computer_start_failed", (_, error) => {
    expect(classify(error, { botName: "QA" })).toEqual({
      code: "computer_start_failed",
      params: { agent: "QA" },
    });
  });

  it("marks a damaged computer", () => {
    expect(classify(new SandboxDamagedError()).params?.damaged).toBe("1");
  });

  it.each([
    [BOT_MONTHLY_LIMIT_RUN_ERROR, "monthly_limit", "bot"],
    [MEMBER_MONTHLY_LIMIT_RUN_ERROR, "monthly_limit", "member"],
    [BOT_DAILY_LIMIT_RUN_ERROR, "daily_credit_limit", "bot"],
    [PARTNER_CREDIT_USED_UP_RUN_ERROR, "daily_credit_limit", "credit"],
    [ACCOUNT_PAUSED_RUN_ERROR, "paused", "account"],
    [SPACE_PAUSED_RUN_ERROR, "paused", "space"],
  ])("maps the app's run error %s", (message, code, scope) => {
    expect(classifyRunError(new Error(message), message)).toEqual({ code, params: { scope } });
  });

  it("maps a model the partner did not allow to its own code", () => {
    expect(
      classifyRunError(
        new Error(PARTNER_MODEL_NOT_ALLOWED_RUN_ERROR),
        PARTNER_MODEL_NOT_ALLOWED_RUN_ERROR,
      ),
    ).toEqual({ code: "model_not_allowed" });
  });

  it.each([MODEL_ACCESS_REQUIRED_RUN_ERROR, MISSING_MODEL_RUN_ERROR])(
    "maps %s to no_model_access",
    (message) => {
      expect(classifyRunError(new Error(message), message).code).toBe("no_model_access");
    },
  );

  it("maps the reply cap by its message and by its stop reason", () => {
    expect(classifyRunError(new Error(BOT_REPLY_CAP_RUN_ERROR), BOT_REPLY_CAP_RUN_ERROR)).toEqual({
      code: "reply_cap",
    });
    expect(classifyRunError(new Error("x"), "x", { stopReason: "reply_cap" }).code).toBe(
      "reply_cap",
    );
  });

  it("maps every other stop reason to a code", () => {
    for (const stopReason of RUN_STOP_REASONS) {
      const info = classifyRunError(new Error("x"), "x", { stopReason });
      expect(RUN_ERROR_CODES).toContain(info.code);
      expect(info.code).not.toBe("unknown");
    }
    expect(classifyRunError(new Error("x"), "x", { stopReason: "loop" })).toEqual({
      code: "turn_stopped",
      params: { kind: "loop" },
    });
  });

  it.each([
    [PLAN_ERROR_CODES.storageFull, "plan_storage_full"],
    [PLAN_ERROR_CODES.computerLimit, "plan_computer_limit"],
  ])("maps the plan error %s", (planCode, code) => {
    const error = Object.assign(new Error("over the plan"), { code: planCode });
    expect(classify(error).code).toBe(code);
  });

  it("maps a rate limited model with its provider and model", () => {
    const message = '429: {"error":{"message":"Too many requests"}}';
    expect(
      classifyRunError(new TransientModelError(message), message, {
        provider: "openai",
        model: "gpt-x",
      }),
    ).toEqual({ code: "model_rate_limited", params: { provider: "openai", model: "gpt-x" } });
  });

  it("maps a provider timeout", () => {
    const message = "Request timed out";
    expect(classifyRunError(new TransientModelError(message), message).code).toBe("timeout");
  });

  it("maps a refused model account with a short sanitized reason", () => {
    const message = `401: {"error":{"type":"authentication_error","message":"Bearer sk-live-1234567890abcdef invalid"}}`;
    const info = classifyRunError(new ModelAccountError(message), message, {
      provider: "anthropic",
      model: "claude-x",
    });
    expect(info.code).toBe("model_provider_error");
    expect(info.params).toMatchObject({ provider: "anthropic", model: "claude-x", kind: "auth" });
    expect(info.params?.reason).not.toContain("sk-live-1234567890abcdef");
    expect(info.params?.reason?.length).toBeLessThanOrEqual(161);
  });

  it("maps unusable model output to a provider error", () => {
    expect(classify(new ModelOutputError("The model returned an unusable response.")).code).toBe(
      "model_provider_error",
    );
  });

  it("falls back to unknown", () => {
    expect(classify(new Error("something odd")).code).toBe("unknown");
  });
});
