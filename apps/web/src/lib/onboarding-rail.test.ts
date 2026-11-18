import { describe, expect, it } from "vitest";
import { firstName, railDetails, stepsLeft } from "./onboarding-rail";

const labels = {
  business: {
    agency: "Agency",
    "online-store": "Online store",
    clinic: "Clinic",
    software: "Software",
    "customer-service": "Customer service",
    "services-office": "Services office",
    other: "Something else",
  },
  imported: "Imported",
  justTheChief: "Just the Chief",
  agents: (count: number) => `${count} agents`,
} as const;

describe("railDetails", () => {
  it("shows each answer under its step", () => {
    expect(
      railDetails(
        {
          spaceName: " Greenflow ",
          business: "agency",
          userName: "Pedro Alves",
          team: { way: "team", agents: 3 },
        },
        labels,
      ),
    ).toEqual({
      workspace: "Greenflow",
      business: "Agency",
      you: "Pedro Alves",
      start: "3 agents",
    });
  });

  it("shows nothing for what was skipped", () => {
    expect(
      railDetails({ spaceName: "", business: null, userName: null, team: null }, labels),
    ).toEqual({});
  });

  it("names how the team was chosen", () => {
    const base = { spaceName: null, business: null, userName: null };
    expect(railDetails({ ...base, team: { way: "import", agents: 0 } }, labels).start).toBe(
      "Imported",
    );
    expect(railDetails({ ...base, team: { way: "blank", agents: 0 } }, labels).start).toBe(
      "Just the Chief",
    );
  });
});

describe("stepsLeft", () => {
  it("counts the steps not done yet, including the open one", () => {
    expect(stepsLeft(["workspace", "business", "you", "bot"], new Set(["workspace"]))).toBe(3);
    expect(stepsLeft(["workspace"], new Set(["workspace"]))).toBe(0);
  });
});

describe("firstName", () => {
  it("takes the first word", () => {
    expect(firstName("  Pedro Henrique ")).toBe("Pedro");
    expect(firstName(null)).toBe("");
  });
});
