import { describe, expect, it } from "vitest";
import { parseInviteAddresses, personName, splitInvitees } from "./invite-addresses.js";

describe("parseInviteAddresses", () => {
  it("reads bare, named and mixed-case addresses once each", () => {
    expect(
      parseInviteAddresses(
        'Ana Souza <Ana@Example.test>, bruno@example.test;\n"Carla" <carla@example.test>\nana@example.test',
      ),
    ).toEqual({
      addresses: ["ana@example.test", "bruno@example.test", "carla@example.test"],
      rejected: [],
    });
  });

  it("separates what is not an address", () => {
    expect(parseInviteAddresses("nobody, ok@example.test")).toEqual({
      addresses: ["ok@example.test"],
      rejected: ["nobody"],
    });
  });
});

describe("pasting many addresses", () => {
  it("reads mixed separators from a spreadsheet, dropping duplicates and bad entries", () => {
    expect(
      parseInviteAddresses("a@x.test\tb@x.test  c@x.test;A@X.TEST\nnope, d@x.test, e@"),
    ).toEqual({
      addresses: ["a@x.test", "b@x.test", "c@x.test", "d@x.test"],
      rejected: ["nope", "e@"],
    });
  });

  it("leaves out people who already belong", () => {
    expect(splitInvitees(["a@x.test", "b@x.test"], ["B@x.test"])).toEqual({
      toInvite: ["a@x.test"],
      alreadyIn: ["b@x.test"],
    });
  });
});

describe("personName", () => {
  it("never shows the Account placeholder", () => {
    expect(personName("Account", "joao@x.test")).toBe("joao");
    expect(personName("  ", "joao@x.test")).toBe("joao");
    expect(personName("account", "joao@x.test")).toBe("joao");
    expect(personName(null, "joao@x.test")).toBe("joao");
    expect(personName("Ana Souza", "ana@x.test")).toBe("Ana Souza");
  });
});
