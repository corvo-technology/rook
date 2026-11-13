import { describe, expect, it } from "vitest";
import { parseInviteAddresses } from "./invite-addresses.js";

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
