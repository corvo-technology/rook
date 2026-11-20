import { describe, expect, it } from "vitest";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";

const base = {
  graphicalToolsAllowed: false,
  groupId: null,
  semanticMemoryEnabled: false,
  messagingChannelRun: false,
};
const names = (options: Partial<Parameters<typeof selectBuiltinToolsForRun>[0]>) =>
  selectBuiltinToolsForRun({ ...base, trigger: "routine", ...options }).map((tool) => tool.name);

describe("workflow_stop", () => {
  it("is offered only to a routine run that has steps after it", () => {
    expect(names({ workflowContinues: true })).toContain("workflow_stop");
    expect(names({ workflowContinues: false })).not.toContain("workflow_stop");
    expect(names({})).not.toContain("workflow_stop");
  });

  it("is not offered in a chat", () => {
    expect(names({ trigger: "user" })).not.toContain("workflow_stop");
  });
});

describe("pass", () => {
  it("is offered only to a run the channel router woke", () => {
    expect(names({ trigger: "user", groupId: "group-1", routedRun: true })).toContain("pass");
    expect(names({ trigger: "user", groupId: "group-1", routedRun: false })).not.toContain("pass");
    expect(names({ trigger: "user", groupId: "group-1" })).not.toContain("pass");
    expect(names({ trigger: "user" })).not.toContain("pass");
  });
});

describe("request_stronger_model", () => {
  it("is offered only to a run that may still move up a tier", () => {
    expect(names({ strongerModelAvailable: true })).toContain("request_stronger_model");
    expect(names({ strongerModelAvailable: false })).not.toContain("request_stronger_model");
    expect(names({})).not.toContain("request_stronger_model");
  });
});

describe("the wiki tools", () => {
  const wiki = ["wiki_index", "wiki_search", "wiki_read"];

  it("are offered to every run that talks to the team, not only some", () => {
    for (const trigger of ["user", "routine", "agent"]) {
      expect(names({ trigger })).toEqual(expect.arrayContaining(wiki));
    }
  });

  it("are withheld from a run that answers a messaging channel", () => {
    for (const name of wiki)
      expect(names({ trigger: "user", messagingChannelRun: true })).not.toContain(name);
  });
});

describe("propose_host_action", () => {
  it("is offered only when the partner's page registered actions for the turn", () => {
    expect(names({ trigger: "user", hostActionsOffered: true })).toContain("propose_host_action");
    expect(names({ trigger: "user" })).not.toContain("propose_host_action");
  });
});

describe("find_in_app", () => {
  it("is offered to every agent, with or without fleet management, in a chat or a routine", () => {
    for (const trigger of ["user", "routine"]) {
      for (const fleetManagement of [true, false]) {
        expect(names({ trigger, fleetManagement })).toContain("find_in_app");
      }
    }
  });

  it("is not offered to a visitor's run, and a bot may switch it off", () => {
    expect(names({ visitorRun: true })).not.toContain("find_in_app");
    expect(names({ disabledBuiltinTools: ["find_in_app"] })).not.toContain("find_in_app");
  });
});
