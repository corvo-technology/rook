import { describe, expect, it } from "vitest";
import {
  afterMessageSent,
  keepMessageModel,
  NO_MESSAGE_MODEL,
  pickMessageModel,
} from "./message-model.js";
import { modelOptionKey } from "./model-providers.js";

const agentKey = modelOptionKey("openai", "gpt-5");
const otherKey = modelOptionKey("anthropic", "claude-sonnet-4-5");

describe("the model chosen for a message", () => {
  it("applies to the next message only", () => {
    const picked = pickMessageModel(NO_MESSAGE_MODEL, otherKey, agentKey);
    expect(picked.model).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-5" });
    expect(afterMessageSent(picked)).toEqual(NO_MESSAGE_MODEL);
  });

  it("stays for the conversation when kept", () => {
    const kept = keepMessageModel(pickMessageModel(NO_MESSAGE_MODEL, otherKey, agentKey), true);
    expect(afterMessageSent(kept)).toBe(kept);
  });

  it("choosing the agent's own model clears the choice", () => {
    const picked = pickMessageModel(NO_MESSAGE_MODEL, otherKey, agentKey);
    expect(pickMessageModel(picked, agentKey, agentKey).model).toBeNull();
  });
});
