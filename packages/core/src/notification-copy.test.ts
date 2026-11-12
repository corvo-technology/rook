import { describe, expect, it } from "vitest";
import { localizeApprovalNotification } from "./notification-copy.js";

const approval = { title: "Scout needs approval", body: "Review before CANVA_CREATE_DESIGN" };

describe("approval push copy", () => {
  it("speaks the receiving device's language, with the tool named as the card names it", () => {
    expect(localizeApprovalNotification(approval, "pt-BR")).toEqual({
      title: "Scout precisa de aprovação",
      body: "Confirme antes: Canva create design",
    });
    expect(localizeApprovalNotification(approval, "es-419").body).toBe(
      "Revisa antes: Canva create design",
    );
  });

  it("leaves English, other languages and other pushes as written", () => {
    expect(localizeApprovalNotification(approval, "en")).toBe(approval);
    expect(localizeApprovalNotification(approval, undefined)).toBe(approval);
    expect(localizeApprovalNotification(approval, "fr")).toBe(approval);
    const answer = { title: "Scout needs an answer", body: "Which date?" };
    expect(localizeApprovalNotification(answer, "pt-BR")).toBe(answer);
  });
});
