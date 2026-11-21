import { StarterRoutineSchema } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { CHIEF_STARTER_ROUTINES } from "./chief-routines.js";

describe("Rook's starter routines", () => {
  it("are the four on their days and hours", () => {
    expect(CHIEF_STARTER_ROUTINES.map((routine) => [routine.key, routine.cron])).toEqual([
      ["weekly-plan", "0 8 * * 1"],
      ["daily-brief", "0 8 * * 2-5"],
      ["board-review", "0 14 * * 3"],
      ["weekly-wrap-up", "0 17 * * 5"],
    ]);
  });

  it("fit the routine contract, in both languages", () => {
    for (const routine of CHIEF_STARTER_ROUTINES) {
      expect(StarterRoutineSchema.safeParse(routine).success).toBe(true);
    }
  });

  it("stay quiet when there is nothing to say and leave outside actions to approval", () => {
    for (const routine of CHIEF_STARTER_ROUTINES) {
      expect(routine.prompt.en).toMatch(/stay quiet/i);
      expect(routine.prompt["pt-BR"]).toMatch(/fique em silêncio/i);
      expect(routine.prompt.en).toMatch(/approval/i);
      expect(routine.prompt["pt-BR"]).toMatch(/aprovação/i);
    }
  });

  it("never name the Chief", () => {
    expect(JSON.stringify(CHIEF_STARTER_ROUTINES)).not.toMatch(/Chief|Chefe/);
  });
});
