import { describe, expect, it } from "vitest";
import { builtinAgentTools } from "./builtin-tools.js";
import { parseConnectorToolArgs } from "./lazy-tool-catalog.js";
import { normalizeOpenAiToolParameters } from "./openai-tool-parameters.js";

describe("release-watch guidance", () => {
  it("exposes one flat schema for schedule_create, with the timing check left to the server", () => {
    const tool = builtinAgentTools.find((entry) => entry.name === "schedule_create");
    const schema = tool?.inputSchema as {
      oneOf?: unknown;
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.oneOf).toBeUndefined();
    expect(schema.required).toEqual(["name", "prompt"]);
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["cron", "every", "unit", "runAt", "delayMinutes", "delaySeconds"]),
    );
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["watch", "onMessage", "startAt"]),
    );
  });

  it("accepts null or blank leftover timing fields", () => {
    const tool = builtinAgentTools.find((entry) => entry.name === "schedule_create");
    const schema = tool?.inputSchema ?? {};
    expect(
      parseConnectorToolArgs(schema, {
        name: "Morning",
        prompt: "Send the report",
        cron: "0 9 * * *",
        every: null,
        unit: "",
        runAt: "  ",
        delayMinutes: null,
        delaySeconds: "",
      }),
    ).toMatchObject({ name: "Morning", cron: "0 9 * * *" });
    const wire = normalizeOpenAiToolParameters(schema);
    const properties = wire.properties as Record<string, unknown>;
    for (const name of ["cron", "every", "unit", "runAt", "delayMinutes", "delaySeconds"]) {
      expect(JSON.stringify(properties[name])).toContain('"null"');
    }
  });

  it("exposes a read-only task catalog", () => {
    const tool = builtinAgentTools.find((entry) => entry.name === "task_catalog");
    expect(tool?.readOnly).toBe(true);
    expect(tool?.description).toMatch(/source of truth/i);
  });
});
