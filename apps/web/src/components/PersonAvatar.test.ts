import { expect, it } from "vitest";
import { personInitials } from "./PersonAvatar";

it("takes the first letters of the first and last name, or the first two of one name", () => {
  expect(personInitials("Pedro Henrique")).toBe("PH");
  expect(personInitials("João Victor da Silva")).toBe("JS");
  expect(personInitials("Marta")).toBe("MA");
  expect(personInitials("  ")).toBe("?");
});
