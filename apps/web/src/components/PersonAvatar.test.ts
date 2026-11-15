import { expect, it } from "vitest";
import { personInitials, presenceDotClass } from "./PersonAvatar";

it("takes the first letters of the first and last name, or the first two of one name", () => {
  expect(personInitials("Pedro Henrique")).toBe("PH");
  expect(personInitials("João Victor da Silva")).toBe("JS");
  expect(personInitials("Marta")).toBe("MA");
  expect(personInitials("  ")).toBe("?");
});

it("shows a dot for online and away only", () => {
  expect(presenceDotClass("online")).toBe("bg-success");
  expect(presenceDotClass("away")).toBe("bg-warning");
  expect(presenceDotClass("offline")).toBeNull();
  expect(presenceDotClass(undefined)).toBeNull();
});
