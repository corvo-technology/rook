import { describe, expect, it } from "vitest";
import type { AgentAudience, Speaker } from "./agent-audience.js";
import { audienceOf, canTalkTo, inAudience, speakerOf } from "./agent-audience.js";
import type { SpacePermission } from "./space-permissions.js";

const audience = (patch: Partial<AgentAudience> = {}): AgentAudience => ({
  ownerUserId: "owner",
  restricted: false,
  roleIds: [],
  userIds: [],
  consultable: true,
  ...patch,
});

function person(
  userId: string,
  options: { roleIds?: string[]; permissions?: SpacePermission[] } = {},
): Speaker {
  return speakerOf(userId, {
    isOwner: false,
    permissions: options.permissions ?? ["talk_to_agents"],
    roleIds: options.roleIds ?? [],
  });
}

describe("canTalkTo", () => {
  it("lets everyone talk to an agent that is not restricted", () => {
    expect(canTalkTo(person("ana"), audience())).toBe(true);
  });

  it("still needs talk_to_agents, except for the agent's own owner", () => {
    const noKey = person("ana", { permissions: [] });
    expect(canTalkTo(noKey, audience())).toBe(false);
    expect(canTalkTo(person("owner", { permissions: [] }), audience({ restricted: true }))).toBe(
      true,
    );
  });

  it("refuses someone who is not in the space", () => {
    expect(canTalkTo(speakerOf("ana", null), audience())).toBe(false);
  });

  it("lets a restricted agent talk with its owner, the people named and the holders of a role", () => {
    const restricted = audience({ restricted: true, userIds: ["bia"], roleIds: ["sales"] });
    expect(canTalkTo(person("owner"), restricted)).toBe(true);
    expect(canTalkTo(person("bia"), restricted)).toBe(true);
    expect(canTalkTo(person("caio", { roleIds: ["ops", "sales"] }), restricted)).toBe(true);
    expect(canTalkTo(person("ana"), restricted)).toBe(false);
    expect(canTalkTo(person("ana", { roleIds: ["ops"] }), restricted)).toBe(false);
  });

  it("restricted with nobody named is only its owner's", () => {
    expect(canTalkTo(person("ana"), audience({ restricted: true }))).toBe(false);
  });

  it("lets another agent consult a consultable one for someone outside, only as an agent", () => {
    const restricted = audience({ restricted: true });
    expect(canTalkTo(person("ana"), restricted, "agent")).toBe(true);
    expect(canTalkTo(person("ana"), restricted, "person")).toBe(false);
    expect(
      canTalkTo(person("ana"), audience({ restricted: true, consultable: false }), "agent"),
    ).toBe(false);
  });

  it("never lends a consultation to someone without talk_to_agents or outside the space", () => {
    const restricted = audience({ restricted: true });
    expect(canTalkTo(person("ana", { permissions: [] }), restricted, "agent")).toBe(false);
    expect(canTalkTo(speakerOf("ana", null), restricted, "agent")).toBe(false);
  });
});

describe("inAudience", () => {
  it("is what reading a conversation asks: no consultation, no permission key", () => {
    const restricted = audience({ restricted: true, roleIds: ["sales"] });
    expect(inAudience(person("ana", { permissions: [] }), audience())).toBe(true);
    expect(inAudience(person("ana"), restricted)).toBe(false);
    expect(inAudience(person("ana", { roleIds: ["sales"] }), restricted)).toBe(true);
    expect(inAudience(person("owner"), restricted)).toBe(true);
  });
});

describe("audienceOf", () => {
  it("reads the columns of a bot row", () => {
    expect(
      audienceOf({
        userId: "u",
        audienceRestricted: true,
        audienceRoleIds: ["r"],
        audienceUserIds: ["p"],
        consultable: false,
      }),
    ).toEqual({
      ownerUserId: "u",
      restricted: true,
      roleIds: ["r"],
      userIds: ["p"],
      consultable: false,
    });
  });
});
