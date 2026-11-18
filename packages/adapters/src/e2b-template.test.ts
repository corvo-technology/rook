import type { TemplateClass } from "@e2b/desktop";
import { Template } from "@e2b/desktop";
import { describe, expect, it, vi } from "vitest";
import {
  buildE2BComputerTemplate,
  E2B_COMPUTER_SIZES,
  E2B_DESKTOP_TEMPLATE,
  e2bTemplatesForSize,
} from "./e2b-template.js";

async function buildSize(size?: "small" | "medium" | "large") {
  const build = vi.fn(async (_t: TemplateClass, name: string) => ({ name }));
  await buildE2BComputerTemplate("e2b_test", { build, size });
  return build.mock.calls[0] as unknown as [TemplateClass, string, Record<string, unknown>];
}

describe("E2B computer template", () => {
  it("builds small by default: 2 vCPU, 4 GB and 8 GB of free disk", async () => {
    const [template, name, options] = await buildSize();
    expect(name).toBe("rook-computer-s");
    expect(options).toMatchObject({
      apiKey: "e2b_test",
      cpuCount: 2,
      memoryMB: 4096,
      minFreeDiskMb: 8192,
    });
    expect(options).not.toHaveProperty("template");
    expect(JSON.parse(await Template.toJSON(template, false))).toMatchObject({
      fromTemplate: E2B_DESKTOP_TEMPLATE,
    });
  });

  it.each([
    ["medium", "rook-computer-m", 4, 8192],
    ["large", "rook-computer-l", 8, 16384],
  ] as const)("builds %s", async (size, template, cpuCount, memoryMB) => {
    const [, name, options] = await buildSize(size);
    expect(name).toBe(template);
    expect(options).toMatchObject({ cpuCount, memoryMB });
    expect(options.minFreeDiskMb).toBe(E2B_COMPUTER_SIZES[size].minFreeDiskMb);
  });

  it("grows disk and compute with the size", () => {
    const { small, medium, large } = E2B_COMPUTER_SIZES;
    expect(small.minFreeDiskMb).toBeLessThan(medium.minFreeDiskMb);
    expect(medium.minFreeDiskMb).toBeLessThan(large.minFreeDiskMb);
    expect(new Set([small.template, medium.template, large.template]).size).toBe(3);
  });

  it("serves existing corvo-computer computers as the small size", () => {
    expect(e2bTemplatesForSize("small")).toEqual(["rook-computer-s", "corvo-computer"]);
    expect(e2bTemplatesForSize("large")).toEqual(["rook-computer-l"]);
  });
});
