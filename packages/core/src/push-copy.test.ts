import { expect, it } from "vitest";
import { localizedApprovalPush } from "./push-copy.js";

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
