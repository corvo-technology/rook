import { RUN_ERROR_CODES } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import {
  localizedApprovalPush,
  localizedFailureLine,
  localizedFailurePush,
  localizedStoragePush,
} from "./push-copy.js";

const approval = {
  kind: "help",
  title: "Ana needs approval",
  body: "Review before writing a file",
};

it("says an approval push in the person's language", () => {
  expect(localizedApprovalPush(approval, "pt-BR")).toEqual({
    kind: "help",
    title: "Ana precisa de aprovação",
    body: "Confirme antes: writing a file",
  });
});

it("reads a raw tool name as words", () => {
  expect(
    localizedApprovalPush({ ...approval, body: "Review before CANVA_CREATE_DESIGN" }, "es").body,
  ).toBe("Revisa antes: Canva create design");
});

it("leaves English, unknown languages and other pushes alone", () => {
  expect(localizedApprovalPush(approval, "en")).toBe(approval);
  expect(localizedApprovalPush(approval, undefined)).toBe(approval);
  const other = { title: "Ana needs an answer", body: "Which plan?" };
  expect(localizedApprovalPush(other, "pt-BR")).toBe(other);
});

const failure = {
  kind: "failure",
  title: "Ana failed",
  body: "Couldn't start the agent's computer.\nThe computer's storage is full.",
  errorInfo: { code: "computer_storage_full" as const },
};

it("says a failed run's push in the person's language from its code", () => {
  expect(localizedFailurePush(failure, "pt-BR")).toMatchObject({
    title: "Ana falhou",
    body: "O computador está sem espaço.",
  });
});

it("words every code in every translated language", () => {
  for (const locale of ["pt-BR", "es", "de", "fr", "ja", "zh-CN"]) {
    for (const code of RUN_ERROR_CODES) {
      const pushed = localizedFailurePush({ ...failure, errorInfo: { code } }, locale);
      expect(pushed.body).not.toBe(failure.body);
      expect(pushed.body.length).toBeGreaterThan(0);
    }
  }
});

it("leaves a failure without a code, English and other pushes alone", () => {
  expect(localizedFailurePush(failure, "en")).toBe(failure);
  const old = { title: "Ana failed", body: "boom" };
  expect(localizedFailurePush(old, "pt-BR")).toBe(old);
  const other = { ...failure, title: "Ana needs an answer" };
  expect(localizedFailurePush(other, "pt-BR")).toBe(other);
});

describe("localizedFailureLine", () => {
  it("returns the billing line in the person's language and nothing for English", () => {
    expect(localizedFailureLine("no_model_access", "pt-BR")).toBe(
      "Conecte um modelo para continuar.",
    );
    expect(localizedFailureLine("no_model_access", "en")).toBeUndefined();
    expect(localizedFailureLine("no_model_access", undefined)).toBeUndefined();
  });
});

it("says a computer's disk push in the person's language", () => {
  const full = {
    kind: "help",
    title: "Ana's computer is full",
    body: "This agent's computer is full.",
    storage: "full" as const,
  };
  expect(localizedStoragePush(full, "pt-BR")).toMatchObject({
    title: "O computador de Ana",
    body: "O computador está cheio.",
  });
  expect(localizedStoragePush({ ...full, storage: "low" }, "pt-BR").body).toBe(
    "O computador está quase cheio.",
  );
  for (const locale of ["es", "de", "fr", "ja", "zh-CN"]) {
    expect(localizedStoragePush(full, locale).body).not.toBe(full.body);
    expect(localizedStoragePush({ ...full, storage: "low" }, locale).title).toContain("Ana");
  }
  expect(localizedStoragePush(full, "en")).toBe(full);
  const other = { title: "Ana needs an answer", body: "x" };
  expect(localizedStoragePush(other, "pt-BR")).toBe(other);
});
