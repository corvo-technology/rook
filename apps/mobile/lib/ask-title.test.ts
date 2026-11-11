import { afterEach, describe, expect, it } from "vitest";
import { approvalNoticeText, plainAskTitle } from "./ask-title.js";
import { activateUiLocale, resetI18nForTests } from "./i18n.js";

describe("plainAskTitle", () => {
  it("shows a name the card title escaped for Markdown as typed", () => {
    expect(plainAskTitle("Change the model of my\\_bot?")).toBe("Change the model of my_bot?");
  });

  it("removes the escape from every character card titles escape, and only those", () => {
    expect(plainAskTitle("\\\\ \\` \\* \\_ \\[ \\] \\< \\> \\~ \\|")).toBe("\\ ` * _ [ ] < > ~ |");
    expect(plainAskTitle("Open C:\\temp\\# now")).toBe("Open C:\\temp\\# now");
  });
});

describe("plainAskTitle for an approval", () => {
  it("shows the raw tool name as words", () => {
    expect(plainAskTitle("Review before CANVA_CREATE_DESIGN_IMPORT_JOB")).toBe(
      "Review before Canva create design import job",
    );
  });
});

describe("approvalNoticeText", () => {
  afterEach(() => resetI18nForTests());

  it("says a waiting bot in the person's language", () => {
    activateUiLocale("pt-BR");
    expect(approvalNoticeText("Ana is waiting for your approval.")).toBe(
      "Ana está aguardando a sua aprovação.",
    );
  });

  it("leaves any other text alone", () => {
    expect(approvalNoticeText("Ana is waiting")).toBe("Ana is waiting");
  });
});
