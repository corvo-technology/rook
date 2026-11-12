import { describe, expect, it } from "vitest";
import { wikiOfferInstruction } from "./wiki-offer.js";

const pdf = { name: "Contract.pdf", mimeType: "application/pdf" };
const notes = { name: "notes.txt", mimeType: "text/plain" };
const photo = { name: "photo.png", mimeType: "image/png" };
const video = { name: "clip.mp4", mimeType: "video/mp4" };
const interactive = { disabled: undefined, messagingChannelRun: false, background: false };

describe("offering to keep a document in the wiki", () => {
  it("tells the agent to ask first, with ask_user, and to save only after a yes", () => {
    const text = wikiOfferInstruction([pdf], interactive);
    expect(text).toContain("ask_user");
    expect(text).toContain("save_shared_memory");
    expect(text).toMatch(/only after a yes/i);
    expect(text).toMatch(/not (?:ask|again)/i);
  });

  it("names the wiki as where the team keeps what it knows, and says everyone in the space reads it", () => {
    const text = wikiOfferInstruction([pdf], interactive);
    expect(text).toMatch(/wiki/i);
    expect(text).toMatch(/where the team keeps what it knows/i);
    expect(text).toMatch(/everyone in this space/i);
  });

  it("says to offer only a document worth keeping, not every file", () => {
    expect(wikiOfferInstruction([pdf], interactive)).toMatch(
      /contract, policy, manual or specification/i,
    );
    expect(wikiOfferInstruction([pdf], interactive)).toMatch(/not a casual file|casual/i);
  });

  it("applies to a plain text file as it does to a PDF", () => {
    expect(wikiOfferInstruction([notes], interactive)).toContain("ask_user");
  });

  it("applies to Word and spreadsheet files, but not the old formats", () => {
    const docx = { name: "plan.docx", mimeType: "" };
    const sheet = {
      name: "budget",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    expect(wikiOfferInstruction([docx], interactive)).toContain("ask_user");
    expect(wikiOfferInstruction([sheet], interactive)).toContain("ask_user");
    expect(
      wikiOfferInstruction([{ name: "old.doc", mimeType: "application/msword" }], interactive),
    ).toBe("");
  });

  it("says nothing when no attached file is a document that can be read", () => {
    expect(wikiOfferInstruction([], interactive)).toBe("");
    expect(wikiOfferInstruction([photo, video], interactive)).toBe("");
  });

  it("says nothing when the agent cannot ask or cannot save", () => {
    expect(wikiOfferInstruction([pdf], { ...interactive, disabled: new Set(["ask_user"]) })).toBe(
      "",
    );
    expect(
      wikiOfferInstruction([pdf], { ...interactive, disabled: new Set(["save_shared_memory"]) }),
    ).toBe("");
  });

  it("says nothing in a messaging channel, where the agent has neither the wiki nor a way to ask", () => {
    expect(wikiOfferInstruction([pdf], { ...interactive, messagingChannelRun: true })).toBe("");
  });

  it("says nothing in a background run, where there is nobody to answer", () => {
    expect(wikiOfferInstruction([pdf], { ...interactive, background: true })).toBe("");
  });

  it("never fails a run over a file that arrives without a type or a name", () => {
    const odd = [{ name: undefined, mimeType: undefined }, { mimeType: "application/pdf" }];
    expect(() => wikiOfferInstruction(odd as never, interactive)).not.toThrow();
    // A file with no type is judged by its name, so a PDF without one is still a document.
    expect(
      wikiOfferInstruction([{ name: "scan.pdf", mimeType: undefined }] as never, interactive),
    ).toContain("ask_user");
  });

  it("is a short paragraph, since it travels with every turn that has a document", () => {
    expect(wikiOfferInstruction([pdf], interactive).length).toBeLessThan(900);
  });
});
