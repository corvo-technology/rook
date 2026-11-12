import { describe, expect, it } from "vitest";
import { railSection } from "../lib/rail-section";

describe("railSection", () => {
  it("marks the screen each address belongs to", () => {
    expect(railSection("/app", "")).toBe("agents");
    expect(railSection("/app/bot-1", "")).toBe("agents");
    expect(railSection("/app/g/group-1", "")).toBe("agents");
    expect(railSection("/app/team", "")).toBe("team");
    expect(railSection("/app/routines", "")).toBe("routines");
    expect(railSection("/app/workflows", "")).toBe("workflows");
    expect(railSection("/app/artifacts/artifact-1", "")).toBe("artifacts");
    expect(railSection("/app/usage", "")).toBe("usage");
    expect(railSection("/app/wiki", "?page=Plan")).toBe("wiki");
    expect(railSection("/settings/usage", "")).toBe("usage");
  });

  it("marks the board in the rail", () => {
    expect(railSection("/app/board", "")).toBe("board");
    expect(railSection("/app/board", "?ticket=RAK-4")).toBe("board");
  });

  it("leaves the rail unmarked on custom links reached from the account menu", () => {
    expect(railSection("/app/x/link-1", "")).toBeNull();
  });
});
